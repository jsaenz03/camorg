/**
 * Self-check for the patient search LIKE-pattern escaping.
 *
 * Run: node scripts/self-check-search-escape.mjs
 *
 * Exercises the escape expression used by patientService.searchPatients
 * (lib/services/patient-service.ts) so %, _ and \ match literally instead of
 * acting as SQL LIKE wildcards. Also runs the escaped pattern against an
 * in-process SQLite when the sqlite3 CLI is available, proving the
 * ESCAPE '\' clause behaves. Fails loudly (non-zero exit) on any mismatch.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Keep in sync with patientService.searchPatients.
const escapeLikeWildcards = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

assert.equal(escapeLikeWildcards('100%'), '100\\%', 'percent must be escaped');
assert.equal(escapeLikeWildcards('sm_th'), 'sm\\_th', 'underscore must be escaped');
assert.equal(escapeLikeWildcards('a\\b'), 'a\\\\b', 'backslash must be escaped');
assert.equal(escapeLikeWildcards("o'brien"), "o'brien", 'apostrophe must pass through');
assert.equal(escapeLikeWildcards('smith-jones'), 'smith-jones', 'hyphen must pass through');
assert.equal(escapeLikeWildcards(''), '', 'empty term stays empty');

// End-to-end against real SQLite (skipped silently when sqlite3 is absent).
// execFileSync passes SQL as one argv — no shell unescaping layer.
let ranSql = false;
try {
  const sql = `
    CREATE TABLE t(n TEXT);
    INSERT INTO t VALUES ('100% sure'),('100 x sure'),('sm_th'),('smith');
    SELECT n FROM t WHERE n LIKE '%${escapeLikeWildcards('100%')}%' ESCAPE '\\';
  `;
  const out = execFileSync('sqlite3', [':memory:', sql], { encoding: 'utf8' }).trim();
  assert.equal(out, '100% sure', 'literal % must only match rows containing %');
  ranSql = true;
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log('sqlite3 CLI not found — skipped the live-SQL half of the check.');
  } else {
    throw err;
  }
}

console.log(
  ranSql
    ? 'search-escape self-check passed (pattern + live SQLite)'
    : 'search-escape self-check passed (pattern only)'
);
