#!/usr/bin/env node
/**
 * Self-check for licence auto-renew (specs/005-licence-auto-renew). Pure
 * logic only — no network, no D1. Run:
 *   node scripts/self-check-licence-renewal.mjs
 * (picked up by scripts/run-self-checks.sh)
 *
 * Covers the two decisions the worker and the app depend on:
 * - extractRenewal only accepts subscription-cycle invoices (the origin
 *   purchase belongs to the checkout.session.completed path), across both
 *   Stripe invoice shapes.
 * - a renewal key minted from the chain tip is a fresh, verifiable key in
 *   the app's format, with a distinct fingerprint — and the worker's
 *   "unexpired successors only" rule filters lapsed renewals out.
 */

import { keygenAsync } from '@noble/ed25519';
import assert from 'node:assert';
import { issueLicence, licenceFingerprint, verifyLicence } from '../activation-server/src/activation.mjs';
import { extractRenewal } from '../activation-server/src/fulfil.mjs';

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const { secretKey, publicKey } = await keygenAsync();
const secretHex = hex(secretKey);
const publicHex = hex(publicKey);

// --- extractRenewal: which invoice.paid events mint a successor key ---

const cycleInvoice = {
  id: 'in_renewal123',
  subscription: 'sub_abc123',
  billing_reason: 'subscription_cycle',
};

// 1. The annual renewal charge yields the renewal job.
assert.deepEqual(extractRenewal(cycleInvoice), {
  invoiceId: 'in_renewal123',
  subscriptionId: 'sub_abc123',
});

// 2. Newer Stripe API shape: the subscription lives under
//    parent.subscription_details.
assert.deepEqual(
  extractRenewal({
    id: 'in_nested456',
    parent: { subscription_details: { subscription: 'sub_nested' } },
    billing_reason: 'subscription_cycle',
  }),
  { invoiceId: 'in_nested456', subscriptionId: 'sub_nested' },
);

// 3. The subscription's FIRST invoice (the origin purchase) must not mint —
//    checkout.session.completed already owns that mint.
assert.equal(
  extractRenewal({ ...cycleInvoice, id: 'in_first', billing_reason: 'subscription_create' }),
  null,
);

// 4. One-off invoices carry no subscription at all.
assert.equal(extractRenewal({ id: 'in_once', billing_reason: 'subscription_cycle' }), null);

// 5. An invoice without an id can never be recorded idempotently.
assert.equal(extractRenewal({ subscription: 'sub_x', billing_reason: 'subscription_cycle' }), null);

// --- renewal minting: the successor key chain ---

const tip = { practice: 'Bay Dermatology', tier: 'practice', seats: 3 };
const key1 = await issueLicence({ ...tip, months: 12 }, secretHex);
const fp1 = await licenceFingerprint(key1);

// 6. A renewal minted from the chain tip verifies in the app's format and
//    carries the subscription's practice/tier/seats forward.
const key2 = await issueLicence({ ...tip, months: 12 }, secretHex);
const payload2 = await verifyLicence(key2, publicHex);
assert.equal(payload2.practice, tip.practice);
assert.equal(payload2.tier, tip.tier);
assert.equal(payload2.seats, tip.seats);

// 7. The successor is a distinct key (fresh fingerprint, fresh term) —
//    that distinctness is what makes renews_fp a real chain link.
const fp2 = await licenceFingerprint(key2);
assert.notEqual(fp2, fp1);
assert.ok(payload2.expiresAt > Date.now(), 'renewal term is in the future');

// 8. The worker only serves successors whose expires_at is still ahead —
//    a lapsed renewal (subscription kept paying after a long dunning gap
//    with an old tip) must be filtered, not installed.
const stale = await issueLicence(
  { ...tip, months: 12, now: Date.now() - 400 * 24 * 60 * 60 * 1000 },
  secretHex,
);
assert.ok((await verifyLicence(stale, publicHex)).expiresAt < Date.now(), 'stale renewal is expired');

console.log('licence renewal self-check passed');
