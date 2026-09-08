// Self-check for the capture prefill rules (lib/utils/capture-prefill.ts).
//
// Run: node scripts/self-check-capture-prefill.mjs
//
// Pins the two invariants the capture flow promises:
//  1. A capture opened inside a patient file ALWAYS addresses the photo to
//     that patient — any entry point, whatever the photo itself carries.
//     The photo's own address (phone patient tag, staged follow-up) is kept
//     only when no patient file is open (dashboard).
//  2. A staged follow-up's location prefill survives only inside its own
//     patient's file; from another patient's file the location is blank.
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import {
  mergeCaptureOptions,
  resolveCapturePrefill,
} from '../lib/utils/capture-prefill.ts';

const LOCATION = { bodyPart: 'arm', laterality: 'left', subpart: 'inner elbow' };
const OTHER_LOCATION = { bodyPart: 'back', subpart: 'lower' };

// ---- mergeCaptureOptions: the ambient patient file fills a context-free open ----

const ambient = {
  patientId: 'p1',
  patientName: 'Ada Lovelace',
  patientDob: '10/12/1815',
  onSaved: () => {},
};

// A context-free open (the phone-photo toast's Review action) over a patient
// file inherits their address — the off/on bug: first open prefilled nothing.
assert.deepEqual(
  mergeCaptureOptions(ambient, {}),
  ambient,
  'context-free open must inherit the ambient patient',
);

// ...and keeps any fields the caller did pass.
assert.deepEqual(
  mergeCaptureOptions(ambient, { linkPhotoId: 'photo-9' }),
  { ...ambient, linkPhotoId: 'photo-9' },
  'ambient must not drop the caller’s own options',
);

// An explicitly addressed open (the patient page's Capture button) is
// untouched by ambient — no cross-patient smear.
const explicit = { patientId: 'p2', patientName: 'Grace Hopper' };
assert.equal(
  mergeCaptureOptions(ambient, explicit),
  explicit,
  'explicit options must win unchanged',
);

// With no patient file open (dashboard), a context-free open stays context-free.
assert.deepEqual(mergeCaptureOptions(null, {}), {}, 'no ambient must add nothing');

// ---- resolveCapturePrefill: whose address lands on the form ----

const filePatient = { patientId: 'p1', patientName: 'Ada Lovelace', patientDob: '10/12/1815' };
const followUpP1 = {
  linkPhotoId: 'photo-1',
  patientId: 'p1',
  patientName: 'Ada Lovelace',
  patientDob: '10/12/1815',
  prefill: LOCATION,
};
const followUpP2 = {
  linkPhotoId: 'photo-2',
  patientId: 'p2',
  patientName: 'Grace Hopper',
  prefill: OTHER_LOCATION,
};
const hintP2 = { patientId: 'p2', patientName: 'Grace Hopper' };

// 1. Inside a patient file: a fresh snap (no address of its own) is always
//    addressed to that patient — the reported first-attempt failure.
assert.deepEqual(
  resolveCapturePrefill({ patient: filePatient }),
  { patientName: 'Ada Lovelace', patientDob: '10/12/1815' },
  'fresh snap inside a patient file must take the patient’s address',
);

// 2. Inside a patient file, the patient beats a phone patient tag — even the
//    same patient's, and certainly a different patient's.
for (const hint of [hintP2, { ...hintP2, patientId: 'p1' }]) {
  assert.equal(
    resolveCapturePrefill({ patient: filePatient, hint }).patientName,
    'Ada Lovelace',
    'the open patient file must beat the photo’s phone tag',
  );
}

// 3. A staged follow-up inside its own patient's file: their name plus the
//    original's location (the follow-up inherits what it was staged with).
assert.deepEqual(
  resolveCapturePrefill({ patient: filePatient, followUp: followUpP1 }),
  { patientName: 'Ada Lovelace', patientDob: '10/12/1815', location: LOCATION },
  'same-patient follow-up must keep its location prefill',
);

// 4. The same staged follow-up opened from ANOTHER patient's file: that
//    patient's address, and no location — the lesion belongs to the
//    original's patient, not the file it was opened from.
assert.deepEqual(
  resolveCapturePrefill({
    patient: { patientId: 'p3', patientName: 'Charles Babbage' },
    followUp: followUpP1,
  }),
  { patientName: 'Charles Babbage', patientDob: '' },
  'cross-patient follow-up must lose its location prefill',
);

// 5. Without ids to compare, the follow-up's location is kept (nothing
//    contradicts it — pre-existing behaviour outside a patient file).
assert.deepEqual(
  resolveCapturePrefill({ patient: { patientName: 'Ada Lovelace' }, followUp: { ...followUpP1, patientId: undefined } }),
  { patientName: 'Ada Lovelace', patientDob: '', location: LOCATION },
  'unidentifiable follow-up keeps its location',
);

// 6. Outside any patient file (dashboard): the photo keeps its own address —
//    first the staged follow-up, then the phone patient tag.
assert.deepEqual(
  resolveCapturePrefill({ followUp: followUpP2 }),
  { patientName: 'Grace Hopper', patientDob: '', location: OTHER_LOCATION },
  'dashboard open keeps a staged follow-up’s address',
);
assert.deepEqual(
  resolveCapturePrefill({ hint: hintP2 }),
  { patientName: 'Grace Hopper', patientDob: '' },
  'dashboard open keeps a phone-tagged snap’s address',
);

// 7. A caller-requested location prefill (desktop review follow-up) still
//    lands, and yields to the staged follow-up's own location.
assert.deepEqual(
  resolveCapturePrefill({ locationPrefill: LOCATION }),
  { patientName: '', patientDob: '', location: LOCATION },
  'review-follow-up prefill must land',
);
assert.deepEqual(
  resolveCapturePrefill({ followUp: followUpP1, locationPrefill: OTHER_LOCATION }),
  { patientName: 'Ada Lovelace', patientDob: '10/12/1815', location: LOCATION },
  'staged follow-up’s location beats the caller’s',
);

// 8. Nothing anywhere: blank form, no prefill.
assert.deepEqual(
  resolveCapturePrefill({}),
  { patientName: '', patientDob: '' },
  'empty sources resolve to a blank form',
);

console.log('capture-prefill self-check passed');
