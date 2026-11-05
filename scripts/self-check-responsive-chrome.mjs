// Self-check for the dashboard chrome's horizontal containment and the
// capture dialog's small-screen scroll regime.
//
// Run: node scripts/self-check-responsive-chrome.mjs
//
// Pins (behaviourally verified in a browser harness: a horizontal wheel pan
// renders scrollLeft inert and the sticky top bar stays beside the fixed
// sidebar; the capture dialog scrolls as one region below @3xl and keeps
// independent panes above):
//  1. the root clips document-level horizontal overflow — a wide element can
//     never drag the (sticky) header sideways over the (fixed) sidebar;
//  2. the clip also lives on SidebarInset, NOT its flex parent — Chromium
//     collapses empty fixed-width flex items (the sidebar gap) when the flex
//     container itself clips;
//  3. the thin warning banners wrap instead of forcing the page wide;
//  4. the capture dialog below @3xl scrolls as ONE region (natural rows) and
//     splits into independently-scrolling panes at @3xl+, matching the other
//     bounded dialogs ("nothing hidden, Save reachable by scrolling").
// Fails loudly (non-zero exit) if any invariant breaks.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// 1+2 — containment
const globals = read('app/globals.css');
assert.ok(
  /overflow-x:\s*clip/.test(globals),
  'globals.css: html must clip horizontal overflow (chrome anchoring)',
);
const layout = read('app/(dashboard)/layout.tsx');
assert.ok(
  /<SidebarInset className="overflow-x-clip">/.test(layout),
  'layout: SidebarInset must clip its own content',
);
assert.ok(
  !/<SidebarProvider[^>]*overflow-x-clip/.test(layout),
  'layout: the clip must not sit on the flex parent (Chromium collapses empty fixed-width flex items there, breaking the sidebar gap)',
);

// 3 — banners wrap
for (const [file, label] of [
  ['components/licence/licence-banner.tsx', 'licence banner'],
  ['components/dashboard/disk-encryption-banner.tsx', 'disk encryption banner'],
]) {
  const src = read(file);
  const rows = src.match(/flex items-center justify-center[^"']*/g) ?? [];
  assert.ok(
    rows.every((row) => row.includes('flex-wrap')),
    `${label}: every banner row must wrap — nowrap rows are what dragged the page wide`,
  );
}

// 4 — capture dialog scroll regime
const capture = read('components/capture/capture-dialog.tsx');
const wrapperWindow = capture.slice(
  capture.indexOf('@container flex min-h-0 flex-1 flex-col gap-6'),
);
assert.ok(
  wrapperWindow.includes('overflow-y-auto @3xl:overflow-hidden'),
  'capture: the panes wrapper must be the one scroll region below @3xl',
);
assert.ok(
  capture.includes('grid-rows-[auto_auto] gap-6 @3xl:grid-cols-2 @3xl:grid-rows-1 @3xl:min-h-0 @3xl:flex-1'),
  'capture: the grid must use natural rows below @3xl and the two-pane grid above',
);

console.log('responsive-chrome: containment, banner wrap and capture scroll regime pinned');
