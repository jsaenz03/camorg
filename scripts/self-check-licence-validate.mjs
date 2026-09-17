#!/usr/bin/env node
/**
 * Self-check for the /v1/validate seat re-check endpoint (specs/003 —
 * revocation propagation; renewal hand-out in specs/005).
 *
 * Drives the activation server's REAL worker.fetch
 * (activation-server/src/worker.mjs) against a stub D1 holding activation
 * and renewal-chain rows, so routing, handler, and the error→status mapping
 * are all exercised. Pins, with asserts:
 *   - active seat → 200 { valid, exp }
 *   - revoked seat → 403 'revoked' (the whole point: no un-revoking)
 *   - absent seat → 404 'not_activated'
 *   - expired licence key → 410 'expired'
 *   - successor key (paid renewal) → rides home in `renewal`; a revoked
 *     seat never collects one, and a lapsed successor is filtered
 *   - tampered key → 400 'invalid_key'; malformed input → 400 'bad_request'
 *   - method/path guard: GET /v1/validate and unknown paths stay 404
 *
 * Uses throwaway keys (never .keys/) so it runs anywhere.
 */

import { keygenAsync, signAsync } from '@noble/ed25519';
import assert from 'node:assert';
import {
  b64uEncode,
  licenceFingerprint,
} from '../activation-server/src/activation.mjs';
import worker from '../activation-server/src/worker.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
const uuid = 'aabbccdd-0011-2233-4455-66778899aabb';

async function signLicence(payload, secretKey) {
  const message = new TextEncoder().encode(JSON.stringify(payload));
  return `${b64uEncode(message)}.${b64uEncode(await signAsync(message, secretKey))}`;
}

