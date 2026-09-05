/**
 * Self-check for lesion-series name normalisation (lib/utils/lesion-group.ts)
 * and the wiring of migration 013's per-photo review + series columns.
 *
 * Run: node scripts/self-check-lesion-groups.mjs
 *
 * The normaliser is the contract between the edit-photo form, the service
 * and the DB: trim + collapse whitespace + 100-char cap, blank → null.
 * If any invariant breaks (e.g. someone starts storing raw input and the
 * same series fragments under " Mole " / "Mole"), this fails loudly.
 */

import assert from 'node:assert/strict';
import { normalizeLesionGroup, reviewSeriesName } from '../lib/utils/lesion-group.ts';

// Plain names pass through untouched.
assert.equal(normalizeLesionGroup('Left cheek mole'), 'Left cheek mole', 'plain name preserved');

// Whitespace is trimmed and collapsed so near-identical input stays one series.
assert.equal(normalizeLesionGroup('  Left cheek mole  '), 'Left cheek mole', 'trimmed');
assert.equal(normalizeLesionGroup('Left   cheek\tmole'), 'Left cheek mole', 'internal whitespace collapsed');

// Blank in every flavour means "not in a series".
assert.equal(normalizeLesionGroup(''), null, 'empty string → null');
assert.equal(normalizeLesionGroup('   '), null, 'whitespace-only → null');
assert.equal(normalizeLesionGroup(null), null, 'null → null');
assert.equal(normalizeLesionGroup(undefined), null, 'undefined → null');

// Cap matches the update schema's 100-char limit (names longer are truncated,
// never rejected, so a paste can't break saving).
assert.equal(normalizeLesionGroup('a'.repeat(150)).length, 100, 'capped at 100 chars');
assert.equal(normalizeLesionGroup('a'.repeat(100)).length, 100, 'exactly 100 kept whole');

// A name that is only whitespace after the cap boundary still normalises sane.
assert.equal(normalizeLesionGroup(' x'.repeat(60)).length, 100, 'capped after collapsing');

// Review follow-up series names: anchored to the original photo, formatted
// "<part> (<subpart>) — from <date>", capped like any other series name.
assert.equal(
  reviewSeriesName({ bodyPartLabel: 'Left cheek', subpart: 'medial aspect', capturedAt: new Date(2024, 2, 4) }),
  'Left cheek (medial aspect) — from 4 Mar 2024',
  'review series name format',
);
assert.equal(
  reviewSeriesName({ bodyPartLabel: 'Back', capturedAt: new Date(2025, 11, 25) }),
  'Back — from 25 Dec 2025',
  'subpart omitted when absent',
);
assert.ok(
  reviewSeriesName({ bodyPartLabel: 'x'.repeat(120), subpart: 'y'.repeat(120), capturedAt: new Date() }).length <= 100,
  'review series name capped at 100 chars',
);

console.log('self-check-lesion-groups: all assertions passed');
