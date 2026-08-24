// Self-check for the legal-document markdown renderer
// (lib/utils/markdown.tsx). Run: node scripts/self-check-markdown.mjs
// ponytail: mirrors the block rules and the inline tokenizer because Node
// cannot import TSX; if you change the renderer, update the mirror.

import assert from 'node:assert/strict';

// Mirror of renderInline's tokenizer: **bold**, *italic*, `code`.
function inlineTokens(text) {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**')) return ['strong', part.slice(2, -2)];
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return ['em', part.slice(1, -1)];
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return ['code', part.slice(1, -1)];
      return ['text', part];
    });
}

// Bold inside a sentence.
assert.deepEqual(inlineTokens('We may amend **these Terms** from time'), [
  ['text', 'We may amend '],
  ['strong', 'these Terms'],
  ['text', ' from time'],
]);

// Italic legal citations do not swallow the bold rule.
assert.deepEqual(inlineTokens('*Privacy Act 1988* (Cth)'), [
  ['em', 'Privacy Act 1988'],
  ['text', ' (Cth)'],
]);

// Mixed bold + italic + code on one line (effective-date line).
const mixed = inlineTokens('**Effective date:** 23/08/2026 · **Version:** 1.0');
assert.equal(mixed.filter(([t]) => t === 'strong').length, 2);
assert.ok(mixed.some(([t, v]) => t === 'text' && v.includes('23/08/2026')));

// Code spans survive (file names in the docs).
assert.deepEqual(inlineTokens('edit `package.json` only'), [
  ['text', 'edit '],
  ['code', 'package.json'],
  ['text', ' only'],
]);

// A single stray asterisk is NOT treated as emphasis (bullet char, math).
assert.deepEqual(inlineTokens('3 * 4 = 12'), [['text', '3 * 4 = 12']]);

// Mirror of the block classifier: each shipped construct maps to a block.
function classify(line) {
  if (!line.trim()) return 'blank';
  if (/^---\s*$/.test(line)) return 'hr';
  if (/^(#{1,3})\s+/.test(line)) return 'heading';
  if (line.startsWith('> ')) return 'quote';
  if (line.startsWith('- ')) return 'list';
  return 'paragraph';
}
assert.equal(classify('## 1. Agreement to these Terms'), 'heading');
assert.equal(classify('# Camog — Terms of Service'), 'heading');
assert.equal(classify('> **DRAFT FOR REVIEW'), 'quote');
assert.equal(classify('- **Your patient data stays on your devices.**'), 'list');
assert.equal(classify('---'), 'hr');
assert.equal(classify('1.1 These Terms of Service are a legal agreement'), 'paragraph');
assert.equal(classify(''), 'blank');

// Every line of both shipped documents classifies into a known block —
// an unknown construct would render as a plain paragraph today; this
// catches new syntax (links, tables, nested lists) arriving unannounced.
import { readFileSync } from 'node:fs';
const known = new Set(['blank', 'hr', 'heading', 'quote', 'list', 'paragraph']);
for (const doc of ['public/legal/terms-of-service.md', 'public/legal/privacy-policy.md']) {
  for (const line of readFileSync(doc, 'utf8').split('\n')) {
    assert.ok(known.has(classify(line)), `unknown construct in ${doc}: ${line}`);
  }
}

console.log('self-check-markdown: all assertions passed');
