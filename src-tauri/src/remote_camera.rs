// Phone-camera tether + companion viewer. A phone that can reach this
// machine — same Wi-Fi, the phone's own hotspot, or a shared Tailscale
// network — opens a pairing URL served by this process, snaps the photo with
// its native camera app, and POSTs the JPEG back; the bytes are forwarded to
// the webview as a Tauri event and flow through the normal capture pipeline.
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

use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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

/// Which network a pairing address lives on — the pairing UI labels each
/// candidate QR with this.
#[derive(serde::Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum LinkKind {
  Lan,
  Tailscale,
}

/// One address a phone could reach the link on right now.
#[derive(serde::Serialize, PartialEq, Debug)]
pub struct RemoteCameraUrl {
  pub url: String,
  pub kind: LinkKind,
}

#[derive(serde::Serialize)]
pub struct RemoteCameraInfo {
  /// Every currently-reachable pairing URL, same-network primary first.
  /// Recomputed from the live routing table on every read, so a network
  /// change needs a dialog refresh at most — never a link restart.
  pub urls: Vec<RemoteCameraUrl>,
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
  /// Port and token are all that is pinned; the URLs are rebuilt from the
  /// live routing table whenever anyone asks, so they survive network changes.
  port: u16,
  token: String,
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

/// Per-source tracker for unauthenticated requests (wrong or missing pairing
/// token). Every phone request carries the token, so a burst of failures from
/// one address is a scanner — or a phone holding a code that was just
/// rotated. After FAIL_LIMIT failures inside FAIL_WINDOW the address is
/// refused for BLOCK_FOR, answered with the same 404 as any unknown route so
/// the block itself stays invisible. A request presenting the valid token
/// clears its address, so a phone that re-scans the QR reconnects immediately
/// even while its old URL's retry loop is still racking up failures.
/// ponytail: per-address map with a hard cap (see MAX_TRACKED); IPv6 privacy
/// addresses rotate and evade per-address tracking — a persistent attacker
/// needs network-level monitoring, not this.
const FAIL_LIMIT: u32 = 10;
const FAIL_WINDOW: Duration = Duration::from_secs(60);
const BLOCK_FOR: Duration = Duration::from_secs(5 * 60);
const MAX_TRACKED: usize = 1024;

#[derive(Default)]
struct AuthGuard {
  fails: Mutex<HashMap<IpAddr, FailState>>,
}

#[derive(Default)]
struct FailState {
  fails: u32,
  window_started: Option<Instant>,
  blocked_until: Option<Instant>,
}

impl AuthGuard {
  fn new() -> Self {
    Self::default()
  }

  fn is_blocked(&self, ip: IpAddr, now: Instant) -> bool {
    self.fails
      .lock()
      .unwrap()
      .get(&ip)
      .is_some_and(|s| s.blocked_until.is_some_and(|until| now < until))
  }

  /// Record a wrong-token request. Returns `Some(true)` when this failure
  /// just crossed the limit (the caller logs the block once, not per
  /// request), `Some(false)` when it is the first failure of a fresh window
  /// (worth a line in diagnostics), `None` otherwise.
  fn note_failure(&self, ip: IpAddr, now: Instant) -> Option<bool> {
    let mut map = self.fails.lock().unwrap();
    if map.len() >= MAX_TRACKED && !map.contains_key(&ip) {
      map.clear(); // wholesale eviction: bounded memory over precise LRU
    }
    let state = map.entry(ip).or_default();
    let window_fresh = state
      .window_started
      .is_some_and(|started| now.duration_since(started) < FAIL_WINDOW);
    if !window_fresh {
      state.fails = 0;
      state.window_started = Some(now);
    }
    state.fails += 1;
    if state.fails >= FAIL_LIMIT {
      let just_blocked = state.blocked_until.is_none();
      state.blocked_until = Some(now + BLOCK_FOR);
      return if just_blocked { Some(true) } else { None };
    }
    if state.fails == 1 {
      Some(false)
    } else {
      None
    }
  }

