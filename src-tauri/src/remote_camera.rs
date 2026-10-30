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
// whitelist from the photos directory. No DB access lives here. The phone
// can also ask the desktop to mark a photo reviewed (which counts as the
// patient's review too, exactly like the desktop dialog) or prepare a case
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
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine as _;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tiny_http::{Header, Method, Response, Server};

const PHOTO_EVENT: &str = "remote-camera-photo";
const STATUS_EVENT: &str = "remote-camera-status";
const PHOTO_REVIEW_EVENT: &str = "companion-photo-review-request";
const REPORT_EVENT: &str = "companion-report-request";
// Generous ceiling: a 12MP JPEG straight from a phone camera is ~4-8 MB.
// ponytail: fixed cap, no streaming; raise if phones ever send RAW/HEIC.
const MAX_BODY: usize = 25 * 1024 * 1024;
// Phone control requests are tiny JSON ({"patientId":"<uuid>"}).
const MAX_CONTROL_BODY: usize = 4 * 1024;

// Transit envelope (specs/007): AES-256-GCM over every patient-data record —
// library manifest and photos down, uploads and report up — keyed from the QR
// URL the phone scanned off this screen. 96-bit nonces, one per record;
// envelope = nonce ‖ ciphertext‖tag, exactly what the aes-gcm crate's
// encrypt() produces and the phone page's JS decrypts.
const ENVELOPE_OVERHEAD: usize = 12 + 16;

fn envelope_seal(key: &[u8; 32], plaintext: &[u8]) -> Option<Vec<u8>> {
  let cipher = Aes256Gcm::new(key.into());
  let nonce_bytes: [u8; 12] = rand::random();
  let mut envelope = Vec::with_capacity(ENVELOPE_OVERHEAD + plaintext.len());
  envelope.extend_from_slice(&nonce_bytes);
  envelope.extend_from_slice(&cipher.encrypt(Nonce::from_slice(&nonce_bytes), plaintext).ok()?);
  Some(envelope)
}

/// None when the record was truncated, or the key (or a byte of the record)
/// doesn't match — GCM authentication rejects all of them alike.
fn envelope_open(key: &[u8; 32], envelope: &[u8]) -> Option<Vec<u8>> {
  if envelope.len() < ENVELOPE_OVERHEAD {
    return None;
  }
  let (nonce, ciphertext) = envelope.split_at(12);
  Aes256Gcm::new(key.into())
    .decrypt(Nonce::from_slice(nonce), ciphertext)
    .ok()
}

fn envelope_header() -> Header {
  Header::from_bytes(&b"X-Link-Envelope"[..], &b"1"[..]).expect("static header value")
}

/// Enveloped response body: the phone unwraps it before it can read anything.
fn respond_enveloped(request: tiny_http::Request, key: &[u8; 32], body: Vec<u8>) {
  match envelope_seal(key, &body) {
    Some(envelope) => {
      let _ = request.respond(
        Response::from_data(envelope)
          .with_header(content_type("application/octet-stream"))
          .with_header(envelope_header()),
      );
    }
    None => respond_text(request, 500, "Could not protect the response"),
  }
}

/// Did this request come from a page that holds the transit key? The header
/// rides every request the 0.13.0 phone page makes. It is a capability
/// marker, not proof — the key itself is only ever proven by GCM
/// authentication — but it is what lets an OLD cached page (which cannot
/// decrypt anything) be answered with the same 404 as a dead pairing, so its
/// existing error path shows the re-scan message instead of raw garbage.
fn link_capability(request: &tiny_http::Request) -> bool {
  request
    .headers()
    .iter()
    .any(|h| h.field.equiv("X-Link-Key") && h.value.as_str().trim() == "1")
}

/// The body-level marker: this request's body is a sealed record. Distinct
/// from link_capability on purpose — the capability rides hello's headers,
/// this one rides the individual uploads it describes.
fn envelope_request(request: &tiny_http::Request) -> bool {
  request
    .headers()
    .iter()
    .any(|h| h.field.equiv("X-Link-Envelope") && h.value.as_str().trim() == "1")
}

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

// camelCase so the payload keys match the webview's contract (captureId,
// patientId) — snake_case keys would silently read as undefined there.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteCameraPhoto {
  data: String,
  /// Id the phone minted when it sent this capture (X-Capture-Id). The
  /// webview claims it before staging so a transport-level resend of the
  /// same POST stages one photo, not two.
  #[serde(skip_serializing_if = "Option::is_none")]
  capture_id: Option<String>,
  /// Patient the phone said it was capturing for (X-Patient-Id), when the
  /// snap was started from a patient's screen. Only an id the shared
  /// library actually allows is relayed; the webview prefills the photo's
  /// metadata form from it.
  #[serde(skip_serializing_if = "Option::is_none")]
  patient_id: Option<String>,
}

/// The phone stamps every photo POST with an id minted at send time; the
/// webview claims it before staging so a transport-level resend of the same
/// request (a dropped keep-alive connection replayed below the app — both
/// copies arrive complete) stages one photo, not two. Strict shape — it rides
/// in event payloads and diagnostics lines — and a missing or malformed id
/// simply means "no dedupe key" (an old phone page).
fn capture_id_from_headers(headers: &[Header]) -> Option<String> {
  let raw = headers
    .iter()
    .find(|h| h.field.equiv("X-Capture-Id"))
    .map(|h| h.value.as_str())?;
  strict_header_id(raw)
}

/// The X-Patient-Id companion of the capture id: same strict shape, but it
/// must also be a patient the shared library actually advertises (pass the
/// manifest's allowed set, or None with no library shared) — the webview
/// resolves a patient record from it, so a stale or forged id is dropped
/// here rather than prefilled into a form. Pure; unit-tested without the
/// global library state.
fn patient_id_from_headers(
  headers: &[Header],
  allowed_patients: Option<&HashSet<String>>,
) -> Option<String> {
  let raw = headers
    .iter()
    .find(|h| h.field.equiv("X-Patient-Id"))
    .map(|h| h.value.as_str())?;
  let id = strict_header_id(raw)?;
  if allowed_patients?.contains(&id) { Some(id) } else { None }
}

/// Shape rules shared by the phone's id headers: non-empty, bounded, and
/// alphanumeric-or-dash only.
fn strict_header_id(raw: &str) -> Option<String> {
  let id = raw.trim();
  if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
    return None;
  }
  Some(id.to_string())
}

#[derive(serde::Serialize, Clone)]
struct RemoteCameraStatus {
  connected: bool,
}

/// Body of the phone's control requests (prepare report). Serialized back
/// out as the Tauri event payload (camelCase both ways).
#[derive(serde::Serialize, Deserialize)]
struct PatientRequest {
  #[serde(rename = "patientId")]
  patient_id: String,
}

/// Body of the phone's photo review request: mark one shared photo reviewed,
/// optionally arming the series follow-up for the next photo it snaps.
#[derive(serde::Serialize, Deserialize)]
struct PhotoReviewRequest {
  #[serde(rename = "photoId")]
  photo_id: String,
  snap: bool,
}

struct RemoteCamera {
  shutdown: Arc<AtomicBool>,
  server: Arc<Server>,
  thread: Option<JoinHandle<()>>,
  /// Port and token are all that is pinned; the URLs are rebuilt from the
  /// live routing table whenever anyone asks, so they survive network changes.
  port: u16,
  token: String,
  /// The transit key the QR carries (?k=…); rotated only by
  /// reset_pairing_token. Lives as long as the struct so remote_camera_active
  /// can re-embed it into rebuilt URLs.
  key: [u8; 32],
  /// Live phone sessions. In-memory by design: it lives and dies with the
  /// link, so stopping the listener revokes every phone — "End session"
  /// signs them all out without rotating the pairing code, and a desktop
  /// restart makes every phone re-run the exchange from its saved
  /// /t/<code>/ URL.
  sessions: Arc<SessionStore>,
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

// Version of the shared library, bumped on every publish and clear, with a
// condvar the library long-poll sleeps on. Publish takes the lock only to
// notify — a waiter checks the generation under the same lock before it
// sleeps, so a change landing in that window can never be slept through.
static LIBRARY_GEN: AtomicU64 = AtomicU64::new(0);
static LIBRARY_GEN_LOCK: Mutex<()> = Mutex::new(());
static LIBRARY_GEN_CV: Condvar = Condvar::new();

fn signal_library_changed() {
  LIBRARY_GEN.fetch_add(1, Ordering::Release);
  let lock = LIBRARY_GEN_LOCK.lock().unwrap();
  LIBRARY_GEN_CV.notify_all();
  drop(lock);
}

/// Hold a long-poll until the shared library changes. Returns true when a
/// publish or clear landed since this call started, false when the link shut
/// down or `cap` elapsed first (the phone then simply asks again).
fn wait_for_library_change(shutdown: &AtomicBool, cap: Duration) -> bool {
  let mut lock = LIBRARY_GEN_LOCK.lock().unwrap();
  let seen = LIBRARY_GEN.load(Ordering::Acquire);
  let deadline = Instant::now() + cap;
  loop {
    if LIBRARY_GEN.load(Ordering::Acquire) != seen {
      return true;
    }
    if shutdown.load(Ordering::Relaxed) || Instant::now() >= deadline {
      return false;
    }
    let (woken, _) = LIBRARY_GEN_CV
      .wait_timeout(lock, deadline.saturating_duration_since(Instant::now()))
      .unwrap();
    lock = woken;
  }
}

// The case report the webview has prepared for the phone, if any — keyed to
// the session that asked for it, time-bounded so a patient's report does not
// linger on the link. Report preparation itself is single-flight (see
// AWAITING_REPORT below): the staging slot can therefore never be claimed by
// a different phone than the one whose request produced the PDF.
#[derive(Clone)]
struct StagedReport {
  session: Option<[u8; 16]>,
  path: PathBuf,
  at: u64,
}

static STAGED_REPORT: Mutex<Option<StagedReport>> = Mutex::new(None);
/// The single in-flight report request: (session, claimed-at). One report is
/// prepared at a time — a second phone's request is refused until this slot
/// is consumed by stage_remote_report or expires — so the staged PDF can
/// never be attributed to (and downloaded by) the wrong phone.
static AWAITING_REPORT: Mutex<Option<([u8; 16], u64)>> = Mutex::new(None);
const STAGED_REPORT_TTL_MS: u64 = 10 * 60 * 1000;
const AWAITING_REPORT_TTL_MS: u64 = 60 * 1000;

/// The staged report a given session may download: the phone that asked for
/// the report is the one that gets it (an unattached or stale stage serves
/// nobody — the phone shows its error state and can request again).
fn staged_report_for(
  staged: &Option<StagedReport>,
  session: Option<[u8; 16]>,
  now: u64,
) -> Option<PathBuf> {
  let staged = staged.as_ref()?;
  let holder = staged.session?;
  if holder != session? || now.saturating_sub(staged.at) > STAGED_REPORT_TTL_MS {
    return None;
  }
  Some(staged.path.clone())
}

/// Belt-and-braces filename gate alongside the whitelist: UUID-derived photo
/// filenames are plain ASCII alphanumerics with dots, dashes, underscores.
fn is_safe_filename(name: &str) -> bool {
  !name.is_empty()
    && !name.contains("..")
    && name
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
}

/// Per-source tracker for unauthenticated requests (wrong pairing code, or
/// a missing/dead session cookie). Every authenticated phone request carries
/// a valid credential, so a burst of failures from one address is a scanner
/// — or a phone holding a code that was just rotated, or a cookie that died
/// with a link restart. After FAIL_LIMIT failures inside FAIL_WINDOW the
/// address is refused for BLOCK_FOR, answered with the same 404 as any
/// unknown route so the block itself stays invisible. A request presenting
/// a valid credential — the live pairing code or a live session cookie —
/// clears its address, so a phone that re-scans the QR reconnects
/// immediately even while its old URL's retry loop is still racking up
/// failures.
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

  /// Record an unauthenticated request. Returns `Some(true)` when this
  /// failure just crossed the limit (the caller logs the block once, not
  /// per request), `Some(false)` when it is the first failure of a fresh
  /// window (worth a line in diagnostics), `None` otherwise.
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

  /// A request with a valid credential arrived: forget the address
  /// entirely, so a re-scanned phone is never refused over its old URL's
  /// failures.
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
// rotating the code. classify_auth below is the single decision point
// handle_request consults; the unit tests drive it without an AppHandle.
// ponytail: HashSet of raw ids, no expiry — link lifetime (plus the idle
// auto-close) bounds it; per-session revoke arrives with a device-list UI.

/// Cookie name carrying the session id.
const SESSION_COOKIE: &str = "camog_session";

#[derive(Default)]
struct SessionStore {
  sessions: Mutex<HashSet<[u8; 16]>>,
  /// Leaky-bucket meter for state-changing POSTs, per session: a paired
  /// client can snap and review at consult pace, but a scripted client
  /// cannot flood the desktop with capture dialogs, review writes, or
  /// report generations. GETs (long-poll, image grabs) stay unmetered; the
  /// unauthenticated throttle lives in AuthGuard.
  post_buckets: Mutex<HashMap<[u8; 16], (f64, u64)>>,
}

/// Bucket shape: a consult's worth of bursts (bulk-adding a dozen phone
/// photos, say) passes straight through; sustained flood does not.
const POST_BURST: f64 = 20.0;
const POST_REFILL_PER_SEC: f64 = 10.0;

/// Tokens in a bucket refilled at POST_REFILL_PER_SEC since `last`, capped.
fn refilled(tokens: f64, last: u64, now: u64) -> f64 {
  let elapsed_secs = now.saturating_sub(last) as f64 / 1000.0;
  (tokens + elapsed_secs * POST_REFILL_PER_SEC).min(POST_BURST)
}

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

