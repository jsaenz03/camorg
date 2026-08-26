// Phone-camera tether. A phone on the same Wi-Fi opens a pairing URL served
// by this process, snaps the photo with its native camera app, and POSTs the
// JPEG back; the bytes are forwarded to the webview as a Tauri event and flow
// through the normal capture pipeline.
//
// The phone page drives the native camera via <input capture> rather than
// getUserMedia: camera capture needs a secure context, which plain LAN http
// cannot offer on iOS/Android.

use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use base64::Engine as _;
use tauri::{AppHandle, Emitter};
use tiny_http::{Header, Method, Response, Server};

const PHOTO_EVENT: &str = "remote-camera-photo";
const STATUS_EVENT: &str = "remote-camera-status";
// Generous ceiling: a 12MP JPEG straight from a phone camera is ~4-8 MB.
// ponytail: fixed cap, no streaming; raise if phones ever send RAW/HEIC.
const MAX_BODY: usize = 25 * 1024 * 1024;

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

struct RemoteCamera {
  shutdown: Arc<AtomicBool>,
  server: Arc<Server>,
  thread: Option<JoinHandle<()>>,
}

static REMOTE_CAMERA: Mutex<Option<RemoteCamera>> = Mutex::new(None);

/// The LAN address a phone would use to reach this machine. A UDP "connect"
/// selects the default-route interface without sending any packets.
fn lan_ip() -> IpAddr {
  UdpSocket::bind("0.0.0.0:0")
    .and_then(|s| s.connect("8.8.8.8:80").map(|_| s))
    .and_then(|s| s.local_addr())
    .map(|a| a.ip())
    .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST))
}

fn content_type(value: &str) -> Header {
  Header::from_bytes(&b"Content-Type"[..], value.as_bytes()).expect("static header value")
}

fn respond_text(request: tiny_http::Request, status: u16, body: &str) {
  let _ = request.respond(
    Response::from_string(body)
      .with_status_code(status)
      .with_header(content_type("text/plain; charset=utf-8")),
  );
}

