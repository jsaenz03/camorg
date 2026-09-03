// Phone-camera tether + companion viewer. A phone on the same Wi-Fi opens a
// pairing URL served by this process, snaps the photo with its native camera
// app, and POSTs the JPEG back; the bytes are forwarded to the webview as a
// Tauri event and flow through the normal capture pipeline.
//
// The phone can also browse the signed-in clinician's library (patients and
// photos) while the link is open, so the clinician can review photos with the
// patient away from the desk. The webview owns all data decisions: it pushes
// an access-filtered manifest plus an explicit filename whitelist via
// update_remote_library, and this shell only ever serves files on that
// whitelist from the photos directory. No DB access lives here. The phone can
// additionally ask the desktop to mark a patient reviewed or prepare a case
// report; both arrive as Tauri events, the webview does the work through the
// normal services, and a finished report is staged back via
// stage_remote_report for the phone to download.
//
// The phone page drives the native camera via <input capture> rather than
// getUserMedia: camera capture needs a secure context, which plain LAN http
// cannot offer on iOS/Android. Existing photos can also be sent from the
// phone's own library through the same POST path (multi-select, reviewed one
// at a time on the phone).

use std::collections::HashSet;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};
use tiny_http::{Header, Method, Response, Server};

const PHOTO_EVENT: &str = "remote-camera-photo";
const STATUS_EVENT: &str = "remote-camera-status";
const REVIEW_EVENT: &str = "companion-review-request";
const REPORT_EVENT: &str = "companion-report-request";
// Generous ceiling: a 12MP JPEG straight from a phone camera is ~4-8 MB.
// ponytail: fixed cap, no streaming; raise if phones ever send RAW/HEIC.
const MAX_BODY: usize = 25 * 1024 * 1024;
// Phone control requests are tiny JSON ({"patientId":"<uuid>"}).
const MAX_CONTROL_BODY: usize = 4 * 1024;

#[derive(serde::Serialize)]
pub struct RemoteCameraInfo {
  pub url: String,
}

#[derive(serde::Serialize, Clone)]
struct RemoteCameraPhoto {
  data: String,
}

#[derive(serde::Serialize, Clone)]
struct RemoteCameraStatus {
  connected: bool,
}

/// Body of the phone's control requests (mark reviewed / prepare report).
/// Serialized back out as the Tauri event payload (camelCase both ways).
#[derive(serde::Serialize, Deserialize)]
struct PatientRequest {
  #[serde(rename = "patientId")]
  patient_id: String,
}

struct RemoteCamera {
  shutdown: Arc<AtomicBool>,
  server: Arc<Server>,
  thread: Option<JoinHandle<()>>,
  url: String,
  /// Unix ms of the last authenticated request from the phone; the desktop
  /// polls it to auto-end an abandoned session.
  last_seen_ms: Arc<AtomicU64>,
}

/// What the phone may browse: a JSON manifest of access-filtered patients and
/// photos, the photos directory to read bytes from, and the exact set of
/// filenames those bytes may come from. Everything is pushed by the webview.
struct LibraryState {
  manifest_json: String,
  photos_dir: PathBuf,
  allowed_files: HashSet<String>,
  allowed_patients: HashSet<String>,
}

static REMOTE_CAMERA: Mutex<Option<RemoteCamera>> = Mutex::new(None);
static LIBRARY: Mutex<Option<LibraryState>> = Mutex::new(None);
// The case report the webview has prepared for the phone, if any.
static STAGED_REPORT: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Belt-and-braces filename gate alongside the whitelist: UUID-derived photo
/// filenames are plain ASCII alphanumerics with dots, dashes, underscores.
fn is_safe_filename(name: &str) -> bool {
  !name.is_empty()
    && !name.contains("..")
    && name
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// The pairing token is the bearer secret for the LAN link, and it persists
/// across restarts: the same URL is served every session, so the phone's
/// saved bookmark (or home-screen icon) keeps working without re-scanning
/// the QR. Stored in the app data dir next to the database; deleting the
/// file revokes every phone link saved to it.
fn pairing_token(app: &AppHandle) -> Result<String, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  let path = dir.join("phone-link-token");
  if let Ok(token) = std::fs::read_to_string(&path) {
    let token = token.trim();
    if token.len() == 16 && token.chars().all(|c| c.is_ascii_hexdigit()) {
      return Ok(token.to_string());
    }
  }
  let token = format!("{:016x}", rand::random::<u64>());
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  std::fs::write(&path, &token).map_err(|e| e.to_string())?;
  Ok(token)
}

