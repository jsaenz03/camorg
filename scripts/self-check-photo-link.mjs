// Self-check for the drag-to-link/unlink rules (lib/utils/photo-link.ts).
//
// Run: node scripts/self-check-photo-link.mjs
//
// Pins what a drop of one photo tile onto another does:
//  - self-drops, cross-patient drops and deleted photos are refused;
//  - the target's series wins, else the dragged photo's, else no name yet;
//  - only photos not already in the resolved series are updated;
//  - a drop within the same series unlinks the dragged photo instead, and
//    resolveUnlinkScope dissolves a series that would be left with one member.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { resolvePhotoLink, resolveUnlinkScope } from '../lib/utils/photo-link.ts';

function photo(overrides) {
  return {
    id: 'photo-1',
    patientId: 'patient-1',
    lesionGroup: null,
    isDeleted: false,
    ...overrides,
  };
}

// ---- refusals ----

// A drop on the photo itself is a no-op, never a link request.
assert.deepEqual(resolvePhotoLink(photo({ id: 'a' }), photo({ id: 'a' })), {
  ok: false,
  reason: 'same-photo',
});

// Different patients never link — the save path refuses it too.
assert.deepEqual(
  resolvePhotoLink(photo({ id: 'a' }), photo({ id: 'b', patientId: 'patient-2' })),
  { ok: false, reason: 'cross-patient' },
);
assert.deepEqual(
  resolvePhotoLink(photo({ id: 'a', patientId: 'patient-2' }), photo({ id: 'b' })),
  { ok: false, reason: 'cross-patient' },
);

// Soft-deleted photos stay out of series management.
assert.deepEqual(
  resolvePhotoLink(photo({ id: 'a', isDeleted: true }), photo({ id: 'b' })),
  { ok: false, reason: 'deleted' },
);
assert.deepEqual(
  resolvePhotoLink(photo({ id: 'a' }), photo({ id: 'b', isDeleted: true })),
  { ok: false, reason: 'deleted' },
);

// ---- link resolution ----

// The target's series wins: dropping A onto B files A into B's series, and
// only A needs the update (B is already there).
assert.deepEqual(
  resolvePhotoLink(photo({ id: 'a' }), photo({ id: 'b', lesionGroup: 'Left cheek mole' })),
  { ok: true, action: 'link', seriesName: 'Left cheek mole', photoIds: ['a'] },
);

// Only the dragged photo has a series: the target joins it instead.
assert.deepEqual(
  resolvePhotoLink(photo({ id: 'a', lesionGroup: 'Left cheek mole' }), photo({ id: 'b' })),
  { ok: true, action: 'link', seriesName: 'Left cheek mole', photoIds: ['b'] },
);

// Two different series: the dragged photo moves into the target's series;
// its old series' other members are untouched (only these two ids returned).
assert.deepEqual(
  resolvePhotoLink(
    photo({ id: 'a', lesionGroup: 'Series A' }),
    photo({ id: 'b', lesionGroup: 'Series B' }),
  ),
  { ok: true, action: 'link', seriesName: 'Series B', photoIds: ['a'] },
);

// Neither is in a series: the plan carries no name — the caller (link
// dialog) supplies one — and both photos are updated.
assert.deepEqual(resolvePhotoLink(photo({ id: 'a' }), photo({ id: 'b' })), {
  ok: true,
  action: 'link',
  seriesName: null,
  photoIds: ['a', 'b'],
});

// ---- unlink resolution ----

// Dropping a photo onto another tile from its own series unlinks the dragged
// photo — never the whole series sight-unseen.
assert.deepEqual(
  resolvePhotoLink(
    photo({ id: 'a', lesionGroup: 'Series A' }),
    photo({ id: 'b', lesionGroup: 'Series A' }),
  ),
  { ok: true, action: 'unlink', seriesName: 'Series A', photoIds: ['a'] },
);

// resolveUnlinkScope: with one other member left the series would be a name
// with nothing linked to it — the drop dissolves it (both photos cleared).
assert.deepEqual(resolveUnlinkScope(['a', 'b'], 'a'), {
  photoIds: ['a', 'b'],
  dissolve: true,
});

// A lone "series" (data oddity) dissolves too: only the member itself clears.
assert.deepEqual(resolveUnlinkScope(['a'], 'a'), {
  photoIds: ['a'],
  dissolve: true,
});

// Three or more members: only the dragged photo leaves; the rest stay linked.
assert.deepEqual(resolveUnlinkScope(['a', 'b', 'c'], 'a'), {
  photoIds: ['a'],
  dissolve: false,
});

console.log('photo-link self-check passed');
