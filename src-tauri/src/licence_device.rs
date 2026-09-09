// Device identity for licence seats (specs/003-licence-activation/spec.md).
//
// The device ID is a random UUID stored in a `device-id` file. The file lives
// in a MACHINE-WIDE location when one is writable — ProgramData / /Library
// Application Support / /var/lib — falling back to `~/.camog/` (the v1
// location, deliberately outside the app data dir that holds the SQLite
// database). Machine scope is what makes a seat mean "computer": per-user
// home files burned one seat per OS account on a shared clinic PC, while a
// dotfile-synced home directory cloned the identity to a new machine wholesale.
//
// Two moving parts keep a seat honest:
//
// - Pre-activation, the identity is seeded from the DB's install_id so a
//   fresh install keeps one identity across launches before it ever
//   activates (fail-open: a machine with no writable candidate at all just
//   returns the seed and never persists).
// - At activation, licence-service rotates to a freshly minted ID whenever
//   the key being activated differs from the stored one. The activation
//   token then names a value that exists only in the device file — a copied
//   database can no longer reconstruct it, so the copy lands read-only and
//   must re-activate against the seat count. Re-activating the SAME key
//   reuses the on-disk identity: that is the support seat-move flow (revoke,
//   then re-activate) and same-machine recovery (restored DB, device file
//   intact). An OS rebuild that loses the device file therefore needs a
//   support seat move — the honest trade for closing the silent-clone hole.
//
// The OS credential store was considered and rejected on this project's own
// record: 0.4.6 kept the photo key there and the per-update access prompts
// read as invasive to clinicians (see photo_crypto.rs); a plain file prompts
// for nothing.

use rand::RngCore;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Where candidate device files live, highest priority first; set once at
/// app startup (mirrors photo_crypto::init_key_path), with the HOME env as a
/// fallback for direct command calls.
static CANDIDATES: OnceLock<Vec<PathBuf>> = OnceLock::new();

pub fn init_device_path(home: PathBuf) {
  let _ = CANDIDATES.set(candidate_paths(&home));
}

/// Machine-wide candidate first, the per-user home fallback last.
fn candidate_paths(home: &Path) -> Vec<PathBuf> {
  let mut paths = Vec::new();
  if let Some(machine) = machine_candidate() {
    paths.push(machine);
  }
  paths.push(home.join(".camog").join("device-id"));
  paths
}

/// A location every OS account of the machine can share. Windows ships
/// ProgramData writable-by-Users by default; macOS needs an admin (first
/// run is usually done by one); Linux /var/lib needs root, so it serves as
/// the documented-hopeful spot with home fallback.
fn machine_candidate() -> Option<PathBuf> {
  #[cfg(target_os = "windows")]
  {
    std::env::var_os("ProgramData")
      .or_else(|| std::env::var_os("PROGRAMDATA"))
      .map(|dir| PathBuf::from(dir).join("Camog").join("device-id"))
  }
  #[cfg(target_os = "macos")]
  {
    Some(PathBuf::from("/Library/Application Support/Camog/device-id"))
  }
  #[cfg(all(unix, not(target_os = "macos")))]
  {
    Some(PathBuf::from("/var/lib/camog/device-id"))
  }
  #[cfg(not(any(windows, unix)))]
  {
    None
  }
}

/// A candidate can be the write target when its file can be opened for
/// append (creating it). The probe may leave an empty file behind, which
/// reads as "absent" — harmless.
fn writable(path: &Path) -> bool {
  if let Some(dir) = path.parent() {
    let _ = std::fs::create_dir_all(dir);
  }
  std::fs::OpenOptions::new()
    .create(true)
    .append(true)
    .open(path)
    .is_ok()
}

fn read_identity(path: &Path) -> Option<String> {
  let stored = std::fs::read_to_string(path).ok()?;
  let stored = stored.trim().to_string();
  if stored.is_empty() || stored.len() > 64 {
    return None;
  }
  Some(stored)
}

fn write_identity(path: &Path, id: &str) -> std::io::Result<()> {
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir)?;
  }
  std::fs::write(path, id)?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    // World-readable on purpose: on a shared clinic PC the file is written
    // by whichever account set the machine up and read by the rest — it is
    // an identity, not a secret.
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o644));
  }
  Ok(())
}

/// The identity, resolved against explicit candidates. The first WRITABLE
/// candidate is canonical; the canonical file wins, and a value found only
/// in a lower-priority file is migrated into it — so the second OS account
/// on a shared PC adopts the first account's identity (one seat, one
/// machine) instead of minting its own.
fn device_id_from(candidates: &[PathBuf], seed: &str) -> String {
  let canonical = candidates.iter().find(|p| writable(p));
  let mut ordered: Vec<&PathBuf> = canonical.into_iter().collect();
  ordered.extend(candidates.iter().filter(|p| Some(*p) != canonical));
  for path in ordered {
    if let Some(id) = read_identity(path) {
      if Some(path) != canonical {
        if let Some(c) = canonical {
          let _ = write_identity(c, &id);
        }
      }
      return id;
    }
  }
  let id = if seed.is_empty() {
    new_uuid()
  } else {
    seed.to_string()
  };
  if let Some(c) = canonical {
    let _ = write_identity(c, &id);
  }
  id
}

