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
// on first use and stored in the OS credential store (macOS Keychain /
// Windows Credential Manager), never on disk and never sent to the webview.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::RngCore;
use std::sync::OnceLock;

/// 5-byte prefix marking an encrypted photo ("Camog Encrypted", version 1).
pub const MAGIC: &[u8; 5] = b"CMGE1";
/// Nonce length (GCM standard 96-bit).
const NONCE_LEN: usize = 12;
/// Keychain slot: service + user identify the single app-wide photo key.
const KEY_SERVICE: &str = "com.camog.app";
const KEY_USER: &str = "photo-encryption-key";

/// The cached key; None until first use, Err if the OS credential store
/// is unavailable (e.g. no Secret Service on a bare Linux session).
static KEY: OnceLock<Result<[u8; 32], String>> = OnceLock::new();

fn load_key() -> Result<[u8; 32], String> {
  KEY.get_or_init(load_key_once).clone()
}

fn load_key_once() -> Result<[u8; 32], String> {
  let entry = keyring::Entry::new(KEY_SERVICE, KEY_USER)
    .map_err(|e| format!("Could not open the OS credential store: {e}"))?;
  if let Ok(stored) = entry.get_password() {
    let bytes = B64
      .decode(stored.trim())
      .map_err(|e| format!("Stored photo key is not valid base64: {e}"))?;
    let key: [u8; 32] = bytes
      .try_into()
      .map_err(|v: Vec<u8>| format!("Stored photo key is {} bytes, expected 32", v.len()))?;
    return Ok(key);
  }
  // No key yet (first encryption, or the user deleted the entry): generate,
  // persist, return. A deleted entry followed by regeneration means existing
  // encrypted photos become unreadable — decryption then fails loudly with
  // the auth-tag error below rather than returning wrong bytes.
  let mut key = [0u8; 32];
  rand::rngs::OsRng
    .try_fill_bytes(&mut key)
    .map_err(|e| format!("Could not generate a photo key: {e}"))?;
  entry
    .set_password(&B64.encode(key))
    .map_err(|e| format!("Could not store the photo key in the OS credential store: {e}"))?;
  Ok(key)
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
      "This encrypted photo could not be opened. Its encryption key may have been \
       removed from this device's credential store, or the file is damaged."
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

  // Exercises the real OS credential store (creates the app's key entry on
  // this machine), so it stays out of the default test run.
  // Run: cargo test -- --ignored
  #[test]
  #[ignore]
  fn keychain_backed_roundtrip() {
    let photo = b"\xff\xd8\xff\xe0fake-jpeg-bytes".to_vec();
    let sealed = encrypt(&photo).expect("keychain + encryption");
    assert!(is_encrypted(&sealed));
    assert_eq!(decrypt_or_plain(&sealed).unwrap(), photo);
  }
}
