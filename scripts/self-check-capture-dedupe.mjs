/**
 * Self-check for the phone-capture dedupe (lib/utils/capture-dedupe.ts).
 *
 * Run: node scripts/self-check-capture-dedupe.mjs
 *
 * Pins the contract the photo listeners rely on: one send = one processed
 * delivery, even when the phone's network stack silently resends the POST —
 * the exact mechanism that staged one capture twice (one carrying the review
 * follow-up link, one empty). Fails loudly (non-zero exit) if any invariant
 * breaks.
 */

import assert from 'node:assert/strict';
import { claimRemoteCapture } from '../lib/utils/capture-dedupe.ts';

const TTL = 10 * 60 * 1000;
// Fixed "now" so every case is deterministic.
const t0 = 1_788_569_111_042; // the incident capture's arrival time

// First delivery of a capture processes; the resend 88ms later does not.
assert.equal(claimRemoteCapture('cap-a', t0), true, 'first delivery must process');
assert.equal(claimRemoteCapture('cap-a', t0 + 88), false, 'resent delivery must drop');

// A different capture still processes (a burst of snaps is not a duplicate).
assert.equal(claimRemoteCapture('cap-b', t0 + 100), true, 'next snap must process');

// A delivery with no id (old phone page) has no dedupe key — always processes.
assert.equal(claimRemoteCapture(null, t0 + 120), true, 'null id must process');
assert.equal(claimRemoteCapture(undefined, t0 + 120), true, 'undefined id must process');
assert.equal(claimRemoteCapture('', t0 + 120), true, 'empty id must process');

// Past the TTL the id expires: a later delivery with that id processes again
// (a genuinely new capture may reuse an id only across a long gap, but the
// memory must not grow unbounded either).
assert.equal(
  claimRemoteCapture('cap-a', t0 + TTL + 1),
  true,
  'id past the TTL must process again',
);

// The map stays bounded: the oldest entry is evicted past 200, so a long
// session keeps claiming new captures rather than silently dropping them.
assert.equal(claimRemoteCapture('first', t0 + 500), true, 'pre-burst capture must process');
for (let i = 0; i < 200; i += 1) {
  assert.equal(claimRemoteCapture(`burst-${i}`, t0 + 1000 + i), true, 'burst captures must process');
}
assert.equal(claimRemoteCapture('first', t0 + 2000), true, 'evicted oldest must process again');
assert.equal(claimRemoteCapture('burst-199', t0 + 2000), false, 'recent capture must still dedupe');

console.log('capture-dedupe self-check passed');