  /// Whether this session may make one more state-changing POST. Takes a
  /// token out on true.
  fn allow_post(&self, session: [u8; 16], now: u64) -> bool {
    let mut buckets = self.post_buckets.lock().unwrap();
    let entry = buckets.entry(session).or_insert((POST_BURST, now));
    let tokens = refilled(entry.0, entry.1, now);
    if tokens < 1.0 {
      *entry = (tokens, now);
      return false;
    }
    *entry = (tokens - 1.0, now);
    true
  }

  /// Revoke every live session. stop_remote_camera calls this before the
  /// listener winds down so even an in-flight exchange minted a moment
  /// earlier is dead on arrival; a per-device variant arrives with a
  /// device-list UI.
  fn remove_all(&self) {
    self.sessions.lock().unwrap().clear();
  }
}

/// Parse the session id out of a request's Cookie header value. Phones send
/// exactly the one cookie we set, but splitting on ';' keeps the parse
/// honest if an engine ever appends its own.
fn session_from_cookie(header: Option<&str>) -> Option<[u8; 16]> {
  let header = header?;
  header
    .split(';')
    .find_map(|pair| parse_session_id(pair.trim().strip_prefix("camog_session=")?.trim()))
}

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

fn session_id_hex(id: &[u8; 16]) -> String {
  id.iter().map(|b| format!("{b:02x}")).collect()
}

/// The Set-Cookie line for a fresh session. Session-scoped on purpose (no
/// Max-Age/Expires — it dies with the browser session, fine for a
/// standalone PWA), HttpOnly, SameSite=Strict (every request is
/// same-origin), and deliberately no Secure: the link is plain HTTP, where
/// a Secure cookie would never come back.
fn session_cookie_header(id: &[u8; 16]) -> Header {
  let value = format!(
    "{SESSION_COOKIE}={}; Path=/; HttpOnly; SameSite=Strict",
    session_id_hex(id)
  );
  Header::from_bytes(&b"Set-Cookie"[..], value.as_bytes()).expect("static header value")
}

/// What handle_request should do with an incoming request, decided before
/// any routing.
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
      // Tokens written before the owner-only permission existed are fixed up here.
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
      }
      return Ok(token.to_string());
    }
  }
  let token = format!("{:016x}", rand::random::<u64>());
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  std::fs::write(&path, &token).map_err(|e| e.to_string())?;
  // Owner-only, like the photo key: the token is a bearer credential.
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
  }
  Ok(token)
}

/// The transit key (specs/007): a 256-bit AES-GCM key for the link's
/// patient-data records. It reaches the phone OUT OF BAND — embedded in the
/// QR URL (?k=…) that the phone scans live off this screen, a channel an
/// on-path attacker can read but never alter — and is never served over the
/// link itself. Persisted beside the pairing token so a phone's saved
/// home-screen icon keeps decrypting across restarts (the phone stores its
/// copy when it scans), minted on demand for installs that paired before
/// 0.13.0, and rotated with the code by reset_pairing_token. Owner-only
/// file, like the token.
fn pairing_key(app: &AppHandle) -> Result<[u8; 32], String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  let path = dir.join("phone-link-key");
  if let Ok(text) = std::fs::read_to_string(&path) {
    if let Some(key) = parse_link_key(text.trim()) {
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
      }
      return Ok(key);
    }
  }
  let key: [u8; 32] = rand::random();
  std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
  std::fs::write(&path, &hex).map_err(|e| e.to_string())?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
  }
  Ok(key)
}

/// 64 hex chars → the 32 key bytes (same strict shape the token uses).
fn parse_link_key(text: &str) -> Option<[u8; 32]> {
  if text.len() != 64 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
    return None;
  }
  let mut key = [0u8; 32];
  for (i, byte) in key.iter_mut().enumerate() {
    *byte = u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).ok()?;
  }
  Some(key)
}

/// The QR-URL form of the key: unpadded base64url (43 chars, the phone-side
/// shape check matches this exactly).
fn link_key_param(key: &[u8; 32]) -> String {
  base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(key)
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
/// paired once never scans the QR again. Off by default — the link is a
/// plaintext LAN listener, so keeping it up between sessions is an explicit
/// choice. Installs that had paired before 0.11.0 (token on disk, no prefs
/// file, old default on) are carried over by migrate_auto_start_pref.
#[derive(serde::Serialize, serde::Deserialize)]
struct PhoneLinkPrefs {
  #[serde(default)]
  remember: bool,
}

fn phone_link_prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
  app
    .path()
    .app_data_dir()
    .map(|d| d.join("phone-link.json"))
    .map_err(|e| format!("could not resolve the app data dir: {e}"))
}

/// The stored preference: false when absent or unreadable. Auto-start is
/// opt-in, so only a prefs file that explicitly says "on" turns it on.
fn read_remember_pref(dir: &Path) -> bool {
  match std::fs::read_to_string(dir.join("phone-link.json")) {
    Ok(text) => serde_json::from_str::<PhoneLinkPrefs>(&text)
      .map(|p| p.remember)
      .unwrap_or(false),
    Err(_) => false,
  }
}

/// One-time carry-over for 0.11.0: auto-start became opt-in, but installs
/// that had paired before the change hold a phone-link-token with no prefs
/// file — for them the old always-on behaviour was a choice they made by
/// pairing, so it is seeded once. Fresh installs (never paired) keep the
/// off default until they pair and opt in. Runs in setup(), before the
/// webview can read the preference.
pub fn migrate_auto_start_pref(app: &AppHandle) -> Result<(), String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  migrate_auto_start_pref_in(&dir)
}

