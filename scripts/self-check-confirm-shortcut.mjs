#!/usr/bin/env node
/**
 * Ctrl/Cmd+Enter confirm-shortcut pins.
 *
 * One dashboard-mounted capture-phase listener (components/confirm-shortcut.tsx)
 * commits the topmost open Radix dialog: a <form> via requestSubmit() — gated
 * on the dialog's own primary submitter so a disabled save button (isSaving,
 * typed-CLEAR destructive confirms) blocks the shortcut just like a click —
 * else a button explicitly marked data-confirm-shortcut (button-driven
 * dialogs with no form). This pin fails if the handler loses any of those
 * behaviours, the mount disappears, or the marked-button set drifts.
 *
 * Run: node scripts/self-check-confirm-shortcut.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const handler = readFileSync(new URL('../components/confirm-shortcut.tsx', import.meta.url), 'utf8');

// 1. The handler's contract.
assert.match(handler, /event\.ctrlKey \|\| event\.metaKey/, 'handler must accept Ctrl (Windows) and Cmd (macOS) + Enter');
assert.match(handler, /event\.repeat|event\.isComposing/, 'handler must ignore held-key repeats and IME composition');
assert.match(handler, /open\[open\.length - 1\]/, 'handler must act on the topmost open dialog');
assert.match(handler, /submitter\?\.disabled/, 'handler must respect the dialog own disabled submitter gate');
assert.match(handler, /form\.requestSubmit\(\)/, 'handler must drive forms through requestSubmit (validation runs)');
assert.match(handler, /event\.stopPropagation\(\)/, 'handler must consume the event (no double submits from per-field Enter handlers)');
assert.match(handler, /data-confirm-shortcut/, 'handler must fall back to marked buttons for form-less dialogs');

// 2. Mounted once in the dashboard layout.
const layout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8');
assert.match(layout, /import { ConfirmShortcut } from '@\/components\/confirm-shortcut'/, 'dashboard layout must import ConfirmShortcut');
assert.equal(layout.split('<ConfirmShortcut />').length - 1, 1, 'dashboard layout must render <ConfirmShortcut /> exactly once');

// 3. The marked-button set: button-driven confirm dialogs. A new marker
//    belongs here; a removed marker means that dialog gained a form (update
//    this list).
const EXPECTED = [
  'components/settings/storage-cleanup-dialog.tsx',
  'components/settings/patient-access-panel.tsx',
  'components/photo/import-photos-dialog.tsx',
  'components/photo/photo-move-dialog.tsx',
  'components/licence/licence-activation-dialog.tsx',
  'components/companion/phone-link-dialog.tsx',
  'app/(dashboard)/patients/view/page.tsx',
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const marked = [];
for (const root of ['components', 'app']) {
  for (const file of walk(root)) {
    // The handler component itself is exempt: it defines the marker, like the
    // ui/ primitives are exempt from the select width scan.
    if (file === join('components', 'confirm-shortcut.tsx')) continue;
    const n = readFileSync(file, 'utf8').split('data-confirm-shortcut').length - 1;
    if (n > 0) marked.push(`${file}:${n}`);
  }
}
const markedSet = marked.map((m) => m.split(':')[0]).sort();
assert.deepEqual(
  markedSet,
  [...EXPECTED].sort(),
  `data-confirm-shortcut markers drifted — expected exactly:\n  ${EXPECTED.join('\n  ')}\nfound:\n  ${markedSet.join('\n  ')}`,
);
for (const entry of marked) {
  const [, n] = entry.split(':');
  assert.equal(n, '1', `${entry} must carry the marker exactly once`);
}

// 4. The measured behaviour is pinned too.
const spec = readFileSync(new URL('../tests/confirm-shortcut.spec.ts', import.meta.url), 'utf8');
assert.match(spec, /Control\+Enter/, 'confirm-shortcut spec must drive Ctrl+Enter');
assert.match(spec, /Meta\+Enter/, 'confirm-shortcut spec must drive Cmd+Enter');
assert.match(spec, /insert into patients/, 'confirm-shortcut spec must assert the real commit path ran');

console.log(`confirm-shortcut: handler contract + mount pinned, ${markedSet.length} marked buttons accounted for`);
