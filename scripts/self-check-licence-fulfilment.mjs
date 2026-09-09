#!/usr/bin/env node
/**
 * Self-check for Stripe licence fulfilment (activation-server/src/fulfil.mjs
 * + the issueLicence signing twin in activation.mjs). Pure logic only — no
 * network, no D1. Run: node scripts/self-check-licence-fulfilment.mjs
 * (picked up by scripts/run-self-checks.sh).
 */

import { keygenAsync } from '@noble/ed25519';
import assert from 'node:assert';
import { issueLicence, verifyLicence } from '../activation-server/src/activation.mjs';
import {
  buildEmail,
  extractOrder,
  formatDateAU,
  verifyStripeSignature,
} from '../activation-server/src/fulfil.mjs';

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

// --- issueLicence: what the worker mints must verify in the app's format ---

const { secretKey, publicKey } = await keygenAsync();
const secretHex = hex(secretKey);
const publicHex = hex(publicKey);

// 1. A minted key round-trips through the app-side verifier.
const now = Date.now();
const key = await issueLicence({ practice: 'Bay Dermatology', tier: 'practice', seats: 3, now }, secretHex);
const payload = await verifyLicence(key, publicHex);
assert.equal(payload.practice, 'Bay Dermatology');
assert.equal(payload.tier, 'practice');
assert.equal(payload.seats, 3);
assert.equal(payload.issuedAt, now);

// 2. 12-month term matches keygen's Date-based month arithmetic.
const monthsAhead = new Date(now);
monthsAhead.setMonth(monthsAhead.getMonth() + 12);
assert.equal(payload.expiresAt, monthsAhead.getTime());

// 3. The minted key also passes the worker's own activation verification
//    (same verifyLicence the /v1/activate route uses) and isn't expired.
assert.ok(payload.expiresAt > Date.now(), 'minted licence is in-term');

// 4. Bad fulfilment inputs are rejected before any signing happens.
await assert.rejects(
  () => issueLicence({ practice: '', tier: 'solo', seats: 1 }, secretHex),
  /practice/,
);
await assert.rejects(
  () => issueLicence({ practice: 'X', tier: 'enterprise', seats: 1 }, secretHex),
  /tier/,
);
await assert.rejects(
  () => issueLicence({ practice: 'X', tier: 'solo', seats: 0 }, secretHex),
  /seats/i,
);

// --- verifyStripeSignature: the webhook's authentication gate ---

const webhookSecret = 'whsec_test_secret_0123456789abcdef';
const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed' });
const t = Math.floor(Date.now() / 1000);
const signedPayload = `${t}.${body}`;
const cryptoKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(webhookSecret),
  { name: 'HMAC', hash: 'SHA-256' },
  false,
  ['sign'],
);
const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(signedPayload));
const v1 = hex(new Uint8Array(sig));

// 5. A correctly signed request passes.
assert.ok(
  await verifyStripeSignature(body, `t=${t},v1=${v1}`, webhookSecret),
  'valid signature accepted',
);

// 6. Tampered body, wrong secret, stale timestamp, malformed headers fail.
assert.ok(!(await verifyStripeSignature(`${body} `, `t=${t},v1=${v1}`, webhookSecret)), 'tampered body rejected');
assert.ok(!(await verifyStripeSignature(body, `t=${t},v1=${v1}`, 'whsec_other_secret_0123456789a')), 'wrong secret rejected');
const staleT = Math.floor((Date.now() - 6 * 60 * 1000) / 1000);
assert.ok(
  !(await verifyStripeSignature(body, `t=${staleT},v1=${v1}`, webhookSecret)),
  'stale timestamp rejected',
);
assert.ok(!(await verifyStripeSignature(body, 'v1=deadbeef', webhookSecret)), 'missing t rejected');
assert.ok(!(await verifyStripeSignature(body, '', webhookSecret)), 'missing header rejected');

// 7. Node's own HMAC agrees with our WebCrypto construction (guards against
//    a subtle API misuse that would accept everything signed by us).
const { createHmac } = await import('node:crypto');
const nodeSig = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
assert.equal(v1, nodeSig, 'WebCrypto HMAC matches node:crypto HMAC');

// --- extractOrder: Payment Link metadata + practice fallbacks ---

// 8. Well-formed session (Payment Link metadata + practice custom field).
const order = extractOrder({
  id: 'cs_test_1',
  payment_status: 'paid',
  customer_details: { email: 'reception@bayderm.com.au', name: 'Dr Jane' },
  metadata: { tier: 'practice', seats: '3' },
  custom_fields: [{ key: 'practice', text: { value: 'Bay Dermatology' } }],
});
assert.equal(order.sessionId, 'cs_test_1');
assert.equal(order.email, 'reception@bayderm.com.au');
assert.equal(order.practice, 'Bay Dermatology');
assert.equal(order.tier, 'practice');
assert.equal(order.seats, 3);

// 9. Missing metadata → tier/seats null (recorded for manual fulfilment),
//    practice falls back to customer name then the email local part.
const unmapped = extractOrder({ id: 'cs_test_2', customer_details: { email: 'a@b.com' } });
assert.equal(unmapped.tier, null);
assert.equal(unmapped.seats, null);
assert.equal(unmapped.practice, 'a');
const named = extractOrder({
  id: 'cs_test_3',
  customer_details: { email: 'a@b.com', name: 'Coastal Clinic' },
  metadata: { tier: 'clinic', seats: '10' },
});
assert.equal(named.practice, 'Coastal Clinic');

// 10. Non-integer / non-positive seats are treated as unmapped, not trusted.
assert.equal(extractOrder({ id: 'cs_4', metadata: { tier: 'solo', seats: 'many' } }).seats, null);
assert.equal(extractOrder({ id: 'cs_5', metadata: { tier: 'solo', seats: '0' } }).seats, null);

// 10b. Trust-boundary hygiene: control characters stripped, values bounded.
const dirty = extractOrder({
  id: 'cs_6',
  customer_details: { email: 'x@y.com' },
  metadata: { tier: 'solo', seats: '100000' },
  custom_fields: [{ key: 'practice', text: { value: 'Bad\u0007Practice\nName' } }],
});
assert.equal(dirty.seats, null, 'oversized seats treated as unmapped');
assert.ok(!/[\u0000-\u001f\u007f]/.test(dirty.practice), 'control characters stripped from practice');
assert.ok(dirty.practice.length <= 200, 'practice length bounded');

// --- buildEmail + formatDateAU ---

// 11. The delivery email carries the key, expiry (DD/MM/YYYY) and term.
const email = buildEmail({
  practice: 'Bay Dermatology',
  tier: 'practice',
  seats: 3,
  key,
  expiresAt: payload.expiresAt,
});
assert.match(email.subject, /Bay Dermatology/);
assert.ok(email.text.includes(key), 'text body contains the key');
assert.ok(email.html.includes(key), 'html body contains the key');
assert.ok(email.text.includes(formatDateAU(payload.expiresAt)), 'expiry date present');
assert.ok(/^[0-3]\d\/[01]\d\/\d{4}$/.test(formatDateAU(payload.expiresAt)), 'AU date format');

console.log('licence-fulfilment self-check passed (12 checks).');
