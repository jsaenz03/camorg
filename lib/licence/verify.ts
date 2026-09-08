/**
 * Offline licence key parsing + Ed25519 verification.
 *
 * Key format: base64url(payloadJSON).base64url(signature). The signature
 * covers the exact payload bytes, so any payload edit breaks verification.
 * Whitespace in pasted keys (email line wraps, textarea newlines) is
 * stripped before parsing.
 *
 * Mirrored (deliberately, kept in sync) by scripts/licence-keygen.mjs —
 * its `selftest` is the runnable proof for this format.
 */

import { verifyAsync } from '@noble/ed25519';
import { z } from 'zod';
import { LicenceKeyError } from '@/lib/validators/errors';
import { LICENCE_PUBLIC_KEY_HEX } from '@/lib/licence/public-key';
import { ACTIVATION_PUBLIC_KEY_HEX } from '@/lib/licence/activation-public-key';
import type { LicenceInfo } from '@/specs/002-offline-licence/contracts/licence-service';

const payloadSchema = z.object({
  v: z.literal(1),
  practice: z.string().trim().min(1),
  tier: z.enum(['solo', 'practice', 'clinic']),
  seats: z.number().int().positive(),
  issuedAt: z.number().positive(),
  expiresAt: z.number().positive(),
});

function b64uToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Verifies a licence key string and returns its decoded info.
 *
 * Expiry is NOT checked here — a validly signed but expired key is a state
 * ('read-only' / LicenceExpiredError on activate), not a verification failure.
 *
 * @throws LicenceKeyError if the key is malformed, fails schema validation,
 *   or fails signature verification.
 */
export async function verifyLicenceKey(key: string): Promise<LicenceInfo> {
  const parts = key.replace(/\s+/g, '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LicenceKeyError('Licence key must be a single key in the form payload.signature');
  }

  let payloadBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    payloadBytes = b64uToBytes(parts[0]);
    signature = b64uToBytes(parts[1]);
  } catch {
    throw new LicenceKeyError('Licence key is not valid base64');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new LicenceKeyError('Licence key payload is not valid');
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new LicenceKeyError('Licence key payload is not valid');
  }

  let ok = false;
  try {
    ok = await verifyAsync(signature, payloadBytes, hexToBytes(LICENCE_PUBLIC_KEY_HEX));
  } catch {
    ok = false;
  }
  if (!ok) throw new LicenceKeyError('Licence key failed signature verification');

  const { practice, tier, seats, issuedAt, expiresAt } = parsed.data;
  return {
    practice,
    tier,
    seats,
    issuedAt: new Date(issuedAt),
    expiresAt: new Date(expiresAt),
  };
}

// --- Activation tokens (specs/003-licence-activation) ---
//
// Same payload.signature shape as licence keys, but signed by the activation
// server (lib/licence/activation-public-key.ts) and payload
// { v: 1, fp, deviceId, exp }: the licence fingerprint this token belongs
// to, the device ID holding the seat, and the licence's expiry (the token
// never outlives the licence). Mirrored by
// scripts/self-check-licence-activation.mjs via the worker's activation.mjs.

const tokenSchema = z.object({
  v: z.literal(1),
  fp: z.string().regex(/^[0-9a-f]{64}$/),
  deviceId: z.string().min(8).max(64),
  exp: z.number().positive(),
});

export interface ActivationTokenInfo {
  fp: string;
  deviceId: string;
  exp: number;
}

/** SHA-256 hex of the whitespace-stripped key — the licence's server-side identity. */
export async function licenceFingerprint(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key.replace(/\s+/g, ''));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verifies an activation token's shape + signature against the activation
 * server's public key. Expiry is NOT checked here — the caller compares exp
 * to the local clock, and fp/deviceId to its own state.
 *
 * @throws LicenceKeyError if the token is malformed, fails schema validation,
 *   or fails signature verification.
 */
export async function verifyActivationToken(token: string): Promise<ActivationTokenInfo> {
  const parts = token.replace(/\s+/g, '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LicenceKeyError('Activation token is malformed');
  }

  let payloadBytes: Uint8Array;
  let signature: Uint8Array;
  try {
    payloadBytes = b64uToBytes(parts[0]);
    signature = b64uToBytes(parts[1]);
  } catch {
    throw new LicenceKeyError('Activation token is not valid base64');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    throw new LicenceKeyError('Activation token payload is not valid');
  }

  const parsed = tokenSchema.safeParse(payload);
  if (!parsed.success) {
    throw new LicenceKeyError('Activation token payload is not valid');
  }

  let ok = false;
  try {
    ok = await verifyAsync(signature, payloadBytes, hexToBytes(ACTIVATION_PUBLIC_KEY_HEX));
  } catch {
    ok = false;
  }
  if (!ok) throw new LicenceKeyError('Activation token failed signature verification');

  return { fp: parsed.data.fp, deviceId: parsed.data.deviceId, exp: parsed.data.exp };
}
