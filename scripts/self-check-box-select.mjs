// Self-check for the box (rubber-band) select geometry (lib/utils/box-select.ts).
//
// Run: node scripts/self-check-box-select.mjs
//
// Pins the maths PhotoBento's Ctrl-drag band runs every pointermove:
//  - the band rect is positive in both drag directions (up-left included);
//  - a tile counts as boxed when the band overlaps a pixel of it — touching
//    edges alone share no area and miss;
//  - the per-move delta only announces changes against the last announced
//    in-band set (no re-toggling on every move);
//  - tiles the band swept back out are returned to the pre-band selection.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { marqueeDelta, marqueeRect, rectsIntersect } from '../lib/utils/box-select.ts';

// ---- the band rect is positive for a backwards drag too ----

{
  // down-right
  assert.deepEqual(marqueeRect(100, 100, 200, 150), {
    left: 100,
    top: 100,
    width: 100,
    height: 50,
  });
  // up-left
  assert.deepEqual(marqueeRect(200, 150, 100, 100), {
    left: 100,
    top: 100,
    width: 100,
    height: 50,
  });
}

// ---- grazing a corner hits; missing by one pixel does not ----

{
  const a = { left: 0, top: 0, width: 10, height: 10 };
  // one pixel of overlap hits
  assert.equal(rectsIntersect(a, { left: 9, top: 9, width: 10, height: 10 }), true);
  assert.equal(rectsIntersect(a, { left: -9, top: -9, width: 10, height: 10 }), true);
  // merely-touching edges share no area — miss
  assert.equal(rectsIntersect(a, { left: 10, top: 10, width: 10, height: 10 }), false);
  assert.equal(rectsIntersect(a, { left: 11, top: 11, width: 10, height: 10 }), false);
  assert.equal(rectsIntersect(a, { left: -10, top: -10, width: 10, height: 10 }), false);
  assert.equal(rectsIntersect(a, { left: -11, top: -11, width: 10, height: 10 }), false);
  // a band entirely inside still hits
  assert.equal(rectsIntersect(a, { left: 3, top: 3, width: 2, height: 2 }), true);
  assert.equal(rectsIntersect(a, a), true);
}

// ---- the delta announces changes only: first move gains, later moves keep ----

{
  const announced = new Set();
  let { gained, lost } = marqueeDelta({ inBandIds: ['a', 'b'], announced });
  assert.deepEqual(gained, ['a', 'b']);
  assert.deepEqual(lost, []);
  for (const id of gained) announced.add(id);

  // a station-holding band (same tiles) announces nothing — no re-toggles
  ({ gained, lost } = marqueeDelta({ inBandIds: ['a', 'b'], announced }));
  assert.deepEqual(gained, []);
  assert.deepEqual(lost, []);

  // the band sweeps out of 'b': announce it lost, callers restore the
  // pre-band selection for their own added set
  ({ gained, lost } = marqueeDelta({ inBandIds: ['a'], announced }));
  assert.deepEqual(gained, []);
  assert.deepEqual(lost, ['b']);
}

console.log('box-select: band rect, intersection and per-move delta pinned');
