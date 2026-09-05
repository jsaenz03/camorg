/**
 * At-rest encryption for database backups (webview side, WebCrypto).
 *
 * A backup holds every patient record, so it is AES-256-GCM encrypted with a
 * key derived from a practice-chosen passphrase (PBKDF2-SHA256, per-backup
 * random salt + nonce). The passphrase is deliberately the one secret that
 * travels with the backup: restoring onto a fresh machine needs no key file
 * from the old one — unlike photos, whose key never leaves the app data dir.
 * The derived key lives only inside these call frames; nothing is persisted.
 *
 * File format: b"CAMGB1" + 16-byte salt + 12-byte nonce + ciphertext(+tag).
 * Files without the magic (backups written before this encryption) pass
 * through decryption unchanged, mirroring photo_crypto's decrypt_or_plain.
 */

const MAGIC = new TextEncoder().encode('CAMGB1');
const MAGIC_LEN = MAGIC.length; // 6 — derived so detect and encrypt can't drift
const SALT_LEN = 16;
const NONCE_LEN = 12;
const ITERATIONS = 210_000; // same PBKDF2-SHA256 cost as passcode hashing

function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const bytes = new ArrayBuffer(len);
  crypto.getRandomValues(new Uint8Array(bytes));
  return new Uint8Array(bytes);
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Does this byte stream carry the CAMGB1 prefix (with room for salt+nonce+tag)? */
export function isEncryptedBackup(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (bytes.length <= MAGIC_LEN + SALT_LEN + NONCE_LEN) return false;
  for (let i = 0; i < MAGIC_LEN; i++) {
    if (bytes[i] !== MAGIC[i]) return false;
  }
  return true;
}

/** Seal a plaintext database snapshot with the practice's passphrase. */
export async function encryptBackupBytes(
  plain: Uint8Array<ArrayBuffer>,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = randomBytes(SALT_LEN);
  const nonce = randomBytes(NONCE_LEN);
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

/**
 * Open a backup with its passphrase. A file without the CAMGB1 magic is a
 * pre-encryption backup and comes back unchanged; a wrong passphrase or a
 * damaged file fails GCM authentication and throws a user-facing error.
 */
export async function decryptBackupBytes(
  bytes: Uint8Array<ArrayBuffer>,
  passphrase: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!isEncryptedBackup(bytes)) return new Uint8Array(bytes);
  const bodyStart = MAGIC_LEN + SALT_LEN + NONCE_LEN;
  const key = await deriveKey(passphrase, bytes.subarray(MAGIC_LEN, MAGIC_LEN + SALT_LEN));
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(MAGIC_LEN + SALT_LEN, bodyStart) },
      key,
      bytes.subarray(bodyStart),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error(
      'That passphrase did not open the backup — check it, or the file may be damaged.',
    );
  }
}