  /// A valid-token request arrived: forget the address entirely, so a
  /// re-scanned phone is never refused over its old URL's failures.
  fn clear(&self, ip: IpAddr) {
    self.fails.lock().unwrap().remove(&ip);
  }
}

// ---- Tier 2: session pairing ------------------------------------------------
// The pairing code in the URL is an exchange credential: presenting it once
// mints a per-device session cookie, and every later request authenticates
// by that cookie on token-less paths. The long-lived code stops riding in
// per-request URLs (intermediate logs, browser history expansion, each
// cleartext LAN request), and sessions become revocable server-side —
// stopping the link drops this store and kills every session without
// rotating the code. Stage 2 wires the below into handle_request; until
// then the allows stay and the unit tests are the consumers.
// ponytail: HashSet of raw ids, no expiry — link lifetime (plus the idle
// auto-close) bounds it; per-session revoke arrives with a device-list UI.

/// Cookie name carrying the session id.
#[allow(dead_code)] // Stage 2
const SESSION_COOKIE: &str = "camog_session";

#[allow(dead_code)] // Stage 2
#[derive(Default)]
struct SessionStore {
  sessions: Mutex<HashSet<[u8; 16]>>,
}

#[allow(dead_code)] // Stage 2
impl SessionStore {
  fn new() -> Self {
    Self::default()
  }

  /// Mint a fresh 128-bit session id. Two u64 draws rather than one array
  /// draw, matching how the pairing token itself is minted.
  fn mint(&self) -> [u8; 16] {
    let mut id = [0u8; 16];
    id[..8].copy_from_slice(&rand::random::<u64>().to_be_bytes());
    id[8..].copy_from_slice(&rand::random::<u64>().to_be_bytes());
    self.sessions.lock().unwrap().insert(id);
    id
  }

  fn contains(&self, id: &[u8; 16]) -> bool {
    self.sessions.lock().unwrap().contains(id)
  }

  /// Groundwork for a future per-device kill switch; today revocation is
  /// dropping the whole store when the link stops.
  #[allow(dead_code)] // no runtime caller yet; tested for when the UI lands
  fn remove_all(&self) {
    self.sessions.lock().unwrap().clear();
  }
}

/// Parse the session id out of a request's Cookie header value. Phones send
/// exactly the one cookie we set, but splitting on ';' keeps the parse
/// honest if an engine ever appends its own.
#[allow(dead_code)] // Stage 2
fn session_from_cookie(header: Option<&str>) -> Option<[u8; 16]> {
  let header = header?;
  header
    .split(';')
    .find_map(|pair| parse_session_id(pair.trim().strip_prefix("camog_session=")?.trim()))
}

#[allow(dead_code)] // Stage 2
fn parse_session_id(text: &str) -> Option<[u8; 16]> {
  if text.len() != 32 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
    return None;
  }
  let mut id = [0u8; 16];
  for (i, byte) in id.iter_mut().enumerate() {
    *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
  }
  Some(id)
}

#[allow(dead_code)] // Stage 2
fn session_id_hex(id: &[u8; 16]) -> String {
  id.iter().map(|b| format!("{b:02x}")).collect()
}

/// The Set-Cookie line for a fresh session. Session-scoped on purpose (no
/// Max-Age/Expires — it dies with the browser session, fine for a
/// standalone PWA), HttpOnly, SameSite=Strict (every request is
/// same-origin), and deliberately no Secure: the link is plain HTTP, where
/// a Secure cookie would never come back.
#[allow(dead_code)] // Stage 2
fn session_cookie_header(id: &[u8; 16]) -> Header {
  let value = format!(
    "{SESSION_COOKIE}={}; Path=/; HttpOnly; SameSite=Strict",
    session_id_hex(id)
  );
  Header::from_bytes(&b"Set-Cookie"[..], value.as_bytes()).expect("static header value")
}

/// What handle_request should do with an incoming request, decided before
/// any routing.
#[allow(dead_code)] // Stage 2
#[derive(Debug, PartialEq)]
enum AuthAction {
  /// The URL presented the live pairing code: mint a session (Some — set
  /// the cookie) or reuse the live one the request already carries (None),
  /// then redirect to /. Reusing keeps an old page still sitting on a
  /// /t/<code>/ URL from minting a session on every relative fetch.
  Exchange { fresh: Option<[u8; 16]> },
  /// A live session cookie authenticated the request.
  Authenticated,
  /// Wrong code, or a missing/dead cookie: count it (unless the source is
  /// already blocked) and answer with the same 404 as any unknown route.
  /// `noted` is AuthGuard::note_failure's result so the caller can emit the
  /// once-only diagnostics lines.
  Rejected { noted: Option<bool> },
}

