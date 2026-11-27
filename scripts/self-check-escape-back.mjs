#!/usr/bin/env node
/**
 * Escape-back pins — Escape steps back up the screen hierarchy.
 *
 * components/escape-back.tsx maps each screen to its static parent (the same
 * destinations the pages' own back buttons use) and navigates on Escape only
 * when the screen is clean: no open dialog/overlay (Radix closes those one at
 * a time — including the idle-lock overlay via its data-idle-lock-overlay
 * attribute: it is a bare portal div, role=dialog but no data-state, so the
 * Radix selector misses it), no
 * popper/menu/listbox up, focus not in a text field. Dashboard and Settings
 * are top-level: Escape does nothing there. This pin fails if a guard is
 * dropped, the parent map loses a route, the mount disappears, or the spec
 * stops measuring the chain.
 *
 * Run: node scripts/self-check-escape-back.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const handler = readFileSync(new URL('../components/escape-back.tsx', import.meta.url), 'utf8');

// 1. The handler's contract: guards before navigation, deferred claim after.
assert.match(handler, /event\.key !== 'Escape'/, 'handler must act on plain Escape only');
assert.match(handler, /event\.shiftKey/, 'handler must leave modified Escape alone');
assert.match(handler, /event\.repeat|event\.isComposing/, 'handler must ignore repeats and IME composition');
assert.match(
  handler,
  /\[role="dialog"\]\[data-state="open"\]/,
  'handler must yield to open dialogs (Radix closes them; next Escape steps back)',
);
assert.match(
  handler,
  /\[data-idle-lock-overlay\]/,
  'handler must yield to the idle-lock overlay (bare portal div — role=dialog but no data-state, so the Radix selector misses it)',
);
assert.match(handler, /data-radix-popper-content-wrapper/, 'handler must yield to open poppers');
assert.match(handler, /\[role="menu"\],\[role="listbox"\]/, 'handler must yield to open menus and select panels');
assert.match(handler, /data-escape-owner/, 'handler must yield to fullscreen Escape owners (photo annotator)');
assert.match(handler, /target\.isContentEditable/, 'handler must yield to text-entry focus (inputs, textareas, editors)');
assert.match(
  handler,
  /setTimeout\([\s\S]{0,120}event\.defaultPrevented\) return;/,
  'navigation must be deferred past the dispatch and skipped if a page-level owner claimed the Escape',
);
assert.doesNotMatch(
  handler,
  /event\.(preventDefault|stopPropagation)\(/,
  'the synchronous listener must never consume Escape — page owners claim it, deference is the protocol',
);

// 2. The parent map: every step of the user-stated chain plus the sibling
//    top-level tabs; dashboard/settings deliberately unmapped.
assert.match(handler, /path === '\/patients\/report'/, 'report must step back to the patient');
assert.match(handler, /\/patients\/view\?id=/, 'report → patient must carry the patient id');
assert.match(handler, /path === '\/patients\/view'\) return '\/patients'/, 'patient must step back to the patient list');
assert.match(handler, /path === '\/patients' \|\| path === '\/photos' \|\| path === '\/compare'\) return '\/'/, 'patient list, photos and compare must step back to the dashboard');
assert.match(handler, /return null; \/\/ dashboard, settings/, 'dashboard and settings must stay unmapped (Escape free)');

// 3. Page-level Escape owners must claim the event (preventDefault) when
//    they act, so the deferred navigation only fires on unclaimed presses —
//    the layering band → selection → step back holds by construction.
const CLAIM = /e\.key === 'Escape' && !e\.defaultPrevented[\s\S]{0,320}e\.preventDefault\(\)/;
for (const owner of ['components/photo/photo-timeline.tsx', 'app/(dashboard)/photos/page.tsx']) {
  const src = readFileSync(new URL(`../${owner}`, import.meta.url), 'utf8');
  assert.match(src, CLAIM, `${owner} must claim the Escape it handles (preventDefault after the clear)`);
}
const detailDialog = readFileSync(new URL('../components/photo/photo-detail-dialog.tsx', import.meta.url), 'utf8');
assert.match(
  detailDialog,
  /data-escape-owner/,
  'the photo annotator must mark its fullscreen root data-escape-owner',
);

// 4. Mounted once in the dashboard layout.
const layout = readFileSync(new URL('../app/(dashboard)/layout.tsx', import.meta.url), 'utf8');
assert.match(layout, /import { EscapeBack } from '@\/components\/escape-back'/, 'dashboard layout must import EscapeBack');
assert.equal(layout.split('<EscapeBack />').length - 1, 1, 'dashboard layout must render <EscapeBack /> exactly once');

// 5. The measured behaviour is pinned too.
const spec = readFileSync(new URL('../tests/escape-back.spec.ts', import.meta.url), 'utf8');
assert.match(spec, /\/patients\/report\?id=p1/, 'escape-back spec must walk the report chain');
assert.match(spec, /closes an open dialog first/, 'escape-back spec must pin the dialog-first layering');
assert.match(spec, /text field does not navigate/, 'escape-back spec must pin the typing guard');

console.log('escape-back: guards + parent map + mount + spec pins accounted for');
