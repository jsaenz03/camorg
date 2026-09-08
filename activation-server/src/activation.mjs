/**
 * Camog licence activation — pure logic, shared by the worker (routing and
 * storage live in worker.mjs) and scripts/self-check-licence-activation.mjs.
 *
 * Licence keys use the format documented in lib/licence/verify.ts and
 * scripts/licence-keygen.mjs (all three parse paths are kept in sync by
 * review + self-checks). Activation tokens use the same
 * base64url(payloadJSON).base64url(signature) shape, signed by the
 * activation server's own Ed25519 key — its public key is embedded in
 * lib/licence/activation-public-key.ts. A token binds one device ID to one
 * licence fingerprint and never outlives the licence (exp = licence expiry),
 * so the client can honour it offline for the licence's whole term.
 */

import { signAsync, verifyAsync } from '@noble/ed25519';

export const SUPPORT_EMAIL = 'admin@cliniciq.com.au';

export class ActivationError extends Error {
  /**
   * @param {string} code one of: bad_request | invalid_key | expired | seat_limit
   * @param {string} message user-facing text (surfaced by the app and admin CLI)
   */
  constructor(code, message) {
    super(message);
    this.name = 'ActivationError';
    this.code = code;
  }
}

// --- base64url + hex (pure Web APIs — Cloudflare Workers have no Buffer) ---
export const b64uEncode = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const b64uDecode = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => {
  const text = s.trim();
  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

const TIERS = ['solo', 'practice', 'clinic'];

function checkLicencePayload(p) {
  if (!p || typeof p !== 'object') throw new ActivationError('invalid_key', 'Licence key payload is not valid.');
  if (p.v !== 1) throw new ActivationError('invalid_key', 'Unknown licence version.');
  if (typeof p.practice !== 'string' || p.practice.trim().length === 0) {
    throw new ActivationError('invalid_key', 'Licence key payload is not valid.');
  }
  if (!TIERS.includes(p.tier)) throw new ActivationError('invalid_key', 'Licence key payload is not valid.');
  if (!Number.isInteger(p.seats) || p.seats <= 0) {
    throw new ActivationError('invalid_key', 'Licence key payload is not valid.');
  }
  if (!Number.isFinite(p.issuedAt) || p.issuedAt <= 0 || !Number.isFinite(p.expiresAt) || p.expiresAt <= 0) {
    throw new ActivationError('invalid_key', 'Licence key payload is not valid.');
  }
}

/**
 * Verifies a licence key against the vendor public key and returns its
 * payload. Expiry is NOT a verification failure (mirrors the client) — the
 * caller turns an expired payload into its own state/error.
 */
export async function verifyLicence(keyStr, licencePublicKeyHex) {
  const parts = keyStr.replace(/\s+/g, '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ActivationError('invalid_key', 'Licence key must be a single key in the form payload.signature.');
  }
  let payloadBytes;
  let signature;
  try {
    payloadBytes = b64uDecode(parts[0]);
    signature = b64uDecode(parts[1]);
  } catch {
    throw new ActivationError('invalid_key', 'Licence key is not valid base64.');
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new ActivationError('invalid_key', 'Licence key payload is not valid.');
  }
  checkLicencePayload(payload);
  let ok = false;
  try {
    ok = await verifyAsync(signature, payloadBytes, unhex(licencePublicKeyHex));
  } catch {
    ok = false;
  }
  if (!ok) throw new ActivationError('invalid_key', 'Licence key failed signature verification.');
  return payload;
}

/** Stable per-licence fingerprint: SHA-256 of the whitespace-stripped key. */
export async function licenceFingerprint(keyStr) {
  const bytes = new TextEncoder().encode(keyStr.replace(/\s+/g, ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

/**
 * Seat decision. A device already holding a seat may always re-activate
 * (renewal, reinstall); a new device needs a free seat.
 */
export function decideSeat({ seats, activeCount, deviceExists }) {
  if (deviceExists || activeCount < seats) return;
  throw new ActivationError(
    'seat_limit',
    `All ${seats} device seat${seats === 1 ? '' : 's'} for this licence are already in use. ` +
      `Contact ${SUPPORT_EMAIL} to move a seat to this device.`,
  );
}

/** Signs an activation token: base64url(payload).base64url(sig). */
export async function issueToken({ fp, deviceId, exp }, tokenSecretKeyHex) {
  const payload = { v: 1, fp, deviceId, exp };
  const message = new TextEncoder().encode(JSON.stringify(payload));
  const signature = await signAsync(message, unhex(tokenSecretKeyHex));
  return `${b64uEncode(message)}.${b64uEncode(signature)}`;
}

/**
 * Verifies an activation token's shape + signature and returns its payload.
 * Expiry is NOT checked here (mirrors verifyLicence) — the client compares
 * exp against the local clock and the fp/deviceId against its own state.
 */
export async function verifyToken(tokenStr, tokenPublicKeyHex) {
  const parts = tokenStr.replace(/\s+/g, '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new ActivationError('invalid_key', 'Activation token is malformed.');
  }
  let payloadBytes;
  let signature;
  try {
    payloadBytes = b64uDecode(parts[0]);
    signature = b64uDecode(parts[1]);
  } catch {
    throw new ActivationError('invalid_key', 'Activation token is not valid base64.');
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new ActivationError('invalid_key', 'Activation token payload is not valid.');
  }
  const valid =
    payload &&
    typeof payload === 'object' &&
    payload.v === 1 &&
    typeof payload.fp === 'string' &&
    /^[0-9a-f]{64}$/.test(payload.fp) &&
    typeof payload.deviceId === 'string' &&
    payload.deviceId.length >= 8 &&
    payload.deviceId.length <= 64 &&
    Number.isFinite(payload.exp) &&
    payload.exp > 0;
  if (!valid) throw new ActivationError('invalid_key', 'Activation token payload is not valid.');
  let ok = false;
  try {
    ok = await verifyAsync(signature, payloadBytes, unhex(tokenPublicKeyHex));
  } catch {
    ok = false;
  }
  if (!ok) throw new ActivationError('invalid_key', 'Activation token failed signature verification.');
  return payload;
}
