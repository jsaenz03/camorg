// Self-check for the drag-to-link/unlink rules (lib/utils/photo-link.ts).
//
// Run: node scripts/self-check-photo-link.mjs
//
// Pins what a drop of one photo tile onto another does:
//  - self-drops, cross-patient drops and deleted photos are refused;
//  - the target's series wins, else the dragged photo's, else no name yet;
//  - only photos not already in the resolved series are updated;
//  - a dragged ⌘/Ctrl selection files every tile into the target's series
//    all-or-nothing (resolveMultiLink) — and when the selection's linkage
//    matches the target's series, it unlinks them all instead;
//  - a drop within the same series unlinks the dragged photo instead, and
//    resolveUnlinkScope dissolves a series that would be left with one member
//    (single photo or several leaving at once);
//  - a photo saved without a body part inherits the other's part when the
//    two are linked, whichever way the drop went (bilateral side included)
//    — resolveLinkInheritance / resolveLinkInheritancePair.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveLinkInheritance,
  resolveLinkInheritancePair,
  resolveMultiLink,
  resolvePhotoLink,
  resolveUnlinkScope,
} from '../lib/utils/photo-link.ts';

function photo(overrides) {
  return {
    id: 'photo-1',
    patientId: 'patient-1',
    bodyPart: 'face',
    laterality: null,
    subpart: null,
    pinX: null,
    pinY: null,
    pinSpace: null,
    pinView: null,
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

// ---- multi-link resolution (a dragged ⌘/Ctrl selection) ----

// All-or-nothing: one cross-patient photo refuses the whole drop, and no
// source may be soft-deleted. Multi-drag never unlinks, so there is no
// unlink variant to pin here.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a' }), photo({ id: 'b', patientId: 'patient-2' })],
    photo({ id: 'c' }),
  ),
  { ok: false, reason: 'cross-patient' },
);
assert.deepEqual(
  resolveMultiLink([photo({ id: 'a' }), photo({ id: 'b', isDeleted: true })], photo({ id: 'c' })),
  { ok: false, reason: 'deleted' },
);
assert.deepEqual(
  resolveMultiLink([photo({ id: 'a' })], photo({ id: 'c', isDeleted: true })),
  { ok: false, reason: 'deleted' },
);

// The target's series wins even when the sources share another one: every
// source moves in, and the target (already there) is not updated.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a', lesionGroup: 'Series A' }), photo({ id: 'b', lesionGroup: 'Series A' })],
    photo({ id: 'c', lesionGroup: 'Series B' }),
  ),
  { ok: true, action: 'link', seriesName: 'Series B', photoIds: ['a', 'b'] },
);

// No target series but the sources share one: the target joins theirs.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a', lesionGroup: 'Series A' }), photo({ id: 'b', lesionGroup: 'Series A' })],
    photo({ id: 'c' }),
  ),
  { ok: true, action: 'link', seriesName: 'Series A', photoIds: ['c'] },
);

// Mixed source series and no target name: the plan carries no name — the
// caller (link dialog) supplies one — and every photo including the target
// is updated.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a', lesionGroup: 'Series A' }), photo({ id: 'b', lesionGroup: 'Series B' })],
    photo({ id: 'c' }),
  ),
  { ok: true, action: 'link', seriesName: null, photoIds: ['c', 'a', 'b'] },
);

// Dropping a selection onto one of its own tiles is a normal drop — the
// duplicated photo appears once in the update list.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a' }), photo({ id: 'b', lesionGroup: 'Series B' })],
    photo({ id: 'b', lesionGroup: 'Series B' }),
  ),
  { ok: true, action: 'link', seriesName: 'Series B', photoIds: ['a'] },
);

// Photos already in the resolved series are skipped (the partial match is a
// link of the stragglers, never an unlink).
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a', lesionGroup: 'Series A' }), photo({ id: 'b' })],
    photo({ id: 'c', lesionGroup: 'Series A' }),
  ),
  { ok: true, action: 'link', seriesName: 'Series A', photoIds: ['b'] },
);

// The plural unlink: the selection dropped on a tile of its own series —
// linkage must match (every source in the target's series) to allow it.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a', lesionGroup: 'Series A' }), photo({ id: 'b', lesionGroup: 'Series A' })],
    photo({ id: 'c', lesionGroup: 'Series A' }),
  ),
  { ok: true, action: 'unlink', seriesName: 'Series A', photoIds: ['a', 'b'] },
);
// The same but dropped onto one of the selection's own tiles.
assert.deepEqual(
  resolveMultiLink(
    [photo({ id: 'a', lesionGroup: 'Series A' }), photo({ id: 'b', lesionGroup: 'Series A' })],
    photo({ id: 'b', lesionGroup: 'Series A' }),
  ),
  { ok: true, action: 'unlink', seriesName: 'Series A', photoIds: ['a', 'b'] },
);

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
assert.deepEqual(resolveUnlinkScope(['a', 'b'], ['a']), {
  photoIds: ['a', 'b'],
  dissolve: true,
});

// A lone "series" (data oddity) dissolves too: only the member itself clears.
assert.deepEqual(resolveUnlinkScope(['a'], ['a']), {
  photoIds: ['a'],
  dissolve: true,
});

// Three or more members: only the dragged photo leaves; the rest stay linked.
assert.deepEqual(resolveUnlinkScope(['a', 'b', 'c'], ['a']), {
  photoIds: ['a'],
  dissolve: false,
});

