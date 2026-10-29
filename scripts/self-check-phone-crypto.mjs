// Self-check (specs/007): the phone page's AES-256-GCM implementation must
// interoperate with Node's OpenSSL — the same primitive family the desktop's
// Rust side uses — or the transit envelope is just noise. Extracts the
// marked gcm block from the page source, runs it in isolation, and
// cross-verifies both directions, plus the failure modes the design leans
// on: tampered bytes, wrong keys, truncated records, nonce freshness.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

const rust = readFileSync(new URL('../src-tauri/src/remote_camera_page.rs', import.meta.url), 'utf8');
const begin = rust.indexOf('// gcm-begin');
const end = rust.indexOf('gcm-end');
assert(begin > 0 && end > begin, 'gcm-begin/gcm-end markers present in the phone page');
const block = rust.slice(begin, end);
// The block is plain JS (an IIFE assigned to GCM) — evaluate it standalone.
// The newline matters: the block ends on a // comment, and a glued-on
// `return` would be commented out with it.
const GCM = new Function(`${block}\n;return GCM;`)();

const key = crypto.randomBytes(32);

// JS seal → OpenSSL open: Node must authenticate and decrypt what the page
// produces, byte for byte, across aligned and ragged lengths.
for (const size of [0, 1, 15, 16, 17, 1000]) {
  const pt = crypto.randomBytes(size);
  const nonce = crypto.randomBytes(12);
  const env = Buffer.from(GCM.seal(key, nonce, pt));
  assert.equal(env.length, size + 12 + 16, `envelope length at ${size} bytes`);
  const d = crypto.createDecipheriv('aes-256-gcm', key, env.subarray(0, 12));
  d.setAuthTag(env.subarray(env.length - 16));
  const ptOut = Buffer.concat([d.update(env.subarray(12, env.length - 16)), d.final()]);
  assert.deepEqual(ptOut, pt, `OpenSSL opens a JS-sealed record at ${size} bytes`);
}

// OpenSSL seal → JS open: the page must authenticate and decrypt what
// OpenSSL produces (the desktop's Rust aes-gcm agrees with OpenSSL).
for (const size of [0, 1, 15, 16, 17, 1000]) {
  const pt = crypto.randomBytes(size);
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ct = Buffer.concat([c.update(pt), c.final()]);
  const env = Buffer.concat([nonce, ct, c.getAuthTag()]);
  const ptOut = Buffer.from(GCM.open(key, env));
  assert.deepEqual(ptOut, pt, `JS opens an OpenSSL-sealed record at ${size} bytes`);
}

// Tamper: one flipped byte anywhere in the record must reject — ciphertext,
// tag, or nonce alike (GCM authentication).
const pt = crypto.randomBytes(200);
const env = Buffer.from(GCM.seal(key, crypto.randomBytes(12), pt));
for (const at of [0, 5, 12, 100, env.length - 1]) {
  const tampered = Buffer.from(env);
  tampered[at] ^= 0x40;
  assert.equal(GCM.open(key, tampered), null, `flipped byte at ${at} must reject`);
}

// Wrong key: a rotated key (or an eavesdropper's guess) opens nothing.
const other = crypto.randomBytes(32);
assert.equal(GCM.open(other, env), null, 'wrong key must reject');
assert.equal(GCM.open(key, crypto.randomBytes(20)), null, 'truncated record must reject');
assert.equal(GCM.open(key, null), null, 'missing record must reject');

// Nonce freshness: the same plaintext under two nonces yields two
// envelopes; determinism holds for identical inputs.
const nonce = crypto.randomBytes(12);
assert.deepEqual(Buffer.from(GCM.seal(key, nonce, pt)), Buffer.from(GCM.seal(key, nonce, pt)),
  'same key+nonce+plaintext must be deterministic');
const otherEnv = Buffer.from(GCM.seal(key, crypto.randomBytes(12), pt));
assert.notDeepEqual(env, otherEnv, 'a fresh nonce must change the envelope');

// Full-size photo: the envelope must not be the slow path (the Rust side
// benchmarks the same shape). OpenSSL does the comparison work here; the
// page's JS seal of ~8 MB should still be seconds, not minutes.
const photo = crypto.randomBytes(8 * 1024 * 1024);
const started = performance.now();
const sealedPhoto = Buffer.from(GCM.seal(key, crypto.randomBytes(12), photo));
const sealMs = performance.now() - started;
const d = crypto.createDecipheriv('aes-256-gcm', key, sealedPhoto.subarray(0, 12));
d.setAuthTag(sealedPhoto.subarray(sealedPhoto.length - 16));
assert.deepEqual(
  Buffer.concat([d.update(sealedPhoto.subarray(12, sealedPhoto.length - 16)), d.final()]),
  photo,
  'an 8 MB snap round-trips through OpenSSL',
);
assert.ok(sealMs < 30_000, `8 MB JS seal took ${sealMs.toFixed(0)}ms — must stay usable`);

console.log('phone-crypto self-check passed (OpenSSL cross-verified both directions)');
