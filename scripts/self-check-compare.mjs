/**
 * Self-check for the comparison engine's pure logic (lib/photo-compare.ts):
 * the seed picks for the two panes, the anchored/free transform math, and
 * the part/lesion-series cascade filters (each dropdown pruned by the other).
 *
 * Run: node scripts/self-check-compare.mjs
 *
 * Fails loudly (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import {
  applyPan,
  applyZoom,
  comparePartOptions,
  compareSeriesOptions,
  defaultComparePicks,
  DEFAULT_COMPARE_TRANSFORM,
  filterComparePool,
  MAX_COMPARE_ZOOM,
  panTransform,
  resolveCompareFilters,
  zoomTransform,
} from '../lib/photo-compare.ts';

// ---------------------------------------------------------------------------
// Seed picks
// ---------------------------------------------------------------------------

// Newest-first pools, as the photo service returns them.
const capture = (id, capturedAt) => ({ id, capturedAt });
const poolA = [
  capture('a1', '2026-09-01'),
  capture('a2', '2026-08-20'),
  capture('a3', '2026-07-11'),
];
const poolB = [capture('b1', '2026-08-30'), capture('b2', '2026-08-02')];

// Cross-patient: each side starts on its own newest photo.
assert.deepEqual(defaultComparePicks(poolA, poolB), { leftId: 'a1', rightId: 'b1' });

// Same patient twice (before/after): the right pane falls back to the next
// newest — never the identical image.
assert.deepEqual(defaultComparePicks(poolA, poolA), { leftId: 'a1', rightId: 'a2' });

// Comparison side has no photos → null pick, left unaffected.
assert.deepEqual(defaultComparePicks(poolA, []), { leftId: 'a1', rightId: null });

// Reference side empty → left null; comparison still picks its newest.
assert.deepEqual(defaultComparePicks([], poolB), { leftId: null, rightId: 'b1' });

// One photo overall: left takes it, the right finds nothing different.
const only = [capture('a1', '2026-09-01')];
assert.deepEqual(defaultComparePicks(only, only), { leftId: 'a1', rightId: null });

// Both pools empty → both null, no crash.
assert.deepEqual(defaultComparePicks([], []), { leftId: null, rightId: null });

// ---------------------------------------------------------------------------
// Anchor transforms
// ---------------------------------------------------------------------------

const tf = (zoom, x, y) => ({ zoom, offset: { x, y } });
const start = { left: tf(2, 10, -20), right: tf(1.5, 30, 40) };

// Anchored pan: both panes shift by the same delta, each keeping its own
// zoom (re-anchoring after free framing must preserve that framing).
assert.deepEqual(applyPan(start, 5, -7, true, 'left'), {
  left: tf(2, 15, -27),
  right: tf(1.5, 35, 33),
});

// Free pan: only the side under the pointer moves.
assert.deepEqual(applyPan(start, 5, -7, false, 'right'), {
  left: tf(2, 10, -20),
  right: tf(1.5, 35, 33),
});

// Anchored zoom: each pane multiplies from its own zoom (ratio preserved),
// offsets untouched (zoom is around the image centre).
assert.deepEqual(applyZoom(start, 2, true, 'right'), {
  left: tf(4, 10, -20),
  right: tf(3, 30, 40),
});

// Free zoom: only the target side zooms.
assert.deepEqual(applyZoom(start, 2, false, 'left'), {
  left: tf(4, 10, -20),
  right: tf(1.5, 30, 40),
});

// Zoom clamps to the [1, 8] window on either end.
assert.equal(zoomTransform(tf(7, 0, 0), 2).zoom, MAX_COMPARE_ZOOM);
assert.equal(zoomTransform(tf(1, 0, 0), 0.5).zoom, 1);
assert.deepEqual(applyZoom({ left: tf(8, 0, 0), right: tf(8, 0, 0) }, 2, true, 'left'), {
  left: tf(8, 0, 0),
  right: tf(8, 0, 0),
});

// Pan never changes zoom; zoom never changes offset.
assert.deepEqual(panTransform(tf(3, 1, 2), 10, 10), tf(3, 11, 12));
assert.deepEqual(zoomTransform(tf(3, 1, 2), 2), tf(6, 1, 2));

// Default viewport is fit-and-centred on both panes.
assert.deepEqual(DEFAULT_COMPARE_TRANSFORM, { zoom: 1, offset: { x: 0, y: 0 } });

// ---------------------------------------------------------------------------
// Part / series cascade filters
// ---------------------------------------------------------------------------
// A pool mixing linked chains and loose photos, as the photo service returns.
const ph = (id, bodyPart, lesionGroup, capturedAt) => ({ id, bodyPart, lesionGroup, capturedAt });
const pool = [
  ph('a1', 'face', 'Face mole', '2026-09-01'),
  ph('a2', 'face', 'Face mole', '2026-08-01'),
  ph('a3', 'face', null, '2026-07-01'),          // loose face photo
  ph('a4', 'hand', 'Palm chain', '2026-06-01'),
  ph('a5', 'hand', null, '2026-05-01'),
];

// With no series chosen, every part with photos is offered.
assert.deepEqual(comparePartOptions(pool, 'all').sort(), ['face', 'hand']);

// Picking a series prunes the part choices to the parts that series covers.
assert.deepEqual(comparePartOptions(pool, 'Face mole'), ['face']);
assert.deepEqual(comparePartOptions(pool, 'Palm chain'), ['hand']);

// Series choices: only linked photos contribute, pruned by the part filter.
assert.deepEqual(compareSeriesOptions(pool, 'all'), ['Face mole', 'Palm chain']);
assert.deepEqual(compareSeriesOptions(pool, 'face'), ['Face mole']);
assert.deepEqual(compareSeriesOptions(pool, 'hand'), ['Palm chain']);
assert.deepEqual(compareSeriesOptions([ph('x', 'face', null, '2026-01-01')], 'all'), []);

// The pool filter applies both at once; 'all' never excludes anything.
assert.deepEqual(
  filterComparePool(pool, 'face', 'Face mole').map((p) => p.id),
  ['a1', 'a2'],
);
assert.deepEqual(
  filterComparePool(pool, 'all', 'all').map((p) => p.id),
  ['a1', 'a2', 'a3', 'a4', 'a5'],
);
assert.deepEqual(filterComparePool(pool, 'hand', 'Face mole'), []);
assert.deepEqual(filterComparePool(pool, 'face', 'all').map((p) => p.id), ['a1', 'a2', 'a3']);

// Filter resolution: filters the pool can't support relax to 'all'; ones it
// can support survive (a patient switch keeps a still-valid part choice).
assert.deepEqual(resolveCompareFilters(pool, 'face', 'Face mole'), { part: 'face', series: 'Face mole' });
assert.deepEqual(resolveCompareFilters(pool, 'chest', 'Face mole'), { part: 'all', series: 'Face mole' });
assert.deepEqual(resolveCompareFilters(pool, 'face', 'Gone series'), { part: 'face', series: 'all' });
assert.deepEqual(resolveCompareFilters([], 'face', 'Face mole'), { part: 'all', series: 'all' });

console.log('compare engine self-check passed');
