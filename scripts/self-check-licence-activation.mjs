#!/usr/bin/env node
/**
 * Self-check for the licence activation contract (specs/003-licence-activation).
 *
 * Imports the activation server's REAL pure logic
 * (activation-server/src/activation.mjs) and pins, with asserts:
 *   - licence verify (good / tampered / wrong-key / malformed / whitespace)
 *   - licence fingerprint (deterministic, whitespace-insensitive, per-key)
 *   - seat decision (free seat, limit rejection, known-device re-activation)
 *   - activation-token round-trip, tamper rejection, wrong-key rejection
 *   - client-format mirror: a token verifies using the same base64url +
 *     Ed25519 path lib/licence/verify.ts uses (verifyActivationToken)
 *
 * Uses throwaway keypairs (never .keys/) so it runs anywhere.
 */

import { keygenAsync, signAsync, verifyAsync } from '@noble/ed25519';
import assert from 'node:assert';
import {
  ActivationError,
  b64uDecode,
  b64uEncode,
  decideSeat,
  issueToken,
  licenceFingerprint,
  verifyLicence,
  verifyToken,
} from '../activation-server/src/activation.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s.trim(), 'hex'));

async function signLicence(payload, secretKey) {
  const message = new TextEncoder().encode(JSON.stringify(payload));
  return `${b64uEncode(message)}.${b64uEncode(await signAsync(message, secretKey))}`;
}

// The client-side mirror of lib/licence/verify.ts verifyActivationToken:
// same base64url decode, shape check, and signature verify.
async function clientVerifyToken(tokenStr, publicKeyHex) {
  const [payloadPart, sigPart] = tokenStr.replace(/\s+/g, '').split('.');
  const payloadBytes = b64uDecode(payloadPart);
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  assert.equal(payload.v, 1, 'token version');
  assert.match(payload.fp, /^[0-9a-f]{64}$/, 'token fp shape');
  assert.ok(payload.deviceId.length >= 8, 'token deviceId shape');
  assert.ok(payload.exp > 0, 'token exp shape');
  const ok = await verifyAsync(b64uDecode(sigPart), payloadBytes, unhex(publicKeyHex));
  assert.ok(ok, 'token signature verifies on the client path');
  return payload;
}

const vendor = await keygenAsync();
const payload = {
  v: 1,
  practice: 'Selfcheck Clinic',
  tier: 'practice',
  seats: 2,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 365 * 86_400_000,
};
const key = await signLicence(payload, vendor.secretKey);
const vendorPublicHex = hex(vendor.publicKey);

// 1. Licence verification: good key round-trips.
const licence = await verifyLicence(key, vendorPublicHex);
assert.equal(licence.practice, 'Selfcheck Clinic');
assert.equal(licence.seats, 2);

// 2. Whitespace in pasted keys tolerated.
assert.equal((await verifyLicence(` \n${key.split('.').join('.\n')}  `, vendorPublicHex)).tier, 'practice');

// 3. Tampered payload rejected.
const tampered = `${b64uEncode(new TextEncoder().encode(JSON.stringify({ ...payload, seats: 99 })))}.${key.split('.')[1]}`;
await assert.rejects(() => verifyLicence(tampered, vendorPublicHex), ActivationError);

// 4. Signature from a different vendor key rejected.
const other = await keygenAsync();
await assert.rejects(async () => verifyLicence(await signLicence(payload, other.secretKey), vendorPublicHex));

// 5. Malformed inputs rejected.
await assert.rejects(() => verifyLicence('not-a-key', vendorPublicHex));
await assert.rejects(() => verifyLicence('aGVsbG8.only', vendorPublicHex));

// 6. Fingerprint: deterministic, whitespace-insensitive, 64-hex, per-key.
const fp = await licenceFingerprint(key);
assert.match(fp, /^[0-9a-f]{64}$/);
assert.equal(fp, await licenceFingerprint(`\n${key}\n`));
assert.notEqual(fp, await licenceFingerprint(await signLicence({ ...payload, seats: 5 }, vendor.secretKey)));

// 7. Seat decision: free seat accepted, limit rejected with seats + support email.
decideSeat({ seats: 2, activeCount: 0, deviceExists: false });
decideSeat({ seats: 2, activeCount: 1, deviceExists: false });
assert.throws(() => decideSeat({ seats: 2, activeCount: 2, deviceExists: false }), (e) => {
  assert.ok(e instanceof ActivationError);
  assert.equal(e.code, 'seat_limit');
  assert.match(e.message, /2 device seats/);
  assert.match(e.message, /admin@cliniciq\.com\.au/);
  return true;
});
decideSeat({ seats: 2, activeCount: 2, deviceExists: true }); // known device re-activates at limit

// 8. Token round-trip through the worker's issuer + the client's verify path.
const tokenSecret = await keygenAsync();
const token = await issueToken({ fp, deviceId: 'aabbccdd-0011-2233-4455-66778899aabb', exp: payload.expiresAt }, hex(tokenSecret.secretKey));
const tokenPublicHex = hex(tokenSecret.publicKey);
const roundTrip = await verifyToken(token, tokenPublicHex);
assert.equal(roundTrip.fp, fp);
assert.equal(roundTrip.deviceId, 'aabbccdd-0011-2233-4455-66778899aabb');
assert.equal(roundTrip.exp, payload.expiresAt);
assert.deepEqual(await clientVerifyToken(token, tokenPublicHex), roundTrip, 'client mirror agrees with worker verify');

// 9. Token tamper + wrong key + malformed rejected.
const forged = `${b64uEncode(new TextEncoder().encode(JSON.stringify({ ...roundTrip, deviceId: '11111111-2222-3333-4444-555555555555' })))}.${token.split('.')[1]}`;
await assert.rejects(() => verifyToken(forged, tokenPublicHex));
await assert.rejects(() => clientVerifyToken(forged, tokenPublicHex));
await assert.rejects(() => verifyToken(token, hex(other.publicKey)));
await assert.rejects(() => verifyToken('garbage', tokenPublicHex));

// 10. Token exp is the caller's concern (verify passes for an expired token) —
//     matches the client, which compares exp to the local clock itself.
const expiredToken = await issueToken({ fp, deviceId: 'aabbccdd-0011-2233-4455-66778899aabb', exp: 1 }, hex(tokenSecret.secretKey));
assert.equal((await verifyToken(expiredToken, tokenPublicHex)).exp, 1);

console.log('licence-activation self-check passed (10 checks).');
