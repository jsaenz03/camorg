/**
 * Self-check for in-app patient creation.
 *
 * Patients used to be creatable only by capturing (or via the phone web
 * companion). The Patients page now offers both: a plain "Add patient"
 * dialog and an upload flow with no fixed patient, which resolves an exact
 * name match or creates the record on save. The upload dialog is also
 * height-bounded — the regression this guards: an unbounded dialog pushed
 * Save out of the window.
 *
 * Run: node scripts/self-check-patient-create.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const patientsPageSrc = read('../app/(dashboard)/patients/page.tsx');
const addDialogSrc = read('../components/patient/add-patient-dialog.tsx');
const uploadSrc = read('../components/photo/photo-upload.tsx');
const patientViewSrc = read('../app/(dashboard)/patients/view/page.tsx');

// --- Plain add: dialog, validation, duplicate guard, audit via the service ---

assert.match(addDialogSrc, /patientService\.createPatient\(/, 'add dialog creates via the service');
assert.match(addDialogSrc, /patientService\.isDuplicateName\(/, 'add dialog checks for a name clash');
assert.match(
  addDialogSrc,
  /isDuplicateName\(values\.name\)[\s\S]*?confirmDialog\(/,
  'add dialog asks before creating a same-name record',
);
assert.match(addDialogSrc, /name: z[\s\S]*?\.trim\(\)[\s\S]*?\.min\(1,/, 'name is required');
assert.match(addDialogSrc, /dateOfBirth: z/, 'date of birth is collected');
assert.match(addDialogSrc, /email: z/, 'email is collected');

// --- Patients page: both entry points wired ---

assert.match(
  patientsPageSrc,
  /<AddPatientDialog[\s\S]*?onCreated=\{[^}]*\}/,
  'patients page renders the add dialog',
);
assert.match(
  patientsPageSrc,
  /<PhotoUpload label="Upload photos" onSaved=\{handleUploadSaved\} \/>/,
  'patients page offers upload without a fixed patient',
);
assert.match(
  patientsPageSrc,
  /router\.push\(`\/patients\/view\?id=\$\{patient\.id\}`\)/,
  'creating a patient opens their file',
);

// --- Upload without a patient: find-or-create, then save against it ---

assert.match(uploadSrc, /patient\?: Patient;/, 'upload patient prop is optional');
assert.match(uploadSrc, /patientService\.searchPatients\(name\)/, 'upload looks for an exact name match');
assert.match(uploadSrc, /patientService\.isDuplicateName\(name\)/, 'upload asks before a same-name create');
assert.match(uploadSrc, /patientService\.createPatient\(/, 'upload creates a patient when none matches');
assert.match(uploadSrc, /const owner = await resolvePatient\(values\);/, 'upload resolves the patient before saving');
assert.match(uploadSrc, /patientId: owner\.id,/, 'photo saves against the resolved patient');
assert.match(uploadSrc, /patientLocked=\{activePatient !== null\}/, 'patient fields lock once resolved');

// --- The dialog stays inside the window and keeps its actions reachable ---

assert.match(
  uploadSrc,
  /DialogContent className="flex max-h-\[95dvh\] flex-col overflow-hidden/,
  'upload dialog is height-bounded',
);
assert.match(uploadSrc, /PhotoMetadataForm[\s\S]*?patientLocked=/, 'form renders inside the bounded column');
assert.match(uploadSrc, /flex min-h-0 flex-1 flex-col/, 'form column can shrink so its scroll region works');

// --- Existing patient uploads stay locked to that patient ---

assert.match(patientViewSrc, /<PhotoUpload patient=\{patient\} onSaved=\{handleUploadSaved\} \/>/, 'timeline keeps the fixed-patient upload');

console.log('patient create self-check passed');
