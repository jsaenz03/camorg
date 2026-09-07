#!/usr/bin/env node
/**
 * Self-check for the bulk photo import helpers — runs the REAL
 * lib/photo/import-utils.ts (Node's type stripping loads the .ts directly,
 * so no mirror drift is possible) and asserts the trust-boundary rules:
 * extension allow-list, 20MB cap, future/invalid date clamps, and
 * skip-if-already-imported partitioning.
 *
 * Run: node scripts/self-check-photo-import.mjs
 */

import assert from 'node:assert/strict';
import {
  IMPORT_MAX_BYTES,
  baseName,
  captureDateFor,
  clampCaptureDate,
  classifyPickedFile,
  mimeTypeForFileName,
  partitionByExisting,
} from '../lib/photo/import-utils.ts';

const NOW = Date.parse('2026-09-07T12:00:00Z');

// 1. Extension allow-list is case-insensitive and maps to schema mime types.
assert.equal(mimeTypeForFileName('IMG_0001.JPG'), 'image/jpeg');
assert.equal(mimeTypeForFileName('photo.Jpeg'), 'image/jpeg');
assert.equal(mimeTypeForFileName('a.png'), 'image/png');
assert.equal(mimeTypeForFileName('b.webp'), 'image/webp');
assert.equal(mimeTypeForFileName('c.HEIC'), 'image/heic');
assert.equal(mimeTypeForFileName('c.heif'), 'image/heic');
// Anything else is rejected before it can reach the create schema.
assert.equal(mimeTypeForFileName('notes.txt'), null);
assert.equal(mimeTypeForFileName('script.svg'), null);
assert.equal(mimeTypeForFileName('noext'), null);
assert.equal(mimeTypeForFileName('trailing.'), null);

// 2. Base names survive both path separators.
assert.equal(baseName('/Users/nurse/IMG 1.jpg'), 'IMG 1.jpg');
assert.equal(baseName('C:\\Users\\nurse\\leg.png'), 'leg.png');
assert.equal(baseName('flat.jpg'), 'flat.jpg');

// 3. Capture dates never land in the future; missing stamps become now.
assert.equal(clampCaptureDate(NOW + 86_400_000, NOW), NOW, 'future clamps to now');
assert.equal(clampCaptureDate(0, NOW), NOW, 'epoch-missing clamps to now');
assert.equal(clampCaptureDate(-5, NOW), NOW, 'negative clamps to now');
assert.equal(clampCaptureDate(Number.NaN, NOW), NOW, 'NaN clamps to now');
assert.equal(clampCaptureDate(NOW - 1000, NOW), NOW - 1000, 'past stamp is kept');

// 4. Dedupe partitions by original file name, preserving order.
const { fresh, skipped } = partitionByExisting(
  ['a.jpg', 'b.jpg', 'c.jpg'],
  new Set(['b.jpg', 'zz.jpg']),
);
assert.deepEqual(fresh, ['a.jpg', 'c.jpg']);
assert.deepEqual(skipped, ['b.jpg']);
assert.deepEqual(
  partitionByExisting(['a.jpg'], new Set()).fresh,
  ['a.jpg'],
  'empty history imports everything',
);

// 5. Pick classification: unsupported extensions drop out, oversized files
//    are flagged (excluded at import), the limit itself passes.
assert.equal(classifyPickedFile('/tmp/evil.exe', { size: 10, mtimeMs: NOW }), null);
const big = classifyPickedFile('/tmp/big.JPG', { size: IMPORT_MAX_BYTES + 1, mtimeMs: NOW });
assert.ok(big && big.tooLarge === true && big.mimeType === 'image/jpeg');
assert.equal(big.name, 'big.JPG');
const atLimit = classifyPickedFile('/tmp/ok.jpg', { size: IMPORT_MAX_BYTES, mtimeMs: NOW });
assert.ok(atLimit && atLimit.tooLarge === false);

// 6. Date mode: 'file' uses the clamped stamp; 'custom' overrides for all;
//    a custom future date still clamps.
const cand = classifyPickedFile('/tmp/x.jpg', { size: 5, mtimeMs: NOW - 50_000 });
const opts = { patientId: 'p', bodyPart: 'face' };
assert.equal(captureDateFor(cand, { dateMode: 'file', customDateMs: null, ...opts }, NOW), NOW - 50_000);
assert.equal(
  captureDateFor(cand, { dateMode: 'custom', customDateMs: NOW - 999, ...opts }, NOW),
  NOW - 999,
  'custom date wins over file stamp',
);
assert.equal(
  captureDateFor(cand, { dateMode: 'custom', customDateMs: NOW + 999, ...opts }, NOW),
  NOW,
  'future custom date clamps',
);

console.log('photo-import self-check passed (6 rule groups).');
