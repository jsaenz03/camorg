#!/usr/bin/env node
/**
 * Bounded-dialog structural pins.
 *
 * Every tall dialog must be a bounded flex column: the DialogContent clamps
 * at max-h-[95dvh] with overflow-hidden, the header and footer carry
 * shrink-0 (pinned), and the middle is a min-h-0 flex-1 overflow-y-auto
 * scroll region. Before the fix these dialogs were unbounded grids — on a
 * short window their lower fields and action bar fell below the viewport
 * edge, unreachable (the "Edit patient details" report).
 *
 * The live behaviour (scrolling + reachable action bar) is measured by
 * tests/dialog-bounded.spec.ts against the real page; this script pins the
 * mechanism across all thirteen converted dialogs.
 *
 * Run: node scripts/self-check-dialog-bounded.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BOUNDED = 'flex max-h-[95dvh] flex-col overflow-hidden';

/** [file, dialog anchor (unique string inside the dialog), label] */
const DIALOGS = [
  ["app/(dashboard)/patients/view/page.tsx", 'Edit patient details', 'edit patient'],
  ["app/(dashboard)/patients/view/page.tsx", 'permanently removes the patient', 'delete patient'],
  ['components/patient/add-patient-dialog.tsx', 'Add patient', 'add patient'],
  ['components/patient/record-consent-dialog.tsx', 'Record photo consent', 'record consent'],
  ['components/patient/email-compose-dialog.tsx', 'Email case report', 'email compose'],
  ['components/photo/photo-move-dialog.tsx', 'Move photo to another patient', 'photo move'],
  ['components/photo/photo-link-dialog.tsx', 'Link photos', 'photo link'],
  ['components/licence/licence-activation-dialog.tsx', 'Activate Camog', 'licence activation'],
  ['components/settings/note-templates-panel.tsx', 'Quick text', 'note template editor'],
  ['components/settings/invitations-panel.tsx', 'Create invitation', 'invitations'],
  ['components/settings/patient-access-panel.tsx', 'Choose one sharing mode', 'patient access'],
  ['components/settings/storage-cleanup-dialog.tsx', 'Delete photos from the old folder', 'storage cleanup'],
  ['app/(auth)/login/page.tsx', 'Locked out?', 'forgot passphrase'],
];

const files = new Map();
const source = (file) => {
  if (!files.has(file)) {
    files.set(file, readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  }
  return files.get(file);
};

/** The dialog's source window: from its DialogContent to the closing tag. */
function dialogSource(src, anchor) {
  const at = src.indexOf(anchor);
  assert.ok(at !== -1, `anchor not found: ${anchor}`);
  const start = src.lastIndexOf('<DialogContent', at);
  assert.ok(start !== -1, `no DialogContent before: ${anchor}`);
  const end = src.indexOf('</DialogContent>', at);
  assert.ok(end !== -1, `no DialogContent close after: ${anchor}`);
  return src.slice(start, end);
}

for (const [file, anchor, label] of DIALOGS) {
  const dlg = dialogSource(source(file), anchor);

  assert.ok(
    dlg.includes(BOUNDED),
    `${label}: DialogContent must clamp with "${BOUNDED}"`,
  );
  assert.ok(
    /<DialogHeader className="[^"]*shrink-0/.test(dlg) || /<form[^>]*shrink-0/.test(dlg),
    `${label}: header must carry shrink-0`,
  );
  assert.ok(
    /min-h-0 flex-1 overflow-y-auto/.test(dlg),
    `${label}: middle must be a min-h-0 flex-1 overflow-y-auto scroll region`,
  );
  assert.ok(
    /<DialogFooter className="[^"]*shrink-0|<div className="flex shrink-0/.test(dlg),
    `${label}: footer/action bar must carry shrink-0`,
  );
}

// The email dialog must no longer scroll as a whole (its action bar used to
// scroll out of reach).
assert.ok(
  !dialogSource(source('components/patient/email-compose-dialog.tsx'), 'Email case report')
    .includes('max-h-[calc(100dvh-2rem)] overflow-y-auto'),
  'email compose: whole-dialog overflow-y-auto must be gone',
);

// Narrow windows: the invitation form's two-column grids must stack.
const invitations = source('components/settings/invitations-panel.tsx');
assert.ok(
  !invitations.includes('grid grid-cols-2'),
  'invitations: fixed grid-cols-2 must be sm:-prefixed so it stacks on narrow windows',
);
assert.ok(
  invitations.includes('grid gap-3 sm:grid-cols-2'),
  'invitations: grids collapse to one column until sm',
);

console.log(`dialog-bounded: ${DIALOGS.length} dialogs pinned, all bounded`);
