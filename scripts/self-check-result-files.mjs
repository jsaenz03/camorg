/**
 * Self-check for result-file support (per-photo document attachments).
 *
 * Run: node scripts/self-check-result-files.mjs
 *
 * Covers the pure pieces that don't need the Tauri shell: the file-type
 * allowlist resolution, the RTF text stripper, the storage/migration wiring
 * (table exists, migration registered Rust-side, service + viewer modules
 * present, pdf.js worker assets synced + CSP-granted). Fails loudly
 * (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

// In-app preview kinds: the viewer renders these without a copy on disk.
assert.equal(resultFilePreviewKind('pathology.pdf'), 'pdf');
assert.equal(resultFilePreviewKind('scan.png'), 'image');
// TIFF/HEIC decode on some webviews only — attempted as images, with the
// viewer swapping to the fallback panel when the decode fails.
assert.equal(resultFilePreviewKind('scan.tiff'), 'image');
assert.equal(resultFilePreviewKind('photo.heic'), 'image');
// RTF previews as stripped text.
assert.equal(resultFilePreviewKind('letter.rtf'), 'text');
assert.equal(resultFilePreviewKind('results.csv'), 'text');
// Office formats have no in-app preview — fall back to "save a copy".
for (const name of ['report.docx', 'letter.doc', 'labs.xlsx', 'sheet.ods']) {
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
assert.match(section, /setViewing/, 'file rows open the in-app viewer');

const viewer = readFileSync(
  join(root, 'components/photo/result-file-viewer.tsx'),
  'utf8',
);
assert.match(viewer, /createObjectURL/, 'images load bytes as a blob URL');
assert.match(viewer, /revokeObjectURL/, 'blob URLs are revoked, not leaked');
assert.match(viewer, /resultFilePreviewKind/, 'pane choice comes from the allowlist kinds');

// PDFs render through react-pdf (canvas re-render per zoom step = crisp),
// with the worker served from the app's own origin.
const pdfPane = readFileSync(
  join(root, 'components/photo/result-pdf-pane.tsx'),
  'utf8',
);
assert.match(pdfPane, /from 'react-pdf'/, 'PDFs render via react-pdf');
// react-pdf v10 ignores options.workerSrc (its own default is a relative
// path that can't resolve) — the pdf.js global is the only thing that works,
// and it must point at the same-origin synced asset.
assert.match(
  pdfPane,
  /GlobalWorkerOptions\.workerSrc = '\/pdfjs\/pdf\.worker\.min\.mjs'/,
  'pdf.js worker global points at the same-origin synced worker',
);
assert.match(pdfPane, /isEvalSupported: false/, 'pdf.js must not eval under the packaged CSP');
// WebKit kills the webview when a canvas allocation spikes — the render must
// be budgeted (DPR cap + canvas pixel cap), and pdf.js gets its own byte
// copy because it takes ownership of (detaches) the buffer it is handed.
assert.match(pdfPane, /MAX_DEVICE_PIXEL_RATIO/, 'render DPR is capped');
assert.match(pdfPane, /MAX_CANVAS_AREA_PX/, 'canvas pixel budget enforced');
assert.match(pdfPane, /bytes\.slice\(\)/, 'pdf.js receives a private buffer copy');
assert.match(
  viewer,
  /PaneErrorBoundary/,
  'panes render inside an error boundary (a render throw must not take the app down)',
);

// The worker + standard fonts are synced out of pdfjs-dist by a script hooked
// into the npm lifecycle, and the generated copy stays out of git.
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.ok(pkg.dependencies['react-pdf'], 'react-pdf is a dependency');
assert.match(pkg.scripts.prebuild, /sync-pdfjs-assets/);
assert.match(pkg.scripts.predev, /sync-pdfjs-assets/);
assert.ok(existsSync(join(root, 'public/pdfjs/pdf.worker.min.mjs')), 'worker asset is synced');
const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
assert.match(gitignore, /public\/pdfjs/, 'generated pdfjs assets are gitignored');

// The packaged CSP must let the app spawn its own pdf.js worker (worker-src),
// and the old blob: frame grant is gone now that PDFs render to canvas
// instead of an iframe.
const tauriConf = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
for (const key of ['csp', 'devCsp']) {
  const csp = tauriConf.app.security[key];
  assert.ok(csp, `tauri.conf.json must define app.security.${key}`);
  const workerSrc = /worker-src\s+([^;]+)(?:;|$)/.exec(csp)?.[1];
  assert.ok(workerSrc, `${key} must grant worker-src for the pdf.js worker`);
  assert.match(workerSrc, /'self'/, `${key} worker-src must allow 'self'`);
  const frameSrc = /frame-src\s+([^;]+)(?:;|$)/.exec(csp)?.[1];
  assert.ok(frameSrc, `${key} keeps an explicit frame-src`);
  assert.doesNotMatch(frameSrc, /blob:/, `${key} frame-src drops the unused blob: grant`);
}

// RTF previews as stripped plain text: paragraphs, accents (hex + unicode
// escapes), escaped braces, and no font-table junk.
const { rtfToPlainText } = await import(join(root, 'lib/utils/rtf-text.ts'));
const rtf = rtfToPlainText(
  String.raw`{\rtf1\ansi{\fonttbl{\f0 Helvetica;}}{\*\generator x;}\b Bold\b0  \'e9 \u233? \par line 2\par \{ok\}}`,
);
assert.ok(rtf.includes('Bold é é'), `RTF text escapes decode: ${JSON.stringify(rtf)}`);
assert.ok(rtf.includes('line 2'), 'RTF paragraphs become newlines');
assert.ok(rtf.includes('{ok}'), 'RTF escaped braces survive');
assert.ok(!rtf.includes('Helvetica') && !rtf.includes('generator'), 'RTF data groups are dropped');

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
