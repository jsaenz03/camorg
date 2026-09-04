// Self-check for the on-disk encrypted-photo format + webview byte helpers.
// Run: node scripts/self-check-photo-crypto.mjs
// ponytail: mirrors the constants in src-tauri/src/photo_crypto.rs (file
// format) and lib/utils/photo-crypto.ts (base64 + JPEG detection) because
// Node cannot import either graph directly; if you change the format or the
// helpers, update the mirrors here. Upgrade path: run via tsx + cargo test
// in CI so the real implementations are exercised.

import assert from 'node:assert/strict';

// Encrypted file = MAGIC + 12-byte nonce + AES-256-GCM ciphertext(+tag).
const MAGIC = 'CMGE1'; // b"CMGE1" — keep in sync with photo_crypto.rs MAGIC
const MAGIC_LEN = 5;
const NONCE_LEN = 12; // keep in sync with photo_crypto.rs NONCE_LEN
const CIPHERTEXT_OFFSET = MAGIC_LEN + NONCE_LEN;

// A file sealed after 0.4.6 must carry the magic, never the JPEG SOI.
const sealedHeader = Buffer.concat([
  Buffer.from(MAGIC, 'latin1'),
  Buffer.alloc(NONCE_LEN, 0xab),
  Buffer.from([0xde, 0xad, 0xbe, 0xef]), // first ciphertext bytes
]);
assert.ok(sealedHeader.subarray(0, MAGIC_LEN).equals(Buffer.from('CMGE1', 'latin1')));
assert.equal(sealedHeader.length, MAGIC_LEN + NONCE_LEN + 4);
assert.equal(CIPHERTEXT_OFFSET, 17);

// isPlaintextJpeg mirror: JPEG SOI (0xFF 0xD8) marks a legacy plaintext file.
function isPlaintextJpeg(bytes) {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}
assert.equal(isPlaintextJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
assert.equal(isPlaintextJpeg(Buffer.from('CMGE1', 'latin1')), false);
assert.equal(isPlaintextJpeg(new Uint8Array([0xff])), false);
assert.equal(isPlaintextJpeg(new Uint8Array(0)), false);

// bytesToBase64/base64ToBytes mirror (chunked at 0x8000 like the real helper).
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Roundtrip across the 0x8000 chunk boundary, empty, and 1-byte inputs.
for (const len of [0, 1, 0x8000 - 1, 0x8000, 0x8000 + 1, 100_000]) {
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = (i * 7 + 13) & 0xff;
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes, `b64 roundtrip len=${len}`);
}

// The migration only rewrites files that are plaintext JPEGs; an encrypted
// file must be left alone (skipped), and non-JPEG strangers untouched.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01]);
assert.equal(isPlaintextJpeg(jpeg), true);
assert.equal(isPlaintextJpeg(sealedHeader), false);

console.log('photo-crypto self-check passed');
