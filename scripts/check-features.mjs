#!/usr/bin/env node
/**
 * Feature wiring self-check (no framework, no fixtures).
 *
 * Asserts the cross-file invariants that TypeScript cannot: the DB migration
 * actually contains the columns the services read, the Rust shell registers
 * the migration, and the body-map picker can reach every BodyPart value.
 * Run: node scripts/check-features.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
}

// 1. Migration 007 exists and carries consent + audit + idle-lock schema.
const migration = read('src-tauri/migrations/007_consent_audit.sql');
for (const needle of [
  'ALTER TABLE patients ADD COLUMN consent_given_at',
  'ALTER TABLE patients ADD COLUMN consent_scope',
  'ALTER TABLE patients ADD COLUMN consent_expires_at',
  'CREATE TABLE IF NOT EXISTS audit_log',
  'ALTER TABLE settings ADD COLUMN idle_lock_timeout_ms',
]) {
  check(`migration 007: ${needle}`, migration.includes(needle));
}

// 2. The Rust shell registers migration 007.
check(
  'lib.rs registers migration 007',
  /version:\s*7[\s\S]*?007_consent_audit\.sql/.test(read('src-tauri/src/lib.rs')),
);

// 3. patient-service reads every consent column migration 007 adds.
const patientService = read('lib/services/patient-service.ts');
for (const col of ['consent_given_at', 'consent_scope', 'consent_expires_at']) {
  check(`patient-service selects ${col}`, patientService.includes(`p.${col}`));
}

// 4. Body-map picker covers every BodyPart enum value (torso via its chip,
//    everything else via diagram regions in the front or back view).
const bodyPartSrc = read('types/body-part.ts');
const enumValues = [...bodyPartSrc.matchAll(/^\s{2}([A-Z_]+) = '([a-z_]+)',$/gm)].map(
  (m) => m[2],
);
check('body-part enum parsed (14 values)', enumValues.length === 14);

const pickerSrc = read('components/patient/body-map-picker.tsx');
// Constants used in the picker, mapped back to enum values by name.
const usedNames = new Set([...pickerSrc.matchAll(/BodyPart\.([A-Z_]+)/g)].map((m) => m[1]));
for (const value of enumValues) {
  check(`body map reaches BodyPart.${value}`, usedNames.has(value.toUpperCase()));
}

// 5. Consent status derivation sanity (mirrors types/patient.ts logic —
//    kept in sync deliberately; the pure function itself is TS-only).
const now = Date.now();
const derive = (givenAt, expiresAt) =>
  !givenAt ? 'none' : expiresAt && expiresAt < now ? 'expired' : 'valid';
check('consent: none when never given', derive(null, null) === 'none');
check('consent: valid with no expiry', derive(now - 1000, null) === 'valid');
check('consent: expired past expiry', derive(now - 1000, now - 1) === 'expired');
check('consent: valid before expiry', derive(now - 1000, now + 10_000) === 'valid');

// 6. Offline licence wiring: migration 008 carries the columns, the Rust shell
//    registers it, the service reads them, a vendor public key is embedded,
//    and every mutating patient/photo method hits the licence guard.
const licenceMigration = read('src-tauri/migrations/008_licence.sql');
for (const needle of [
  'ALTER TABLE settings ADD COLUMN licence_key',
  'ALTER TABLE settings ADD COLUMN trial_started_at',
  'ALTER TABLE settings ADD COLUMN install_id',
]) {
  check(`migration 008: ${needle}`, licenceMigration.includes(needle));
}
check(
  'lib.rs registers migration 008',
  /version:\s*8[\s\S]*?008_licence\.sql/.test(read('src-tauri/src/lib.rs')),
);
const licenceServiceSrc = read('lib/services/licence-service.ts');
for (const col of ['licence_key', 'trial_started_at', 'install_id']) {
  check(`licence-service selects ${col}`, licenceServiceSrc.includes(col));
}
check(
  'licence public key embedded (64 hex chars)',
  /'([0-9a-f]{64})'/.test(read('lib/licence/public-key.ts')),
);
check(
  'patient-service guards all 5 mutations',
  (read('lib/services/patient-service.ts').match(/await ensureWritable/g) || []).length === 5,
);
check(
  'photo-service guards all 6 mutations',
  (read('lib/services/photo-service.ts').match(/await ensureWritable/g) || []).length === 6,
);

// 9. Shipped legal docs (public/legal) must stay byte-identical to legal/.
for (const doc of ['terms-of-service.md', 'privacy-policy.md']) {
  const shipped = read(`public/legal/${doc}`);
  const source = read(`legal/${doc}`);
  check(`public/legal/${doc} matches legal/${doc}`, shipped === source);
  check(`${doc}: supplier details filled`, source.includes('John Raphael Saenz') && source.includes('55 882 511 758'));
  check(
    `${doc}: no unfilled placeholders`,
    !/\[(SUPPLIER|PRIVACY|POSTAL|PHONE|EMAIL|SUPPORT|DISTRIBUTION|URL)[^\]]*\]/.test(source),
  );
}
check('legal page renders markdown', read('app/legal/page.tsx').includes('renderMarkdown'));

// 10. Invitation flow wiring: precreated invites create the account at invite
//     time (temp passcode + must-change), the signup screen exposes code entry
//     even when public signup is on, and the dashboard enforces the
//     must-change-passcode gate.
const authServiceSrc = read('lib/services/auth-service.ts');
check(
  'auth-service: precreated invites create the clinician row at invite time',
  /if \(validated\.kind === 'precreated'\) \{[\s\S]{0,200}createClinicianRow[\s\S]{0,300}mustChangePasscode: true/.test(authServiceSrc),
);
check(
  'auth-service: factory reset restores the open-signup default',
  /SET allow_public_signup = 1/.test(authServiceSrc),
);
check(
  'auth-service: admin passcode reset sets temp passcode, must-change and clears the session',
  /resetUserPasscode[\s\S]{0,1200}must_change_passcode = 1[\s\S]{0,300}session_expires_at = NULL/.test(
    authServiceSrc,
  ),
);
check(
  'users-panel: per-user passcode reset with one-time reveal',
  /resetUserPasscode/.test(read('components/settings/users-panel.tsx')),
);
check(
  'login: forgot-passcode factory reset reachable in production',
  /handleForgotReset[\s\S]{0,500}resetApp/.test(read('app/(auth)/login/page.tsx')),
);
check(
  'signup: invite-code entry reachable in both public and invite-only modes',
  /showCodeEntry/.test(read('app/(auth)/signup/page.tsx')),
);
check(
  'dashboard layout gates on mustChangePasscode',
  /clinician\?\.mustChangePasscode/.test(read('app/(dashboard)/layout.tsx')),
);

// 11. Review scheduling: migration 010 carries the columns, the Rust shell
//     registers it, the service maps them, and the dashboard reads the
//     notification service for its attention panel.
const reviewMigration = read('src-tauri/migrations/010_reviews.sql');
for (const needle of [
  'ALTER TABLE patients ADD COLUMN review_due_at',
  'ALTER TABLE patients ADD COLUMN last_reviewed_at',
  'ALTER TABLE settings ADD COLUMN review_warning_days',
  'ALTER TABLE settings ADD COLUMN review_stale_days',
]) {
  check(`migration 010: ${needle}`, reviewMigration.includes(needle));
}
check(
  'lib.rs registers migration 010',
  /version:\s*10[\s\S]*?010_reviews\.sql/.test(read('src-tauri/src/lib.rs')),
);
for (const col of ['review_due_at', 'last_reviewed_at']) {
  check(`patient-service selects p.${col}`, patientService.includes(`p.${col}`));
}
check(
  'dashboard renders the attention panel',
  read('app/(dashboard)/page.tsx').includes('NeedsAttention'),
);
check(
  'sidebar carries pending-action counters',
  read('components/app-sidebar.tsx').includes('SidebarMenuBadge'),
);

// 11b. Per-photo review + lesion series (migration 013): the columns exist,
//      the Rust shell registers the migration, photo-service maps them, and
//      reviewing a photo stamps the patient's review via markReviewed.
const photoReviewMigration = read('src-tauri/migrations/013_photo_review_series.sql');
for (const needle of [
  'ALTER TABLE photos ADD COLUMN last_reviewed_at',
  'ALTER TABLE photos ADD COLUMN lesion_group',
]) {
  check(`migration 013: ${needle}`, photoReviewMigration.includes(needle));
}
check(
  'lib.rs registers migration 013',
  /version:\s*13[\s\S]*?013_photo_review_series\.sql/.test(read('src-tauri/src/lib.rs')),
);
const reviewSeriesServiceSrc = read('lib/services/photo-service.ts');
for (const col of ['last_reviewed_at', 'lesion_group']) {
  check(`photo-service handles ${col}`, reviewSeriesServiceSrc.includes(col));
}
check(
  'photo-service reviewPhoto stamps the patient review too',
  /async reviewPhoto[\s\S]{0,900}patientService\.markReviewed/.test(reviewSeriesServiceSrc),
);
const photoDialogSrc = read('components/photo/photo-detail-dialog.tsx');
for (const needle of [
  'reviewPhoto',
  'BodyMapBadge',
  'getLesionGroups',
  'getPhotosInGroup',
]) {
  check(`edit-photo dialog wires ${needle}`, photoDialogSrc.includes(needle));
}

// 11c. Scheduled photo reviews (migration 014): the column exists, the Rust
//      shell registers the migration, the service surfaces the due set, the
//      dashboard alert list carries photo-review items end to end, and the
//      edit-photo dialog offers the date input.
const photoDueMigration = read('src-tauri/migrations/014_photo_review_due.sql');
check(
  'migration 014: ALTER TABLE photos ADD COLUMN review_due_at',
  photoDueMigration.includes('ALTER TABLE photos ADD COLUMN review_due_at'),
);
check(
  'lib.rs registers migration 014',
  /version:\s*14[\s\S]*?014_photo_review_due\.sql/.test(read('src-tauri/src/lib.rs')),
);
check(
  'photo-service exposes getPhotosWithReviewDue',
  read('lib/services/photo-service.ts').includes('getPhotosWithReviewDue'),
);
const notificationSrc = read('lib/services/notification-service.ts');
for (const needle of [
  'photo-review-overdue',
  'photo-review-due-soon',
  'photoReviewStatus',
  'getPhotosWithReviewDue',
]) {
  check(`notification-service wires ${needle}`, notificationSrc.includes(needle));
}
const needsAttentionSrc = read('components/dashboard/needs-attention.tsx');
for (const kind of ['photo-review-overdue', 'photo-review-due-soon']) {
  check(`needs-attention maps ${kind}`, needsAttentionSrc.includes(`'${kind}'`));
}
check(
  'edit-photo dialog offers the next review date input',
  photoDialogSrc.includes('photo-review-due'),
);
check(
  'photo cards show the scheduled-review cue',
  /photoReviewStatus/.test(read('components/photo/photo-card.tsx')),
);

// 12. Phone companion (sidecar viewing): the Rust shell serves the pushed
//     manifest + whitelisted photo files and registers the commands; the
//     webview builds the access-filtered manifest, the dashboard owns the
//     session, the sidebar opens the dialog, and a saved photo refreshes the
//     manifest.
const remoteCamera = read('src-tauri/src/remote_camera.rs');
for (const needle of [
  'fn handle_library',
  'fn handle_image',
  'is_safe_filename',
  'pub fn remote_camera_active',
  'pub fn update_remote_library',
  'pub fn clear_remote_library',
  "fetch('library')",
  'screen-viewer',
]) {
  check(`remote_camera.rs: ${needle}`, remoteCamera.includes(needle));
}
const libRs = read('src-tauri/src/lib.rs');
for (const cmd of [
  'remote_camera::remote_camera_active',
  'remote_camera::update_remote_library',
  'remote_camera::clear_remote_library',
]) {
  check(`lib.rs registers ${cmd}`, libRs.includes(cmd));
}
check(
  'companion service pushes manifest + filename whitelist',
  /invoke\('update_remote_library'/.test(read('lib/services/companion-service.ts')),
);
check(
  'dashboard layout mounts CompanionProvider',
  read('app/(dashboard)/layout.tsx').includes('CompanionProvider'),
);
check(
  'sidebar opens the phone link dialog',
  read('components/app-sidebar.tsx').includes('PhoneLinkDialog'),
);
check(
  'capture screen flags itself so photos are not handled twice',
  read('components/capture/capture-dialog.tsx').includes('setCaptureScreenActive'),
);
check(
  'capture dialog republishes the shared library after saving a photo',
  read('components/capture/capture-dialog.tsx').includes('companionService.publish'),
);

// 13. Laterality (migration 011): column exists, the shell registers the
//     migration, the schema validates it, both inserts write it, and the
//     capture form + body map offer it (bilateral regions only).
const latMigration = read('src-tauri/migrations/011_laterality.sql');
check('migration 011: photos.laterality', latMigration.includes('ALTER TABLE photos ADD COLUMN laterality'));
check('lib.rs registers migration 011', /version:\s*11[\s\S]*?011_laterality\.sql/.test(libRs));
check('body-part exports BILATERAL_BODY_PARTS + labels', /BILATERAL_BODY_PARTS[\s\S]*bodyPartDisplayLabel/.test(read('types/body-part.ts')));
const photoServiceSrc = read('lib/services/photo-service.ts');
for (const needle of ['laterality, subpart, clinical_notes', 'validated.laterality ?? null', 'photo.laterality,']) {
  check(`photo-service writes laterality: ${needle}`, photoServiceSrc.includes(needle));
}
check(
  'capture form offers the side control',
  /radiogroup[\s\S]*?Patient's side/.test(read('components/photo/photo-metadata-form.tsx')),
);
check(
  'body map derives the patient side (front view mirrors)',
  read('components/patient/body-map-picker.tsx').includes('patientSideOf'),
);
check(
  'photo thumbnails carry the body-map badge',
  read('components/photo/photo-card.tsx').includes('BodyMapBadge'),
);

// 14. Companion actions: the shell relays review/report requests, stages the
//     report, tracks idle time; the provider listens and auto-ends.
for (const needle of [
  '"review"',
  '"report-request"',
  '"report"',
  'fn stage_remote_report',
  'fn remote_camera_idle_ms',
  'allowed_patients',
  'last_seen_ms',
]) {
  check(`remote_camera.rs: ${needle}`, remoteCamera.includes(needle));
}
check('lib.rs registers remote_camera::stage_remote_report', libRs.includes('remote_camera::stage_remote_report'));
check('lib.rs registers remote_camera::remote_camera_idle_ms', libRs.includes('remote_camera::remote_camera_idle_ms'));
check(
  'companion service sends allowed patients + stages reports',
  /allowedPatients[\s\S]*?stage_remote_report/.test(read('lib/services/companion-service.ts')),
);
const providerSrc = read('components/companion/companion-provider.tsx');
for (const needle of ['companion-review-request', 'companion-report-request', 'remote_camera_idle_ms', 'IDLE_LIMIT_MS']) {
  check(`companion provider: ${needle}`, providerSrc.includes(needle));
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll feature wiring checks passed.');