fn migrate_auto_start_pref_in(dir: &Path) -> Result<(), String> {
  let prefs = dir.join("phone-link.json");
  if prefs.exists() || !dir.join("phone-link-token").exists() {
    return Ok(());
  }
  if let Some(parent) = prefs.parent() {
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  let json = serde_json::to_string(&PhoneLinkPrefs { remember: true }).map_err(|e| e.to_string())?;
  std::fs::write(&prefs, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_phone_link_remember(app: AppHandle) -> Result<bool, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  Ok(read_remember_pref(&dir))
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
///
/// Windows proved the route probe insufficient: some Tailscale/VPN setups
/// leave no usable /10 route in the table (per-peer /32 routes, security
/// software filtering the probe), so the QR never appeared. Fallback: ask
/// the interfaces directly — the tunnel adapter's own 100.x address is
/// present whenever Tailscale is up, whatever the routing table says.
fn tailscale_ip() -> Option<IpAddr> {
  route_source_ip("100.64.1.1:53")
    .filter(|ip| matches!(*ip, IpAddr::V4(v4) if is_cgnat(v4)))
    .or_else(cgnat_address_on_interfaces)
}

/// Any interface address inside the CGNAT range, if one exists.
fn cgnat_address_on_interfaces() -> Option<IpAddr> {
  let addresses: Vec<IpAddr> = if_addrs::get_if_addrs()
    .ok()?
    .into_iter()
    .map(|iface| match iface.addr {
      if_addrs::IfAddr::V4(v4) => IpAddr::V4(v4.ip),
      if_addrs::IfAddr::V6(v6) => IpAddr::V6(v6.ip),
    })
    .collect();
  cgnat_address_among(&addresses)
}

fn cgnat_address_among(addrs: &[IpAddr]) -> Option<IpAddr> {
  addrs
    .iter()
    .copied()
    .find_map(|ip| match ip {
      IpAddr::V4(v4) if is_cgnat(v4) => Some(IpAddr::V4(v4)),
      _ => None,
    })
}

/// Tailscale draws every tailnet address from the CGNAT range 100.64.0.0/10.
fn is_cgnat(ip: Ipv4Addr) -> bool {
  let o = ip.octets();
  o[0] == 100 && (64..=127).contains(&o[1])
}

/// The pairing URLs worth offering right now: the default-route address a
/// same-network phone uses, then the Tailscale address for a phone reaching
/// over the tailnet. Loopback/link-local fallbacks never get a QR. Both
/// embed the transit key (specs/007): scanning the QR off this screen is the
/// key exchange — the code is the capability, the ?k= value is what
/// decrypts what the code lets you fetch. Tailscale addresses get the same
/// envelope (their tunnel is already encrypted; the envelope is orthogonal
/// and identical on every path).
fn pairing_urls(
  default_route: IpAddr,
  tunnel: Option<IpAddr>,
  port: u16,
  token: &str,
  key: &[u8; 32],
) -> Vec<RemoteCameraUrl> {
  let usable = |ip: IpAddr| match ip {
    IpAddr::V4(v4)
      if !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() =>
    {
      Some(v4)
    }
    _ => None,
  };
  let suffix = format!("/t/{token}/?k={}", link_key_param(key));
  let mut urls = Vec::new();
  let primary = usable(default_route);
  if let Some(v4) = primary {
    urls.push(RemoteCameraUrl {
      url: format!("http://{v4}:{port}{suffix}"),
      kind: if is_cgnat(v4) {
        LinkKind::Tailscale
      } else {
        LinkKind::Lan
      },
    });
  }
  if let Some(v4) = tunnel.and_then(usable).filter(|v4| Some(*v4) != primary) {
    urls.push(RemoteCameraUrl {
      url: format!("http://{v4}:{port}{suffix}"),
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

fn cache_control(value: &str) -> Header {
  Header::from_bytes(&b"Cache-Control"[..], value.as_bytes()).expect("static header value")
}

fn location_header(value: &str) -> Header {
  Header::from_bytes(&b"Location"[..], value.as_bytes()).expect("static header value")
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

fn handle_library(request: tiny_http::Request, key: &[u8; 32]) {
  // Patient names and ids ride this manifest — enveloped without exception.
  let manifest = LIBRARY
    .lock()
    .unwrap()
    .as_ref()
    .map(|lib| lib.manifest_json.clone())
    .unwrap_or_else(|| "{\"viewing\":false}".to_string());
  respond_enveloped(request, key, manifest.into_bytes());
}

fn handle_image(request: tiny_http::Request, filename: &str, key: &[u8; 32]) {
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
  // through unchanged (photo_crypto::decrypt_or_plain) — and then the
  // transit envelope wraps the result either way (specs/007).
  match std::fs::read(&path)
    .map_err(|e| e.to_string())
    .and_then(|raw| crate::photo_crypto::decrypt_or_plain(&raw))
  {
    Ok(bytes) => {
      // Clinical images: keep them out of shared/proxy caches; an hour of
      // private caching smooths library browsing without disk trails beyond
      // the phone's own (private-mode-invisible) cache. What gets cached is
      // the envelope, not the pixels.
      respond_enveloped(request, key, bytes);
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

/// Claim the single in-flight report slot for `session`. Report generation
/// is one-at-a-time by design: a second phone requesting while a PDF is
/// being prepared gets refused (409, its UI retries) instead of
/// overwriting the slot and receiving the first phone's patient's PDF.
/// The claim expires so a request whose webview never stages (crash, error)
/// cannot wedge report generation for everyone.
fn try_claim_awaiting_report(
  slot: &mut Option<([u8; 16], u64)>,
  session: [u8; 16],
  now: u64,
) -> bool {
  if let Some((_, noted_at)) = *slot {
    if now.saturating_sub(noted_at) <= AWAITING_REPORT_TTL_MS {
      return false;
    }
  }
  *slot = Some((session, now));
  true
}

/// Read a request body under the cap. Enveloped uploads (X-Link-Envelope: 1)
/// are opened with the session key; a plaintext body passes through so a
/// page cached from before the envelope still works. A corrupt envelope is
/// refused, never guessed — GCM authentication rejects tampered and
/// wrong-keyed records alike.
fn request_body(
  request: &mut tiny_http::Request,
  key: &[u8; 32],
  cap: usize,
) -> Result<Vec<u8>, ()> {
  let max = cap + ENVELOPE_OVERHEAD;
  if request.body_length().is_some_and(|len| len > max) {
    return Err(());
  }
  let mut body = Vec::new();
  let read = request
    .as_reader()
    .take(max as u64 + 1)
    .read_to_end(&mut body);
  if read.is_err() {
    return Err(());
  }
  if envelope_request(request) {
    return envelope_open(key, &body).ok_or(());
  }
  Ok(body)
}

/// Shared tail of the report control request: read the small JSON body, gate
/// the patient against the shared manifest, and relay it to the webview as a
/// Tauri event. The actual work happens webview-side through the normal
/// services (access checks, DB writes, report generation). The requesting
/// session claims the single in-flight slot so the staged report comes back
/// to this phone and only this phone (see stage_remote_report).
fn handle_patient_request<R: Runtime>(
  app: &AppHandle<R>,
  mut request: tiny_http::Request,
  event: &str,
  session: Option<[u8; 16]>,
  key: &[u8; 32],
) {
  let outcome = (|| -> Result<(), (u16, &'static str)> {
    let body = request_body(&mut request, key, MAX_CONTROL_BODY)
      .map_err(|_| (400, "Bad request"))?;
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
    if let Some(s) = session {
      let mut slot = AWAITING_REPORT.lock().unwrap();
      if !try_claim_awaiting_report(&mut slot, s, now_ms()) {
        return Err((409, "A report is already being prepared — try again shortly."));
      }
      drop(slot);
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

/// The phone's "mark this photo reviewed" request: gate the photo against the
/// shared manifest (photo ids are exactly the whitelisted `<id>.jpg` names)
/// and relay `{photoId, snap}` to the webview, which runs the same review
/// service the desktop dialog does and, for `snap`, arms the series
/// follow-up for the phone's next photo.
fn handle_photo_review_request<R: Runtime>(
  app: &AppHandle<R>,
  mut request: tiny_http::Request,
  key: &[u8; 32],
) {
  let outcome = (|| -> Result<(), (u16, &'static str)> {
    let body = request_body(&mut request, key, MAX_CONTROL_BODY)
      .map_err(|_| (400, "Bad request"))?;
    let parsed: PhotoReviewRequest =
      serde_json::from_slice(&body).map_err(|_| (400, "Bad request"))?;
    let allowed = LIBRARY
      .lock()
      .unwrap()
      .as_ref()
      .is_some_and(|lib| lib.allowed_files.contains(&format!("{}.jpg", parsed.photo_id)));
    if !allowed {
      return Err((404, "Not found"));
    }
    app
      .emit(PHOTO_REVIEW_EVENT, &parsed)
      .map_err(|_| (500, "Could not reach the app"))?;
    Ok(())
  })();
  match outcome {
    Ok(()) => respond_text(request, 200, "ok"),
    Err((status, msg)) => respond_text(request, status, msg),
  }
}

fn handle_report_download(request: tiny_http::Request, session: Option<[u8; 16]>, key: &[u8; 32]) {
  let staged = STAGED_REPORT.lock().unwrap().clone();
  let Some(path) = staged_report_for(&staged, session, now_ms()) else {
    respond_json(request, 404, "{\"ready\":false}".to_string());
    return;
  };
  match std::fs::read(&path) {
    Ok(bytes) => {
      // The PDF is a patient's document: enveloped like everything else.
      respond_enveloped(request, key, bytes);
    }
    Err(_) => respond_json(request, 404, "{\"ready\":false}".to_string()),
  }
}

// Runtime-generic so the mock runtime can drive the same wiring the live
// app uses, in the live-HTTP integration test below.
/// The one brand asset served without a credential (wired in handle_request):
/// iOS's home-screen icon loader fetches apple-touch-icon as a bare request
/// that carries no cookies, so behind the auth gate it 404'd and newly saved
/// icons lost the app logo. Static bytes, no secrets in the response.
fn is_public_asset(url: &str) -> bool {
  url == "/logo.png"
}

/// Everything the per-request handler needs about the live link, shared with
/// every request thread as one Arc.
struct LinkContext {
  token: String,
  key: [u8; 32],
  sessions: Arc<SessionStore>,
  last_seen_ms: Arc<AtomicU64>,
  guard: Arc<AuthGuard>,
  shutdown: Arc<AtomicBool>,
}

fn handle_request<R: Runtime>(
  app: &AppHandle<R>,
  ctx: &LinkContext,
  mut request: tiny_http::Request,
) {
  let url = request.url().to_string();
  let source_ip = request.remote_addr().map(|addr| addr.ip());
  let cookie_header = request
    .headers()
    .iter()
    .find(|h| h.field.equiv("Cookie"))
    .map(|h| h.value.as_str());

  // The public brand asset comes first: it must answer the cookieless icon
  // fetch (see is_public_asset) and never count toward the throttle or the
  // connected indicator. Everything else goes through the gate below.
  // The manifest deliberately stays gated — its start_url embeds the
  // pairing code.
  if request.method() == &Method::Get && is_public_asset(&url) {
    let _ = request.respond(
      Response::from_data(LOGO_PNG.to_vec()).with_header(content_type("image/png")),
    );
    return;
  }

  // Auth order (Tier 2): the live pairing code exchanges for a session
  // cookie; a live cookie routes; everything else counts toward the
  // throttle and gets the same 404 as any unknown route. classify_auth owns
  // the ordering so its unit tests pin the re-scan-while-blocked property.
  let action = classify_auth(
    &url,
    cookie_header,
    &ctx.token,
    &ctx.sessions,
    &ctx.guard,
    source_ip,
    Instant::now(),
  );
  // Any request presenting a valid credential (code or cookie) proves the
  // phone is live; photo grabs included.
  if !matches!(action, AuthAction::Rejected { .. }) {
    ctx.last_seen_ms.store(now_ms(), Ordering::Relaxed);
  }
  // The authenticated session, when the request carries a live cookie — the
  // report routes key staged PDFs to it and the POST meter consumes from it.
  let session = session_from_cookie(cookie_header);
  let method = request.method().clone();
  let path = match action {
    // The one-time exchange. 303 to the token-less root is what old saved
    // icons and old QR photos follow to this day; the Set-Cookie rides
    // along (or is skipped when the request already carried a live one).
    AuthAction::Exchange { fresh } => {
      // Carry the query (the transit key ?k=… from the QR URL) into the
      // token-less root — it is how the page first learns the key. The key
      // only ever travels in the QR and this one redirect echo; nothing
      // else serves it.
      let target = match url.split_once('?') {
        Some((_, query)) if !query.is_empty() => format!("/?{query}"),
        _ => "/".to_string(),
      };
      let mut response = Response::empty(303).with_header(location_header(&target));
      if let Some(id) = &fresh {
        response = response.with_header(session_cookie_header(id));
      }
      let _ = request.respond(response);
      return;
    }
    // Token-less authenticated path ("", "hello", "img/<file>"…). A URL
    // without the leading slash matches no route and 404s like any unknown
    // path.
    AuthAction::Authenticated => {
      // State-changing POSTs are metered per session (see SessionStore).
      let limited_post = method == Method::Post
        && matches!(url.strip_prefix('/'), Some("photo" | "photo-review" | "report-request"));
      if limited_post {
        let allowed = session
          .map(|s| ctx.sessions.allow_post(s, now_ms()))
          .unwrap_or(true);
        if !allowed {
          respond_text(request, 429, "Too many requests");
          return;
        }
      }
      url.strip_prefix('/').unwrap_or(&url)
    }
    AuthAction::Rejected { noted } => {
      // Wrong code, or a missing/dead cookie. The same response for every
      // rejected request, but the source is tracked and throttled — a
      // scanner gets refused quietly after a burst. Nothing from the URL
      // or cookie is logged: either may contain a guessed or leaked
      // secret fragment.
      if let Some(ip) = source_ip {
        match noted {
          Some(true) => crate::diagnostics::record(
            crate::diagnostics::Level::Info,
            "phone-camera",
            &format!(
              "Paused requests from {ip} for five minutes — repeated unauthorised requests."
            ),
            None,
          ),
          Some(false) => crate::diagnostics::record(
            crate::diagnostics::Level::Info,
            "phone-camera",
            &format!("Rejected a request from {ip} — no valid pairing code or session."),
            None,
          ),
          None => {}
        }
      }
      // GETs get the link page — a phone whose pairing died needs a way
      // back in (restore the saved link or scan the QR again), not a bare
      // 404 dead end. Static and secret-free, and identical for every
      // rejected request, so it widens no oracle. The 404 status is
      // load-bearing: it is how the companion page tells "credential dead"
      // apart from "server gone" (a 200 here would read as connected), and
      // a browser navigating straight to a dead link still renders the
      // body. Non-GETs (photo posts, beacons) keep the plain refusal.
      if request.method() == &Method::Get {
        let _ = request.respond(
          Response::from_string(LINK_HTML)
            .with_status_code(404)
            .with_header(content_type("text/html; charset=utf-8")),
        );
      } else {
        respond_text(request, 404, "Not found");
      }
      return;
    }
  };

  if method == Method::Get && (path.is_empty() || path == "index.html") {
    // The shell revalidates instead of refetching (specs/007's mitigation
    // for the plain-HTTP app shell): no-cache + a version ETag means the
    // page's JS rides the wire only when the app actually changed — 304s
    // carry nothing. No service worker: SWs are secure-context-only, which
    // plain LAN http is not.
    let etag = format!("\"camog-page-{}\"", env!("CARGO_PKG_VERSION"));
    let matches = request.headers().iter().any(|h| {
      h.field.equiv("If-None-Match") && h.value.as_str().contains(&etag)
    });
    if matches {
      let _ = request.respond(Response::empty(304).with_header(cache_control("no-cache")));
    } else {
      let _ = request.respond(
        Response::from_string(PAGE_HTML)
          .with_header(content_type("text/html; charset=utf-8"))
          .with_header(cache_control("no-cache"))
          .with_header(
            Header::from_bytes(&b"ETag"[..], etag.as_bytes()).expect("static header value"),
          ),
      );
    }
  } else if method == Method::Get && path == "logo.png" {
    let _ = request.respond(
      Response::from_data(LOGO_PNG.to_vec()).with_header(content_type("image/png")),
    );
  } else if method == Method::Get && path == "manifest.webmanifest" {
    respond_json(request, 200, web_manifest(&ctx.token));
  } else if method == Method::Get && path == "hello" {
    // Phone page pings on load so the desktop knows pairing succeeded. A
    // page that cannot prove it holds the transit key (a cached page from
    // before 0.13.0) gets the dead-pairing 404 — which its own error path
    // already renders as the re-scan message, never a raw error.
    if !link_capability(&request) {
      respond_text(request, 404, "Not found");
      return;
    }
    let _ = app.emit(STATUS_EVENT, RemoteCameraStatus { connected: true });
    respond_text(request, 200, "ok");
  } else if method == Method::Get && path == "link-code" {
    // Tells the paired phone its own pairing code so a dead session can
    // heal itself through the saved /t/<code>/ URL (and the link page can
    // offer Restore). Session-gated: a live session is the same class of
    // credential as the code, so this hands nothing to a new principal.
    respond_json(request, 200, format!("{{\"code\":\"{}\"}}", ctx.token));
  } else if method == Method::Get && path == "library" {
    handle_library(request, &ctx.key);
  } else if method == Method::Get && path == "library-wait" {
    // Long-poll: hold until the shared library changes (desktop publish or
    // share-off clear), the link shuts down, or the cap elapses. The phone
    // re-opens this the moment it answers, so manifest updates ride events —
    // review dates, new photos — instead of refresh timers. The answer
    // carries no patient data ({changed:…}), so it stays plaintext.
    let changed = wait_for_library_change(&ctx.shutdown, Duration::from_secs(25));
    respond_json(request, 200, format!(r#"{{"changed":{changed}}}"#));
  } else if method == Method::Get && path.starts_with("img/") {
    handle_image(request, &path["img/".len()..], &ctx.key);
  } else if method == Method::Get && path == "report" {
    handle_report_download(request, session, &ctx.key);
  } else if method == Method::Post && path == "bye" {
    // Phone page beacons on hide/unload so the desktop can clear the
    // "connected" indicator instead of showing it forever.
    let _ = app.emit(STATUS_EVENT, RemoteCameraStatus { connected: false });
    respond_text(request, 200, "ok");
  } else if method == Method::Post && path == "photo-review" {
    handle_photo_review_request(app, request, &ctx.key);
  } else if method == Method::Post && path == "report-request" {
    handle_patient_request(app, request, REPORT_EVENT, session, &ctx.key);
  } else if method == Method::Post && path == "photo" {
    let photo_result = (|| -> Result<Vec<u8>, ()> {
      if request.body_length().is_some_and(|len| len > MAX_BODY + ENVELOPE_OVERHEAD) {
        return Err(());
      }
      request_body(&mut request, &ctx.key, MAX_BODY)
    })();
    let body = match photo_result {
      Ok(body) if !body.is_empty() && body.len() <= MAX_BODY => body,
      Ok(_) => {
        respond_text(request, 413, "Photo too large");
        return;
      }
      Err(()) => {
        respond_text(request, 400, "Bad request");
        return;
      }
    };

    let capture_id = capture_id_from_headers(request.headers());
    let patient_id = LIBRARY.lock().unwrap().as_ref().and_then(|lib| {
      patient_id_from_headers(request.headers(), Some(&lib.allowed_patients))
    });
    // One line per delivery: a transport-level resend shows up as two lines
    // sharing a capture id — the receipt for the webview's dedupe dropping
    // the repeat instead of staging the photo twice.
    crate::diagnostics::record(
      crate::diagnostics::Level::Info,
      "phone-camera",
      &match &capture_id {
        Some(id) => format!("Received photo from phone ({id}, {} bytes).", body.len()),
        None => format!("Received photo from phone ({} bytes).", body.len()),
      },
      None,
    );
    let photo = RemoteCameraPhoto {
      data: base64::engine::general_purpose::STANDARD.encode(&body),
      capture_id,
      patient_id,
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

fn spawn_handler<R: Runtime>(
  app: AppHandle<R>,
  server: Arc<Server>,
  ctx: Arc<LinkContext>,
) -> JoinHandle<()> {
  std::thread::spawn(move || {
    while !ctx.shutdown.load(Ordering::Relaxed) {
      match server.recv() {
        Ok(request) => {
          // One thread per request: the library long-poll holds its
          // connection open for up to 25s and must not starve photo
          // uploads, hello, or anything else behind the sequential recv.
          let app = app.clone();
          let ctx = Arc::clone(&ctx);
          std::thread::spawn(move || {
            handle_request(&app, &ctx, request);
          });
        }
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
  // code's session exchange stays the only gate that matters.
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
  let key = pairing_key(&app)?;
  let urls = pairing_urls(lan_ip(), tailscale_ip(), port, &token, &key);
  let server = Arc::new(server);
  let last_seen_ms = Arc::new(AtomicU64::new(now_ms()));

  let shutdown = Arc::new(AtomicBool::new(false));
  // Fresh failure history per session: a restart (including a pairing-code
  // rotation) unblocks everything and starts counting anew. The session
  // store is likewise fresh — every stop revokes all phone sessions.
  let guard = Arc::new(AuthGuard::new());
  let sessions = Arc::new(SessionStore::new());
  let thread = spawn_handler(
    app,
    Arc::clone(&server),
    Arc::new(LinkContext {
      token: token.clone(),
      key,
      sessions: Arc::clone(&sessions),
      last_seen_ms: Arc::clone(&last_seen_ms),
      guard: Arc::clone(&guard),
      shutdown: Arc::clone(&shutdown),
    }),
  );

  *REMOTE_CAMERA.lock().unwrap() = Some(RemoteCamera {
    shutdown,
    server,
    thread: Some(thread),
    port,
    token,
    key,
    sessions,
    last_seen_ms,
  });
  *STAGED_REPORT.lock().unwrap() = None;

  // No token in diagnostics — the pairing URL is a secret. The discovered
  // addresses (scheme + host + port only) are the support surface: a link
  // missing its `tailscale …` entry means the CGNAT route probe found no
  // tunnel on this machine, while its presence puts a scan failure on the
  // network path (firewall rule, tailnet ACL, phone not connected).
  let discovered = {
    let joined = urls
      .iter()
      .map(|u| {
        let kind = match u.kind {
          LinkKind::Lan => "lan",
          LinkKind::Tailscale => "tailscale",
        };
        let base = u.url.split("/t/").next().unwrap_or("");
        format!("{kind} {base}")
      })
      .collect::<Vec<_>>()
      .join(", ");
    if joined.is_empty() {
      "no pairing address detected".to_string()
    } else {
      joined
    }
  };
  crate::diagnostics::record(
    crate::diagnostics::Level::Info,
    "phone-camera",
    &format!("Phone camera link started on port {port} ({discovered})"),
    None,
  );

  Ok(RemoteCameraInfo { urls })
}

#[tauri::command]
pub async fn stop_remote_camera() {
  if let Some(mut remote_camera) = REMOTE_CAMERA.lock().unwrap().take() {
    // Session revocation, made explicit: every paired phone signs out the
    // moment the link ends, without touching the pairing code.
    remote_camera.sessions.remove_all();
    remote_camera.shutdown.store(true, Ordering::Relaxed);
    remote_camera.server.unblock();
    if let Some(thread) = remote_camera.thread.take() {
      let _ = thread.join();
    }
  }
  *STAGED_REPORT.lock().unwrap() = None;
  *AWAITING_REPORT.lock().unwrap() = None;
}

/// Rotate the pairing code ("New code" in the phone link dialog): stop the
/// link, forget the persisted token, start again on the same pinned port.
/// The previous code stops working the moment the server restarts — a phone
/// still holding it sees 404s and drops to its reconnecting screen until the
/// new QR is scanned once. The transit key rotates with it (specs/007): a
/// code that was shared or photographed must not leave behind a key that
/// still opens anything. The shared library is untouched by the restart,
/// so a re-paired phone picks it straight back up.
#[tauri::command]
pub async fn reset_pairing_token(app: AppHandle) -> Result<RemoteCameraInfo, String> {
  stop_remote_camera().await;
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("could not resolve the app data dir: {e}"))?;
  // A failure here must surface, not fall through to start: a token file we
  // failed to delete would silently keep the old code alive (same reasoning
  // for the key file).
  match std::fs::remove_file(dir.join("phone-link-token")) {
    Ok(()) => {}
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
    Err(e) => return Err(format!("could not remove the old pairing code: {e}")),
  }
  match std::fs::remove_file(dir.join("phone-link-key")) {
    Ok(()) => {}
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
    Err(e) => return Err(format!("could not remove the old transit key: {e}")),
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
      urls: pairing_urls(lan_ip(), tailscale_ip(), rc.port, &rc.token, &rc.key),
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
  // Wake any held library long-poll so the phone sees this publish now.
  signal_library_changed();
  Ok(())
}

/// Drop everything shared with the phone (library + staged report): used when
/// the share toggle goes off or the companion session ends.
#[tauri::command]
pub fn clear_remote_library() {
  *LIBRARY.lock().unwrap() = None;
  *STAGED_REPORT.lock().unwrap() = None;
  *AWAITING_REPORT.lock().unwrap() = None;
  // A held long-poll must wake so the phone reverts to capture-only now.
  signal_library_changed();
}

/// Hand the phone a case report the webview has just generated. The report
/// binds to the single in-flight request's session (consumed here), so a
/// second phone interleaving its own request was refused outright and can
/// never download this patient's PDF.
#[tauri::command]
pub fn stage_remote_report(path: String) {
  let awaiting = AWAITING_REPORT.lock().unwrap().take();
  let session = awaiting
    .filter(|(_, noted_at)| now_ms().saturating_sub(*noted_at) <= AWAITING_REPORT_TTL_MS)
    .map(|(s, _)| s);
  *STAGED_REPORT.lock().unwrap() = Some(StagedReport {
    session,
    path: PathBuf::from(path),
    at: now_ms(),
  });
}

// 256px copy of the app logo (public/logo.png) so the phone page carries the
// brand mark without shipping the 1024px original over the LAN.
const LOGO_PNG: &[u8] = include_bytes!("../assets/logo.png");

// Home-screen app (PWA) manifest: lets the phone add Camog to its home
// screen with the app logo and open it standalone, without browser chrome.
// Minted per link with the pairing code as the start URL so every saved
// icon — old or new — opens through the one-time exchange: a live cookie is
// reused, a dead one (desktop restart, idle auto-close, eviction) is
// re-minted on the spot. The code therefore crosses the wire once per app
// open, never per request. Scope "./" resolves to / where the manifest is
// served. Android uses this; iOS home-screen icons come from the
// apple-touch-icon link in the page head (and engines that save the current
// page URL instead of start_url land on /, where a dead cookie shows the
// re-scan message — the documented trade-off).
// ponytail: single 256px "any" icon — a dedicated maskable PNG would avoid
// launcher cropping but we ship only the one logo asset.
fn web_manifest(token: &str) -> String {
  format!(
    r##"{{"name":"Camog · Clinical Photos","short_name":"Camog","start_url":"/t/{token}/","scope":"./","display":"standalone","background_color":"#f4f4f5","theme_color":"#f4f4f5","icons":[{{"src":"logo.png","sizes":"256x256","type":"image/png","purpose":"any"}}]}}"##
  )
}

include!("remote_camera_page.rs");

#[cfg(test)]
mod tests {
  use super::{
    capture_id_from_headers, is_safe_filename, staged_report_for, refilled, try_claim_awaiting_report,
    cgnat_address_among,
    SessionStore, StagedReport, POST_BURST, STAGED_REPORT_TTL_MS, AWAITING_REPORT_TTL_MS,
    LINK_HTML, PAGE_HTML,
  };
  use std::path::PathBuf;
  use tiny_http::Header;

  fn capture_header(value: &str) -> Vec<Header> {
    vec![Header::from_bytes("X-Capture-Id", value).expect("valid header")]
  }

  // The dedupe key survives the relay: a well-formed id is passed on, a
  // missing one (old page) and a malformed one (not ours, or hostile) are
  // both "no key" rather than a crash or a spoofed log entry.
  #[test]
  fn capture_id_header_strict() {
    assert_eq!(
      capture_id_from_headers(&capture_header("6f8ef090-64c1-4497-ac33-ac1386e1e00e")),
      Some("6f8ef090-64c1-4497-ac33-ac1386e1e00e".to_string())
    );
    assert_eq!(capture_id_from_headers(&capture_header(" c7x9k2m1p0 ")), Some("c7x9k2m1p0".to_string()));
    assert_eq!(capture_id_from_headers(&[]), None);
    assert_eq!(capture_id_from_headers(&capture_header("")), None);
    assert_eq!(capture_id_from_headers(&capture_header("has space")), None);
    // 65 chars of valid alphabet is still refused.
    assert_eq!(capture_id_from_headers(&capture_header(&"a".repeat(65))), None);
    assert_eq!(capture_id_from_headers(&capture_header(&"a".repeat(64))), Some("a".repeat(64)));
    // Only the id header is read; other headers never produce a key.
    let other = vec![Header::from_bytes("Cookie", "session=x").expect("valid header")];
    assert_eq!(capture_id_from_headers(&other), None);
  }

  // The phone page stamps every send with the dedupe id header, and a
  // patient-scoped capture additionally carries the patient header.
  #[test]
  fn phone_page_stamps_capture_id() {
    assert!(PAGE_HTML.contains("'X-Capture-Id': newCaptureId()"));
    assert!(PAGE_HTML.contains("function newCaptureId()"));
    assert!(PAGE_HTML.contains("headers['X-Patient-Id'] = capturePatientId"));
  }

  // The capture-for-patient header only survives for patients the shared
  // library actually advertises: a valid id from the manifest relays into
  // the event (prefills the desktop form), while an unknown or malformed id
  // — and any id with no library shared at all — arrives as nothing.
  #[test]
  fn patient_id_header_gated_on_shared_library() {
    use super::patient_id_from_headers;
    use std::collections::HashSet;

    fn patient_header(value: &str) -> Vec<Header> {
      vec![Header::from_bytes("X-Patient-Id", value).expect("valid header")]
    }
    let mut allowed = HashSet::new();
    allowed.insert("p1".to_string());
    // No library shared: nothing to resolve the patient against.
    assert_eq!(patient_id_from_headers(&patient_header("p1"), None), None);
    // A shared patient relays; an unknown one and a malformed one do not.
    assert_eq!(
      patient_id_from_headers(&patient_header("p1"), Some(&allowed)),
      Some("p1".to_string())
    );
    assert_eq!(patient_id_from_headers(&patient_header("p-other"), Some(&allowed)), None);
    assert_eq!(patient_id_from_headers(&patient_header("has space"), Some(&allowed)), None);
  }

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
  // manifest fetch that switches both on. Photos decrypt through the
  // envelope-aware loader (specs/007) — no raw img/ src anywhere.
  #[test]
  fn phone_page_carries_library_viewer() {
    assert!(PAGE_HTML.contains(r#"fetch('library')"#));
    assert!(PAGE_HTML.contains("screen-patient"));
    assert!(PAGE_HTML.contains("screen-viewer"));
    assert!(PAGE_HTML.contains(r#"setPhotoSrc(img, e.p.id + '.thumb.jpg')"#));
    assert!(PAGE_HTML.contains(r#"setPhotoSrc(img, entry.p.id + '.jpg')"#));
    assert!(PAGE_HTML.contains("Review overdue"));
    assert!(PAGE_HTML.contains("No consent on record"));
    // The loader decrypts before any <img> sees a URL, and no img/src
    // assignment may bypass it.
    assert!(PAGE_HTML.contains("function photoObjectUrl"));
    assert!(PAGE_HTML.contains("function setPhotoSrc"));
    assert!(!PAGE_HTML.contains(".src = 'img/"));
  }

  // Attachment indicator: photos carrying attached documents (result files)
  // show a paperclip + count on both photo grids — and the count rides the
  // aria-label — plus a note on the viewer's date line. The count comes from
  // the manifest's per-photo attachments field; a stale manifest shows none.
  #[test]
  fn phone_page_carries_attachment_indicator() {
    assert!(PAGE_HTML.contains("function attachClip"));
    assert!(PAGE_HTML.contains("function attachAria"));
    assert!(PAGE_HTML.contains("function attachNote"));
    assert!(PAGE_HTML.contains("p.attachments || 0"));
    assert!(PAGE_HTML.contains(".grid .cell-clip"));
    assert!(PAGE_HTML.contains("var clip = attachClip(e.p)"));
    assert!(PAGE_HTML.contains("+ attachAria(e.p)"));
    assert!(PAGE_HTML.contains("attachNote(e.p)"));
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
    assert!(PAGE_HTML.contains("'photo-review'"));
    assert!(PAGE_HTML.contains("'report-request'"));
    assert!(PAGE_HTML.contains("blurred"));
  }

  // Compare linkage: the manifest's lesionGroup drives a body-part +
  // series filter pair whose choices prune each other, photo pickers are
  // thumbnail buttons opening a full-screen sheet, and linked photos carry
  // a visible series chip — in BOTH the per-patient dialog and the
  // cross-patient Compare tab (refreshCompare shared by the two).
  #[test]
  fn phone_page_compare_linkage_filters_and_thumb_picker() {
    // Filters: part and series dropdowns, each pruning the other's options.
    assert!(PAGE_HTML.contains(r#"id="cmp-filters""#));
    assert!(PAGE_HTML.contains(r#"id="cmp-series""#));
    assert!(PAGE_HTML.contains("function cmpSeriesOptions"));
    assert!(PAGE_HTML.contains("function cmpPartOptions"));
    // Pools filter by both; a photo's series link resolves leniently for
    // manifests predating the field.
    assert!(PAGE_HTML.contains("function cmpGroup"));
    assert!(PAGE_HTML.contains("p.lesionGroup || null"));
    // Thumbnail picker buttons (not dropdowns) that open the sheet.
    assert!(PAGE_HTML.contains(r#"class="cmp-pick""#));
    assert!(PAGE_HTML.contains("cmp-left-thumb"));
    assert!(PAGE_HTML.contains("function openPickSheet"));
    assert!(PAGE_HTML.contains(r#"id="screen-cmppick""#));
    assert!(PAGE_HTML.contains("'pick-cell'"));
    assert!(PAGE_HTML.contains("' sel'"));
    assert!(PAGE_HTML.contains("cell-series"));
    assert!(PAGE_HTML.contains("function syncPickerButtons"));
    // One refresh path for both compare entry points; the sheet rides
    // history (back closes the sheet first) and hides with the surface.
    assert!(PAGE_HTML.contains("function refreshCompare"));
    assert!(PAGE_HTML.contains("function prepareCompareTab"));
    assert!(PAGE_HTML.contains("function pickSheetOpen"));
    assert!(PAGE_HTML.contains("hidePickSheet();"));
    // Picker labels carry the series name so links read in the chrome too.
    assert!(PAGE_HTML.contains("p.lesionGroup ? ' \\u00b7 ' + entry.p.lesionGroup"));
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

  // Review lives at the photo level, exactly like the desktop: the viewer
  // carries the status banner and the Mark reviewed offer (snap the
  // follow-up or not), grids flag photos that need review, and the old
  // patient-level button is gone (photo reviews count as the patient's).
  // The bottom bar still starts hidden so the camera hero loads clean.
  #[test]
  fn phone_page_review_offer_and_lazy_tabbar() {
    assert!(PAGE_HTML.contains(r#"<nav id="tabbar" role="tablist" aria-label="Sections" hidden>"#));
    // The fixed chrome (tab bar + theme button) mounts only when the boot
    // splash hands over — updateChrome first runs at the settled viewport,
    // so WebKit never composites a fixed element at the cold-start offset
    // (the "shifted upward on connect" glitch).
    assert!(PAGE_HTML.contains("function updateChrome"));
    assert!(PAGE_HTML.contains("var chromeReady = false;"));
    assert!(PAGE_HTML.contains(r#"id="theme" aria-label="Switch light or dark appearance" hidden"#));
    // Viewer: banner + per-photo offer (snap, phone library, or none).
    assert!(PAGE_HTML.contains(r#"id="viewer-flag""#));
    assert!(PAGE_HTML.contains(r#"id="viewer-review-btn""#));
    assert!(PAGE_HTML.contains(r#"id="photo-review-snap""#));
    assert!(PAGE_HTML.contains(r#"id="photo-review-library""#));
    assert!(PAGE_HTML.contains(r#"id="photo-review-plain""#));
    assert!(PAGE_HTML.contains("Review overdue"));
    assert!(PAGE_HTML.contains("Snap photo"));
    assert!(PAGE_HTML.contains("No photo needed"));
    // A dismissed camera/picker leaves the three-choice offer up (the
    // banner updates in place) instead of collapsing back to the
    // one-click "Mark reviewed" button.
    assert!(PAGE_HTML.contains("function renderViewerBanner"));
    // Grids flag photos needing review; patient rows keep their banners.
    assert!(PAGE_HTML.contains("cell-review"));
    assert!(PAGE_HTML.contains("function reviewDot"));
    // The patient-level review button is gone.
    assert!(!PAGE_HTML.contains(r#"id="review-btn""#));
  }

  // The due-review banner on the patients and photos tabs (the phone's
  // counterpart of the desktop's review badge), a compare surface whose
  // chrome follows the theme (only the photo panes stay black, like the
  // desktop dialog), and the app-shell scroll: screens scroll internally so
  // the fixed tab bar never rides the page's rubber-band overscroll.
  #[test]
  fn phone_page_due_banner_themed_compare_and_scroll_shell() {
    assert!(PAGE_HTML.contains(r#"id="lib-due""#));
    assert!(PAGE_HTML.contains(r#"id="all-due""#));
    assert!(PAGE_HTML.contains("function renderDueBanner"));
    assert!(PAGE_HTML.contains("due for review"));
    assert!(PAGE_HTML.contains("Next photo review"));
    // Patient cards carry the date however far out it sits (desktop
    // ReviewBadge + PhotoReviewDueBadge parity).
    assert!(PAGE_HTML.contains("was due"));
    assert!(PAGE_HTML.contains("p.reviewOwn || p.review"));
    // Theme: the compare surface reads the tokens instead of hardcoding dark.
    assert!(PAGE_HTML.contains("#screen-viewer, #screen-compare { background: var(--bg); }"));
    assert!(!PAGE_HTML.contains("#screen-compare { background: #000; }"));
    assert!(PAGE_HTML.contains("border: 1px solid var(--border); background: var(--card); color: var(--fg);"));
    // Scroll shell: the document is a fixed-height shell; screens scroll.
    assert!(PAGE_HTML.contains("height: 100dvh; overflow: hidden; overscroll-behavior: none;"));
    assert!(PAGE_HTML.contains("overscroll-behavior: contain"));
  }

  // Boot splash (the breathing-logo loading notice) plus the scroll guard:
  // the splash owns the first paint until the link answers AND the layout
  // has settled (a short settle + two frames before the fade), so the fixed
  // tab bar never composites at a stale cold-start offset and the whole UI
  // reveals finished; restored scroll can't open the page mid-list. The
  // patients tab sorts by name, review due, recency and photo count,
  // persisted per phone, and OPENS on Review due (soonest first) so the
  // urgent patients lead without a tap.
  #[test]
  fn phone_page_boot_splash_and_patient_sort() {
    assert!(PAGE_HTML.contains(r#"id="boot""#));
    assert!(PAGE_HTML.contains("@keyframes breathe"));
    // The splash rides the document (absolute), never the fixed layer
    // WebKit locks at the cold-start offset, and reveal forces a full
    // relayout at the settled metrics before anything shows.
    assert!(PAGE_HTML.contains("position: absolute; inset: 0; z-index: 40;"));
    assert!(PAGE_HTML.contains("function forceRelayout"));
    assert!(PAGE_HTML.contains("function reveal"));
    assert!(PAGE_HTML.contains("history.scrollRestoration = 'manual'"));
    assert!(PAGE_HTML.contains(r#"id="sort""#));
    assert!(PAGE_HTML.contains("'camog-sort'"));
    // Ascending/descending: a persisted direction with a visible flip
    // button; review order keys on the earliest date a card advertises
    // (patient schedule or next photo review), not the schedule alone.
    assert!(PAGE_HTML.contains(r#"id="sort-dir""#));
    assert!(PAGE_HTML.contains("'camog-sort-dir'"));
    assert!(PAGE_HTML.contains("nextPhotoDue"));
    assert!(PAGE_HTML.contains("function sortedPatients"));
    // Default sort: review due, ascending (soonest/overdue first).
    assert!(PAGE_HTML.contains("sort: 'review', sortDir: 'asc'"));
    assert!(PAGE_HTML.contains("localStorage.getItem(SORT_KEY) || 'review'"));
    // The topbar wraps instead of crushing the sort out of view.
    assert!(PAGE_HTML.contains("flex-wrap: wrap;"));
  }

  // Capture for a patient, phone half: the patient screen's Take photo
  // opens the camera inside the tap and Send from library runs the same
  // multi-pick pipeline — both stamp the snap's POST with the patient id
  // (chip visible + clearable on the start screen). The "Snap photo" review
  // follow-up opens the camera the same way instead of parking the user on
  // the start screen, and its note drops back to the default once the photo
  // is sent.
  #[test]
  fn phone_page_capture_for_patient_and_direct_snap() {
    assert!(PAGE_HTML.contains(r#"id="patient-capture""#));
    assert!(PAGE_HTML.contains(r#"id="patient-pick""#));
    assert!(PAGE_HTML.contains("Send from library"));
    assert!(PAGE_HTML.contains(r#"id="capture-for""#));
    assert!(PAGE_HTML.contains("function setCapturePatient"));
    assert!(PAGE_HTML.contains("headers['X-Patient-Id'] = capturePatientId"));
    // The library pick opened from a patient screen still lands on the
    // camera tab's review screens.
    assert!(PAGE_HTML.contains("if ($('screen-cam').hidden) setTab('cam');"));
    // Camera opens inside the gesture (both entry points), not after it.
    assert!(PAGE_HTML.contains("function markPhotoReviewed"));
    assert!(PAGE_HTML.contains("snapFollowUp = true"));
    assert!(PAGE_HTML.contains("setConn('Review marked. Send this photo to link it with the original.')"));
    // The note resets once the photo is sent (fresh camera reads clean).
    assert!(PAGE_HTML.contains("id=\"sent-hint\""));
    assert!(PAGE_HTML.contains("setConn(null); // the note has served; the next snap reads clean"));
  }

  // Bilateral sync, phone half: the page holds a library-wait long-poll and
  // refetches the moment the desktop publishes — updates ride the action
  // that caused them, with no polling timers.
  #[test]
  fn phone_page_watches_library_changes() {
    assert!(PAGE_HTML.contains("function watchLibrary"));
    assert!(PAGE_HTML.contains("'library-wait'"));
    assert!(PAGE_HTML.contains("if (shared) watchLibrary();"));
  }

  // Trust boundary: exactly one brand route answers without a credential —
  // the home-screen icon fetch carries no cookies (is_public_asset) — while
  // the data routes and the manifest (its start_url embeds the pairing code)
  // stay behind the gate.
  #[test]
  fn public_asset_gate() {
    use super::is_public_asset;
    assert!(is_public_asset("/logo.png"));
    assert!(!is_public_asset("/hello"));
    assert!(!is_public_asset("/library"));
    assert!(!is_public_asset("/manifest.webmanifest"));
    assert!(!is_public_asset("/t/1234/"));
    assert!(!is_public_asset("/logo.png/extra"));
  }

  // specs/007 needles: the page embeds the AES-256-GCM block (extractable
  // by the self-checks), loads the transit key from the QR's ?k= (storing it
  // for saved icons), seals uploads and control requests, and routes every
  // undecryptable record to the re-scan UX instead of an error. The link
  // page's scan stores the key alongside the code.
  #[test]
  fn phone_page_carries_transit_envelope() {
    // Extractable, self-contained crypto block (self-check cross-verifies
    // against OpenSSL).
    assert!(PAGE_HTML.contains("gcm-begin") && PAGE_HTML.contains("gcm-end"));
    assert!(PAGE_HTML.contains("function expandKey"));
    assert!(PAGE_HTML.contains("function buildTables"));
    assert!(PAGE_HTML.contains("WebCrypto's crypto.subtle only") || PAGE_HTML.contains("secure-context-only"));
    // Key loading: ?k= from the QR URL, persisted for saved icons.
    assert!(PAGE_HTML.contains("'camog-link-key'"));
    assert!(PAGE_HTML.contains("function loadLinkKey"));
    assert!(PAGE_HTML.contains(r#"/(?:^|\?|&)k=([\w-]{43})(?:&|$)/"#));
    // Uploads and control requests are sealed; hellos carry the marker.
    assert!(PAGE_HTML.contains("function sealRecord"));
    assert!(PAGE_HTML.contains("function openRecord"));
    assert!(PAGE_HTML.contains("'X-Link-Envelope': '1'"));
    assert!(PAGE_HTML.contains("'X-Link-Key': '1'"));
    // Manifest + photos + report all decrypt; a failure is the re-scan UX.
    assert!(PAGE_HTML.contains("X-Link-Envelope"));
    assert!(PAGE_HTML.contains("function envelopeFailed"));
    assert!(PAGE_HTML.contains("pairingExpired();"));
    // The link page's scan path captures the key from the QR URL.
    assert!(LINK_HTML.contains("'camog-link-key'"));
    assert!(LINK_HTML.contains("LINK_CRYPTO_KEY"));
    // A keyless page (a pairing from before the envelope) says what actually
    // reconnects it — the QR now carries the key — instead of the generic
    // pairing-expired copy, and skips the futile self-heal hop.
    assert!(PAGE_HTML.contains("'Camog was updated.'"));
    assert!(PAGE_HTML.contains("if (!LINK_KEY_BYTES) {"));
    assert!(
      PAGE_HTML.contains(r"now encrypted. Scan the QR in Camog\u2019s Phone link dialog once")
    );
  }

  // The link page handed to rejected requests: the phone's way back in
  // (restore the saved link or scan the QR again) instead of a bare 404
  // dead end. The companion page feeds it — it remembers the pairing code
  // the desktop shares over its live session and self-heals a dead session
  // through the saved /t/<code>/ URL once.
  #[test]
  fn link_page_offers_restore_and_scan() {
    assert!(LINK_HTML.contains(r#"id="restore""#));
    assert!(LINK_HTML.contains(r#"id="scan""#));
    assert!(LINK_HTML.contains("BarcodeDetector"));
    assert!(LINK_HTML.contains("'/t/' + code + '/'"));
    assert!(LINK_HTML.contains("camog-link-tried"));
    // The companion page's half of the handshake.
    assert!(PAGE_HTML.contains("fetch('link-code')"));
    assert!(PAGE_HTML.contains("rememberLink"));
    assert!(PAGE_HTML.contains("location.href = '/t/' + code + '/';"));
    assert!(PAGE_HTML.contains(r#"id="relink""#));
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

  // The whole Tier 2 exchange over real HTTP, through the same spawn_handler
  // wiring the live app uses (mock runtime — no window, real sockets). This
  // is the curl checklist from the plan, kept as a regression net: it sees
  // the header plumbing (Cookie lookup, Set-Cookie on the 303, Location)
  // that the classify_auth unit tests cannot — plus the specs/007 pieces:
  // the exchange carries the transit key's query into the redirect, the
  // shell revalidates by ETag, and a page that cannot present the transit
  // capability gets the dead-pairing 404.
  #[test]
  fn http_exchange_and_cookie_protocol() {
    use super::{AuthGuard, SessionStore, spawn_handler};
    use std::io::{Read, Write};
    use std::sync::Arc;
    use tauri::test;
    use tiny_http::Server;

    let app = test::mock_app();
    let token = "0123456789abcdef";
    let key = [0x42u8; 32];
    let listener = super::bind_listener("127.0.0.1".parse().unwrap(), 0).expect("test bind");
    let port = listener.local_addr().unwrap().port();
    let server = Arc::new(Server::from_listener(listener, None).expect("test server"));
    let last_seen_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let sessions = Arc::new(SessionStore::new());
    let thread = spawn_handler(
      app.handle().clone(),
      Arc::clone(&server),
      Arc::new(super::LinkContext {
        token: token.to_string(),
        key,
        sessions: Arc::clone(&sessions),
        last_seen_ms: Arc::clone(&last_seen_ms),
        guard: Arc::new(AuthGuard::new()),
        shutdown: Arc::clone(&shutdown),
      }),
    );

    let get = |path: &str, cookie: Option<&str>, caps: bool| -> String {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      let cookie_line = cookie
        .map(|c| format!("Cookie: {c}\r\n"))
        .unwrap_or_default();
      let caps_line = if caps { "X-Link-Key: 1\r\n" } else { "" };
      write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{cookie_line}{caps_line}Connection: close\r\n\r\n"
      )
      .expect("write");
      let mut response = String::new();
      stream.read_to_string(&mut response).expect("read");
      response
    };

    // Unauthenticated root: still a 404 (that status is how the page tells
    // "credential dead" from "server gone"), but the body is the link page
    // — the way back in — rather than a bare dead end.
    let res = get("/", None, true);
    assert!(res.starts_with("HTTP/1.1 404"), "no-cookie root must 404: {res}");
    assert!(res.contains("Restore saved link"), "rejected GET must serve the link page: {res}");

    // The exchange: valid code → 303 to / plus the session cookie, carrying
    // the transit key's query along so the page first learns it there.
    let res = get(&format!("/t/{token}/"), None, true);
    assert!(res.starts_with("HTTP/1.1 303"), "exchange must 303: {res}");
    assert!(res.contains("\r\nLocation: /\r\n"), "exchange without a query points at /: {res}");
    let res = get(&format!("/t/{token}/?k=AbC_-43chars"), None, true);
    assert!(
      res.contains("\r\nLocation: /?k=AbC_-43chars\r\n"),
      "the transit key's query must ride the redirect: {res}"
    );
    let set_cookie = res
      .lines()
      .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
      .expect("exchange sets a cookie");
    // …"camog_session=<hex>; Path=/; HttpOnly; SameSite=Strict"
    assert!(set_cookie.contains("; Path=/; HttpOnly; SameSite=Strict"));
    let session = set_cookie
      .strip_prefix("Set-Cookie: ")
      .expect("server-sent header case")
      .split(';')
      .next()
      .expect("name=value pair");

    // The cookie authenticates token-less paths…
    let res = get("/hello", Some(session), true);
    assert!(res.starts_with("HTTP/1.1 200"), "cookie must authenticate: {res}");
    // …and the page at / revalidates by ETag (no refetch while unchanged).
    let res = get("/", Some(session), true);
    assert!(res.starts_with("HTTP/1.1 200"), "cookie must serve the page: {res}");
    assert!(res.contains("Camog"));
    let etag = res
      .lines()
      .find(|l| l.to_ascii_lowercase().starts_with("etag:"))
      .expect("page carries a version ETag")
      .split_once(':')
      .expect("header split")
      .1
      .trim()
      .to_string();
    assert!(!etag.is_empty());
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    write!(
      stream,
      "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nIf-None-Match: {etag}\r\nConnection: close\r\n\r\n"
    )
    .expect("write");
    let mut res = String::new();
    stream.read_to_string(&mut res).expect("read");
    assert!(res.starts_with("HTTP/1.1 304"), "matching ETag must 304: {res}");

    // A page that cannot present the transit capability (a cached page from
    // before the envelope) gets the dead-pairing 404 — the input to its
    // re-scan UX — even with a live cookie.
    let res = get("/hello", Some(session), false);
    assert!(res.starts_with("HTTP/1.1 404"), "capability-less hello must 404: {res}");

    // A dead cookie is unauthenticated, and counts toward the throttle.
    let dead = "camog_session=ffffffffffffffffffffffffffffffff";
    let res = get("/hello", Some(dead), true);
    assert!(res.starts_with("HTTP/1.1 404"), "dead cookie must 404: {res}");
    // Wrong code, same story.
    let res = get("/t/feedfacefeedface/", None, true);
    assert!(res.starts_with("HTTP/1.1 404"), "wrong code must 404: {res}");

    // An exchange from a holder of the live cookie reuses it: 303 with no
    // fresh Set-Cookie (old pages sitting on /t/<code>/ URLs).
    let res = get(&format!("/t/{token}/hello"), Some(session), true);
    assert!(res.starts_with("HTTP/1.1 303"), "re-exchange must 303: {res}");
    assert!(
      !res.to_ascii_lowercase().contains("set-cookie:"),
      "live cookie must be reused, not re-minted: {res}"
    );

    shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
    server.unblock();
    let _ = thread.join();
  }

  // The passive-capture acceptance test (specs/007): a full session over
  // real sockets — exchange, manifest, photo down, photo up — where the raw
  // wire bytes are searched for patient data. Nothing readable may cross:
  // not the patient's name, not the JPEG bytes, not the manifest JSON.
  #[test]
  fn http_wire_carries_no_patient_data_in_the_clear() {
    use super::{AuthGuard, SessionStore, spawn_handler, update_remote_library};
    use std::io::{Read, Write};
    use std::sync::Arc;
    use tauri::test;
    use tiny_http::Server;

    let app = test::mock_app();
    let token = "0123456789abcdef";
    let key = [0x5Au8; 32];
    let listener = super::bind_listener("127.0.0.1".parse().unwrap(), 0).expect("test bind");
    let port = listener.local_addr().unwrap().port();
    let server = Arc::new(Server::from_listener(listener, None).expect("test server"));
    let last_seen_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let sessions = Arc::new(SessionStore::new());
    let thread = spawn_handler(
      app.handle().clone(),
      Arc::clone(&server),
      Arc::new(super::LinkContext {
        token: token.to_string(),
        key,
        sessions: Arc::clone(&sessions),
        last_seen_ms: Arc::clone(&last_seen_ms),
        guard: Arc::new(AuthGuard::new()),
        shutdown: Arc::clone(&shutdown),
      }),
    );

    let manifest = r#"{"viewing":true,"patients":[{"id":"p1","name":"Margot Whitfield"}]}"#;
    update_remote_library(
      manifest.to_string(),
      ".".to_string(),
      vec!["ph1.jpg".to_string()],
      vec!["p1".to_string()],
    )
    .expect("publish");

    // A distinctive 2 KB "JPEG" whose bytes would be trivially recognisable
    // in the wire capture if they ever travelled in the clear.
    let jpeg = vec![0xA7u8; 2048];

    let exchange = |path: &str| -> String {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
      )
      .expect("write");
      let mut res = String::new();
      stream.read_to_string(&mut res).expect("read");
      res
    };
    let session = exchange(&format!("/t/{token}/?k=x"))
      .lines()
      .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
      .expect("exchange sets a cookie")
      .strip_prefix("Set-Cookie: ")
      .expect("server-sent header case")
      .split(';')
      .next()
      .expect("name=value pair")
      .to_string();

    let mut transcript = Vec::new();
    let get = |path: &str, transcript: &mut Vec<u8>| -> Vec<u8> {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nX-Link-Key: 1\r\nConnection: close\r\n\r\n"
      )
      .expect("write");
      let mut raw = Vec::new();
      stream.read_to_end(&mut raw).expect("read");
      transcript.extend_from_slice(&raw);
      // Strip the head (status + headers) to get the body bytes.
      raw.splitn(2, |b: &u8| *b == b'\n').nth(1).map(|b| b.to_vec()).unwrap_or_default()
      // note: splitn on first \n leaves headers cut at the first line only;
      // the search below is on the whole transcript anyway.
    };
    let _ = get("/library", &mut transcript);
    let _ = get("/img/ph1.jpg", &mut transcript);

    // Photo up: seal a "snap" the way the phone page does.
    let sealed = super::envelope_seal(&key, &jpeg).expect("seal upload");
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    write!(
      stream,
      "POST /photo HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nX-Link-Key: 1\r\nX-Link-Envelope: 1\r\nX-Capture-Id: wire-test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
      sealed.len()
    )
    .expect("write");
    stream.write_all(&sealed).expect("write body");
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).expect("read");
    assert!(raw.starts_with(b"HTTP/1.1 200"), "sealed upload must be accepted: {}", String::from_utf8_lossy(&raw));
    transcript.extend_from_slice(&raw);

    // The passive capture: neither the patient's name, nor the manifest
    // JSON, nor a single recognisable run of the JPEG may appear anywhere.
    let wire = String::from_utf8_lossy(&transcript).to_lowercase();
    assert!(!wire.contains("margot"), "patient name crossed in the clear");
    assert!(!wire.contains("whitfield"), "patient name crossed in the clear");
    assert!(!wire.contains("viewing"), "manifest JSON crossed in the clear");
    assert!(!transcript.windows(16).any(|w| w == &jpeg[..16]), "JPEG bytes crossed in the clear");
    // And the delivered records still decrypt to exactly the originals.
    let lib_raw = {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      write!(
        stream,
        "GET /library HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nX-Link-Key: 1\r\nConnection: close\r\n\r\n"
      )
      .expect("write");
      let mut raw = Vec::new();
      stream.read_to_end(&mut raw).expect("read");
      let body = raw.windows(4).position(|w| w == b"\r\n\r\n").map(|i| &raw[i + 4..]).expect("body");
      body.to_vec()
    };
    assert_eq!(
      super::envelope_open(&key, &lib_raw).as_deref(),
      Some(manifest.as_bytes()),
      "the manifest must survive the envelope intact"
    );

    shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
    server.unblock();
    let _ = thread.join();
  }

  // Upload envelope mechanics: a sealed snap is accepted and relayed, a
  // tampered one is refused (GCM auth), and a plaintext body (a page cached
  // from before the envelope) still passes through for its capture-only
  // lifetime.
  #[test]
  fn http_photo_upload_envelope_and_plaintext_fallback() {
    use super::{AuthGuard, SessionStore, spawn_handler};
    use std::io::{Read, Write};
    use std::sync::Arc;
    use tauri::test;
    use tiny_http::Server;

    let app = test::mock_app();
    let token = "0123456789abcdef";
    let key = [0x63u8; 32];
    let listener = super::bind_listener("127.0.0.1".parse().unwrap(), 0).expect("test bind");
    let port = listener.local_addr().unwrap().port();
    let server = Arc::new(Server::from_listener(listener, None).expect("test server"));
    let last_seen_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let sessions = Arc::new(SessionStore::new());
    let thread = spawn_handler(
      app.handle().clone(),
      Arc::clone(&server),
      Arc::new(super::LinkContext {
        token: token.to_string(),
        key,
        sessions: Arc::clone(&sessions),
        last_seen_ms: Arc::clone(&last_seen_ms),
        guard: Arc::new(AuthGuard::new()),
        shutdown: Arc::clone(&shutdown),
      }),
    );

    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    write!(
      stream,
      "GET /t/{token}/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("write");
    let mut res = String::new();
    stream.read_to_string(&mut res).expect("read");
    let session = res
      .lines()
      .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
      .expect("exchange sets a cookie")
      .strip_prefix("Set-Cookie: ")
      .expect("server-sent header case")
      .split(';')
      .next()
      .expect("name=value pair")
      .to_string();

    // The page's real header set marks only the body (X-Link-Envelope); the
    // capability header is hello's, not the upload's. The `caps` flag here
    // sends BOTH so the envelope is also proven to open when the marker is
    // accompanied by unrelated headers.
    let post = |envelope: Option<&[u8]>, plaintext: &[u8]| -> String {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      let body = envelope.unwrap_or(plaintext);
      let caps = if envelope.is_some() { "X-Link-Envelope: 1\r\nX-Link-Key: 1\r\n" } else { "" };
      write!(
        stream,
        "POST /photo HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\n{caps}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
      )
      .expect("write");
      stream.write_all(body).expect("write body");
      let mut raw = Vec::new();
      stream.read_to_end(&mut raw).expect("read");
      String::from_utf8_lossy(&raw).to_string()
    };

    // Sealed upload: accepted (the webview event delivery is exercised by
    // the capture flow; the HTTP layer's contract is acceptance + decrypt).
    let snap = vec![0x5Cu8; 1024];
    let sealed = super::envelope_seal(&key, &snap).expect("seal");
    let res = post(Some(&sealed), &[]);
    assert!(res.starts_with("HTTP/1.1 200"), "sealed upload must pass: {res}");

    // The phone page's exact header set: the envelope marker on the body,
    // no capability header (that rides hello). Must open just the same —
    // the gate is the marker, not the capability.
    let sealed = super::envelope_seal(&key, &snap).expect("seal");
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    write!(
      stream,
      "POST /photo HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nX-Link-Envelope: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
      sealed.len()
    )
    .expect("write");
    stream.write_all(&sealed).expect("write body");
    let mut raw = Vec::new();
    stream.read_to_end(&mut raw).expect("read");
    assert!(
      raw.starts_with(b"HTTP/1.1 200"),
      "marker-only envelope (the page's real header set) must open: {}",
      String::from_utf8_lossy(&raw)
    );

    // Tampered: one flipped byte, refused.
    let mut tampered = sealed.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x08;
    let res = post(Some(&tampered), &[]);
    assert!(res.starts_with("HTTP/1.1 400"), "tampered upload must be refused: {res}");

    // A wrong-key envelope is refused the same way.
    let forged = super::envelope_seal(&[1u8; 32], &snap).expect("forged");
    let res = post(Some(&forged), &[]);
    assert!(res.starts_with("HTTP/1.1 400"), "wrong-key upload must be refused: {res}");

    // Legacy plaintext (pre-envelope cached page): accepted.
    let res = post(None, &snap);
    assert!(res.starts_with("HTTP/1.1 200"), "plaintext fallback must pass: {res}");

    shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
    server.unblock();
    let _ = thread.join();
  }

  // Bilateral sync: a held library long-poll must wake the moment the
  // desktop publishes (this is the whole phone update channel — review
  // dates and new photos ride it instead of refresh timers), wake on a
  // share-off clear as well, and answer changed:false when the link shuts
  // down. Runs over real HTTP through the same spawn_handler wiring. The
  // manifest itself arrives enveloped — the test opens it with the session
  // key and checks the plaintext never rides the wire.
  #[test]
  fn http_library_wait_wakes_on_publish() {
    use super::{AuthGuard, SessionStore, envelope_open, spawn_handler};
    use std::io::{Read, Write};
    use std::sync::Arc;
    use tauri::test;
    use tiny_http::Server;

    let app = test::mock_app();
    let token = "0123456789abcdef";
    let key = [0x71u8; 32];
    let listener = super::bind_listener("127.0.0.1".parse().unwrap(), 0).expect("test bind");
    let port = listener.local_addr().unwrap().port();
    let server = Arc::new(Server::from_listener(listener, None).expect("test server"));
    let last_seen_ms = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let sessions = Arc::new(SessionStore::new());
    let thread = spawn_handler(
      app.handle().clone(),
      Arc::clone(&server),
      Arc::new(super::LinkContext {
        token: token.to_string(),
        key,
        sessions: Arc::clone(&sessions),
        last_seen_ms: Arc::clone(&last_seen_ms),
        guard: Arc::new(AuthGuard::new()),
        shutdown: Arc::clone(&shutdown),
      }),
    );

    // Exchange the pairing code for a session cookie.
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
    write!(
      stream,
      "GET /t/{token}/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    )
    .expect("write");
    let mut res = String::new();
    stream.read_to_string(&mut res).expect("read");
    let session = res
      .lines()
      .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
      .expect("exchange sets a cookie")
      .strip_prefix("Set-Cookie: ")
      .expect("server-sent header case")
      .split(';')
      .next()
      .expect("name=value pair")
      .to_string();

    let get_raw = |path: &str| -> Vec<u8> {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nX-Link-Key: 1\r\nConnection: close\r\n\r\n"
      )
      .expect("write");
      // The body is envelope ciphertext — read bytes, not UTF-8.
      let mut raw = Vec::new();
      stream.read_to_end(&mut raw).expect("read");
      raw
    };
    let open_manifest = |raw: &[u8]| -> Option<Vec<u8>> {
      let i = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
      envelope_open(&key, &raw[i + 4..])
    };

    // A held wait answers changed:true as soon as a publish lands.
    let wait = |session: &str| -> std::thread::JoinHandle<String> {
      let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
      write!(
        stream,
        "GET /library-wait HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: {session}\r\nConnection: close\r\n\r\n"
      )
      .expect("write");
      std::thread::spawn(move || {
        let mut response = String::new();
        stream.read_to_string(&mut response).expect("read");
        response
      })
    };
    let waiter = wait(&session);
    std::thread::sleep(std::time::Duration::from_millis(500));
    super::update_remote_library(
      r#"{"viewing":true}"#.to_string(),
      ".".to_string(),
      vec![],
      vec![],
    )
    .expect("publish");
    let res = waiter.join().expect("waiter thread");
    assert!(res.starts_with("HTTP/1.1 200"), "wait must 200: {res}");
    assert!(
      res.contains(r#"{"changed":true}"#),
      "held long-poll must wake on publish: {res}"
    );

    // The published manifest arrives enveloped: opens under the session key,
    // and the raw wire never carries the plaintext.
    let raw = get_raw("/library");
    let res = String::from_utf8_lossy(&raw);
    assert!(res.starts_with("HTTP/1.1 200"), "library must 200: {res}");
    assert!(
      res.to_ascii_lowercase().contains("x-link-envelope"),
      "library must be enveloped: {res}"
    );
    assert!(!res.contains("viewing"), "manifest must not ride in the clear: {res}");
    assert_eq!(
      open_manifest(&raw).as_deref(),
      Some(r#"{"viewing":true}"#.as_bytes()),
      "manifest must decrypt exactly"
    );

    // A share-off clear wakes the next wait too (the phone reverts to
    // camera-only without being asked).
    let waiter = wait(&session);
    std::thread::sleep(std::time::Duration::from_millis(500));
    super::clear_remote_library();
    let res = waiter.join().expect("waiter thread");
    assert!(
      res.contains(r#"{"changed":true}"#),
      "held long-poll must wake on clear: {res}"
    );
    let raw = get_raw("/library");
    let res = String::from_utf8_lossy(&raw);
    assert!(
      !res.contains("viewing"),
      "degraded manifest must not ride in the clear either: {res}"
    );
    assert_eq!(
      open_manifest(&raw).as_deref(),
      Some(r#"{"viewing":false}"#.as_bytes()),
      "library must degrade after clear"
    );

    // With nothing publishing, the wait ends only when the link shuts down.
    let waiter = wait(&session);
    std::thread::sleep(std::time::Duration::from_millis(500));
    shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
    server.unblock();
    let res = waiter.join().expect("waiter thread");
    assert!(
      res.contains(r#"{"changed":false}"#),
      "shutdown must release the hold without a change: {res}"
    );
    let _ = thread.join();
  }

  // The stale-code UX contract: probe and heartbeat must check res.ok, or a
  // rotated pairing code leaves the phone claiming "Connected" while every
  // real request 404s.
  #[test]
  fn phone_page_treats_404_as_disconnected() {
    assert!(PAGE_HTML.contains("if (!res.ok) throw new Error('stale pairing code');"));
    assert!(PAGE_HTML.contains("if (!res.ok) disconnected();"));
  }

  // Tier 2's dead-session UX: a 404 from a reachable server means this
  // page's cookie died (code rotated, or the link restarted without
  // rotation) — the page stops its retry loop rather than hammering the
  // throttle, hops once through its saved pairing URL (the exchange mints
  // a fresh cookie), and only then says "re-scan", pointing at the link
  // page for restore/scan.
  #[test]
  fn phone_page_distinguishes_expired_pairing() {
    assert!(PAGE_HTML.contains("res.status === 404"));
    assert!(PAGE_HTML.contains("function pairingExpired()"));
    assert!(PAGE_HTML.contains("location.href = '/t/' + code + '/';"));
    assert!(PAGE_HTML.contains("scan the QR in Camog again"));
    let start = PAGE_HTML
      .find("function pairingExpired()")
      .expect("expired handler present");
    let body = &PAGE_HTML[start..start + 400];
    assert!(body.contains("clearInterval(connTimer)"));
    assert!(!body.contains("setInterval"));
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
  // Both URLs embed the transit key (specs/007) — the QR is the key
  // exchange — and the Tailscale URL is byte-identical to the LAN one apart
  // from the address: the envelope is orthogonal to the path.
  #[test]
  fn pairing_urls_offer_lan_then_tailscale() {
    use super::{pairing_urls, LinkKind};
    let lan: std::net::IpAddr = "192.168.1.5".parse().unwrap();
    let ts: std::net::IpAddr = "100.101.102.103".parse().unwrap();
    let key = [0xABu8; 32];
    let urls = pairing_urls(lan, Some(ts), 8080, "0123456789abcdef", &key);
    assert_eq!(urls.len(), 2);
    let suffix = format!("/t/0123456789abcdef/?k={}", super::link_key_param(&key));
    assert_eq!(urls[0].url, format!("http://192.168.1.5:8080{suffix}"));
    assert_eq!(urls[0].kind, LinkKind::Lan);
    assert_eq!(urls[1].url, format!("http://100.101.102.103:8080{suffix}"));
    assert_eq!(urls[1].kind, LinkKind::Tailscale);
    // The key parameter is well-formed base64url of 32 bytes (43 chars).
    assert_eq!(super::link_key_param(&key).len(), 43);
  }

  // The common no-Tailscale case: the CGNAT probe just returns the default
  // route's own address, which must collapse into a single LAN URL — also
  // covers the phone-hotspot range.
  #[test]
  fn pairing_urls_without_tailscale_stay_single() {
    use super::{pairing_urls, LinkKind};
    let lan: std::net::IpAddr = "172.20.10.7".parse().unwrap();
    let key = [1u8; 32];
    let urls = pairing_urls(lan, Some(lan), 9000, "0123456789abcdef", &key);
    assert_eq!(urls.len(), 1);
    assert_eq!(urls[0].url, format!("http://172.20.10.7:9000/t/0123456789abcdef/?k={}", super::link_key_param(&key)));
    assert_eq!(urls[0].kind, LinkKind::Lan);
  }

  // Loopback fallbacks (no route at all) get no QR; an exit-node setup where
  // the default route IS the tunnel yields one Tailscale URL, not two.
  #[test]
  fn pairing_urls_skip_loopback_and_duplicate_tunnel() {
    use super::{pairing_urls, LinkKind};
    let lo: std::net::IpAddr = "127.0.0.1".parse().unwrap();
    let key = [2u8; 32];
    assert!(pairing_urls(lo, None, 8080, "0123456789abcdef", &key).is_empty());
    let ts: std::net::IpAddr = "100.101.102.103".parse().unwrap();
    let urls = pairing_urls(ts, Some(ts), 8080, "0123456789abcdef", &key);
    assert_eq!(urls.len(), 1);
    assert_eq!(urls[0].kind, LinkKind::Tailscale);
  }

  // The transit envelope's core contract (specs/007): a record round-trips,
  // a wrong key (or a rotated one) opens nothing, one flipped byte is
  // rejected, and the same plaintext never seals to the same bytes (fresh
  // 96-bit nonce per record).
  #[test]
  fn envelope_round_trip_wrong_key_nonce_and_tamper() {
    use super::{envelope_open, envelope_seal};
    let key = [7u8; 32];
    let manifest = br#"{"viewing":true,"patients":[{"id":"p1","name":"Margot Whitfield"}]}"#;

    let sealed = envelope_seal(&key, manifest).expect("seal");
    assert_eq!(sealed.len(), manifest.len() + 12 + 16, "envelope = nonce ‖ ct ‖ tag");
    assert_eq!(envelope_open(&key, &sealed).as_deref(), Some(&manifest[..]));

    // A different key — a rotated one, or an eavesdropper's guess — is
    // indistinguishable from tampering: GCM auth fails either way.
    assert_eq!(envelope_open(&[8u8; 32], &sealed), None);

    // Flipping one ciphertext byte must reject the record.
    let mut tampered = sealed.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0x40;
    assert_eq!(envelope_open(&key, &tampered), None);
    // …and so must flipping a nonce byte.
    let mut tampered = sealed.clone();
    tampered[0] ^= 0x01;
    assert_eq!(envelope_open(&key, &tampered), None);

    // Fresh nonce per record: identical plaintext, two envelopes, two
    // distinct nonces and ciphertexts.
    let again = envelope_seal(&key, manifest).expect("seal again");
    assert_ne!(sealed[..12], again[..12], "nonce reuse would be fatal");
    assert_ne!(sealed, again);
    assert_eq!(envelope_open(&key, &again).as_deref(), Some(&manifest[..]));

    // Truncated envelopes refuse outright.
    assert_eq!(envelope_open(&key, &sealed[..20]), None);
  }

  // The persisted key file: strict shape (64 hex chars), corrupt content
  // mints a fresh key rather than failing the link.
  #[test]
  fn link_key_file_shape() {
    use super::parse_link_key;
    let hex: String = "a".repeat(64);
    assert_eq!(parse_link_key(&hex), Some([0xaa; 32]));
    assert_eq!(parse_link_key(&"a".repeat(63)), None);
    assert_eq!(parse_link_key(&"g".repeat(64)), None);
    assert_eq!(parse_link_key(""), None);
  }

  // Envelope cost on full-size phone photos is negligible (GCM is
  // hardware-fast; this is the regression-watch benchmark, debug-build).
  #[test]
  fn envelope_seal_of_an_8mb_photo_is_fast() {
    use super::{envelope_open, envelope_seal};
    use std::time::Instant;
    let jpeg = vec![0xd7u8; 8 * 1024 * 1024]; // one 8 MP JPEG of noise
    let started = Instant::now();
    let sealed = envelope_seal(&[9u8; 32], &jpeg).expect("seal");
    let opened = envelope_open(&[9u8; 32], &sealed).expect("round trip");
    let elapsed = started.elapsed();
    assert_eq!(opened.len(), jpeg.len());
    // Debug builds run AES without hardware intrinsics everywhere; a few
    // seconds is already orders of magnitude below anything a consult feels.
    assert!(elapsed < std::time::Duration::from_secs(10), "8 MB seal+open took {elapsed:?}");
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
  // manifest route serves that logo as the icon, the start URL is the
  // one-time exchange so saved icons survive restarts, and light is the
  // default appearance on a fresh phone (dark stays opt-in, remembered per
  // phone).
  #[test]
  fn phone_page_pwa_and_light_default() {
    use super::web_manifest;
    assert!(PAGE_HTML.contains(r##"<link rel="manifest" href="manifest.webmanifest">"##));
    assert!(PAGE_HTML.contains(r##"<link rel="apple-touch-icon" href="logo.png">"##));
    assert!(PAGE_HTML.contains(r##"<meta name="apple-mobile-web-app-capable" content="yes">"##));
    assert!(PAGE_HTML.contains(r##"<body class="light">"##));
    assert!(PAGE_HTML.contains(r##"localStorage.getItem(THEME_KEY) !== 'dark'"##));
    let manifest = web_manifest("0123456789abcdef");
    assert!(manifest.contains(r##""start_url":"/t/0123456789abcdef/""##));
    assert!(manifest.contains(r##""icons":[{"src":"logo.png","sizes":"256x256","type":"image/png","purpose":"any"}]"##));
    assert!(manifest.contains(r##""display":"standalone""##));
  }

  // Staged reports are per-session: the phone that asked gets its patient's
  // PDF; a different session, a cookieless request, or an unattached stage
  // get nothing, and a stale stage expires.
  #[test]
  fn staged_report_is_session_keyed_and_expiry_bounded() {
    let session_a = [1u8; 16];
    let session_b = [2u8; 16];
    let staged = Some(StagedReport {
      session: Some(session_a),
      path: PathBuf::from("/tmp/report.pdf"),
      at: 1_000,
    });
    assert_eq!(
      staged_report_for(&staged, Some(session_a), 2_000),
      Some(PathBuf::from("/tmp/report.pdf"))
    );
    assert_eq!(staged_report_for(&staged, Some(session_b), 2_000), None);
    assert_eq!(staged_report_for(&staged, None, 2_000), None);
    assert_eq!(staged_report_for(&staged, Some(session_a), 1_000 + STAGED_REPORT_TTL_MS + 1), None);
    // A stage that never attached to a request serves nobody.
    let unattached = Some(StagedReport { session: None, path: PathBuf::from("/tmp/x.pdf"), at: 0 });
    assert_eq!(staged_report_for(&unattached, Some(session_a), 1), None);
    assert_eq!(staged_report_for(&None, Some(session_a), 1), None);
  }

  // The POST meter: a burst up to the bucket size passes, the next request
  // is refused, and tokens refill over time.
  #[test]
  fn post_meter_bursts_then_refills() {
    assert_eq!(refilled(1.0, 1_000, 1_500), 6.0, "half a second = 5 tokens");
    assert_eq!(refilled(POST_BURST, 0, 10_000), POST_BURST, "capped at burst");
    let sessions = SessionStore::new();
    let session = [7u8; 16];
    for _ in 0..POST_BURST as i32 {
      assert!(sessions.allow_post(session, 1_000), "burst passes");
    }
    assert!(!sessions.allow_post(session, 1_000), "empty bucket refused");
    // 40ms later: 0.4 tokens — still short of one POST.
    assert!(!sessions.allow_post(session, 1_040));
    // A full refill window admits exactly the refilled amount.
    let mut admitted = 0;
    for t in 1_000..=2_000u64 {
      if sessions.allow_post(session, t) {
        admitted += 1;
      }
    }
    assert!(admitted >= 10, "one second refills 10 tokens, got {admitted}");
    // Another session has its own bucket.
    assert!(sessions.allow_post([9u8; 16], 1_000));
  }

  // Report preparation is single-flight: the first claim wins, a second
  // phone is refused while one is in flight, an expired claim frees the
  // slot, and staging consumes it.
  #[test]
  fn awaiting_report_claim_is_exclusive_until_staged_or_expired() {
    let mut slot = None;
    let phone_a = [1u8; 16];
    let phone_b = [2u8; 16];
    assert!(try_claim_awaiting_report(&mut slot, phone_a, 1_000));
    assert!(!try_claim_awaiting_report(&mut slot, phone_b, 2_000), "refused while in flight");
    assert!(
      !try_claim_awaiting_report(&mut slot, phone_b, 1_000 + AWAITING_REPORT_TTL_MS),
      "still in flight at the TTL boundary"
    );
    assert!(try_claim_awaiting_report(&mut slot, phone_b, 1_000 + AWAITING_REPORT_TTL_MS + 1),
      "expired claim frees the slot");
    // stage_remote_report consumes the slot; the next request claims cleanly.
    slot = None;
    assert!(try_claim_awaiting_report(&mut slot, phone_a, 5_000));
  }

    #[test]
    // A phone upgrading from a pre-0.13 pairing — its saved URL works as a
    // code but carries no transit key — must never dead-end: the saved icon
    // still exchanges (code unchanged), the keyless page gets the designed
    // capability 404, and one scan of the CURRENT QR (the only channel the
    // key travels on) reconnects it for good on this origin.
    #[test]
    fn pre_envelope_phone_upgrade_flow() {
        use super::{
            bind_listener, link_key_param, spawn_handler, AuthGuard, LinkContext, SessionStore,
        };
        use std::io::{Read, Write};
        use std::sync::Arc;
        use tauri::test;
        use tiny_http::Server;

        let app = test::mock_app();
        let token = "0123456789abcdef";
        let key = [0xA1u8; 32];
        let listener = bind_listener("127.0.0.1".parse().unwrap(), 0).expect("test bind");
        let port = listener.local_addr().unwrap().port();
        let server = Arc::new(Server::from_listener(listener, None).expect("test server"));
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let thread = spawn_handler(
            app.handle().clone(),
            Arc::clone(&server),
            Arc::new(LinkContext {
                token: token.to_string(),
                key,
                sessions: Arc::new(SessionStore::new()),
                last_seen_ms: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                guard: Arc::new(AuthGuard::new()),
                shutdown: Arc::clone(&shutdown),
            }),
        );

        let get = |path: &str, cookie: Option<&str>, caps: bool| -> String {
            let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).expect("connect");
            let c = cookie.map(|x| format!("Cookie: {x}\r\n")).unwrap_or_default();
            let k = if caps { "X-Link-Key: 1\r\n" } else { "" };
            write!(s, "GET {path} HTTP/1.1\r\nHost: x\r\n{c}{k}Connection: close\r\n\r\n")
                .expect("write");
            let mut r = String::new();
            s.read_to_string(&mut r).expect("read");
            r
        };

        // The saved pre-0.13 icon still exchanges: the code was not rotated.
        let res = get(&format!("/t/{token}/"), None, false);
        assert!(res.starts_with("HTTP/1.1 303"), "saved icon must still exchange: {res}");
        let cookie = res
            .lines()
            .find(|l| l.to_ascii_lowercase().starts_with("set-cookie:"))
            .expect("exchange sets a cookie")
            .strip_prefix("Set-Cookie: ")
            .expect("server-sent header case")
            .split(';')
            .next()
            .expect("name=value pair")
            .to_string();

        // The page serves fine, but the keyless phone cannot prove it holds
        // the transit key: hello 404s — the input to the re-scan message.
        let res = get("/", Some(&cookie), false);
        assert!(res.starts_with("HTTP/1.1 200"), "page must load: {res}");
        let res = get("/hello", Some(&cookie), false);
        assert!(res.starts_with("HTTP/1.1 404"), "keyless hello must 404: {res}");

        // One scan of the current QR: the key rides the redirect once, and
        // the same session is fully live afterwards.
        let k = link_key_param(&key);
        let res = get(&format!("/t/{token}/?k={k}"), Some(&cookie), false);
        assert!(res.starts_with("HTTP/1.1 303"), "re-scan must exchange: {res}");
        assert!(
            res.contains(&format!("Location: /?k={k}")),
            "the key must ride the redirect: {res}"
        );
        let res = get("/hello", Some(&cookie), true);
        assert!(res.starts_with("HTTP/1.1 200"), "keyed hello must pass: {res}");

        shutdown.store(true, std::sync::atomic::Ordering::Relaxed);
        server.unblock();
        let _ = thread.join();
    }

  // The CGNAT window is Tailscale's 100.64.0.0/10, edges included; the
  // interface-scan fallback picks the tunnel address out of a mixed list
  // and reports none when only ordinary addresses exist.
  #[test]
  fn cgnat_detection_boundaries_and_scan() {
    use super::is_cgnat;
    use std::net::{IpAddr, Ipv4Addr};
    assert!(is_cgnat(Ipv4Addr::new(100, 64, 0, 0)));
    assert!(is_cgnat(Ipv4Addr::new(100, 127, 255, 255)));
    assert!(!is_cgnat(Ipv4Addr::new(100, 63, 255, 255)));
    assert!(!is_cgnat(Ipv4Addr::new(100, 128, 0, 0)));
    assert!(!is_cgnat(Ipv4Addr::new(101, 64, 0, 0)));

    let mixed = [
      IpAddr::V4(Ipv4Addr::LOCALHOST),
      IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5)),
      IpAddr::V4(Ipv4Addr::new(100, 101, 1, 20)),
      IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8)),
    ];
    assert_eq!(
      cgnat_address_among(&mixed),
      Some(IpAddr::V4(Ipv4Addr::new(100, 101, 1, 20)))
    );
    let plain = [IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5))];
    assert_eq!(cgnat_address_among(&plain), None);
  }
}

/// Auto-start is opt-in from 0.11.0: absent/corrupt prefs read as off, and
/// only installs that had paired (token on disk, no prefs file) carry the
/// old always-on default over. ponytail: tempdir under TMP, no cleanup —
/// the same trade the db_restore tests make.
#[cfg(test)]
mod phone_link_prefs_tests {
  use super::*;

  fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("camog-phone-link-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("tempdir");
    dir
  }

  #[test]
  fn absent_or_corrupt_prefs_read_as_off() {
    let dir = tempdir("absent");
    assert!(!read_remember_pref(&dir), "no file: the opt-in default applies");
    std::fs::write(dir.join("phone-link.json"), "not json").expect("write");
    assert!(!read_remember_pref(&dir), "corrupt file must fail closed to off");
    std::fs::write(dir.join("phone-link.json"), r#"{"remember":true}"#).expect("write");
    assert!(read_remember_pref(&dir), "an explicit on must be honoured");
  }

  #[test]
  fn migration_seeds_only_paired_installs_and_never_overwrites() {
    let dir = tempdir("migrate");
    // Fresh install (never paired): nothing written, default stays off.
    migrate_auto_start_pref_in(&dir).expect("migrate");
    assert!(!dir.join("phone-link.json").exists(), "fresh install must stay opt-in");

    // Paired before 0.11.0: token exists, no prefs file — seed the old on.
    std::fs::write(dir.join("phone-link-token"), "token").expect("write");
    migrate_auto_start_pref_in(&dir).expect("migrate");
    assert!(read_remember_pref(&dir), "an existing pairing keeps auto-start");

    // An explicit preference is never overwritten — including off.
    std::fs::write(dir.join("phone-link.json"), r#"{"remember":false}"#).expect("write");
    migrate_auto_start_pref_in(&dir).expect("migrate");
    assert!(!read_remember_pref(&dir), "explicit choice must survive the migration");
  }
}
