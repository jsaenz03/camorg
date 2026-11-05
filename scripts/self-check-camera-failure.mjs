// Self-check for the camera failure copy (lib/photo/camera-failure.ts).
//
// Run: node scripts/self-check-camera-failure.mjs
//
// Pins the failure states the capture dialog shows when the camera won't
// open: every realistic getUserMedia outcome names the actual problem — no
// camera, access denied, camera busy — with a fallback that repeats the raw
// message instead of blanking. The retry is restart-based, so the copy
// pairs with in-place recovery, not a page reload.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { cameraFailure } from '../lib/photo/camera-failure.ts';

// ---- no camera device found ----

assert.equal(cameraFailure({ name: 'NotSupportedError', message: 'No camera device found' }, 'granted').title, 'No camera available');

// ---- permission denied (mapped error or slow permission state) ----

assert.equal(
  cameraFailure({ name: 'PermissionDeniedError', message: 'Camera permission denied by user' }, 'prompt').title,
  'Camera access denied',
);
assert.equal(cameraFailure(null, 'denied').title, 'Camera access denied');

// ---- camera held by another app (plain Error from the mapper) ----

const busy = cameraFailure(
  { name: 'Error', message: 'Camera is already in use by another application' },
  'granted',
);
assert.equal(busy.title, 'Camera is in use');

// ---- unknown failures repeat the message instead of blanking ----

const odd = cameraFailure({ name: 'Error', message: 'Something specific went wrong' }, 'prompt');
assert.equal(odd.title, 'Camera problem');
assert.equal(odd.message, 'Something specific went wrong');

// ---- nothing at all still gets an actionable message ----

assert.ok(cameraFailure(null, 'prompt').message.length > 0);

console.log('camera-failure: no-camera, denied, busy and fallback copy pinned');
