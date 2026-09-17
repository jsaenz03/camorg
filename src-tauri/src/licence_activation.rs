// One-shot licence activation over HTTPS (specs/003-licence-activation/spec.md).
//
// This is the app's ONLY outbound network call. The webview itself is
// CSP-blocked from the internet; activation goes through Rust so its scope
// is one fixed URL carrying two fields — the licence key and the device ID.
// No patient data, no tokens, no telemetry.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Activation endpoint. Points at the custom domain attached to the worker
/// (activation-server/README.md steps 5–6) — verify it resolves before a
/// release that changes licensing.
const ACTIVATION_URL: &str = "https://camog-license.cliniciq.com.au/v1/activate";
/// Read-only seat re-check (called at most daily on app open). Same domain,
/// writeless twin of activate.
const VALIDATE_URL: &str = "https://camog-license.cliniciq.com.au/v1/validate";

#[derive(Serialize)]
struct LicenceWireRequest<'a> {
  key: &'a str,
  // The worker's API field name (the device ID argument itself is snake_case).
  #[serde(rename = "deviceId")]
  device_id: &'a str,
}

#[derive(Deserialize)]
struct ActivateResponse {
  token: String,
}

/// Validate's body: the seat verdict plus, when a paid subscription cycle
/// minted a successor key for the presented one (specs/005), the successor
/// key text itself for the app to activate.
#[derive(Deserialize)]
struct ValidateResponse {
  #[serde(default)]
  renewal: Option<String>,
}

/// Errors are prefixed so the webview can classify them without parsing
/// prose: network: | invalid: | expired: | seat-limit: | revoked: |
/// not-activated: | server:
///
/// Pulls the worker's user-facing message out of an error response body
/// ({ error, message }); falls back to generic prose when unreadable.
fn response_message(resp: ureq::Response) -> String {
  resp
    .into_string()
    .ok()
    .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
    .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
    .unwrap_or_else(|| "Licence server request failed.".to_string())
}

/// Maps a licence-server HTTP status onto the prefixed error vocabulary.
/// Shared by activate and validate; each endpoint simply never receives the
/// codes the other one alone can produce.
fn classify_status(code: u16, message: String) -> String {
  match code {
    400 => format!("invalid:{message}"),
    403 => format!("revoked:{message}"),
    404 => format!("not-activated:{message}"),
    409 => format!("seat-limit:{message}"),
    410 => format!("expired:{message}"),
    _ => format!("server:{message}"),
  }
}

#[tauri::command]
pub fn activate_licence(key: String, device_id: String) -> Result<String, String> {
  // Mirror the client-side strip: pasted keys arrive with email line wraps.
  let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
  let response = ureq::post(ACTIVATION_URL)
    .timeout(Duration::from_secs(10))
    .send_json(LicenceWireRequest {
      key: &key,
      device_id: &device_id,
    })
    .map_err(|e| match e {
      ureq::Error::Status(code, resp) => classify_status(code, response_message(resp)),
      _ => "network:Could not reach the licence server. Activating a licence needs a one-time \
            internet connection — check the network and try again."
        .to_string(),
    })?;
  let parsed: ActivateResponse = response
    .into_json()
    .map_err(|e| format!("server:Activation response was unreadable ({e})."))?;
  if parsed.token.is_empty() {
    return Err("server:Activation returned no token.".to_string());
  }
  Ok(parsed.token)
}

/// Seat re-check for an install that already holds a licence + token.
/// Ok(None) means the server still counts this seat and no renewal is
/// waiting; Ok(Some(key)) additionally carries a paid successor licence
/// (specs/005 auto-renew) for the caller to activate. Every other outcome
/// is a prefixed error. Transport failures and unexpected statuses classify
/// as network:/server: and the caller fails open — only a definitive 403/404
/// from the licence server may bite.
#[tauri::command]
pub fn validate_licence(key: String, device_id: String) -> Result<Option<String>, String> {
  let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
  let response = ureq::post(VALIDATE_URL)
    .timeout(Duration::from_secs(10))
    .send_json(LicenceWireRequest {
      key: &key,
      device_id: &device_id,
    })
    .map_err(|e| match e {
      ureq::Error::Status(code, resp) => classify_status(code, response_message(resp)),
      _ => "network:Could not reach the licence server.".to_string(),
    })?;
  let parsed: ValidateResponse = response
    .into_json()
    .map_err(|e| format!("server:Licence server response was unreadable ({e})."))?;
  Ok(parsed.renewal.filter(|renewal| !renewal.is_empty()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn statuses_classify_onto_the_prefixed_vocabulary() {
    assert_eq!(classify_status(400, "bad key".into()), "invalid:bad key");
    assert_eq!(classify_status(403, "seat gone".into()), "revoked:seat gone");
    assert_eq!(
      classify_status(404, "no seat".into()),
      "not-activated:no seat"
    );
    assert_eq!(classify_status(409, "full".into()), "seat-limit:full");
    assert_eq!(classify_status(410, "old".into()), "expired:old");
    assert_eq!(classify_status(500, "boom".into()), "server:boom");
    // A proxy or CDN interposing an odd status must never read as a
    // definitive licensing verdict.
    assert_eq!(classify_status(502, "gateway".into()), "server:gateway");
  }
}