/// The auth evaluation order as a pure function: pairing code first — a
/// valid code always wins, even from a blocked address, because the
/// re-scanned phone is legitimate and its old URL's retry loop is what
/// filled the failure history — then the session cookie, then the
/// 404-plus-count fallback. Guard and store are updated here so the whole
/// ordering is unit-testable without an AppHandle.
#[allow(dead_code)] // Stage 2
fn classify_auth(
  url: &str,
  cookie_header: Option<&str>,
  token: &str,
  store: &SessionStore,
  guard: &AuthGuard,
  source_ip: Option<IpAddr>,
  now: Instant,
) -> AuthAction {
  if url.starts_with(&format!("/t/{token}/")) {
    if let Some(ip) = source_ip {
      guard.clear(ip);
    }
    let fresh = if session_from_cookie(cookie_header).is_some_and(|id| store.contains(&id)) {
      None
    } else {
      Some(store.mint())
    };
    return AuthAction::Exchange { fresh };
  }
  if session_from_cookie(cookie_header).is_some_and(|id| store.contains(&id)) {
    if let Some(ip) = source_ip {
      guard.clear(ip);
    }
    return AuthAction::Authenticated;
  }
  let noted = source_ip
    .filter(|ip| !guard.is_blocked(*ip, now))
    .and_then(|ip| guard.note_failure(ip, now));
  AuthAction::Rejected { noted }
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

/// The source address the routing table picks for `target`. A UDP "connect"
/// selects the interface without sending any packets, so this is a free
/// probe of which network a connection to that destination leaves on.
fn route_source_ip(target: &str) -> Option<IpAddr> {
  UdpSocket::bind("0.0.0.0:0")
    .and_then(|s| s.connect(target).map(|_| s))
    .and_then(|s| s.local_addr())
    .map(|a| a.ip())
    .ok()
}

/// The address a phone on this machine's usual network (Wi-Fi, hotspot,
/// ethernet) would dial. Falls back to loopback when there is no route at
/// all; callers filter that out.
fn lan_ip() -> IpAddr {
  route_source_ip("8.8.8.8:80").unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

/// The machine's Tailscale address, if Tailscale is connected. Tailscale
/// routes the CGNAT block 100.64.0.0/10 (RFC 6598) through its tunnel, so
/// probing any address in that block yields the tunnel's own 100.x IP as the
/// source. Without Tailscale the probe just echoes the ordinary LAN address,
/// which the CGNAT filter then discards — nothing is configured or pinned
/// per user, every machine discovers its own address at runtime.
/// ponytail: route-probe detection; a Tailscale mode installing only
/// per-peer /32 routes (no 100.64/10 route) would hide the address — scan
/// interfaces with getifaddrs/GetAdaptersAddresses if that ever shows up.
fn tailscale_ip() -> Option<IpAddr> {
  route_source_ip("100.64.1.1:53").filter(|ip| match ip {
    IpAddr::V4(v4) => is_cgnat(*v4),
    _ => false,
  })
}

/// Tailscale draws every tailnet address from the CGNAT range 100.64.0.0/10.
fn is_cgnat(ip: Ipv4Addr) -> bool {
  let o = ip.octets();
  o[0] == 100 && (64..=127).contains(&o[1])
}

/// The pairing URLs worth offering right now: the default-route address a
/// same-network phone uses, then the Tailscale address for a phone reaching
/// over the tailnet. Loopback/link-local fallbacks never get a QR.
fn pairing_urls(
  default_route: IpAddr,
  tunnel: Option<IpAddr>,
  port: u16,
  token: &str,
) -> Vec<RemoteCameraUrl> {
  let usable = |ip: IpAddr| match ip {
    IpAddr::V4(v4)
      if !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() =>
    {
      Some(v4)
    }
    _ => None,
  };
  let mut urls = Vec::new();
  let primary = usable(default_route);
  if let Some(v4) = primary {
    urls.push(RemoteCameraUrl {
      url: format!("http://{v4}:{port}/t/{token}/"),
      kind: if is_cgnat(v4) {
        LinkKind::Tailscale
      } else {
        LinkKind::Lan
      },
    });
  }
  if let Some(v4) = tunnel.and_then(usable).filter(|v4| Some(*v4) != primary) {
    urls.push(RemoteCameraUrl {
      url: format!("http://{v4}:{port}/t/{token}/"),
      kind: LinkKind::Tailscale,
    });
  }
  urls
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
  // Photo files are AES-GCM encrypted at rest; legacy plaintext passes
  // through unchanged (photo_crypto::decrypt_or_plain).
  match std::fs::read(&path)
    .map_err(|e| e.to_string())
    .and_then(|raw| crate::photo_crypto::decrypt_or_plain(&raw))
  {
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

fn handle_request(
  app: &AppHandle,
  token: &str,
  last_seen_ms: &AtomicU64,
  guard: &AuthGuard,
  mut request: tiny_http::Request,
) {
  let url = request.url().to_string();
  let source_ip = request.remote_addr().map(|addr| addr.ip());
  let prefix = format!("/t/{token}/");
  let path = match url.strip_prefix(&prefix) {
    Some(path) => path,
    None => {
      // Wrong or missing token. Same 404 as any unknown route, but the
      // source is tracked and throttled — a scanner gets refused quietly
      // after a burst. Nothing from the URL is logged: it may contain a
      // guessed or leaked token fragment.
      let now = Instant::now();
      if let Some(ip) = source_ip {
        if !guard.is_blocked(ip, now) {
          match guard.note_failure(ip, now) {
            Some(true) => crate::diagnostics::record(
              crate::diagnostics::Level::Info,
              "phone-camera",
              &format!(
                "Paused requests from {ip} for five minutes — repeated wrong pairing codes."
              ),
              None,
            ),
            Some(false) => crate::diagnostics::record(
              crate::diagnostics::Level::Info,
              "phone-camera",
              &format!("Rejected a request from {ip} — wrong pairing code."),
              None,
            ),
            None => {}
          }
        }
      }
      respond_text(request, 404, "Not found");
      return;
    }
  };
  // A valid token clears the source's failure history, so re-scanning the
  // QR reconnects instantly even mid-block (the old URL's retry loop is what
  // filled the history).
  if let Some(ip) = source_ip {
    guard.clear(ip);
  }
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
  guard: Arc<AuthGuard>,
) -> JoinHandle<()> {
  std::thread::spawn(move || {
    while !shutdown.load(Ordering::Relaxed) {
      match server.recv() {
        Ok(request) => handle_request(&app, &token, &last_seen_ms, &guard, request),
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

  // Bind every interface (0.0.0.0), not just today's default route: the
  // link keeps working when the machine switches networks (Wi-Fi ↔ hotspot)
  // and accepts connections arriving over Tailscale's tunnel. The pairing
  // token in the URL path stays the only gate that matters.
  let bind_all = IpAddr::V4(Ipv4Addr::UNSPECIFIED);
  // Bind the pinned port first so last session's URL keeps working; only if
  // something else grabbed it fall back to an ephemeral port (and re-pin, so
  // the new URL is the stable one going forward).
  let pinned = pinned_port(&app)?;
  let (server, port) = match pinned.and_then(|p| {
    let listener = bind_listener(bind_all, p).ok()?;
    Server::from_listener(listener, None).ok().map(|server| (server, p))
  }) {
    Some((server, port)) => (server, port),
    None => {
      let start_fail = |e: String| {
        let msg = format!("failed to start phone-camera server: {e}");
        crate::diagnostics::record(crate::diagnostics::Level::Error, "phone-camera", &msg, None);
        msg
      };
      let listener = bind_listener(bind_all, 0).map_err(|e| start_fail(e.to_string()))?;
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
  let urls = pairing_urls(lan_ip(), tailscale_ip(), port, &token);
  let server = Arc::new(server);
  let last_seen_ms = Arc::new(AtomicU64::new(now_ms()));

  let shutdown = Arc::new(AtomicBool::new(false));
  // Fresh failure history per session: a restart (including a pairing-code
  // rotation) unblocks everything and starts counting anew.
  let guard = Arc::new(AuthGuard::new());
  let thread = spawn_handler(
    app,
    Arc::clone(&server),
    token.clone(),
    Arc::clone(&last_seen_ms),
    Arc::clone(&shutdown),
    Arc::clone(&guard),
  );

  *REMOTE_CAMERA.lock().unwrap() = Some(RemoteCamera {
    shutdown,
    server,
    thread: Some(thread),
    port,
    token,
    last_seen_ms,
  });
  *STAGED_REPORT.lock().unwrap() = None;

  // No token in diagnostics — the pairing URL is a secret.
  crate::diagnostics::record(
    crate::diagnostics::Level::Info,
    "phone-camera",
    &format!("Phone camera link started on port {port}"),
    None,
  );

  Ok(RemoteCameraInfo { urls })
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

/// Rotate the pairing code ("New code" in the phone link dialog): stop the
/// link, forget the persisted token, start again on the same pinned port.
/// The previous code stops working the moment the server restarts — a phone
/// still holding it sees 404s and drops to its reconnecting screen until the
/// new QR is scanned once. The shared library is untouched by the restart,
/// so a re-paired phone picks it straight back up.
#[tauri::command]
pub async fn reset_pairing_token(app: AppHandle) -> Result<RemoteCameraInfo, String> {
  stop_remote_camera().await;
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  // A failure here must surface, not fall through to start: a token file we
  // failed to delete would silently keep the old code alive.
  match std::fs::remove_file(dir.join("phone-link-token")) {
    Ok(()) => {}
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
    Err(e) => return Err(format!("could not remove the old pairing code: {e}")),
  }
  crate::diagnostics::record(
    crate::diagnostics::Level::Info,
    "phone-camera",
    "Pairing code rotated — previously paired phones must re-scan.",
    None,
  );
  start_remote_camera(app).await
}

/// The pairing URLs of the running link, if any. Lets a second surface (the
/// capture screen's phone panel) reuse the live session instead of restarting
/// it, which would invalidate the QR the phone may already have open. URLs
/// are rebuilt from the current routing table on every call, so a dialog
/// opened after a network switch (Wi-Fi ↔ hotspot) shows live addresses.
#[tauri::command]
pub fn remote_camera_active() -> Option<RemoteCameraInfo> {
  REMOTE_CAMERA
    .lock()
    .unwrap()
    .as_ref()
    .map(|rc| RemoteCameraInfo {
      urls: pairing_urls(lan_ip(), tailscale_ip(), rc.port, &rc.token),
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

  // The unauthenticated-request throttle: failures accumulate per source
  // until the limit, the block outlives the failure window, and time (or a
  // valid-token request — clear) is the only way out. The re-scan case is
  // the load-bearing one: a blocked address presenting the valid token
  // must be served, because the old URL's retry loop is what filled the
  // history in the first place.
  #[test]
  fn auth_guard_blocks_after_burst_and_recovers() {
    use super::{AuthGuard, BLOCK_FOR, FAIL_LIMIT, FAIL_WINDOW};
    use std::net::IpAddr;
    use std::time::{Duration, Instant};
    let guard = AuthGuard::new();
    let ip: IpAddr = "192.168.1.9".parse().unwrap();
    let t0 = Instant::now();

    // Below the limit: never blocked, first failure of the window flagged.
    assert_eq!(guard.note_failure(ip, t0), Some(false));
    for _ in 2..FAIL_LIMIT {
      assert_eq!(guard.note_failure(ip, t0), None);
      assert!(!guard.is_blocked(ip, t0));
    }
    // The failure that crosses the limit reports "just blocked", and the
    // steady state afterwards reports nothing (no per-request log spam).
    assert_eq!(guard.note_failure(ip, t0), Some(true));
    assert!(guard.is_blocked(ip, t0));
    assert_eq!(guard.note_failure(ip, t0 + FAIL_WINDOW / 2), None);

    // Block expiry: the next failure after BLOCK_FOR counts from a fresh
    // window instead of re-blocking instantly.
    let later = t0 + FAIL_WINDOW + BLOCK_FOR;
    assert!(!guard.is_blocked(ip, later));
    assert_eq!(guard.note_failure(ip, later), Some(false));

    // A window that has aged out also resets the count: nine failures,
    // then a failure after the window reads as the first of a new one.
    let stale = later + FAIL_WINDOW + Duration::from_secs(1);
    for _ in 1..FAIL_LIMIT {
      guard.note_failure(ip, stale);
    }
    assert!(!guard.is_blocked(ip, stale + FAIL_WINDOW + Duration::from_secs(1)));
    assert_eq!(guard.note_failure(ip, stale + FAIL_WINDOW + Duration::from_secs(1)), Some(false));
  }

  #[test]
  fn auth_guard_clear_beats_block() {
    use super::{AuthGuard, FAIL_LIMIT};
    use std::net::IpAddr;
    use std::time::Instant;
    let guard = AuthGuard::new();
    let phone: IpAddr = "192.168.1.20".parse().unwrap();
    let t0 = Instant::now();
    for _ in 0..FAIL_LIMIT {
      guard.note_failure(phone, t0);
    }
    assert!(guard.is_blocked(phone, t0));
    // The re-scanned phone arrives with the valid token: history gone.
    guard.clear(phone);
    assert!(!guard.is_blocked(phone, t0));
    assert_eq!(guard.note_failure(phone, t0), Some(false));
  }

  // Tier 2's §3.4 decision table, exercised without an AppHandle: a valid
  // pairing code mints a session (and clears the block its own dead URL's
  // retry loop built), a live cookie routes, everything else counts.
  #[test]
  fn auth_exchange_mints_session_and_clears_guard() {
    use super::{
      AuthAction, AuthGuard, SessionStore, FAIL_LIMIT, classify_auth, session_from_cookie,
      session_id_hex,
    };
    use std::net::IpAddr;
    use std::time::Instant;
    let store = SessionStore::new();
    let guard = AuthGuard::new();
    let phone: IpAddr = "192.168.1.20".parse().unwrap();
    let t0 = Instant::now();
    for _ in 0..FAIL_LIMIT {
      guard.note_failure(phone, t0);
    }
    assert!(guard.is_blocked(phone, t0));

    let action = classify_auth(
      "/t/0123456789abcdef/",
      None,
      "0123456789abcdef",
      &store,
      &guard,
      Some(phone),
      t0,
    );
    match action {
      AuthAction::Exchange { fresh: Some(id) } => {
        assert!(store.contains(&id));
        // The minted id round-trips through the cookie serialisation the
        // response will use.
        let cookie = format!("camog_session={}", session_id_hex(&id));
        assert_eq!(session_from_cookie(Some(&cookie)), Some(id));
      }
      other => panic!("expected a fresh exchange, got {other:?}"),
    }
    // Presenting the valid code cleared the block: the next failure reads
    // as the first of a fresh window, not as a blocked source.
    assert!(!guard.is_blocked(phone, t0));
    assert_eq!(guard.note_failure(phone, t0), Some(false));
  }

  #[test]
  fn auth_valid_cookie_routes_and_clears_guard() {
    use super::{AuthAction, AuthGuard, SessionStore, FAIL_LIMIT, classify_auth, session_id_hex};
    use std::net::IpAddr;
    use std::time::Instant;
    let store = SessionStore::new();
    let guard = AuthGuard::new();
    let phone: IpAddr = "192.168.1.21".parse().unwrap();
    let t0 = Instant::now();
    let id = store.mint();
    let cookie = format!("camog_session={}", session_id_hex(&id));
    for _ in 0..FAIL_LIMIT {
      guard.note_failure(phone, t0);
    }

    // Token-less path, cookie only — routed even from a blocked address
    // (the credential is proof the phone is legitimate, Tier 1's property).
    assert_eq!(
      classify_auth(
        "/library",
        Some(&cookie),
        "0123456789abcdef",
        &store,
        &guard,
        Some(phone),
        t0
      ),
      AuthAction::Authenticated
    );
    assert!(!guard.is_blocked(phone, t0));
  }

  // The cookie-eviction / post-restart case: parseable cookie, dead
  // session, counts exactly like a wrong code.
  #[test]
  fn auth_dead_cookie_counts_failure() {
    use super::{AuthAction, AuthGuard, SessionStore, FAIL_LIMIT, classify_auth, session_id_hex};
    use std::net::IpAddr;
    use std::time::Instant;
    let store = SessionStore::new();
    let guard = AuthGuard::new();
    let phone: IpAddr = "192.168.1.22".parse().unwrap();
    let t0 = Instant::now();
    let stale = format!("camog_session={}", session_id_hex(&store.mint()));
    store.remove_all();

    assert_eq!(
      classify_auth(
        "/hello",
        Some(&stale),
        "0123456789abcdef",
        &store,
        &guard,
        Some(phone),
        t0
      ),
      AuthAction::Rejected { noted: Some(false) }
    );
    assert_eq!(
      classify_auth("/hello", None, "0123456789abcdef", &store, &guard, Some(phone), t0),
      AuthAction::Rejected { noted: None }
    );
    // Keep counting to the limit, then: blocked sources are answered
    // without further counting.
    for _ in 2..FAIL_LIMIT {
      classify_auth("/hello", None, "0123456789abcdef", &store, &guard, Some(phone), t0);
    }
    assert!(guard.is_blocked(phone, t0));
    assert_eq!(
      classify_auth("/hello", None, "0123456789abcdef", &store, &guard, Some(phone), t0),
      AuthAction::Rejected { noted: None }
    );
  }

  #[test]
  fn auth_wrong_code_counts_failure() {
    use super::{AuthAction, AuthGuard, SessionStore, classify_auth};
    use std::net::IpAddr;
    use std::time::Instant;
    let store = SessionStore::new();
    let guard = AuthGuard::new();
    let scanner: IpAddr = "10.0.0.9".parse().unwrap();
    assert_eq!(
      classify_auth(
        "/t/feedfacefeedface/",
        None,
        "0123456789abcdef",
        &store,
        &guard,
        Some(scanner),
        Instant::now()
      ),
      AuthAction::Rejected { noted: Some(false) }
    );
  }

  // An old page still sitting on /t/<code>/ (saved icon kept open across
  // the upgrade): the exchange must reuse the live cookie it already has,
  // not mint a session per relative fetch.
  #[test]
  fn auth_exchange_reuses_live_cookie() {
    use super::{AuthAction, AuthGuard, SessionStore, classify_auth, session_id_hex};
    use std::time::Instant;
    let store = SessionStore::new();
    let guard = AuthGuard::new();
    let id = store.mint();
    let cookie = format!("camog_session={}", session_id_hex(&id));
    assert_eq!(
      classify_auth(
        "/t/0123456789abcdef/hello",
        Some(&cookie),
        "0123456789abcdef",
        &store,
        &guard,
        None,
        Instant::now()
      ),
      AuthAction::Exchange { fresh: None }
    );
    // While a request with no cookie at all mints one.
    match classify_auth(
      "/t/0123456789abcdef/hello",
      None,
      "0123456789abcdef",
      &store,
      &guard,
      None,
      Instant::now(),
    ) {
      AuthAction::Exchange { fresh: Some(id) } => assert!(store.contains(&id)),
      other => panic!("expected a fresh exchange, got {other:?}"),
    }
  }

  #[test]
  fn session_ids_unique_and_revocable() {
    use super::SessionStore;
    let store = SessionStore::new();
    let a = store.mint();
    let b = store.mint();
    assert_ne!(a, b);
    assert!(store.contains(&a));
    store.remove_all();
    assert!(!store.contains(&a));
    assert!(!store.contains(&b));
  }

  #[test]
  fn session_cookie_parsing() {
    use super::{parse_session_id, session_from_cookie, session_id_hex};
    let id = [0xabu8; 16];
    let hex = session_id_hex(&id);
    assert_eq!(hex.len(), 32);
    assert_eq!(session_from_cookie(None), None);
    assert_eq!(session_from_cookie(Some("other=1")), None);
    // Exact name only — a longer cookie name must not match.
    assert_eq!(session_from_cookie(Some("camog_sessionX=1")), None);
    assert_eq!(session_from_cookie(Some(&format!("camog_session={hex}"))), Some(id));
    // Whatever else the browser appends around ours.
    assert_eq!(
      session_from_cookie(Some(&format!("a=1; camog_session={hex}; b=2"))),
      Some(id)
    );
    // Malformed values never reach the store lookup.
    assert_eq!(session_from_cookie(Some("camog_session=short")), None);
    assert_eq!(
      session_from_cookie(Some(&format!("camog_session={}", "z".repeat(32)))),
      None
    );
    assert_eq!(parse_session_id(""), None);
  }

  // The cookie contract from the protocol design: HttpOnly, Strict,
  // session-scoped, Path=/ — and no Secure, which on plain HTTP would stop
  // the phone from ever sending it back.
  #[test]
  fn session_cookie_header_shape() {
    use super::session_cookie_header;
    let header = session_cookie_header(&[0x12u8; 16]);
    assert!(header.field.equiv("Set-Cookie"));
    let value = header.value.as_str();
    assert_eq!(
      value,
      "camog_session=12121212121212121212121212121212; Path=/; HttpOnly; SameSite=Strict"
    );
    assert!(!value.to_ascii_lowercase().contains("secure"));
    assert!(!value.to_ascii_lowercase().contains("max-age"));
    assert!(!value.to_ascii_lowercase().contains("expires"));
  }

  // The stale-code UX contract: probe and heartbeat must check res.ok, or a
  // rotated pairing code leaves the phone claiming "Connected" while every
  // real request 404s.
  #[test]
  fn phone_page_treats_404_as_disconnected() {
    assert!(PAGE_HTML.contains("if (!res.ok) throw new Error('stale pairing code');"));
    assert!(PAGE_HTML.contains("if (!res.ok) disconnected();"));
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

  // Multi-network pairing: the same-network address is offered first, the
  // Tailscale (CGNAT) address alongside it, and probes that merely echoed the
  // LAN address (no Tailscale) or fell back to loopback never mint a QR.
  #[test]
  fn pairing_urls_offer_lan_then_tailscale() {
    use super::{pairing_urls, LinkKind};
    let lan: std::net::IpAddr = "192.168.1.5".parse().unwrap();
    let ts: std::net::IpAddr = "100.101.102.103".parse().unwrap();
    let urls = pairing_urls(lan, Some(ts), 8080, "0123456789abcdef");
    assert_eq!(urls.len(), 2);
    assert_eq!(urls[0].url, "http://192.168.1.5:8080/t/0123456789abcdef/");
    assert_eq!(urls[0].kind, LinkKind::Lan);
    assert_eq!(urls[1].url, "http://100.101.102.103:8080/t/0123456789abcdef/");
    assert_eq!(urls[1].kind, LinkKind::Tailscale);
  }

  // The common no-Tailscale case: the CGNAT probe just returns the default
  // route's own address, which must collapse into a single LAN URL — also
  // covers the phone-hotspot range.
  #[test]
  fn pairing_urls_without_tailscale_stay_single() {
    use super::{pairing_urls, LinkKind};
    let lan: std::net::IpAddr = "172.20.10.7".parse().unwrap();
    let urls = pairing_urls(lan, Some(lan), 9000, "0123456789abcdef");
    assert_eq!(urls.len(), 1);
    assert_eq!(urls[0].url, "http://172.20.10.7:9000/t/0123456789abcdef/");
    assert_eq!(urls[0].kind, LinkKind::Lan);
  }

  // Loopback fallbacks (no route at all) get no QR; an exit-node setup where
  // the default route IS the tunnel yields one Tailscale URL, not two.
  #[test]
  fn pairing_urls_skip_loopback_and_duplicate_tunnel() {
    use super::{pairing_urls, LinkKind};
    let lo: std::net::IpAddr = "127.0.0.1".parse().unwrap();
    assert!(pairing_urls(lo, None, 8080, "0123456789abcdef").is_empty());
    let ts: std::net::IpAddr = "100.101.102.103".parse().unwrap();
    let urls = pairing_urls(ts, Some(ts), 8080, "0123456789abcdef");
    assert_eq!(urls.len(), 1);
    assert_eq!(urls[0].kind, LinkKind::Tailscale);
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