/// The tether port sits next to the token (phone-link-port) so the whole
/// pairing URL — IP, port and token — is stable across restarts. Without a
/// pinned port every launch would bind an ephemeral one and the phone's
/// saved home-screen icon would point at a dead endpoint. Unprivileged range
/// only; the first launch binds an ephemeral port and pins whatever it got.
/// A corrupt file reads as "no pin" — the link still starts and re-pins.
fn pinned_port(app: &AppHandle) -> Result<Option<u16>, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  let port = std::fs::read_to_string(dir.join("phone-link-port"))
    .ok()
    .and_then(|text| parse_saved_port(&text));
  Ok(port)
}

fn parse_saved_port(text: &str) -> Option<u16> {
  text.trim().parse::<u16>().ok().filter(|p| *p >= 1024)
}

fn pin_port(app: &AppHandle, port: u16) -> Result<(), String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  std::fs::write(dir.join("phone-link-port"), port.to_string()).map_err(|e| e.to_string())
}

/// "Start automatically" preference (the Phone link dialog's toggle): when
/// on, the link starts itself whenever the app opens, so a doctor who has
/// paired once never scans the QR again. On by default.
#[derive(serde::Serialize, serde::Deserialize)]
struct PhoneLinkPrefs {
  #[serde(default = "default_true")]
  remember: bool,
}

fn default_true() -> bool {
  true
}

fn phone_link_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_data_dir()
    .map(|d| d.join("phone-link.json"))
    .map_err(|e| format!("could not resolve the app data dir: {e}"))
}

#[tauri::command]
pub fn get_phone_link_remember(app: AppHandle) -> Result<bool, String> {
  let path = phone_link_prefs_path(&app)?;
  match std::fs::read_to_string(&path) {
    Ok(text) => serde_json::from_str::<PhoneLinkPrefs>(&text)
      .map(|p| p.remember)
      .map_err(|e| e.to_string()),
    // No file yet: the default (remembered) applies.
    Err(_) => Ok(true),
  }
}

#[tauri::command]
pub fn set_phone_link_remember(app: AppHandle, remember: bool) -> Result<(), String> {
  let path = phone_link_prefs_path(&app)?;
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
  }
  let json = serde_json::to_string(&PhoneLinkPrefs { remember }).map_err(|e| e.to_string())?;
  std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// The LAN address a phone would use to reach this machine. A UDP "connect"
