/**
 * Self-check: every `INSERT INTO photos` in photo-service.ts must be
 * internally consistent — one bind parameter per $N placeholder, and
 * VALUES entries (placeholders + literals) = column count. A mismatch is
 * rejected by tauri-plugin-sql only at runtime (the whole save fails), and
 * neither tsc nor eslint can see inside SQL template strings — this check
 * exists because exactly that mismatch once broke every photo save.
 *
 * Run: node scripts/self-check-photo-insert.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'services', 'photo-service.ts'),
  'utf8',
);

// Split a JS array/object body on top-level commas only — bind entries may
// contain nested brackets (function calls, arrays) that must not split.
function topLevelEntries(body) {
  const entries = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    if (ch === ',' && depth === 0) {
      entries.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) entries.push(current);
  return entries.filter((e) => e.trim());
}

const insertRe = /INSERT INTO photos\s*\(([^)]*)\)\s*VALUES \(([^)]*)\)`\s*,\s*\[([\s\S]*?)\]\s*\)/g;
const matches = [...source.matchAll(insertRe)];
assert.ok(matches.length >= 1, 'at least one INSERT INTO photos with a bind array found');

matches.forEach((match, i) => {
  const columns = match[1].split(',').map((c) => c.trim()).filter(Boolean);
  const valueEntries = match[2].split(',').map((v) => v.trim()).filter(Boolean);
  const placeholders = valueEntries.filter((v) => /^\$\d+$/.test(v));
  const literals = valueEntries.filter((v) => !/^\$\d+$/.test(v));
  const bindEntries = topLevelEntries(match[3]);

  assert.equal(
    placeholders.length + literals.length,
    columns.length,
    `INSERT #${i + 1}: VALUES entries must match the ${columns.length} columns`,
  );
  assert.equal(
    placeholders.length,
    bindEntries.length,
    `INSERT #${i + 1}: ${placeholders.length} placeholders but ${bindEntries.length} bind params`,
  );
  assert.equal(
    Math.max(...placeholders.map((p) => Number(p.slice(1)))),
    placeholders.length,
    `INSERT #${i + 1}: placeholder numbers must be contiguous from $1`,
  );
});

console.log(
  `self-check-photo-insert: ${matches.length} INSERT statement(s), columns/placeholders/binds consistent`,
);
