// At-rest encryption for photo files (library JPEGs + staged phone photos).
//
// Every photo byte that lands on disk goes through here: the webview calls
// photo_encrypt_bytes/photo_decrypt_bytes around its plugin-fs writes, and the
// Rust readers (PDF report, phone tether server) call decrypt_or_plain so
// encrypted and pre-encryption files coexist until the boot migration
// rewrites the legacy ones.
//
// File format: b"CMGE1" + 12-byte random nonce + AES-256-GCM ciphertext
// (GCM appends a 16-byte auth tag). The key is a random 256-bit key created
// on first use and stored in a `photo-key` file inside the app data
// directory (beside the database, owner-only permissions), never sent to the
// webview. A file needs no OS permission dialog — the OS credential store
// was tried first, but its access prompts (macOS re-prompts after every
// update) read as invasive to clinicians. The file protects photos when the
// photo files alone leak (a synced or backed-up photos folder); the whole
// data directory is covered by full-disk encryption, which the privacy
// policy already recommends.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use std::path::PathBuf;
use std::sync::OnceLock;

/// 5-byte prefix marking an encrypted photo ("Camog Encrypted", version 1).
pub const MAGIC: &[u8; 5] = b"CMGE1";
/// Nonce length (GCM standard 96-bit).
const NONCE_LEN: usize = 12;
/// Credential-store slot written by 0.4.6; upgrading machines get their key
/// rescued out of there once, then the entry is deleted.
const KEY_SERVICE: &str = "com.camog.app";
const KEY_USER: &str = "photo-encryption-key";

/// Where the key file lives; set once at app startup from the app data dir,
/// before any command (encrypt/decrypt, tether, report) can need it.
static KEY_FILE: OnceLock<PathBuf> = OnceLock::new();

pub fn init_key_path(path: PathBuf) {
  let _ = KEY_FILE.set(path);
}

/// The cached key; None until first use, Err if the key file is unreadable.
static KEY: OnceLock<Result<[u8; 32], String>> = OnceLock::new();

fn load_key() -> Result<[u8; 32], String> {
  KEY.get_or_init(load_key_once).clone()
}

fn load_key_once() -> Result<[u8; 32], String> {
  let path = KEY_FILE.get().ok_or_else(|| {
    "photo key storage is not initialised (app setup has not run)".to_string()
  })?;
  // The key file is the one source of truth: created on first use, read on
  // every later launch. A corrupt file is an error, never a silent
  // regeneration — a fresh key would strand every encrypted photo.
  if let Ok(stored) = std::fs::read_to_string(path) {
    return decode_key(&stored);
  }
  // No key file: a genuinely fresh install, or a 0.4.6 machine whose key
  // still sits in the OS credential store. Rescue before minting — the
  // photos that key encrypted are already on disk.
  match keyring::Entry::new(KEY_SERVICE, KEY_USER).and_then(|entry| entry.get_password()) {
    Ok(stored) => {
      let key = decode_key(&stored)?;
      write_key_file(path, &stored)?;
      // Best effort: the entry is dead weight once the file exists.
      if let Ok(entry) = keyring::Entry::new(KEY_SERVICE, KEY_USER) {
        let _ = entry.delete_password();
      }
      crate::diagnostics::record(
        crate::diagnostics::Level::Info,
        "photo-crypto",
        "Moved the photo encryption key from the OS credential store to the app data directory.",
        None,
      );
      return Ok(key);
    }
    // Nothing stored (fresh install) or no usable store: mint a key.
    Err(keyring::Error::NoEntry) | Err(keyring::Error::PlatformFailure(_)) => {}
    // Anything else (e.g. access denied on the rescue prompt) must not fall
    // through to a fresh key — that would silently orphan every encrypted
    // photo on the machine.
    Err(e) => {
      return Err(format!(
        "The photo encryption key could not be read from the OS credential store ({e}). \
         Reopen Camog and allow access once, so the key can move to its new home."
      ));
    }
  }
  let mut key = [0u8; 32];
  rand::rngs::OsRng
    .try_fill_bytes(&mut key)
    .map_err(|e| format!("Could not generate a photo key: {e}"))?;
  let encoded = B64.encode(key);
  write_key_file(path, &encoded)?;
  Ok(key)
}

fn decode_key(stored: &str) -> Result<[u8; 32], String> {
  let bytes = B64
    .decode(stored.trim())
    .map_err(|e| format!("Stored photo key is not valid base64: {e}"))?;
  bytes
    .try_into()
    .map_err(|v: Vec<u8>| format!("Stored photo key is {} bytes, expected 32", v.len()))
}

fn write_key_file(path: &std::path::Path, encoded: &str) -> Result<(), String> {
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| format!("Could not create the app data dir: {e}"))?;
  }
  std::fs::write(path, encoded.trim())
    .map_err(|e| format!("Could not store the photo key in the app data dir: {e}"))?;
  // Owner-only on Unix; the Windows profile directory is already per-user.
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
  }
  Ok(())
}

/// Does this byte stream carry our encrypted-photo prefix?
pub fn is_encrypted(bytes: &[u8]) -> bool {
  bytes.len() > MAGIC.len() + NONCE_LEN && bytes.starts_with(MAGIC)
}

