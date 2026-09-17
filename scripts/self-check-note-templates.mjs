/**
 * Self-check for the documentation helpers:
 * - lib/utils/note-tokens.ts (token substitution)
 * - lib/utils/text-expansion.ts (type-a-shortcut expansion)
 * - the wiring of migration 024 (note_templates) and both clinician-facing
 *   forms (capture/upload + photo detail).
 *
 * Run: node scripts/self-check-note-templates.mjs
 *
 * The expansion function is the contract between the notes textarea and the
 * template store: it must fire only at word boundaries, match shortcuts
 * case-insensitively, refuse to blow past the 2000-char note cap, and never
 * insert anything for a non-matching word. Token substitution must leave
 * unresolvable tokens literal — clinical notes must never silently lose text.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveNoteTokens } from '../lib/utils/note-tokens.ts';
import { expandShortcutAtCaret } from '../lib/utils/text-expansion.ts';
import { STARTER_TEMPLATES } from '../lib/utils/note-template-starters.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

// ---------- starter set: unique samples, placeholders demonstrated ----------

assert.equal(STARTER_TEMPLATES.length, 8, 'exactly 8 starter templates');
const uniq = (xs) => new Set(xs).size === xs.length;
assert.ok(uniq(STARTER_TEMPLATES.map((t) => t.slug)), 'starter slugs unique');
assert.ok(uniq(STARTER_TEMPLATES.map((t) => t.title)), 'starter titles unique');
assert.ok(uniq(STARTER_TEMPLATES.map((t) => t.body)), 'starter bodies unique — no near-duplicate samples');
const starterShortcuts = STARTER_TEMPLATES.map((t) => t.shortcut).filter(Boolean);
assert.ok(uniq(starterShortcuts), 'starter shortcuts unique');

const allBodies = STARTER_TEMPLATES.map((t) => t.body).join('\n');
for (const token of ['{date}', '{patient}', '{bodypart}']) {
  assert.ok(allBodies.includes(token), `placeholder ${token} demonstrated in the samples`);
}

const shortcutRe = /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,15}$/;
for (const t of STARTER_TEMPLATES) {
  if (t.shortcut) {
    assert.match(t.shortcut, shortcutRe, `starter shortcut ${t.shortcut} matches the schema regex`);
  }
}

// ---------- token substitution ----------

const midwinter = new Date(2026, 5, 4); // 4 June 2026 → 04/06/2026 (AU)

assert.equal(
  resolveNoteTokens('Reviewed {date} — stable.', { now: midwinter }),
  'Reviewed 04/06/2026 — stable.',
  '{date} becomes DD/MM/YYYY',
);

assert.equal(
  resolveNoteTokens('{patient}: {bodypart} lesion', {
    patient: 'Jane Citizen',
    bodyPart: 'Left cheek',
    now: midwinter,
  }),
  'Jane Citizen: Left cheek lesion',
  '{patient} and {bodypart} resolve when known',
);

// Unknown values stay literal — a note must never silently lose text.
assert.equal(
  resolveNoteTokens('{patient} reports change', { now: midwinter }),
  '{patient} reports change',
  'missing patient stays literal',
);
assert.equal(
  resolveNoteTokens('{bodypart} reviewed {date}', { bodyPart: '   ', now: midwinter }),
  '{bodypart} reviewed 04/06/2026',
  'whitespace-only body part stays literal',
);
assert.equal(
  resolveNoteTokens('Plan per {chief} protocol', { now: midwinter }),
  'Plan per {chief} protocol',
  'unknown tokens pass through untouched',
);

// ---------- shortcut expansion ----------

const shortcuts = { ncp: 'No change since the previous photo.' };

{
  const text = 'Lesion review: ncp';
  const outcome = expandShortcutAtCaret({ text, caret: text.length, shortcuts });
  assert.ok(outcome?.applied, 'shortcut at end of text expands');
  assert.equal(outcome.text, 'Lesion review: No change since the previous photo.');
  assert.equal(outcome.caret, 'Lesion review: No change since the previous photo.'.length);
  assert.equal(outcome.shortcut, 'ncp');
}

// Case-insensitive match; the typed case is replaced.
{
  const outcome = expandShortcutAtCaret({ text: 'NCP', caret: 3, shortcuts });
  assert.ok(outcome?.applied, 'case-insensitive match');
  assert.equal(outcome.text, 'No change since the previous photo.');
}

// Text after the caret is preserved and the caret lands after the body.
{
  const text = 'ncp — plan reviewed';
  const outcome = expandShortcutAtCaret({ text, caret: 3, shortcuts });
  assert.ok(outcome?.applied, 'expansion mid-text');
  assert.equal(outcome.text, 'No change since the previous photo. — plan reviewed');
  assert.equal(outcome.caret, 'No change since the previous photo.'.length);
}

// Word boundaries: no expansion mid-word, after a partial, or on a miss.
assert.equal(
  expandShortcutAtCaret({ text: 'ncp', caret: 2, shortcuts }),
  null,
  'caret inside the word must not fire',
);
assert.equal(
  expandShortcutAtCaret({ text: 'abncp', caret: 5, shortcuts }),
  null,
  'a longer word containing the shortcut must not fire',
);
assert.equal(
  expandShortcutAtCaret({ text: 'ok ', caret: 3, shortcuts }),
  null,
  'no word before the caret → null',
);
assert.equal(
  expandShortcutAtCaret({ text: 'xyz', caret: 3, shortcuts }),
  null,
  'non-shortcut word → null',
);
assert.equal(
  expandShortcutAtCaret({ text: 'ncp', caret: 3, shortcuts: {} }),
  null,
  'no shortcuts defined → null',
);

// The 2000-char note cap refuses the expansion instead of truncating.
{
  const long = 'x'.repeat(60);
  const outcome = expandShortcutAtCaret({
    text: 'ncp',
    caret: 3,
    shortcuts: { ncp: long },
    maxLength: 50,
  });
  assert.ok(outcome && !outcome.applied && outcome.reason === 'too-long', 'cap refuses, not truncates');
  assert.equal(outcome.shortcut, 'ncp');
}

// Exactly-at-cap still expands (the cap is a limit, not an offset).
{
  const outcome = expandShortcutAtCaret({
    text: 'ncp',
    caret: 3,
    shortcuts: { ncp: '12345' },
    maxLength: 5,
  });
  assert.ok(outcome?.applied, 'at-cap expansion applies');
}

// ---------- wiring: migration, shell registration, forms, preference ----------

const migration = read('src-tauri/migrations/024_note_templates.sql');
for (const needle of [
  'CREATE TABLE IF NOT EXISTS note_templates',
  'clinician_id TEXT NOT NULL',
  'shortcut TEXT',
  'WHERE shortcut IS NOT NULL',
  'usage_count INTEGER NOT NULL DEFAULT 0',
]) {
  assert.ok(migration.includes(needle), `migration 024 contains: ${needle}`);
}

const libRs = read('src-tauri/src/lib.rs');
assert.match(libRs, /version:\s*24[\s\S]*?024_note_templates\.sql/, 'lib.rs registers migration 24');
assert.match(
  libRs,
  /version:\s*25[\s\S]*?025_note_template_starters_v2\.sql/,
  'lib.rs registers migration 25 (v1 starter reset)',
);
const migration25 = read('src-tauri/migrations/025_note_template_starters_v2.sql');
assert.ok(
  migration25.includes("body = 'Reviewed {date} against the previous photo"),
  'migration 25 removes the old v1 starter texts',
);

const service = read('lib/services/note-template-service.ts');
for (const needle of ['listTemplates', 'createTemplate', 'updateTemplate', 'deleteTemplate', 'restoreStarters', 'recordUsage']) {
  assert.ok(service.includes(needle), `note-template-service exposes ${needle}`);
}
// Deterministic starter ids make seeding idempotent: a racing duplicate
// insert loses to OR REPLACE instead of doubling the list.
assert.ok(
  service.includes('uuidv5') && service.includes('INSERT OR REPLACE INTO note_templates'),
  'starter seeding is deterministic + idempotent',
);
assert.equal(
  (service.match(/await ensureWritable/g) || []).length,
  5,
  'writable gate on seeding + the 4 management mutations (usage bump stays best-effort)',
);

const notesField = read('components/photo/clinical-notes-field.tsx');
assert.ok(notesField.includes('expandShortcutAtCaret'), 'notes field wires shortcut expansion');
assert.ok(notesField.includes('resolveNoteTokens'), 'notes field resolves tokens');
assert.ok(notesField.includes('Popover'), 'notes field offers the template picker');

const captureForm = read('components/photo/photo-metadata-form.tsx');
const detailDialog = read('components/photo/photo-detail-dialog.tsx');
for (const [name, src] of [['capture form', captureForm], ['detail dialog', detailDialog]]) {
  assert.ok(src.includes('ClinicalNotesField'), `${name} uses the shared clinical-notes field`);
  assert.ok(src.includes('SubpartInput'), `${name} uses the subpart suggestion input`);
}

const clinicianType = read('types/clinician.ts');
const authService = read('lib/services/auth-service.ts');
assert.ok(
  clinicianType.includes('showSubpartSuggestions') &&
    authService.includes('showSubpartSuggestions: parsed.showSubpartSuggestions ?? true'),
  'showSubpartSuggestions preference typed + defaulted on',
);

const settingsPage = read('app/(dashboard)/settings/page.tsx');
assert.ok(
  settingsPage.includes('NoteTemplatesPanel') && settingsPage.includes('value="templates"'),
  'settings page carries the Templates tab',
);

console.log('self-check-note-templates: all assertions passed');