/// Write an identity to every writable candidate.
fn adopt_device_among(candidates: &[PathBuf], id: &str) {
  for path in candidates {
    if writable(path) {
      let _ = write_identity(path, id);
    }
  }
}

fn candidates() -> Vec<PathBuf> {
  CANDIDATES.get().cloned().unwrap_or_default()
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
/// settings row: reused when no device file exists yet so pre-activation
/// installs keep their identity.
#[tauri::command]
pub fn device_id(seed: String) -> Result<String, String> {
  let seed = seed.trim().to_string();
  let seed = if seed.len() <= 64 { seed } else { String::new() };
  Ok(device_id_from(&candidates(), &seed))
}

/// Mint a fresh identity WITHOUT writing it: licence-service binds an
/// activation to it and persists it only once the server accepted the key —
/// rotating on disk before the wire would let a failed activation (typo'd
/// key, no internet) de-activate the working licence already on this
/// machine.
#[tauri::command]
pub fn device_id_fresh() -> Result<String, String> {
  Ok(new_uuid())
}

/// Persist an identity to every writable candidate, so the writable mirrors
/// on one machine stay in sync. (A candidate that cannot be written keeps
/// its old value; such machines re-converge through re-activation.)
#[tauri::command]
pub fn device_id_adopt(id: String) -> Result<(), String> {
  let id = id.trim().to_string();
  if id.is_empty() || id.len() > 64 {
    return Err("invalid device id".to_string());
  }
  adopt_device_among(&candidates(), &id);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tempdir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
      "camog-device-{}-{}-{}",
      name,
      std::process::id(),
      rand::random::<u64>()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
  }

  fn seed_file(path: &Path, id: &str) {
    std::fs::create_dir_all(path.parent().expect("parent")).unwrap();
    std::fs::write(path, id).unwrap();
  }

  #[test]
  fn candidates_put_a_machine_scope_first_and_home_last() {
    let home = PathBuf::from("/home/tester");
    let paths = candidate_paths(&home);
    assert_eq!(paths.last(), Some(&home.join(".camog").join("device-id")));
    assert!(paths.len() >= 2, "machine candidate expected on this platform");
  }

  #[test]
  fn absent_candidates_seed_and_persist() {
    let dir = tempdir("seed");
    let first = PathBuf::from(dir.join("a").join("device-id"));
    let id = device_id_from(&[first.clone()], "install-seed");
    assert_eq!(id, "install-seed", "seed reused pre-activation");
    assert_eq!(read_identity(&first).as_deref(), Some("install-seed"));
    let again = device_id_from(&[first.clone()], "install-seed");
    assert_eq!(again, "install-seed", "identity stable across launches");
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn empty_seed_mints_a_fresh_uuid() {
    let dir = tempdir("mint");
    let file = dir.join("device-id");
    let id = device_id_from(&[file.clone()], "");
    assert_eq!(id.len(), 36, "uuid v4 shape");
    assert_eq!(read_identity(&file).as_deref(), Some(id.as_str()));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn lower_priority_identity_migrates_into_the_canonical_file() {
    let dir = tempdir("migrate");
    let machine = dir.join("machine").join("device-id");
    let home = dir.join("home").join("device-id");
    // Only the home file holds an identity so far (a pre-upgrade install on
    // a machine-wide-aware build): the canonical machine file adopts it so
    // every OS account on the machine shares the one seat.
    seed_file(&home, "migrated-id");
    let id = device_id_from(&[machine.clone(), home.clone()], "seed");
    assert_eq!(id, "migrated-id");
    assert_eq!(read_identity(&machine).as_deref(), Some("migrated-id"));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn canonical_file_wins_over_stale_lower_priority_copies() {
    let dir = tempdir("canonical-wins");
    let machine = dir.join("machine").join("device-id");
    let home = dir.join("home").join("device-id");
    seed_file(&machine, "machine-id");
    seed_file(&home, "stale-id");
    let id = device_id_from(&[machine.clone(), home.clone()], "seed");
    assert_eq!(id, "machine-id");
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn adoption_rewrites_every_writable_candidate() {
    let dir = tempdir("adopt");
    let machine = dir.join("machine").join("device-id");
    let home = dir.join("home").join("device-id");
    seed_file(&machine, "old-id");
    seed_file(&home, "old-id");
    adopt_device_among(&[machine.clone(), home.clone()], "new-id");
    assert_eq!(read_identity(&machine).as_deref(), Some("new-id"));
    assert_eq!(read_identity(&home).as_deref(), Some("new-id"));
    let _ = std::fs::remove_dir_all(&dir);
  }

  #[test]
  fn adoption_survives_unwritable_candidates() {
    let dir = tempdir("adopt-partial");
    let missing_root = dir.join("nope").join("device-id");
    let home = dir.join("home").join("device-id");
    seed_file(&home, "old-id");
    adopt_device_among(&[missing_root, home.clone()], "new-id");
    assert_eq!(read_identity(&home).as_deref(), Some("new-id"));
    let _ = std::fs::remove_dir_all(&dir);
  }
}
