/**
 * At-rest photo encryption (webview side).
 *
 * Photo JPEGs are AES-256-GCM encrypted before they touch disk; the key stays
 * in the Rust process (a key file in the app data directory, no OS permission
 * prompts) and never reaches the webview — these helpers just shuttle bytes
 * (base64, to keep the Tauri IPC JSON-safe) through the Rust commands in
 * src-tauri/src/photo_crypto.rs. Encrypted files carry a `CMGE1` magic
 * prefix; legacy plaintext JPEGs (pre-encryption captures) are detected and
 * passed through by Rust, so reads work during and after the boot migration.
 */

import { invoke } from '@tauri-apps/api/core';

/** Chunked base64 so a multi-MB JPEG does not blow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encrypt photo bytes with the Rust-held key before writing to disk. */
export async function encryptPhotoBytes(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const sealed = await invoke<string>('photo_encrypt_bytes', { b64: bytesToBase64(bytes) });
  return base64ToBytes(sealed);
}

/**
 * Decrypt photo bytes read from disk. Legacy plaintext files come back
 * unchanged (Rust-side passthrough), so mid-migration reads keep working.
 */
export async function decryptPhotoBytes(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const plain = await invoke<string>('photo_decrypt_bytes', { b64: bytesToBase64(bytes) });
  return base64ToBytes(plain);
}

/** JPEG SOI (0xFF 0xD8) — every unencrypted photo this app writes is a JPEG. */
export function isPlaintextJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
