#!/usr/bin/env node
/**
 * Select width-stability pins.
 *
 * The Select primitive's trigger defaults to w-fit, so a trigger that does
 * not declare a width policy resizes to its selected value and reflows its
 * row on every selection. The layout-shift audit behind this pin found six
 * such triggers: the compare page's patient pickers resized against their
 * grid pair, the compare-view filter selects squeezed the photo pickers
 * beside them, and the consent / invitations / forgot-passphrase forms
 * resized their field against the full-width inputs around it. Every
 * trigger now reserves its width — w-full in forms and grid columns, fixed
 * w-[…] in toolbar rows — and the rule is pinned so new selects can't
 * regress to w-fit. DropdownMenu triggers are out of scope: their content
 * never changes with use, and their menus render in a portal.
 *
 * Run: node scripts/self-check-select-stability.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'components'];
/** A trigger reserves its row's width against value changes (CLS rule). */
const WIDTH_POLICY = /(^|\s)(w-|min-w-|max-w-|flex-1|basis-)/;
const TRIGGER = /<SelectTrigger\b/g;
const NATIVE = /<select\b/g;

/** The opening tag's source: scan to the unquoted, unbraced `>`. */
function openingTag(src, start) {
  let quote = null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (depth === 0 && ch === '>') return src.slice(start, i + 1);
  }
  return '';
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      // ui/ primitives are exempt: the w-fit default is what call sites
      // override, and the Select primitive itself can't state a width.
      if (p === 'components/ui') continue;
      out.push(...walk(p));
    } else if (p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const offenders = [];
let triggers = 0;
let nativeSelects = 0;

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    for (const pattern of [TRIGGER, NATIVE]) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(src)) !== null) {
        const tag = openingTag(src, m.index);
        const line = src.slice(0, m.index).split('\n').length;
        if (pattern === TRIGGER) triggers++;
        else nativeSelects++;
        const className = tag.match(/className="([^"]*)"/)?.[1];
        // Triggers pass className through to the DOM element directly in
        // this codebase; a cn()/template value would need the rule restated
        // rather than silently passing — flag it.
        if (!className || !WIDTH_POLICY.test(className)) {
          offenders.push(`${file}:${line} — ${tag.split('\n')[0].trim()}`);
        }
      }
    }
  }
}

assert.ok(triggers >= 20, `expected >= 20 SelectTriggers, scanned ${triggers} — the walk is broken`);
  assert.ok(nativeSelects >= 1, `expected the settings/annotator native selects, scanned ${nativeSelects}`);
assert.deepEqual(offenders, [], [
  'Selects without a width policy (they resize on selection and reflow their row):',
  ...offenders,
  'Give them w-full in a form/grid cell, or a fixed w-[…] in a toolbar row.',
].join('\n'));

console.log(`select-stability: ${triggers} SelectTriggers + ${nativeSelects} native selects all declare a width policy`);
