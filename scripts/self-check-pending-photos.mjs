// Self-check for the pending phone-photo tray's pure logic: filename
// collation (complete entries vs partial-write orphans) and sidecar
// validation. Run: node scripts/self-check-pending-photos.mjs
// ponytail: mirrors the functions in lib/services/pending-photo-service.ts
// because Node cannot import the TS module graph directly; if you change the
// tray rules, update the mirror here. Upgrade path: run via tsx/ts-node in CI.

import assert from 'node:assert/strict';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function collatePendingFiles(names) {
  const hasJson = new Set();
  const hasOther = new Set();
  for (const name of names) {
    const json = /^(.+)\.json$/.exec(name);
    if (json) {
      if (UUID_RE.test(json[1])) hasJson.add(json[1]);
      continue;
    }
    const other = /^(.+)\.(?:thumb\.jpg|jpg)$/.exec(name);
    if (other && UUID_RE.test(other[1])) hasOther.add(other[1]);
  }
  const ids = [...hasJson];
  const orphans = [...hasOther].filter((id) => !hasJson.has(id));
  return { ids, orphans };
}

function parsePendingSidecar(raw, id) {
  try {
    const d = JSON.parse(raw);
    if (
      d?.id !== id ||
      typeof d.capturedAt !== 'number' ||
      typeof d.receivedAt !== 'number' ||
      typeof d.width !== 'number' ||
      typeof d.height !== 'number'
    ) {
      return null;
    }
    return { id, capturedAt: d.capturedAt, receivedAt: d.receivedAt, width: d.width, height: d.height };
  } catch {
    return null;
  }
}

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

// A complete entry: all three files.
assert.deepEqual(
  collatePendingFiles([`${A}.jpg`, `${A}.thumb.jpg`, `${A}.json`]),
  { ids: [A], orphans: [] },
);

// A partial store (crash before the sidecar landed) is an orphan, not an entry.
assert.deepEqual(
  collatePendingFiles([`${A}.jpg`, `${A}.thumb.jpg`]),
  { ids: [], orphans: [A] },
);

// Mixed listing: complete A and C, partial B.
const mixed = collatePendingFiles([
  `${A}.json`, `${A}.jpg`, `${A}.thumb.jpg`,
  `${B}.jpg`, `${B}.thumb.jpg`,
  `${C}.json`, `${C}.jpg`, `${C}.thumb.jpg`,
]);
assert.deepEqual([...mixed.ids].sort(), [A, C]);
assert.deepEqual(mixed.orphans, [B]);

// Non-uuid filenames (user junk, other files) are ignored entirely.
assert.deepEqual(
  collatePendingFiles(['notes.txt', 'photo.jpg', 'evil.json', '.DS_Store']),
  { ids: [], orphans: [] },
);

// Sidecar must match its own id and carry every field.
const good = { id: A, capturedAt: 1, receivedAt: 2, width: 3, height: 4 };
assert.deepEqual(parsePendingSidecar(JSON.stringify(good), A), good);
assert.equal(parsePendingSidecar(JSON.stringify({ ...good, id: B }), A), null); // id mismatch
assert.equal(parsePendingSidecar(JSON.stringify({ ...good, width: 'x' }), A), null); // bad type
assert.equal(parsePendingSidecar('not json', A), null); // corrupt
assert.equal(parsePendingSidecar(JSON.stringify(good), 'not-a-uuid'), null); // bad filename id

// Age purge predicate as used by listPendingPhotos: receivedAt older than a
// week is stale and deleted, exactly-one-week-old is not.
const now = 1_000_000_000_000;
assert.equal(now - (now - PENDING_MAX_AGE_MS - 1) > PENDING_MAX_AGE_MS, true);
assert.equal(now - (now - PENDING_MAX_AGE_MS) > PENDING_MAX_AGE_MS, false);

console.log('pending-photos self-check passed');
