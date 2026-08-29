// Self-check for the brand palette derivation (lib/branding.ts).
// Run: node scripts/self-check-branding.mjs
// Imports the real module — Node 24 strips TS types by default, and the
// module is deliberately dependency-free so the selfcheck runs under plain
// Node (same trick as bondy's selfcheck).

import assert from 'node:assert/strict';
import {
  normaliseHex,
  mixHex,
  contrastRatio,
  pickReadableInk,
  brandStyleCss,
  DARK_BG,
} from '../lib/branding.ts';

// normaliseHex: 3- and 6-digit, case folding, junk rejection.
assert.equal(normaliseHex('#FF00aa'), '#ff00aa');
assert.equal(normaliseHex('abc'), '#aabbcc');
assert.equal(normaliseHex('#00ff00'), '#00ff00');
assert.equal(normaliseHex(''), null);
assert.equal(normaliseHex('not-a-colour'), null);
assert.equal(normaliseHex('#12345'), null);

// mixHex: midpoint black↔white, clamping beyond both ends.
assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
assert.equal(mixHex('#000000', '#ffffff', 0), '#000000');
assert.equal(mixHex('#000000', '#ffffff', 1), '#ffffff');

// WCAG reference values: black/white = 21:1, identical = 1:1.
assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
assert.equal(contrastRatio('#808080', '#808080'), 1);

// Ink choice: dark ink on white, white ink on black.
assert.equal(pickReadableInk('#ffffff'), '#1c1c1f');
assert.equal(pickReadableInk('#000000'), '#ffffff');

// No colours set → no stylesheet (the built-in teal stands).
assert.equal(brandStyleCss(null, null), null);

// A brand colour produces both theme blocks, .dark second so it wins the
// specificity tie.
const css = brandStyleCss('#000080', null);
assert.ok(css);
assert.ok(css.startsWith(':root {'));
assert.ok(css.includes('.dark {'));
assert.ok(css.indexOf('.dark {') > css.indexOf(':root {'));
// Light theme keeps the colour verbatim; dark theme lightens it until it
// reads ≥4.5:1 on the dark background.
const light = css.match(/:root \{\n  --primary: (#\w{6});/);
const dark = css.match(/\.dark \{\n  --primary: (#\w{6});/);
assert.ok(light && dark);
assert.equal(light[1], '#000080');
assert.ok(contrastRatio(dark[1], DARK_BG) >= 4.5, 'dark primary must read ≥4.5:1 on the dark background');

// Accent-only input still emits the accent vars in both themes.
const accentCss = brandStyleCss(null, '#ff8800');
assert.ok(accentCss);
assert.ok(accentCss.includes('--accent:'));
assert.ok(accentCss.includes('--sidebar-accent-foreground:'));

console.log('branding self-check passed');
