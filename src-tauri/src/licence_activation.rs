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

#[derive(Serialize)]
struct ActivateRequest<'a> {
  key: &'a str,
  // The worker's API field name (the device ID argument itself is snake_case).
  #[serde(rename = "deviceId")]
  device_id: &'a str,
}

#[derive(Deserialize)]
struct ActivateResponse {
  token: String,
}

/// Errors are prefixed so the webview can classify them without parsing
/// prose: network: | invalid: | expired: | seat-limit: | server:
#[tauri::command]
pub fn activate_licence(key: String, device_id: String) -> Result<String, String> {
  // Mirror the client-side strip: pasted keys arrive with email line wraps.
  let key: String = key.chars().filter(|c| !c.is_whitespace()).collect();
  let response = ureq::post(ACTIVATION_URL)
    .timeout(Duration::from_secs(10))
    .send_json(ActivateRequest {
      key: &key,
      device_id: &device_id,
    })
    .map_err(|e| match e {
      ureq::Error::Status(code, resp) => {
        let message = resp
          .into_string()
          .ok()
          .and_then(|body| serde_json::from_str::<serde_json::Value>(&body).ok())
          .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
          .unwrap_or_else(|| "Activation failed.".to_string());
        match code {
          400 => format!("invalid:{message}"),
          409 => format!("seat-limit:{message}"),
          410 => format!("expired:{message}"),
          _ => format!("server:{message}"),
        }
      }
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