fn encrypt_with(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
  // Fresh random nonce per file. Photo writes are rare (human-paced), so the
  // GCM random-nonce birthday bound is nowhere in reach.
  let nonce_bytes: [u8; NONCE_LEN] = rand::random();
  let cipher = Aes256Gcm::new(key.into());
  let ciphertext = cipher
    .encrypt(Nonce::from_slice(&nonce_bytes), Payload::from(plain))
    .map_err(|_| "Could not encrypt the photo".to_string())?;
  let mut out = Vec::with_capacity(MAGIC.len() + NONCE_LEN + ciphertext.len());
  out.extend_from_slice(MAGIC);
  out.extend_from_slice(&nonce_bytes);
  out.extend_from_slice(&ciphertext);
  Ok(out)
}

fn decrypt_with(key: &[u8; 32], bytes: &[u8]) -> Result<Vec<u8>, String> {
  if !is_encrypted(bytes) {
    return Ok(bytes.to_vec());
  }
  let nonce = &bytes[MAGIC.len()..MAGIC.len() + NONCE_LEN];
  let ciphertext = &bytes[MAGIC.len() + NONCE_LEN..];
  Aes256Gcm::new(key.into())
    .decrypt(Nonce::from_slice(nonce), Payload::from(ciphertext))
    .map_err(|_| {
      "This encrypted photo could not be opened. The app's photo key file is missing \
       or was changed, or the file is damaged."
        .to_string()
    })
}

/// Encrypt with the app key. Output replaces the photo file's bytes on disk.
pub fn encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
  encrypt_with(&load_key()?, plain)
}

/// Decrypt an encrypted photo; a legacy plaintext file passes through
/// unchanged so pre-migration photos stay readable everywhere.
pub fn decrypt_or_plain(bytes: &[u8]) -> Result<Vec<u8>, String> {
  decrypt_with(&load_key()?, bytes)
}

// ---- commands (webview byte shuttles; base64 keeps the IPC JSON-safe) ----

#[tauri::command]
pub fn photo_encrypt_bytes(b64: String) -> Result<String, String> {
  let plain = B64.decode(b64).map_err(|e| format!("Invalid base64 input: {e}"))?;
  Ok(B64.encode(encrypt(&plain)?))
}

#[tauri::command]
pub fn photo_decrypt_bytes(b64: String) -> Result<String, String> {
  let bytes = B64.decode(b64).map_err(|e| format!("Invalid base64 input: {e}"))?;
  Ok(B64.encode(decrypt_or_plain(&bytes)?))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn roundtrip_returns_original_bytes() {
    let key = [7u8; 32];
    let photo = b"\xff\xd8\xff\xe0fake-jpeg-bytes".to_vec();
    let sealed = encrypt_with(&key, &photo).unwrap();
    assert!(is_encrypted(&sealed));
    assert_eq!(decrypt_with(&key, &sealed).unwrap(), photo);
  }

  #[test]
  fn encrypted_output_hides_the_plaintext() {
    // A whole-file plaintext match must not survive into the sealed bytes,
    // and the file must not look like a JPEG (the at-rest privacy property).
    let key = [7u8; 32];
    let photo = b"\xff\xd8\xff\xe0fake-jpeg-bytes".to_vec();
    let sealed = encrypt_with(&key, &photo).unwrap();
    assert!(sealed.starts_with(MAGIC));
    assert!(!sealed.starts_with(b"\xff\xd8"));
    assert!(!sealed.windows(photo.len()).any(|w| w == photo.as_slice()));
  }

  #[test]
  fn legacy_plaintext_passes_through() {
    let key = [7u8; 32];
    let photo = b"\xff\xd8\xff\xe0fake-jpeg-bytes".to_vec();
    assert_eq!(decrypt_with(&key, &photo).unwrap(), photo);
  }

  #[test]
  fn wrong_key_or_tampered_file_fails() {
    let sealed = encrypt_with(&[1u8; 32], b"secret photo").unwrap();
    assert!(decrypt_with(&[2u8; 32], &sealed).is_err());
    let mut tampered = sealed.clone();
    let last = tampered.len() - 1;
    tampered[last] ^= 0xff;
    assert!(decrypt_with(&[1u8; 32], &tampered).is_err());
  }

  #[test]
  fn short_garbage_is_treated_as_plaintext() {
    // A truncated/corrupt header cannot be distinguished from a legacy file;
    // it passes through and the JPEG decoder downstream rejects it.
    assert_eq!(decrypt_with(&[1u8; 32], b"CMG").unwrap(), b"CMG");
  }

  // Exercises the real key-file path end to end: init a scratch location,
  // then the commands' internals roundtrip through disk. Runs on a machine
  // with no credential-store entry, so it never touches the user's key.
  #[test]
  fn file_backed_roundtrip() {
    let dir = std::env::temp_dir().join(format!("camog-key-test-{}", std::process::id()));
    let path = dir.join("photo-key");
    let _ = std::fs::remove_file(&path);
    init_key_path(path.clone());
    let photo = b"\xff\xd8\xff\xe0fake-jpeg-bytes".to_vec();
    let sealed = encrypt(&photo).expect("key file + encryption");
    assert!(is_encrypted(&sealed));
    assert_eq!(decrypt_or_plain(&sealed).unwrap(), photo);
    // The file now holds the base64 key (44 chars for 32 bytes).
    assert_eq!(std::fs::read_to_string(&path).unwrap().len(), 44);
    let _ = std::fs::remove_dir_all(&dir);
  }
}
