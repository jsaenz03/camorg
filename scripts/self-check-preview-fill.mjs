#!/usr/bin/env node
/**
 * Preview-fill pin.
 *
 * Three previews sit in an aspect-video box inside a ScrollArea: the capture
 * dialog's captured photo, the upload dialog's blob preview, and the built-in
 * camera's live video (rendered by the capture dialog's pane). Radix's
 * ScrollArea wraps its content in a display:table div, and WebKit lays out
 * an auto-height table's contents with percentage heights unresolved. A
 * static img's h-full fell back to the photo's natural pixel height (1080px),
 * and object-contain centred the picture far below the clipped box — a black
 * preview on macOS until the photo was saved. The live video fell back to
 * its frame height once frames arrived and stretched its box — a zoomed
 * preview. Chromium resolves the percentage, so the Chromium-measured
 * Playwright suite cannot see it. An absolutely positioned element resolves
 * against the box instead, with h-full w-full doing the sizing (an
 * auto-sized img keeps its ratio under the preflight's max-width: 100%, so a
 * portrait photo overflows the box); inset-0 just anchors it. These are the
 * only img and video elements under a ScrollArea.
 *
 * shortcut: a source-text pin — it checks each element's own classes, not
 * its parent's `relative` or the rendered layout, and a complete tag written
 * in a // comment can satisfy it. Its tag scan handles brace expressions up
 * to one nesting level (style={{ … }}); deeper braces fail closed as
 * "not found". Upgrade path: a measured WebKit Playwright project — headless
 * Playwright WebKit reproduces this — asserting that each preview fills its
 * box.
 *
 * Run: node scripts/self-check-preview-fill.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** [file, element, the attribute its preview tag is known by] */
const PREVIEWS = [
  ['components/capture/capture-dialog.tsx', 'img', 'alt="Captured photo"'],
  ['components/photo/photo-upload.tsx', 'img', 'alt="Photo to add"'],
  ['components/camera/camera-capture.tsx', 'video', 'aria-label="Camera preview"'],
];

const FILL = ['absolute', 'inset-0', 'h-full', 'w-full'];

for (const [file, element, attribute] of PREVIEWS) {
  // Comments dropped first: the pin must bind to markup, not to prose.
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // Opening tags: plain attribute text, quoted values, or {expressions} up to
  // one nesting level (style={{ … }}); deeper braces fail closed as "not found".
  const tags = src.match(new RegExp(`<${element}\\b(?:[^{}>"]|"[^"]*"|\\{(?:[^{}]|\\{[^{}]*\\})*\\})+>`, 'g')) ?? [];
  const carries = new RegExp(`\\s${attribute}(?=\\s|/)`);
  const previews = tags.filter((tag) => carries.test(tag));
  assert.ok(previews.length > 0, `${file}: preview ${element} (${attribute}) not found`);
  for (const tag of previews) {
    // \s before className so a look-alike attribute (data-className=…) cannot supply the classes.
    const tokens = new Set((/\sclassName="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/));
    const missing = FILL.filter((token) => !tokens.has(token));
    assert.equal(missing.length, 0, `${file}: the preview ${element} is missing ${missing.join(' ')} — a static h-full ${element} inside a ScrollArea falls back to its natural height in WebKit`);
  }
}

console.log(`preview-fill: ${PREVIEWS.length} previews pinned, all ${FILL.join(' ')}`);