async function post(env, body, { path = '/v1/validate', method = 'POST' } = {}) {
  return worker.fetch(
    new Request(`https://licence.test${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
    }),
    env,
  );
}

const vendor = await keygenAsync();
const vendorPublicHex = hex(vendor.publicKey);
const payload = {
  v: 1,
  practice: 'Selfcheck Clinic',
  tier: 'practice',
  seats: 2,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 365 * 86_400_000,
};
const key = await signLicence(payload, vendor.secretKey);
const fp = await licenceFingerprint(key);

// Stub D1: the two queries validate runs — the activations seat map and
// the renewal-chain lookup (emulating the SQL's expires_at > now filter).
const seats = new Map(); // `${fp}\n${deviceId}` → revoked 0|1
const successors = new Map(); // renews_fp → { key_text, expires_at }
const env = {
  LICENCE_PUBLIC_KEY: vendorPublicHex,
  DB: {
    prepare(sql) {
      if (/SELECT revoked FROM activations/.test(sql)) {
        return {
          bind(bindFp, bindDeviceId) {
            return {
              first: async () => {
                const revoked = seats.get(`${bindFp}\n${bindDeviceId}`);
                return revoked === undefined ? null : { revoked };
              },
            };
          },
        };
      }
      assert.match(sql, /SELECT key_text FROM licences/, 'unexpected SQL in validate path');
      return {
        bind(bindFp, bindNow) {
          return {
            first: async () => {
              const row = successors.get(bindFp);
              return row && row.expires_at > bindNow ? row : null;
            },
          };
        },
      };
    },
  },
};

// 1. Active seat: 200 with the licence expiry echoed back.
seats.set(`${fp}\n${uuid}`, 0);
let res = await post(env, { key, deviceId: uuid });
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), { valid: true, exp: payload.expiresAt });

// 2. Revoked seat: 403 — and repeat calls change nothing (no un-revoke).
seats.set(`${fp}\n${uuid}`, 1);
res = await post(env, { key, deviceId: uuid });
assert.equal(res.status, 403);
const revokedBody = await res.json();
assert.equal(revokedBody.error, 'revoked');
assert.match(revokedBody.message, /admin@cliniciq\.com\.au/);
seats.set(`${fp}\n${uuid}`, 1);
res = await post(env, { key, deviceId: uuid });
assert.equal(res.status, 403, 'repeat validate must not resurrect a revoked seat');

// 3. Seat row absent entirely: 404 not_activated.
res = await post(env, { key, deviceId: '11111111-2222-3333-4444-555555555555' });
assert.equal(res.status, 404);
assert.equal((await res.json()).error, 'not_activated');

// 4. Expired licence without a successor: 410 (the seat verdict comes
//    first — a lapsed key on a healthy seat still gets the 410).
const expiredPayload = {
  ...payload,
  issuedAt: Date.now() - 400 * 86_400_000,
  expiresAt: Date.now() - 35 * 86_400_000,
};
const expiredKey = await signLicence(expiredPayload, vendor.secretKey);
seats.set(`${await licenceFingerprint(expiredKey)}\n${uuid}`, 0);
res = await post(env, { key: expiredKey, deviceId: uuid });
assert.equal(res.status, 410);
assert.equal((await res.json()).error, 'expired');

// 5. Tampered key payload rejected by signature.
const tampered = `${b64uEncode(new TextEncoder().encode(JSON.stringify({ ...payload, seats: 99 })))}.${key.split('.')[1]}`;
res = await post(env, { key: tampered, deviceId: uuid });
assert.equal(res.status, 400);
assert.equal((await res.json()).error, 'invalid_key');

// 6. Malformed input.
res = await post(env, { key: '', deviceId: uuid });
assert.equal(res.status, 400);
assert.equal((await res.json()).error, 'bad_request');
res = await post(env, { key, deviceId: 'not-a-uuid' });
assert.equal(res.status, 400);
assert.equal((await res.json()).error, 'bad_request');

// 7. Method and path guards: validate is POST-only, unknown paths stay 404.
res = await post(env, undefined, { method: 'GET' });
assert.equal(res.status, 404);
res = await post(env, { key, deviceId: uuid }, { path: '/v1/validate/extra' });
assert.equal(res.status, 404);

// --- renewal hand-out (specs/005-licence-auto-renew) ---

const successorKey = await signLicence(
  { ...payload, issuedAt: Date.now(), expiresAt: Date.now() + 365 * 86_400_000 },
  vendor.secretKey,
);

// 8. A paid successor rides home on a healthy seat's 200.
seats.set(`${fp}\n${uuid}`, 0); // back from case 2's revocation
successors.set(fp, { key_text: successorKey, expires_at: Date.now() + 365 * 86_400_000 });
res = await post(env, { key, deviceId: uuid });
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), {
  valid: true,
  exp: payload.expiresAt,
  renewal: successorKey,
});

// 9. A revoked seat must not collect its successor — seat checks run
//    before any renewal hand-out, even after the old key lapses.
seats.set(`${fp}\n${uuid}`, 1);
res = await post(env, { key, deviceId: uuid });
assert.equal(res.status, 403, 'revoked seat must not receive the successor key');
seats.set(`${fp}\n${uuid}`, 0);

// 10. Expired key + unexpired successor: 200 with the renewal so an
//     install that was offline through its expiry recovers on its own.
const staleFp = await licenceFingerprint(expiredKey);
successors.set(staleFp, { key_text: successorKey, expires_at: Date.now() + 365 * 86_400_000 });
res = await post(env, { key: expiredKey, deviceId: uuid });
assert.equal(res.status, 200);
assert.deepEqual(await res.json(), {
  valid: false,
  exp: expiredPayload.expiresAt,
  renewal: successorKey,
});

// 11. A lapsed successor (payment landed, term already over) is filtered —
//     the expired key keeps its plain 410.
successors.set(staleFp, {
  key_text: await signLicence(
    { ...payload, issuedAt: Date.now() - 800 * 86_400_000, expiresAt: Date.now() - 1 },
    vendor.secretKey,
  ),
  expires_at: Date.now() - 1,
});
res = await post(env, { key: expiredKey, deviceId: uuid });
assert.equal(res.status, 410);
assert.equal((await res.json()).error, 'expired');

console.log('licence-validate self-check passed (11 checks).');
