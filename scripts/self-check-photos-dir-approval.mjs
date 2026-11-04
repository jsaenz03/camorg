#!/usr/bin/env node
/**
 * Self-check for the photos-folder approval boundary (disk-safety audit M3)
 * and the boot orphan sweep decision logic (L5).
 *
 * 1. Approval boundary — source pins: the folder dialog must run Rust-side
 *    (choose_photos_directory records the approval), and the
 *    webview-callable grant command must only honour paths the Rust-side
 *    approval file already contains (one-time carry-over seed on the first
 *    call). The settings panel must no longer pass a webview-picked path.
 * 2. Orphan sweep — runs the REAL lib/storage/orphan-sweep.ts (Node type
 *    stripping, no mirror): photo/result files are only ever REPORTED,
 *    never auto-deleted; only machine-local backup seal debris (*.db.tmp)
 *    is marked for deletion.
 *
 * Run: node scripts/self-check-photos-dir-approval.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKUP_TMP_RE,
  isCamogSweepPhotoFileName,
  planOrphanSweep,
} from '../lib/storage/orphan-sweep.ts';
import { isCamogPhotoFileName } from '../lib/storage/photo-file-name.ts';

// 1. Approval boundary pins.
const libRs = readFileSync(
  new URL('../src-tauri/src/lib.rs', import.meta.url),
  'utf8',
);
assert.match(libRs, /fn choose_photos_directory/, 'Rust-side dialog command exists');
assert.match(
  libRs,
  /blocking_pick_folder/,
  'the folder dialog runs in Rust, not the webview',
);
const grantBody = libRs.slice(
  libRs.indexOf('fn grant_directory_access'),
  libRs.indexOf('fn choose_photos_directory'),
);
assert.ok(grantBody.length > 0, 'grant command precedes the dialog command');
assert.match(
  grantBody,
  /read_approved_photos_dirs/,
  'grant command consults the approval file',
);
assert.match(
  grantBody,
  /not an approved photos folder/,
  'non-approved paths are refused',
);
assert.match(
  grantBody,
  /one-time carry-over/,
  'the first-call seed is marked as a one-time carry-over',
);
assert.match(
  libRs,
  /choose_photos_directory,/,
  'dialog command is registered in the invoke handler',
);

const panel = readFileSync(
  new URL('../components/settings/storage-panel.tsx', import.meta.url),
  'utf8',
);
assert.doesNotMatch(
  panel,
  /open\(\{\s*directory:\s*true/,
  'the panel no longer picks folders webview-side',
);
assert.match(
  panel,
  /choose_photos_directory/,
  'the panel asks Rust to run the folder dialog',
);

// 2. Orphan sweep decision logic.
const UUID = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b';
const known = new Set([`${UUID}.jpg`, `${UUID}.thumb.jpg`]);

// 2a. Known photo files are never flagged; unknown Camog-named ones report.
let plan = planOrphanSweep(
  [`${UUID}.jpg`, `${UUID}.thumb.jpg`, '0a0b0c0d-1111-4222-8333-444455556666.jpg'],
  [],
  known,
  new Set(),
);
assert.deepEqual(
  plan.orphanPhotoFiles,
  ['0a0b0c0d-1111-4222-8333-444455556666.jpg'],
  'unknown Camog-named file reports',
);

// 2b. Foreign files in the folder are ignored entirely.
plan = planOrphanSweep(['IMG_001.jpg', 'notes.txt', '.DS_Store'], [], known, new Set());
assert.deepEqual(plan.orphanPhotoFiles, [], 'foreign files ignored');
assert.deepEqual(plan.backupTmpDebris, [], 'foreign files never deleted');

// 2c. Backup seal debris is marked for deletion; real backups are not.
plan = planOrphanSweep(
  ['camog-backup-20261105090000.db.tmp', 'camog-backup-20261105090000.db'],
  [],
  new Set(),
  new Set(),
);
assert.deepEqual(
  plan.backupTmpDebris,
  ['camog-backup-20261105090000.db.tmp'],
  'seal debris marked for deletion',
);
assert.equal(
  BACKUP_TMP_RE.test('camog-backup-20261105090000.db'),
  false,
  'a sealed backup is never debris',
);
assert.equal(BACKUP_TMP_RE.test('camog-backup-20261105.db.tmp'), false, 'wrong stamp width');

// 2d. results/ entries with no row report (report-only).
plan = planOrphanSweep([], ['stray.pdf', 'kept.pdf'], new Set(), new Set(['kept.pdf']));
assert.deepEqual(plan.orphanResultFiles, ['stray.pdf'], 'result orphan reports');

// 2e. The sweep's duplicated photo gate agrees with photo-file-name's
// canonical one on every shape that matters (no drift between the two).
for (const name of [
  `${UUID}.jpg`,
  `${UUID}.thumb.jpg`,
  'IMG_001.jpg',
  `${UUID.toUpperCase()}.jpg`,
  `${UUID}.png`,
  `${UUID}.thumb.jpg.bak`,
  '',
]) {
  assert.equal(
    isCamogSweepPhotoFileName(name),
    isCamogPhotoFileName(name),
    `photo gates agree on ${JSON.stringify(name)}`,
  );
}

console.log('photos-dir-approval + orphan-sweep self-check passed (2 areas).');
