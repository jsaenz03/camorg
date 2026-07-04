/**
 * Passcode + token hashing helpers (Web Crypto API, PBKDF2-SHA256).
 *
 * Stored format: `pbkdf2$<iterations>$<saltHex>$<hashHex>`
 *
 * Why PBKDF2 over the v1 contract's plain SHA-256: PBKDF2 with a per-user salt
 * and high iteration count makes offline brute-force impractical if the local
 * SQLite file leaks. Constant-time compare guards against timing attacks.
 */

const ITERATIONS = 210_000; // OWASP 2023 recommendation for PBKDF2-SHA256
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I,O,0,1 — readability

const subtle = (): SubtleCrypto => {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto API is required but unavailable');
  }
  return crypto.subtle;
};

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(hex.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(len);
  const bytes = new Uint8Array(buffer);
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveBits(
  passcode: string,
  salt: BufferSource,
  iterations: number,
): Promise<ArrayBuffer> {
  const key = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passcode),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  return subtle().deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    HASH_BYTES * 8,
  );
}

/**
 * Hash a passcode with a fresh random salt.
 * Returns `pbkdf2$<iters>$<saltHex>$<hashHex>`.
 */
export async function hashPasscode(
  passcode: string,
  saltHex?: string,
): Promise<string> {
  const salt = saltHex ? hexToBuf(saltHex) : randomBytes(SALT_BYTES);
  const hash = await deriveBits(passcode, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${bufToHex(salt.buffer)}$${bufToHex(hash)}`;
}

/**
 * Verify a passcode against a stored `pbkdf2$...` string.
 * Constant-time comparison of the derived hash.
 */
export async function verifyPasscode(
  passcode: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  const saltHex = parts[2];
  const expectedHex = parts[3];
  if (!iterations || !saltHex || !expectedHex) return false;

  const salt = hexToBuf(saltHex);
  const derived = await deriveBits(passcode, salt, iterations);
  const derivedHex = bufToHex(derived);

  if (derivedHex.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    diff |= derivedHex.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generate a human-readable random token (default 8 chars).
 * Excludes ambiguous characters (I, O, 0, 1) for ease of manual entry.
 */
export function randomToken(len = 8): string {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
