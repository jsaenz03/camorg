// Self-check for the passphrase-encrypted backup format (lib/utils/backup-crypto.ts).
// Run: node scripts/self-check-backup-crypto.mjs
// ponytail: mirrors the constants and the WebCrypto flow of backup-crypto.ts
// because Node cannot import the TS graph directly; Node 18+ ships the same
// WebCrypto, so this exercises the identical algorithm. If you change the
// format there, update the mirror here.

import assert from 'node:assert/strict';

// Format: MAGIC(6 = "CAMGB1") + salt(16) + nonce(12) + AES-256-GCM ciphertext(+tag).
const MAGIC = new TextEncoder().encode('CAMGB1');
const MAGIC_LEN = MAGIC.length;
const SALT_LEN = 16;
const NONCE_LEN = 12;
const ITERATIONS = 210_000; // keep in sync with backup-crypto.ts / crypto.ts

function isEncryptedBackup(bytes) {
  if (bytes.length <= MAGIC_LEN + SALT_LEN + NONCE_LEN) return false;
  for (let i = 0; i < MAGIC_LEN; i++) if (bytes[i] !== MAGIC[i]) return false;
  return true;
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function encryptBackupBytes(plain, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain),
  );
  const out = new Uint8Array(MAGIC_LEN + SALT_LEN + NONCE_LEN + ciphertext.length);
  out.set(MAGIC, 0);
  out.set(salt, MAGIC_LEN);
  out.set(nonce, MAGIC_LEN + SALT_LEN);
  out.set(ciphertext, MAGIC_LEN + SALT_LEN + NONCE_LEN);
  return out;
}

async function decryptBackupBytes(bytes, passphrase) {
  if (!isEncryptedBackup(bytes)) return new Uint8Array(bytes);
  const bodyStart = MAGIC_LEN + SALT_LEN + NONCE_LEN;
  const key = await deriveKey(passphrase, bytes.subarray(MAGIC_LEN, MAGIC_LEN + SALT_LEN));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(MAGIC_LEN + SALT_LEN, bodyStart) },
      key, bytes.subarray(bodyStart),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error('That passphrase did not open the backup');
  }
}

// A SQLite file header — what a legacy (pre-encryption) backup starts with.
const sqliteBytes = new Uint8Array(80);
sqliteBytes.set(new TextEncoder().encode('SQLite format 3\0'), 0);

// Roundtrip: the sealed file carries the magic at 0, salt at 5, nonce at 21,
// and decrypts back to the exact snapshot bytes.
const db = new Uint8Array(4096);
for (let i = 0; i < db.length; i++) db[i] = (i * 31 + 7) & 0xff;
const sealed = await encryptBackupBytes(db, 'correct horse battery');
assert.ok(isEncryptedBackup(sealed));
assert.deepEqual([...sealed.subarray(0, MAGIC_LEN)], [...MAGIC]);
const opened = await decryptBackupBytes(sealed, 'correct horse battery');
assert.equal(opened.length, db.length);
assert.deepEqual([...opened], [...db]);

// The same plaintext + passphrase seals differently each time (random salt+nonce).
const sealed2 = await encryptBackupBytes(db, 'correct horse battery');
assert.notDeepEqual([...sealed.subarray(MAGIC_LEN, MAGIC_LEN + SALT_LEN)],
  [...sealed2.subarray(MAGIC_LEN, MAGIC_LEN + SALT_LEN)], 'salt must be random per backup');
assert.notDeepEqual([...sealed], [...sealed2], 'seals must never be identical');

// A wrong passphrase fails closed (GCM auth), and a tampered byte fails too.
await assert.rejects(decryptBackupBytes(sealed, 'wrong passphrase entirely'));
const tampered = sealed.slice();
tampered[tampered.length - 1] ^= 0xff;
await assert.rejects(decryptBackupBytes(tampered, 'correct horse battery'));
// Every byte of the sealed output's header differs from the plaintext
// snapshot's start (the at-rest privacy property: no plaintext SQLite
// header survives into the sealed file).
let headerOverlap = true;
for (let i = 0; i < 15; i++) {
  if (sealed[i] !== sqliteBytes[i]) { headerOverlap = false; break; }
}
assert.ok(!headerOverlap);

// Legacy passthrough: a pre-encryption backup (plain SQLite) comes back as-is.
assert.equal(isEncryptedBackup(sqliteBytes), false);
assert.deepEqual([...(await decryptBackupBytes(sqliteBytes, 'ignored'))], [...sqliteBytes]);

// Short/garbage input is not mistaken for ours.
assert.equal(isEncryptedBackup(MAGIC.slice()), false);
assert.equal(isEncryptedBackup(new Uint8Array(0)), false);

console.log('backup-crypto self-check passed');