/// selects the default-route interface without sending any packets.
fn lan_ip() -> IpAddr {
  UdpSocket::bind("0.0.0.0:0")
    .and_then(|s| s.connect("8.8.8.8:80").map(|_| s))
    .and_then(|s| s.local_addr())
    .map(|a| a.ip())
    .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

/// Bind the tether listener. SO_REUSEADDR (Unix only) lets an app restart
/// rebind the pinned port even while the previous session's phone
/// connections are still lingering in TIME_WAIT; without it a quick restart
/// would EADDRINUSE itself off the pinned port and force a re-pair.
/// ponytail: Windows' SO_REUSEADDR would also hijack a *live* listener, so
/// there we bind plain and let a busy port fall back to a fresh one.
fn bind_listener(ip: IpAddr, port: u16) -> std::io::Result<std::net::TcpListener> {
  let addr = std::net::SocketAddr::new(ip, port);
  #[cfg(unix)]
  {
    let socket = socket2::Socket::new(
      socket2::Domain::for_address(addr),
      socket2::Type::STREAM,
      Some(socket2::Protocol::TCP),
    )?;
    socket.set_reuse_address(true)?;
    socket.bind(&addr.into())?;
    socket.listen(16)?;
    Ok(socket.into())
  }
  #[cfg(not(unix))]
  {
    std::net::TcpListener::bind(addr)
  }
}

fn content_type(value: &str) -> Header {
  Header::from_bytes(&b"Content-Type"[..], value.as_bytes()).expect("static header value")
}

fn content_disposition(value: &str) -> Header {
  Header::from_bytes(&b"Content-Disposition"[..], value.as_bytes()).expect("static header value")
}

fn cache_control(value: &str) -> Header {
  Header::from_bytes(&b"Cache-Control"[..], value.as_bytes()).expect("static header value")
}

fn respond_text(request: tiny_http::Request, status: u16, body: &str) {
  let _ = request.respond(
    Response::from_string(body)
      .with_status_code(status)
      .with_header(content_type("text/plain; charset=utf-8")),
  );
}

fn respond_json(request: tiny_http::Request, status: u16, body: String) {
  let _ = request.respond(
    Response::from_string(body)
      .with_status_code(status)
      .with_header(content_type("application/json")),
  );
}

fn handle_library(request: tiny_http::Request) {
  let manifest = LIBRARY
    .lock()
    .unwrap()
    .as_ref()
    .map(|lib| lib.manifest_json.clone())
    .unwrap_or_else(|| "{\"viewing\":false}".to_string());
  respond_json(request, 200, manifest);
}

fn handle_image(request: tiny_http::Request, filename: &str) {
  // The whitelist is the authority; the charset check just keeps any weird
  // bytes from ever reaching the filesystem layer.
  let allowed = LIBRARY.lock().unwrap().as_ref().is_some_and(|lib| {
    lib.allowed_files.contains(filename) && is_safe_filename(filename)
  });
  if !allowed {
    respond_text(request, 404, "Not found");
    return;
  }
  let path = LIBRARY
    .lock()
    .unwrap()
    .as_ref()
    .map(|lib| lib.photos_dir.join(filename));
  let Some(path) = path else {
    respond_text(request, 404, "Not found");
    return;
  };
  match std::fs::read(&path) {
    Ok(bytes) => {
      let _ = request.respond(
        Response::from_data(bytes)
          .with_header(content_type("image/jpeg"))
          // Clinical images: keep them out of shared/proxy caches; an hour of
          // private caching smooths library browsing without disk trails
          // beyond the phone's own (private-mode-invisible) cache.
          .with_header(cache_control("private, max-age=3600")),
      );
    }
    Err(e) => {
      crate::diagnostics::record(
        crate::diagnostics::Level::Error,
        "phone-camera",
        &format!("Could not read photo file for the phone: {e}"),
        None,
      );
      respond_text(request, 500, "Could not read photo");
    }
  }
}

/// Shared tail of the review / report control requests: read the small JSON
/// body, gate the patient against the shared manifest, and relay it to the
/// webview as a Tauri event. The actual work happens webview-side through the
/// normal services (access checks, DB writes, report generation).
fn handle_patient_request(app: &AppHandle, mut request: tiny_http::Request, event: &str) {
  let outcome = (|| -> Result<(), (u16, &'static str)> {
    if request.body_length().is_some_and(|len| len > MAX_CONTROL_BODY) {
      return Err((413, "Request too large"));
    }
    let mut body = Vec::new();
    let read = request
      .as_reader()
      .take(MAX_CONTROL_BODY as u64 + 1)
      .read_to_end(&mut body);
    if read.is_err() {
      return Err((400, "Bad request"));
    }
    let parsed: PatientRequest =
      serde_json::from_slice(&body).map_err(|_| (400, "Bad request"))?;
    let allowed = LIBRARY
      .lock()
      .unwrap()
      .as_ref()
      .is_some_and(|lib| lib.allowed_patients.contains(&parsed.patient_id));
    if !allowed {
      return Err((404, "Not found"));
    }
    app
      .emit(event, &parsed)
      .map_err(|_| (500, "Could not reach the app"))?;
    Ok(())
  })();
  match outcome {
    Ok(()) => respond_text(request, 200, "ok"),
    Err((status, msg)) => respond_text(request, status, msg),
  }
}

fn handle_report_download(request: tiny_http::Request) {
  let staged = STAGED_REPORT.lock().unwrap().clone();
  let Some(path) = staged else {
    respond_json(request, 404, "{\"ready\":false}".to_string());
    return;
  };
  match std::fs::read(&path) {
    Ok(bytes) => {
      let _ = request.respond(
        Response::from_data(bytes)
          .with_header(content_type("application/pdf"))
          .with_header(content_disposition("inline; filename=\"camog-case-report.pdf\""))
          .with_header(cache_control("no-store")),
      );
    }
    Err(_) => respond_json(request, 404, "{\"ready\":false}".to_string()),
  }
}

fn handle_request(app: &AppHandle, token: &str, last_seen_ms: &AtomicU64, mut request: tiny_http::Request) {
  let url = request.url().to_string();
  let prefix = format!("/t/{token}/");
  let path = match url.strip_prefix(&prefix) {
    Some(path) => path,
    None => {
      respond_text(request, 404, "Not found");
      return;
    }
  };
  // Any authenticated request (photo grabs included) proves the phone is live.
  last_seen_ms.store(now_ms(), Ordering::Relaxed);

  let method = request.method().clone();
  if method == Method::Get && (path.is_empty() || path == "index.html") {
    let _ = request.respond(
      Response::from_string(PAGE_HTML).with_header(content_type("text/html; charset=utf-8")),
    );
  } else if method == Method::Get && path == "logo.png" {
    let _ = request.respond(
      Response::from_data(LOGO_PNG.to_vec()).with_header(content_type("image/png")),
    );
  } else if method == Method::Get && path == "manifest.webmanifest" {
    respond_json(request, 200, WEB_MANIFEST.to_string());
  } else if method == Method::Get && path == "hello" {
    // Phone page pings on load so the desktop knows pairing succeeded.
    let _ = app.emit(STATUS_EVENT, RemoteCameraStatus { connected: true });
    respond_text(request, 200, "ok");
  } else if method == Method::Get && path == "library" {
    handle_library(request);
  } else if method == Method::Get && path.starts_with("img/") {
    handle_image(request, &path["img/".len()..]);
  } else if method == Method::Get && path == "report" {
    handle_report_download(request);
  } else if method == Method::Post && path == "bye" {
    // Phone page beacons on hide/unload so the desktop can clear the
    // "connected" indicator instead of showing it forever.
    let _ = app.emit(STATUS_EVENT, RemoteCameraStatus { connected: false });
    respond_text(request, 200, "ok");
  } else if method == Method::Post && path == "review" {
    handle_patient_request(app, request, REVIEW_EVENT);
  } else if method == Method::Post && path == "report-request" {
    handle_patient_request(app, request, REPORT_EVENT);
  } else if method == Method::Post && path == "photo" {
    if request.body_length().is_some_and(|len| len > MAX_BODY) {
      respond_text(request, 413, "Photo too large");
      return;
    }
    let mut body = Vec::new();
    let read = request
      .as_reader()
      .take(MAX_BODY as u64 + 1)
      .read_to_end(&mut body);
    if read.is_err() || body.is_empty() {
      respond_text(request, 400, "Bad request");
      return;
    }
    if body.len() > MAX_BODY {
      respond_text(request, 413, "Photo too large");
      return;
    }

    let photo = RemoteCameraPhoto {
      data: base64::engine::general_purpose::STANDARD.encode(&body),
    };
    match app.emit(PHOTO_EVENT, photo) {
      Ok(()) => respond_text(request, 200, "ok"),
      Err(e) => {
        crate::diagnostics::record(
          crate::diagnostics::Level::Error,
          "phone-camera",
          &format!("Could not deliver phone photo to the app: {e}"),
          None,
        );
        respond_text(request, 500, "Could not deliver photo to app")
      }
    }
  } else {
    respond_text(request, 404, "Not found");
  }
}

fn spawn_handler(
  app: AppHandle,
  server: Arc<Server>,
  token: String,
  last_seen_ms: Arc<AtomicU64>,
  shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
  std::thread::spawn(move || {
    while !shutdown.load(Ordering::Relaxed) {
      match server.recv() {
        Ok(request) => handle_request(&app, &token, &last_seen_ms, request),
        // stop_remote_camera() unblocks the listener to wake us up.
        Err(_) => break,
      }
    }
  })
}

// Commands are async so they run off the main thread; stop joins the server
// thread and must not block the UI mid-upload.
#[tauri::command]
pub async fn start_remote_camera(app: AppHandle) -> Result<RemoteCameraInfo, String> {
  stop_remote_camera().await;

  let ip = lan_ip();
  // Bind the pinned port first so last session's URL keeps working; only if
  // something else grabbed it fall back to an ephemeral port (and re-pin, so
  // the new URL is the stable one going forward).
  let pinned = pinned_port(&app)?;
  let (server, port) = match pinned.and_then(|p| {
    let listener = bind_listener(ip, p).ok()?;
    Server::from_listener(listener, None).ok().map(|server| (server, p))
  }) {
    Some((server, port)) => (server, port),
    None => {
      let start_fail = |e: String| {
        let msg = format!("failed to start phone-camera server: {e}");
        crate::diagnostics::record(crate::diagnostics::Level::Error, "phone-camera", &msg, None);
        msg
      };
      let listener = bind_listener(ip, 0).map_err(|e| start_fail(e.to_string()))?;
      let server = Server::from_listener(listener, None).map_err(|e| start_fail(e.to_string()))?;
      let port = server.server_addr().to_ip().map(|a| a.port()).ok_or_else(|| {
        let msg = "failed to determine phone-camera server port".to_string();
        crate::diagnostics::record(crate::diagnostics::Level::Error, "phone-camera", &msg, None);
        msg
      })?;
      if pinned.is_some() {
        crate::diagnostics::record(
          crate::diagnostics::Level::Info,
          "phone-camera",
          "The saved phone-link port was busy, so the link moved to a new address — re-scan the QR code once.",
          None,
        );
      }
      pin_port(&app, port)?;
      (server, port)
    }
  };
  let token = pairing_token(&app)?;
  let url = format!("http://{ip}:{port}/t/{token}/");
  let server = Arc::new(server);
  let last_seen_ms = Arc::new(AtomicU64::new(now_ms()));

  let shutdown = Arc::new(AtomicBool::new(false));
  let thread = spawn_handler(
    app,
    Arc::clone(&server),
    token.clone(),
    Arc::clone(&last_seen_ms),
    Arc::clone(&shutdown),
  );

  *REMOTE_CAMERA.lock().unwrap() = Some(RemoteCamera {
    shutdown,
    server,
    thread: Some(thread),
    url: url.clone(),
    last_seen_ms,
  });
  *STAGED_REPORT.lock().unwrap() = None;

  // No token in diagnostics — the pairing URL is a secret.
  crate::diagnostics::record(
    crate::diagnostics::Level::Info,
    "phone-camera",
    &format!("Phone camera link started on {ip}:{port}"),
    None,
  );

  Ok(RemoteCameraInfo { url })
}

#[tauri::command]
pub async fn stop_remote_camera() {
  if let Some(mut remote_camera) = REMOTE_CAMERA.lock().unwrap().take() {
    remote_camera.shutdown.store(true, Ordering::Relaxed);
    remote_camera.server.unblock();
    if let Some(thread) = remote_camera.thread.take() {
      let _ = thread.join();
    }
  }
  *STAGED_REPORT.lock().unwrap() = None;
}

/// The pairing URL of the running link, if any. Lets a second surface (the
/// capture screen's phone panel) reuse the live session instead of restarting
/// it, which would invalidate the QR the phone may already have open.
#[tauri::command]
pub fn remote_camera_active() -> Option<RemoteCameraInfo> {
  REMOTE_CAMERA
    .lock()
    .unwrap()
    .as_ref()
    .map(|rc| RemoteCameraInfo {
      url: rc.url.clone(),
    })
}

/// Milliseconds since the phone's last request, while a link is running. The
/// desktop uses this to auto-end abandoned sessions.
#[tauri::command]
pub fn remote_camera_idle_ms() -> Option<u64> {
  let remote_camera = REMOTE_CAMERA.lock().unwrap();
  let rc = remote_camera.as_ref()?;
  Some(now_ms().saturating_sub(rc.last_seen_ms.load(Ordering::Relaxed)))
}

/// The webview pushes the access-filtered library manifest, the exact set of
/// photo files the phone may fetch, and the patient ids it may act on.
/// Called when a companion session starts (and whenever the library should be
/// refreshed while it is open).
#[tauri::command]
pub fn update_remote_library(
  manifest_json: String,
  photos_dir: String,
  allowed_files: Vec<String>,
  allowed_patients: Vec<String>,
) -> Result<(), String> {
  if !allowed_files.iter().all(|f| is_safe_filename(f)) {
    return Err("Refusing unsafe photo filename".to_string());
  }
  *LIBRARY.lock().unwrap() = Some(LibraryState {
    manifest_json,
    photos_dir: PathBuf::from(photos_dir),
    allowed_files: allowed_files.into_iter().collect(),
    allowed_patients: allowed_patients.into_iter().collect(),
  });
  Ok(())
}

/// Drop everything shared with the phone (library + staged report): used when
/// the share toggle goes off or the companion session ends.
#[tauri::command]
pub fn clear_remote_library() {
  *LIBRARY.lock().unwrap() = None;
  *STAGED_REPORT.lock().unwrap() = None;
}

/// Hand the phone a case report the webview has just generated.
#[tauri::command]
pub fn stage_remote_report(path: String) {
  *STAGED_REPORT.lock().unwrap() = Some(PathBuf::from(path));
}

// 256px copy of the app logo (public/logo.png) so the phone page carries the
// brand mark without shipping the 1024px original over the LAN.
const LOGO_PNG: &[u8] = include_bytes!("../assets/logo.png");

// Home-screen app (PWA) manifest: lets the phone add Camog to its home
// screen with the app logo and open it standalone, without browser chrome.
// Relative start_url/scope resolve under /t/<token>/ so each phone's saved
// icon points at its own pairing. Android uses this; iOS home-screen icons
// come from the apple-touch-icon link in the page head.
// ponytail: single 256px "any" icon — a dedicated maskable PNG would avoid
// launcher cropping but we ship only the one logo asset.
const WEB_MANIFEST: &str = r##"{"name":"Camog · Clinical Photos","short_name":"Camog","start_url":"./","scope":"./","display":"standalone","background_color":"#f4f4f5","theme_color":"#f4f4f5","icons":[{"src":"logo.png","sizes":"256x256","type":"image/png","purpose":"any"}]}"##;

include!("remote_camera_page.rs");

#[cfg(test)]
mod tests {
  use super::{is_safe_filename, PAGE_HTML, WEB_MANIFEST};

  // Guards the branded phone page: the logo route, wordmark, theme tokens,
  // and the [hidden] override that keeps screens toggleable.
  #[test]
  fn phone_page_carries_branding() {
    assert!(PAGE_HTML.contains(r#"src="logo.png""#));
    assert!(PAGE_HTML.contains(">Clinical Photos<"));
    assert!(PAGE_HTML.contains("--primary: #00aeb5"));
    assert!(PAGE_HTML.contains("[hidden] { display: none !important; }"));
    assert!(PAGE_HTML.trim_end().ends_with("</html>"));
  }

  // The companion viewer surface: library tab, patient rows, viewer, and the
  // manifest fetch that switches both on.
  #[test]
  fn phone_page_carries_library_viewer() {
    assert!(PAGE_HTML.contains(r#"fetch('library')"#));
    assert!(PAGE_HTML.contains("screen-patient"));
    assert!(PAGE_HTML.contains("screen-viewer"));
    assert!(PAGE_HTML.contains(r#"'img/' + e.p.id + '.thumb.jpg'"#));
    assert!(PAGE_HTML.contains(r#"'img/' + e.p.id + '.jpg'"#));
    assert!(PAGE_HTML.contains("Review overdue"));
    assert!(PAGE_HTML.contains("No consent on record"));
  }

  // Companion extras: theme toggle, body-map thumbnail overlays, desktop-style
  // compare (pickers + side/overlay), review and report actions, blur toggle.
  #[test]
  fn phone_page_carries_companion_extras() {
    assert!(PAGE_HTML.contains("body.light"));
    assert!(PAGE_HTML.contains("camog-theme"));
    assert!(PAGE_HTML.contains("BODY_FRONT"));
    assert!(PAGE_HTML.contains("screen-compare"));
    assert!(PAGE_HTML.contains("cmp-left"));
    assert!(PAGE_HTML.contains("cmp-overlay"));
    assert!(PAGE_HTML.contains("cell-fig"));
    assert!(PAGE_HTML.contains("'review'"));
    assert!(PAGE_HTML.contains("'report-request'"));
    assert!(PAGE_HTML.contains("blurred"));
  }

  // Send-from-library + the all-photos tab + patient detail lines: the phone
  // packs the same affordances the desktop offers (upload dialog, Photos
  // page, patient header details).
  #[test]
  fn phone_page_carries_send_photo_and_photos_tab() {
    assert!(PAGE_HTML.contains(r#"id="pick""#));
    assert!(PAGE_HTML.contains(r#"type="file" accept="image/*" multiple"#));
    assert!(PAGE_HTML.contains("Send from library"));
    assert!(PAGE_HTML.contains(r#"id="tab-all""#));
    assert!(PAGE_HTML.contains(r#"id="screen-all""#));
    assert!(PAGE_HTML.contains("cell-name"));
    assert!(PAGE_HTML.contains("patientName(e.p.patientId)"));
    assert!(PAGE_HTML.contains("p.dob"));
    assert!(PAGE_HTML.contains("p.ownerName"));
    assert!(PAGE_HTML.contains("p.consentScopeLabel"));
  }

  // Trust boundary: only plain UUID-derived names may reach the filesystem.
  #[test]
  fn filename_gate() {
    assert!(is_safe_filename("b7c9d1e2-3f4a-4b5c-8d6e-7f8a9b0c1d2e.jpg"));
    assert!(is_safe_filename("b7c9d1e2.thumb.jpg"));
    assert!(!is_safe_filename(""));
    assert!(!is_safe_filename(".."));
    assert!(!is_safe_filename("../secret.txt"));
    assert!(!is_safe_filename("a/b.jpg"));
    assert!(!is_safe_filename("a\\b.jpg"));
    assert!(!is_safe_filename("photo name.jpg"));
    assert!(!is_safe_filename("café.jpg"));
  }

  // The saved port file is read from disk on every launch; corrupt or
  // privileged values must read as "no pin" (start + re-pin) rather than
  // breaking the link or asking the OS for a port it can't have.
  #[test]
  fn saved_port_gate() {
    use super::parse_saved_port;
    assert_eq!(parse_saved_port("49152"), Some(49152));
    assert_eq!(parse_saved_port("  8080\n"), Some(8080));
    assert_eq!(parse_saved_port("65535"), Some(65535));
    assert_eq!(parse_saved_port(""), None);
    assert_eq!(parse_saved_port("not-a-port"), None);
    assert_eq!(parse_saved_port("80"), None);
    assert_eq!(parse_saved_port("0"), None);
    assert_eq!(parse_saved_port("70000"), None);
    assert_eq!(parse_saved_port("-1"), None);
  }

  // The pinned-port promise: an app quit leaves TIME_WAIT sockets on the
  // tether port (server-closed phone connections), and the next launch must
  // still rebind that exact port. SO_REUSEADDR is what makes this pass;
  // a plain std bind fails with EADDRINUSE while TIME_WAIT lingers.
  #[test]
  fn pinned_port_rebinds_over_time_wait() {
    use super::bind_listener;
    let ip: std::net::IpAddr = "127.0.0.1".parse().unwrap();
    let listener = bind_listener(ip, 0).expect("ephemeral bind");
    let port = listener.local_addr().unwrap().port();
    // One served connection, closed from the server side first — exactly
    // what the previous session leaves behind after phone traffic.
    let client = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
    let (conn, _) = listener.accept().unwrap();
    drop(conn);
    drop(client);
    drop(listener);
    let rebound = bind_listener(ip, port).expect("pinned port must rebind over TIME_WAIT");
    assert_eq!(rebound.local_addr().unwrap().port(), port);
  }

  // Persistent pairing on the phone side: a saved home-screen app opened
  // while the desktop is closed (or mid-restart) keeps pinging until the
  // link answers, heartbeats so the desktop's idle watchdog spares an open
  // page, and probes immediately when brought back to the foreground.
  #[test]
  fn phone_page_reconnects_and_heartbeats() {
    assert!(PAGE_HTML.contains("setInterval(probe, 3000)"));
    assert!(PAGE_HTML.contains("setInterval(beat, 60000)"));
    assert!(PAGE_HTML.contains("addEventListener('visibilitychange'"));
    assert!(PAGE_HTML.contains("function disconnected()"));
  }

  // Reports from a home-screen app: a standalone PWA cannot open a new tab
  // (target="_blank" is a silent no-op) nor render PDFs inline, so the page
  // must detect standalone and hand the file to the platform instead —
  // share sheet where available, else a download.
  #[test]
  fn phone_page_report_survives_standalone() {
    assert!(PAGE_HTML.contains("display-mode: standalone"));
    assert!(PAGE_HTML.contains("navigator.canShare"));
    assert!(PAGE_HTML.contains("a.download = 'camog-case-report.pdf'"));
  }

  // Home-screen app (PWA): the page links the manifest and the app logo, the
  // manifest route serves that logo as the icon, and light is the default
  // appearance on a fresh phone (dark stays opt-in, remembered per phone).
  #[test]
  fn phone_page_pwa_and_light_default() {
    assert!(PAGE_HTML.contains(r##"<link rel="manifest" href="manifest.webmanifest">"##));
    assert!(PAGE_HTML.contains(r##"<link rel="apple-touch-icon" href="logo.png">"##));
    assert!(PAGE_HTML.contains(r##"<meta name="apple-mobile-web-app-capable" content="yes">"##));
    assert!(PAGE_HTML.contains(r##"<body class="light">"##));
    assert!(PAGE_HTML.contains(r##"localStorage.getItem(THEME_KEY) !== 'dark'"##));
    assert!(WEB_MANIFEST.contains(r##""icons":[{"src":"logo.png","sizes":"256x256","type":"image/png","purpose":"any"}]"##));
    assert!(WEB_MANIFEST.contains(r##""display":"standalone""##));
  }
}
