/**
 * Self-check for result-file support (per-photo document attachments).
 *
 * Run: node scripts/self-check-result-files.mjs
 *
 * Covers the pure pieces that don't need the Tauri shell: the file-type
 * allowlist resolution, the storage/migration wiring (table exists, migration
 * registered Rust-side, service + UI modules present). Fails loudly
 * (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const { RESULT_FILE_EXTENSIONS, resolveResultFileType, resultFilePreviewKind } =
  await import(join(root, 'types/result-file.ts'));

// Common clinical document types resolve to the right MIME.
assert.deepEqual(resolveResultFileType('pathology-report.pdf'), {
  extension: 'pdf',
  mimeType: 'application/pdf',
});
assert.deepEqual(resolveResultFileType('letter.RTF'), {
  extension: 'rtf',
  mimeType: 'application/rtf',
});
assert.deepEqual(resolveResultFileType('results 12Aug26.docx'), {
  extension: 'docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
});
assert.deepEqual(resolveResultFileType('scan.JPG'), {
  extension: 'jpg',
  mimeType: 'image/jpeg',
});

// Everything on the allowlist resolves; nothing outside it does.
for (const ext of RESULT_FILE_EXTENSIONS) {
  assert.ok(
    resolveResultFileType(`file.${ext}`),
    `allowlisted extension must resolve: ${ext}`,
  );
}
for (const name of ['virus.exe', 'payload.js', 'archive.zip', 'script.sh']) {
  assert.equal(resolveResultFileType(name), null, `must reject: ${name}`);
}

// Extension edge cases: no dot, trailing dot, dotfile.
assert.equal(resolveResultFileType('no-extension'), null);
assert.equal(resolveResultFileType('trailing.'), null);
assert.equal(resolveResultFileType('.gitignore'), null);

// In-app preview kinds: browsers render these without a copy on disk.
assert.equal(resultFilePreviewKind('pathology.pdf'), 'pdf');
assert.equal(resultFilePreviewKind('scan.png'), 'image');
assert.equal(resultFilePreviewKind('results.csv'), 'text');
// RTF/Office/TIFF/HEIC have no in-app preview — fall back to "save a copy".
for (const name of ['letter.rtf', 'report.docx', 'labs.xlsx', 'scan.tiff', 'img.heic']) {
  assert.equal(resultFilePreviewKind(name), 'none', `must have no preview: ${name}`);
}

// Migration + wiring are in place.
const migration = readFileSync(
  join(root, 'src-tauri/migrations/015_result_files.sql'),
  'utf8',
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS result_files/);
assert.match(migration, /photo_id\s+TEXT\s+NOT NULL/);

const libRs = readFileSync(join(root, 'src-tauri/src/lib.rs'), 'utf8');
assert.match(libRs, /015_result_files\.sql/);

const service = readFileSync(
  join(root, 'lib/services/result-file-service.ts'),
  'utf8',
);
assert.match(service, /INSERT INTO result_files/);
assert.match(service, /ensureWritable\(\)/);
assert.match(service, /assertCanManagePatient/);
assert.match(service, /readFileBytes/, 'viewer reads stored bytes in place');

const section = readFileSync(
  join(root, 'components/photo/result-files-section.tsx'),
  'utf8',
);
assert.match(section, /handleView/, 'file rows open the in-app preview');
assert.match(section, /<iframe/, 'PDFs render inside the preview dialog');
assert.match(
  section,
  /createObjectURL/,
  'preview loads bytes as a blob URL (base64 data: URLs render blank in the webviews)',
);

// The packaged CSP must let frames load blob: URLs — without a frame-src
// grant the PDF preview falls back to default-src 'self' and renders blank
// ("only photos can be viewed"). The preview only ever frames blob: URLs,
// so the grant stays least-privilege: 'self' blob:.
const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
for (const key of ['csp', 'devCsp']) {
  const csp = tauriConf.app.security[key];
  assert.ok(csp, `tauri.conf.json must define app.security.${key}`);
  const frameSrc = /frame-src\s+([^;]+)(?:;|$)/.exec(csp)?.[1];
  assert.ok(frameSrc, `${key} must grant frame-src for the PDF preview iframe`);
  assert.match(frameSrc, /'self'/, `${key} frame-src must keep 'self'`);
  assert.match(frameSrc, /blob:/, `${key} frame-src must allow blob: URLs`);
}

const dialog = readFileSync(
  join(root, 'components/photo/photo-detail-dialog.tsx'),
  'utf8',
);
assert.match(dialog, /ResultFilesSection/);
assert.doesNotMatch(
  dialog,
  /sticky bottom-0/,
  'action bar is pinned outside the scroll region, not sticky-overlaid',
);

console.log('self-check-result-files: all assertions passed');
