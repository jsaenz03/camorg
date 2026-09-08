// Device identity for licence seats (specs/003-licence-activation/spec.md).
//
// The device ID is a random UUID created on first use and stored in a
// `device-id` file under the user's home directory — deliberately OUTSIDE
// the app data directory that holds the SQLite database. Cloning an
// activation by copying the app data folder to another machine therefore
// does not carry the seat: the new machine reads a different (or no) device
// ID, fails the stored token's check, and must re-activate against the
// licence's seat count. The OS credential store was considered and rejected
// on this project's own record: 0.4.6 kept the photo key there and the
// per-update access prompts read as invasive to clinicians (see
// photo_crypto.rs); a plain owner-only home file prompts for nothing.
//
// Failure mode is fail-open to the pre-activation behaviour: with no usable
// home directory the caller's database-seeded install ID is returned, so
// activation never breaks — it only degrades to the DB-bound ceiling.

use rand::RngCore;
use std::path::PathBuf;
use std::sync::OnceLock;

/// Where the device file lives; normally set once at app startup from the
/// home directory (mirrors photo_crypto::init_key_path), with an env-based
/// fallback for direct command calls.
static DEVICE_FILE: OnceLock<PathBuf> = OnceLock::new();

pub fn init_device_path(home: PathBuf) {
  let _ = DEVICE_FILE.set(home.join(".camog").join("device-id"));
}

fn device_file() -> Option<PathBuf> {
  if let Some(path) = DEVICE_FILE.get() {
    return Some(path.clone());
  }
  let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
  let path = PathBuf::from(home).join(".camog").join("device-id");
  let _ = DEVICE_FILE.set(path.clone());
  Some(path)
}

/// UUID v4 in the same shape the webview's crypto.randomUUID() produces —
/// the worker validates this format.
fn new_uuid() -> String {
  let mut b = [0u8; 16];
  rand::rngs::OsRng.try_fill_bytes(&mut b).expect("OS RNG unavailable");
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  let hex = |slice: &[u8]| slice.iter().map(|x| format!("{x:02x}")).collect::<String>();
  format!(
    "{}-{}-{}-{}-{}",
    hex(&b[0..4]),
    hex(&b[4..6]),
    hex(&b[6..8]),
    hex(&b[8..10]),
    hex(&b[10..16])
  )
}

/// Read-or-create the device ID. `seed` is the install_id already in the
/// settings row: reused when the device file is absent so pre-activation
/// installs keep their identity, and used as the fallback when no device
/// file can be used — the ID must stay stable per machine either way, or
/// every launch would look like a new seat.
#[tauri::command]
pub fn device_id(seed: String) -> Result<String, String> {
  let seed = seed.trim().to_string();
  let seed = if seed.len() <= 64 { seed } else { String::new() };
  let Some(path) = device_file() else {
    return Ok(if seed.is_empty() { new_uuid() } else { seed });
  };
  if let Ok(stored) = std::fs::read_to_string(&path) {
    let stored = stored.trim().to_string();
    if !stored.is_empty() && stored.len() <= 64 {
      return Ok(stored);
    }
  }
  let id = if seed.is_empty() { new_uuid() } else { seed };
  // Best effort: a failure here (locked-down home dir) still returns the ID
  // so this session works; the file write is retried on the next launch.
  if let Some(dir) = path.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  match std::fs::write(&path, &id) {
    Ok(()) => {
      // Owner-only on Unix; the Windows profile directory is already per-user.
      #[cfg(unix)]
      {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
      }
    }
    Err(e) => crate::diagnostics::record(
      crate::diagnostics::Level::Error,
      "licence-device",
      &format!("Could not persist the device ID file: {e}"),
      None,
    ),
  }
  Ok(id)
}