// Plural unlink: two of three leave — a single member would remain, so the
// series dissolves with them.
assert.deepEqual(resolveUnlinkScope(['a', 'b', 'c'], ['a', 'b']), {
  photoIds: ['a', 'b', 'c'],
  dissolve: true,
});

// Plural unlink with room to spare: only the leavers go.
assert.deepEqual(resolveUnlinkScope(['a', 'b', 'c', 'd'], ['a', 'b']), {
  photoIds: ['a', 'b'],
  dissolve: false,
});

// ---- link inheritance ----

// A photo saved without a body part takes the donor's whole location —
// part, side, subpart text and the pinpoint X.
assert.deepEqual(
  resolveLinkInheritance(
    photo({ bodyPart: null }),
    photo({ bodyPart: 'hand', laterality: 'left', subpart: 'knuckle', pinX: 0.4, pinY: 0.6, pinSpace: 'part', pinView: 'back' }),
  ),
  {
    bodyPart: 'hand', laterality: 'left', subpart: 'knuckle',
    pinX: 0.4, pinY: 0.6, pinSpace: 'part', pinView: 'back',
  },
);

// A central part inherits no side, and the X only travels when complete
// (x, y AND which diagram) — a half-specified mark is dropped, not guessed.
assert.deepEqual(
  resolveLinkInheritance(photo({ bodyPart: null }), photo({ bodyPart: 'face', subpart: 'cheek' })),
  {
    bodyPart: 'face', laterality: null, subpart: 'cheek',
    pinX: null, pinY: null, pinSpace: null, pinView: null,
  },
);
assert.deepEqual(
  resolveLinkInheritance(
    photo({ bodyPart: null }),
    photo({ bodyPart: 'face', pinX: 0.5, pinY: 0.5 }),
  ),
  {
    bodyPart: 'face', laterality: null, subpart: null,
    pinX: null, pinY: null, pinSpace: null, pinView: null,
  },
);

// One direction only: a photo that already has its part keeps its own
// location, and the photo it lands on never takes the dragged one's.
assert.equal(
  resolveLinkInheritance(
    photo({ bodyPart: 'hand', laterality: 'left' }),
    photo({ bodyPart: null }),
  ),
  null,
);
assert.equal(
  resolveLinkInheritance(
    photo({ bodyPart: 'face' }),
    photo({ bodyPart: 'hand', laterality: 'right', subpart: 'knuckle' }),
  ),
  null,
);

// Nothing to inherit: both blank stays blank.
assert.equal(resolveLinkInheritance(photo({ bodyPart: null }), photo({ bodyPart: null })), null);

// The dialog links in both drag orders: whichever photo lacks the body
// part takes the other's whole location, so the drop direction never
// matters.
assert.deepEqual(
  resolveLinkInheritancePair(
    photo({ bodyPart: null }),
    photo({ bodyPart: 'hand', laterality: 'left', subpart: 'knuckle' }),
  ),
  {
    source: {
      bodyPart: 'hand', laterality: 'left', subpart: 'knuckle',
      pinX: null, pinY: null, pinSpace: null, pinView: null,
    },
    target: null,
  },
);
assert.deepEqual(
  resolveLinkInheritancePair(
    photo({ bodyPart: 'hand', laterality: 'left', subpart: 'knuckle' }),
    photo({ bodyPart: null }),
  ),
  {
    source: null,
    target: {
      bodyPart: 'hand', laterality: 'left', subpart: 'knuckle',
      pinX: null, pinY: null, pinSpace: null, pinView: null,
    },
  },
);

// Both unspecified, or both already located: nothing to fill in either way.
assert.deepEqual(
  resolveLinkInheritancePair(photo({ bodyPart: null }), photo({ bodyPart: null })),
  { source: null, target: null },
);
assert.deepEqual(
  resolveLinkInheritancePair(
    photo({ bodyPart: 'face' }),
    photo({ bodyPart: 'hand', laterality: 'right' }),
  ),
  { source: null, target: null },
);

console.log('photo-link self-check passed');

// ---- drift pin: the local bilateral set mirrors types/body-part.ts ----
// photo-link.ts keeps its own BILATERAL_PARTS (the module must stay
// import-free so this check runs on plain Node — a TS enum is not
// type-strippable). If the two sets ever diverge, inheritance would drop
// or invent laterality for real regions, so pin them together here.

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const bodyPartSrc = read('../types/body-part.ts');
const linkSrc = read('../lib/utils/photo-link.ts');

const enumBody = bodyPartSrc.match(/export enum BodyPart\s*\{([^}]*)\}/)?.[1] ?? '';
const enumEntries = new Map(
  [...enumBody.matchAll(/(\w+)\s*=\s*'([\w]+)'/g)].map((m) => [m[1], m[2]]),
);
const canonical = (bodyPartSrc.match(/BILATERAL_BODY_PARTS[^=]*=\s*new Set\(\[([^\]]*)\]/)?.[1] ?? '')
  .match(/BodyPart\.(\w+)/g)
  ?.map((ref) => enumEntries.get(ref.slice('BodyPart.'.length))) ?? [];
assert.ok(canonical.length > 0, 'could not read BILATERAL_BODY_PARTS from types/body-part.ts');

const local = (linkSrc.match(/BILATERAL_PARTS\s*=\s*new Set\(\[([^\]]*)\]/)?.[1] ?? '')
  .match(/'[^']+'/g)
  ?.map((s) => s.slice(1, -1)) ?? [];
assert.deepEqual(
  [...local].sort(),
  [...canonical].sort(),
  'BILATERAL_PARTS in photo-link.ts drifted from BILATERAL_BODY_PARTS in types/body-part.ts',
);
