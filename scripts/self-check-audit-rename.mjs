/**
 * Self-check for audit-trail coverage of significant changes: renames and
 * hard deletes (the reasons a rename used to blank the Patient column and
 * rewrite history), date-of-birth changes, and clinician administration.
 *
 * Run: node scripts/self-check-audit-rename.mjs
 *
 * Pins: the rename detail wording, stored-patient-name-wins over the read
 * time JOIN, the updatePatient rename guard, deletePatient carrying the
 * name explicitly, the DOB-change detail, admin role/activation/creation
 * events, and labels existing for every new action. Fails loudly
 * (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renameAuditDetail, mapAuditRow } from '../lib/utils/audit.ts';
import { AuditActionLabels } from '../types/audit.ts';

const serviceSrc = readFileSync(new URL('../lib/services/audit-service.ts', import.meta.url), 'utf8');
const patientSrc = readFileSync(new URL('../lib/services/patient-service.ts', import.meta.url), 'utf8');
const authSrc = readFileSync(new URL('../lib/services/auth-service.ts', import.meta.url), 'utf8');

// --- Rename detail wording (the only place the old name survives) ---

assert.equal(
  renameAuditDetail('Jane Doe', 'Jane Smith'),
  'renamed from “Jane Doe” to “Jane Smith”',
  'rename detail carries old → new',
);

// --- Labels exist so the audit viewer and CSV never fall back to the raw path ---

assert.equal(AuditActionLabels['patient.rename'], 'Renamed patient');
assert.equal(AuditActionLabels['patient.delete'], 'Deleted patient');
assert.equal(AuditActionLabels['admin.role_change'], 'Changed a user’s role');
assert.equal(AuditActionLabels['admin.user_activation'], 'Approved / deactivated a user');
assert.equal(AuditActionLabels['admin.user_created'], 'Created a user account');

// --- Stored patient_name wins over the JOIN, inside the redaction rule ---

const CAPTURED_AT = new Date(2026, 8, 6, 9, 0).getTime();
const renamedRow = {
  id: 'a1',
  clinician_id: 'c1',
  clinician_name: 'Dr Jane Doe',
  action: 'photo.create',
  entity_type: 'photo',
  entity_id: 'p1',
  patient_id: 'pat1',
  patient_name: 'Name At Capture Time', // baked in at write time
  detail: 'left arm',
  created_at: CAPTURED_AT,
};
assert.equal(
  mapAuditRow(renamedRow, true).patientName,
  'Name At Capture Time',
  'a later rename must not rewrite what the row recorded',
);
assert.equal(mapAuditRow(renamedRow, false).patientName, null, 'redaction still applies');
assert.equal(mapAuditRow({ ...renamedRow, patient_name: null }, true).patientName, null,
  'pre-migration row without stored name maps to null here (JOIN resolves in SQL)');

// --- Structural guards on the services ---

// The read path must prefer the stored name over the read-time JOIN.
assert.match(serviceSrc, /COALESCE\(a\.patient_name, p\.name\) AS patient_name/,
  'AUDIT_SELECT must prefer the stored patient_name over the JOIN');

// record() must denormalise the name (column + insert binding) and only
// look it up when the caller did not supply it.
assert.match(serviceSrc, /patient_name/, 'audit_log insert must include patient_name');
assert.match(serviceSrc, /ctx\.patientName \?\? null/, 'explicit patientName wins over lookup');

// updatePatient must detect a name change and emit its own rename entry.
assert.match(patientSrc, /prior\.name !== validated\.name/, 'rename guard on updatePatient');
assert.match(patientSrc, /'patient\.rename'/, 'patient.rename action recorded');

// deletePatient must carry the name explicitly (the row is already gone by
// the time record() runs) and cascade everything attached to the patient.
const deleteBody = patientSrc.slice(patientSrc.indexOf('async deletePatient'));
for (const fragment of [
  /patientName: name/,
  /DELETE FROM patient_shares/,
  /DELETE FROM result_files/,
  /DELETE FROM photos/,
  /DELETE FROM patients/,
]) {
  assert.match(deleteBody, fragment, `deletePatient must include ${fragment}`);
}

// --- Significant changes must be describable from the trail ---

// A date-of-birth change is the identity change renames don't cover; the
// update entry's detail must say so (old→new DOB values aren't stored, but
// the change itself is, attributed and timestamped).
assert.match(patientSrc, /date of birth (changed|recorded|removed)/,
  'patient.update detail must describe DOB changes');

// Clinician administration is security-relevant and must be audited: the
// decision-maker is signed in, so every event carries an actor.
assert.match(authSrc, /auditService\.record\('admin\.role_change'/,
  'setUserRole must record an admin.role_change entry');
assert.match(authSrc, /auditService\.record\('admin\.user_activation'/,
  'setUserActive must record an admin.user_activation entry');
assert.match(authSrc, /auditService\.record\('admin\.user_created'/,
  'the precreated-invite path must record an admin.user_created entry');

// --- Boundary closures: storage, licence, signup attribution, photo labels ---

assert.equal(AuditActionLabels['auth.signup'], 'Registered an account');
assert.equal(AuditActionLabels['storage.photos_dir'], 'Changed the photo storage location');
assert.equal(AuditActionLabels['licence.activation'], 'Activated a licence');
assert.equal(AuditActionLabels['patient.sharing'], 'Changed patient sharing');
assert.equal(AuditActionLabels['admin.invitation_created'], 'Issued an invitation');
assert.equal(AuditActionLabels['admin.invitation_revoked'], 'Revoked an invitation');
assert.equal(AuditActionLabels['admin.settings_change'], 'Changed security settings');

// Patient exposure and access provisioning are security-relevant actions.
assert.equal((patientSrc.match(/'patient\.sharing'/g) ?? []).length, 2,
  'setOrgShared and setSharedDoctors must each record patient.sharing');
assert.match(authSrc, /'admin\.invitation_created'/,
  'createInvitation must record an admin.invitation_created entry');
assert.match(authSrc, /'admin\.invitation_revoked'/,
  'revokeInvitation must record an admin.invitation_revoked entry');
assert.match(authSrc, /'admin\.settings_change'/,
  'security-relevant settings deltas must be recorded');
assert.match(authSrc, /public signup \$\{next\.allowPublicSignup/,
  'the settings entry must describe the signup-policy delta');

// Photo labels are snapshotted at write time and preferred at read time, so
// body-part edits or a patient delete can't rewrite what an entry showed.
assert.match(serviceSrc, /photo_label/, 'audit_log insert must include photo_label');
assert.match(serviceSrc, /row\.photo_label \?\?\s*photoAuditLabel/,
  'the read path must prefer the stored photo_label over the JOIN');
assert.match(serviceSrc, /getCurrentClinician\(\)\.catch\(\(\) => null\)/,
  'record() must not drop events when no session exists');
assert.match(serviceSrc, /ctx\.clinicianName \?\?/,
  'attribution override must exist for pre-auth events');

// Pre-auth account registration is attributed to the new account itself.
assert.equal((authSrc.match(/'auth\.signup'/g) ?? []).length, 2,
  'register() and acceptInvitation() must each record auth.signup');

const storageSrc = readFileSync(new URL('../lib/services/storage-service.ts', import.meta.url), 'utf8');
const licenceSrc = readFileSync(new URL('../lib/services/licence-service.ts', import.meta.url), 'utf8');
assert.match(storageSrc, /'storage\.photos_dir'/,
  'changing the photo storage location must be audited');
assert.match(licenceSrc, /'licence\.activation'/,
  'licence activation must be audited');
assert.match(licenceSrc, /slice\(-4\)/,
  'the audit detail must carry only the key tail, never the full licence key');

// The destructive and auth-critical writes are awaited, not fire-and-forget.
assert.match(patientSrc, /await auditService\.record\('patient\.delete'/,
  'patient.delete audit write must be awaited');
assert.match(authSrc, /await auditService\.record\('auth\.logout'/,
  'auth.logout audit write must be awaited');

// Migration 019 pins legacy rows: patient_id promoted from entity_id and
// photo labels backfilled.
const migSrc = readFileSync(
  new URL('../src-tauri/migrations/019_audit_identity_backfill.sql', import.meta.url),
  'utf8',
);
assert.match(migSrc, /SET patient_id = entity_id/,
  'legacy patient rows must be attributed');
assert.match(migSrc, /ADD COLUMN photo_label/,
  'photo labels must be snapshotted from migration 019 on');

// The login-screen factory reset wipes the trail by design, so the reset
// itself must leave a trace outside the database: a diagnostics entry that
// is mirrored to the rotating camog.log, which survives the wipe.
assert.match(authSrc, /record_web_diagnostic/,
  'resetApp must leave a durable out-of-DB trace of the factory reset');

console.log('self-check-audit-rename: all assertions passed.');