fn handle_request(app: &AppHandle, token: &str, mut request: tiny_http::Request) {
  let url = request.url().to_string();
  let prefix = format!("/t/{token}/");
  if !url.starts_with(&prefix) {
    respond_text(request, 404, "Not found");
    return;
  }

  let method = request.method().clone();
  if method == Method::Get && (url == prefix || url == format!("{prefix}index.html")) {
    let _ = request.respond(
      Response::from_string(PAGE_HTML).with_header(content_type("text/html; charset=utf-8")),
    );
  } else if method == Method::Get && url == format!("{prefix}logo.png") {
    let _ = request.respond(
      Response::from_data(LOGO_PNG.to_vec()).with_header(content_type("image/png")),
    );
  } else if method == Method::Get && url == format!("{prefix}hello") {
    // Phone page pings on load so the desktop knows pairing succeeded.
    let _ = app.emit(STATUS_EVENT, RemoteCameraStatus { connected: true });
    respond_text(request, 200, "ok");
  } else if method == Method::Post && url == format!("{prefix}bye") {
    // Phone page beacons on hide/unload so the desktop can clear the
    // "connected" indicator instead of showing it forever.
    let _ = app.emit(STATUS_EVENT, RemoteCameraStatus { connected: false });
    respond_text(request, 200, "ok");
  } else if method == Method::Post && url == format!("{prefix}photo") {
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
  shutdown: Arc<AtomicBool>,
) -> JoinHandle<()> {
  std::thread::spawn(move || {
    while !shutdown.load(Ordering::Relaxed) {
      match server.recv() {
        Ok(request) => handle_request(&app, &token, request),
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
  let server = Server::http((ip, 0)).map_err(|e| {
    let msg = format!("failed to start phone-camera server: {e}");
    crate::diagnostics::record(crate::diagnostics::Level::Error, "phone-camera", &msg, None);
    msg
  })?;
  let port = server.server_addr().to_ip().map(|a| a.port()).ok_or_else(|| {
    let msg = "failed to determine phone-camera server port".to_string();
    crate::diagnostics::record(crate::diagnostics::Level::Error, "phone-camera", &msg, None);
    msg
  })?;
  let token = format!("{:016x}", rand::random::<u64>());
  let server = Arc::new(server);

  let shutdown = Arc::new(AtomicBool::new(false));
  let thread = spawn_handler(app, Arc::clone(&server), token.clone(), Arc::clone(&shutdown));

  *REMOTE_CAMERA.lock().unwrap() = Some(RemoteCamera {
    shutdown,
    server,
    thread: Some(thread),
  });

  // No token in diagnostics — the pairing URL is a secret.
  crate::diagnostics::record(
    crate::diagnostics::Level::Info,
    "phone-camera",
    &format!("Phone camera link started on {ip}:{port}"),
    None,
  );

  Ok(RemoteCameraInfo {
    url: format!("http://{ip}:{port}/t/{token}/"),
  })
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
}

// 256px copy of the app logo (public/logo.png) so the phone page carries the
// brand mark without shipping the 1024px original over the LAN.
const LOGO_PNG: &[u8] = include_bytes!("../assets/logo.png");

const PAGE_HTML: &str = r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0a0a0a">
<title>Camog &middot; Phone camera</title>
<style>
  /* Camog dark theme — mirrors app/globals.css .dark tokens. */
  :root {
    color-scheme: dark;
    --bg: #0a0a0a;
    --card: #171717;
    --fg: #fafafa;
    --muted: #a1a1aa;
    --border: rgba(255, 255, 255, 0.1);
    --primary: #00aeb5;    /* oklch(0.68 0.12 200) */
    --primary-fg: #001011; /* oklch(0.16 0.02 200) */
    --success: #4ade80;
    --error: #f87171;
    --radius: 10px;        /* 0.625rem */
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 16px; min-height: 100dvh;
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(70% 40% at 50% 0, rgba(0, 174, 181, 0.08), transparent 70%) var(--bg);
    color: var(--fg);
  }
  header { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  header img {
    width: 56px; height: 56px; padding: 6px;
    border-radius: 14px; border: 1px solid var(--border);
    background: var(--card); object-fit: contain;
  }
  .wordmark { font-size: 20px; font-weight: 600; line-height: 1.2; text-align: center; }
  .tagline { font-size: 13px; color: var(--muted); text-align: center; }
  h1 { font-size: 20px; margin: 0; text-align: center; }
  p { font-size: 15px; line-height: 1.5; color: var(--muted); margin: 0; text-align: center; max-width: 36ch; }
  .check {
    width: 64px; height: 64px; border-radius: 999px; color: var(--primary);
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 174, 181, 0.12);
  }
  .check svg { width: 30px; height: 30px; }
  .btn {
    display: block; width: 100%; max-width: 340px; padding: 15px; border: 0; border-radius: var(--radius);
    font-size: 17px; font-weight: 600; text-align: center; cursor: pointer;
    -webkit-user-select: none; user-select: none;
  }
  .btn:active { opacity: 0.85; }
  .btn-primary { background: var(--primary); color: var(--primary-fg); }
  .btn-secondary { background: #27272a; color: var(--fg); }
  #screen-start, #screen-review, #screen-sent {
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }
  #screen-start[hidden], #screen-review[hidden], #screen-sent[hidden] { display: none; }
  #preview { max-width: 100%; max-height: 50dvh; border-radius: 12px; object-fit: contain; border: 1px solid var(--border); }
  #error { color: var(--error); white-space: pre-line; }
</style>
</head>
<body>
  <header>
    <img src="logo.png" alt="Camog">
    <div>
      <div class="wordmark">Camog</div>
      <div class="tagline">Clinical Photos</div>
    </div>
  </header>
  <div id="screen-start">
    <p id="conn">Connecting to Camog&hellip;</p>
    <label class="btn btn-primary" for="photo">Take photo</label>
    <input id="photo" type="file" accept="image/*" capture="environment" hidden>
  </div>
  <div id="screen-review" hidden>
    <h1>Use this photo?</h1>
    <img id="preview" alt="Photo to send">
    <button type="button" class="btn btn-primary" id="send">Send to Camog</button>
    <button type="button" class="btn btn-secondary" id="retake">Retake</button>
  </div>
  <div id="screen-sent" hidden>
    <div class="check" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
    </div>
    <h1>Photo sent</h1>
    <p>Check Camog on your computer to add details and save it.</p>
    <button type="button" class="btn btn-primary" id="another">Take another photo</button>
  </div>
  <p id="error"></p>
<script>
(function () {
  'use strict';
  var pending = null; // processed JPEG blob waiting to be sent

  function $(id) { return document.getElementById(id); }
  function show(screen) {
    ['screen-start', 'screen-review', 'screen-sent'].forEach(function (s) {
      $(s).hidden = s !== screen;
    });
  }
  function fail(msg) { $('error').textContent = msg; }

  // Relative URLs resolve under /t/<token>/, so the token never appears here.
  fetch('hello').then(function () {
    $('conn').textContent = 'Connected. Take the photo, review it, then send it.';
    $('conn').style.color = '#4ade80';
  }).catch(function () {
    fail('Cannot reach Camog.\nMake sure the Camog app is open and your phone is on the same Wi-Fi.');
  });

  // Tell the desktop when the page goes away so it can clear "connected".
  addEventListener('pagehide', function () { navigator.sendBeacon('bye'); });

  $('photo').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    fail('');
    shrink(file).then(function (blob) {
      pending = blob;
      $('preview').src = URL.createObjectURL(blob);
      show('screen-review');
    }).catch(function () {
      fail('Could not read that photo. Try again.');
    });
  });

  $('retake').addEventListener('click', function () { show('screen-start'); });
  $('another').addEventListener('click', function () { show('screen-start'); });

  $('send').addEventListener('click', function () {
    if (!pending) return;
    var blob = pending;
    pending = null;
    fail('');
    fetch('photo', { method: 'POST', body: blob }).then(function (res) {
      if (!res.ok) throw new Error('status ' + res.status);
      show('screen-sent');
    }).catch(function () {
      pending = blob;
      fail('Could not send the photo.\nMake sure Camog is still showing the capture screen, then try again.');
      show('screen-review');
    });
  });

  // Re-encode to JPEG capped at 1920px, matching the desktop capture path.
  function shrink(file) {
    return decode(file).then(function (img) {
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('no dimensions');
      var scale = Math.min(1, 1920 / Math.max(w, h));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      if (img.close) img.close();
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode')); }, 'image/jpeg', 0.92);
      });
    });
  }

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' });
    }
    // ponytail: pre-2021 iOS Safari has no createImageBitmap; img decode applies EXIF anyway.
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }
})();
</script>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
  use super::PAGE_HTML;

  // Guards the branded phone page: the logo route, wordmark, theme tokens,
  // and the [hidden] override that keeps flex screens toggleable.
  #[test]
  fn phone_page_carries_branding() {
    assert!(PAGE_HTML.contains(r#"src="logo.png""#));
    assert!(PAGE_HTML.contains(">Clinical Photos<"));
    assert!(PAGE_HTML.contains("--primary: #00aeb5"));
    assert!(PAGE_HTML.contains("[hidden] { display: none; }"));
    assert!(PAGE_HTML.trim_end().ends_with("</html>"));
  }
}
