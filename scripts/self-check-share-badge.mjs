/**
 * Self-check for the patient access "Shared" badge.
 *
 * Run: node scripts/self-check-share-badge.mjs
 *
 * Proves the shared_doctor_count column selected by patientService
 * (lib/services/patient-service.ts, PATIENT_COLUMNS) counts per-doctor grants
 * while excluding grants to the owner, so the Settings → Access panel badges
 * Org-wide / Shared (N) / Private instead of folding shared patients into
 * "Private". Runs the column against an in-process SQLite when the sqlite3 CLI
 * is available. Fails loudly (non-zero exit) on any mismatch.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Keep in sync with PATIENT_COLUMNS in lib/services/patient-service.ts.
const SHARED_COUNT_COLUMN = `
  (SELECT COUNT(*) FROM patient_shares ps
     WHERE ps.patient_id = p.id
       AND ps.clinician_id IS NOT p.owner_clinician_id) AS shared_doctor_count`;

// Keep in sync with SharingBadge in components/settings/patient-access-panel.tsx.
function badgeState(patient) {
  if (patient.isOrgShared) return 'Org-wide';
  if (patient.sharedDoctorCount > 0) return 'Shared';
  return 'Private';
}

assert.equal(
  badgeState({ isOrgShared: false, sharedDoctorCount: 0 }),
  'Private',
  'no grants and not org-wide must read Private',
);
assert.equal(
  badgeState({ isOrgShared: false, sharedDoctorCount: 2 }),
  'Shared',
  'grants to other doctors must read Shared',
);
assert.equal(
  badgeState({ isOrgShared: true, sharedDoctorCount: 0 }),
  'Org-wide',
);
assert.equal(
  badgeState({ isOrgShared: true, sharedDoctorCount: 3 }),
  'Org-wide',
  'org-wide wins when both flags are somehow set (OR visibility rule)',
);

// End-to-end against real SQLite (skipped silently when sqlite3 is absent).
// Fixtures: own = owner, doc = another clinician.
//   p-none   no grants                     -> 0 (Private)
//   p-one    granted to doc                -> 1 (Shared)
//   p-owner  granted to the owner only     -> 0 (still Private)
//   p-mixed  granted to owner + doc        -> 1 (Shared)
//   p-legacy ownerless row granted to doc  -> 1 (Shared; NULL owner must not
//                                             swallow the count)
let ranSql = false;
try {
  const sql = `
    CREATE TABLE patients(id TEXT PRIMARY KEY, owner_clinician_id TEXT, is_org_shared INTEGER);
    CREATE TABLE patient_shares(
      id TEXT PRIMARY KEY, patient_id TEXT NOT NULL, clinician_id TEXT NOT NULL,
      granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL,
      UNIQUE(patient_id, clinician_id));
    INSERT INTO patients VALUES
      ('p-none','own',0),('p-one','own',0),('p-owner','own',0),
      ('p-mixed','own',0),('p-legacy',NULL,0);
    INSERT INTO patient_shares VALUES
      ('s1','p-one','doc','admin',0),
      ('s2','p-owner','own','admin',0),
      ('s3','p-mixed','own','admin',0),
      ('s4','p-mixed','doc','admin',0),
      ('s5','p-legacy','doc','admin',0);
    SELECT p.id, ${SHARED_COUNT_COLUMN}
      FROM patients p ORDER BY p.id;
  `;
  const out = execFileSync('sqlite3', [':memory:', sql], { encoding: 'utf8' }).trim();
  assert.equal(
    out,
    ['p-legacy|1', 'p-mixed|1', 'p-none|0', 'p-one|1', 'p-owner|0'].join('\n'),
    'count column must exclude owner grants and survive a NULL owner',
  );
  ranSql = true;
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('sqlite3 CLI not found — skipped the live-SQL half of the check.');
  } else {
    throw err;
  }
}

console.log(
  ranSql
    ? 'share-badge self-check passed (badge states + live SQLite)'
    : 'share-badge self-check passed (badge states only)',
);
