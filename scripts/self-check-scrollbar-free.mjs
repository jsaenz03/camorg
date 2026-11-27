#!/usr/bin/env node
/**
 * Scrollbar-abolition pins — the modal-open canvas shift fix.
 *
 * react-remove-scroll (which scroll-locks every Radix Dialog and Select)
 * measures gap = innerWidth − documentElement.clientWidth and injects
 * body[data-scroll-locked] { margin-right: <gap>px !important } even though
 * html's overflow-x: clip means the lock never removes the viewport scrollbar.
 * Any classic scrollbar (Windows) — and scrollbar-gutter: stable, which
 * reserved the gutter even with nothing to scroll — makes that gap ≈ 17px at
 * all times, so opening a modal pulled the canvas ~17px left and closing let
 * it spring back. The fix hides every scrollbar (scrollbar-width: none, with a
 * ::-webkit-scrollbar fallback) so no scrollbar consumes layout width and the
 * gap is 0 by construction. This pin fails the moment the abolition rules are
 * dropped or a scrollbar gutter is reintroduced.
 *
 * Run: node scripts/self-check-scrollbar-free.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
); // comments stripped: the rationale prose names the retired gutter rule

// 1. The universal rule hides every scrollbar (standard property; Chromium
//    121+ / Safari 18.2+, i.e. both Tauri webviews).
assert.match(
  css,
  /\*\s*\{[^}]*scrollbar-width:\s*none;/,
  'globals.css must hide scrollbars via scrollbar-width: none on the base * rule',
);

// 2. The ::-webkit-scrollbar fallback zeroes the layout footprint on engines
//    without standard scrollbar-width support.
assert.match(
  css,
  /::-webkit-scrollbar\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/,
  'globals.css must zero the ::-webkit-scrollbar fallback footprint',
);

// 3. html still clips horizontal overflow — the containment rule that keeps
//    the Radix scroll-lock inert (body's overflow cannot reach the viewport).
assert.match(
  css,
  /html\s*\{[^}]*overflow-x:\s*clip;/,
  'globals.css must keep overflow-x: clip on html (scroll-lock inertness + horizontal containment)',
);

// 4. scrollbar-gutter must NOT come back: reserving a gutter re-arms the gap
//    (clientWidth < innerWidth) and with it the compensation margin, even with
//    no scrollbar visible.
assert.doesNotMatch(
  css,
  /scrollbar-gutter/,
  'globals.css must not reserve a scrollbar gutter (it re-arms the modal-open shift)',
);

// 5. The measured behaviour is pinned too, so a CSS regression cannot pass
//    unnoticed while the spec still asserts the old regime.
const spec = readFileSync(new URL('../tests/scrollbar-stability.spec.ts', import.meta.url), 'utf8');
assert.match(spec, /scrollbarWidth/, 'scrollbar-stability.spec.ts must pin computed scrollbar-width: none');
assert.match(spec, /bodyMarginRight/, 'scrollbar-stability.spec.ts must pin the body margin-right during the lock');

console.log('scrollbar-free: abolition rules present, gutter absent, spec pins in place');
