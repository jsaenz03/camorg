// Self-check for the photo query WHERE assembly (lib/services/photo-service.ts).
// Run: node scripts/self-check-photo-where.mjs
// Catches the "near ORDER" class of bug: a dangling WHERE (or any malformed
// clause) when the admin access filter is empty. Executes the real SQL shape
// against live sqlite3 when available; string-level asserts otherwise.
// ponytail: mirrors whereSql + the two query templates because Node cannot
// import the TS module graph; if you change the queries, update the mirror.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const ADMIN_ACCESS = ''; // getAccessiblePatientFilter for admins
const NON_ADMIN_ACCESS = `AND (
        p.owner_clinician_id = $N
        OR p.is_org_shared = 1
        OR EXISTS (SELECT 1 FROM patient_shares ps WHERE ps.patient_id = p.id AND ps.clinician_id = $N)
      )`.replace(/\$N/g, () => '$ACCESS');

function whereSql(conditions, accessSql) {
  const parts = [...conditions, accessSql.replace(/^AND\s+/i, '').trim()].filter((p) => p.length > 0);
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

function accessWithBind(accessSql, bindNo) {
  return accessSql.replaceAll('$ACCESS', `$${bindNo}`);
}

// The two query templates as shipped (summaries + page/list).
function summariesQuery(where) {
  return `SELECT ph.id, ph.patient_id, ph.body_part, ph.captured_at, ph.is_deleted,
              p.name AS patient_name
         FROM photos ph
         JOIN patients p ON p.id = ph.patient_id
         ${where}
        ORDER BY ph.captured_at DESC`;
}
function pageQuery(where) {
  return `SELECT ph.* FROM photos ph JOIN patients p ON p.id = ph.patient_id ${where} ORDER BY ph.captured_at DESC LIMIT 10 OFFSET 0`;
}

// String-level: no dangling WHERE, no double WHERE, nothing before ORDER BY.
function assertWellFormed(where) {
  const trimmed = where.trim();
  if (trimmed.length === 0) return;
  assert.ok(trimmed.startsWith('WHERE '), `where must start with WHERE: "${where}"`);
  // (A second inner WHERE inside the access filter's EXISTS subquery is
  // legitimate — the live sqlite execution below catches real syntax errors.)
  assert.ok(!/WHERE\s*$/.test(trimmed), `no dangling WHERE: "${where}"`);
}

const SCHEMA = `
CREATE TABLE patients (id TEXT PRIMARY KEY, name TEXT, owner_clinician_id TEXT, is_org_shared INT);
CREATE TABLE photos (id TEXT PRIMARY KEY, patient_id TEXT, body_part TEXT, captured_at INT, is_deleted INT);
CREATE TABLE patient_shares (patient_id TEXT, clinician_id TEXT);
INSERT INTO patients VALUES ('p1', 'Own Patient', 'c1', 0);
INSERT INTO patients VALUES ('p2', 'Shared Patient', 'c2', 1);
INSERT INTO patients VALUES ('p3', 'Hidden Patient', 'c2', 0);
INSERT INTO photos VALUES ('a', 'p1', 'face', 300, 0);
INSERT INTO photos VALUES ('b', 'p1', 'face', 200, 1);
INSERT INTO photos VALUES ('c', 'p2', 'hand', 100, 0);
INSERT INTO photos VALUES ('d', 'p3', 'back', 400, 0);
`;

function runSqlite(sql) {
  // Bind placeholders become literals for a syntax/exec check.
  const inlined = sql.replaceAll('$1', "'c1'").replaceAll('$2', 0);
  return execFileSync('/usr/bin/sqlite3', [':memory:'], {
    input: SCHEMA + '.mode list\n' + inlined + ';\n',
    encoding: 'utf8',
  }).trim();
}

const cases = [];
for (const role of ['admin', 'non-admin']) {
  const access = role === 'admin' ? ADMIN_ACCESS : NON_ADMIN_ACCESS;
  for (const includeDeleted of [true, false]) {
    cases.push({
      name: `${role} · deleted=${includeDeleted}`,
      where: whereSql(
        [...(includeDeleted ? [] : ['ph.is_deleted = 0'])],
        accessWithBind(access, 1),
      ),
      expectMinRows: 1,
    });
    cases.push({
      name: `${role} · deleted=${includeDeleted} · date+bodyPart filters`,
      where: whereSql(
        [
          ...(includeDeleted ? [] : ['ph.is_deleted = 0']),
          'ph.body_part = $1',
          'ph.captured_at >= $2',
        ],
        accessWithBind(access, 3),
      ),
      expectMinRows: 0,
    });
  }
}

for (const c of cases) {
  assertWellFormed(c.where);
  for (const q of [summariesQuery(c.where), pageQuery(c.where)]) {
    if (q.includes('$')) {
      assert.ok(!/\$(?![0-9])/.test(q), `unsubstituted access bind in: ${q}`);
    }
  }
}

// The exact regression: admin + includeDeleted must produce NO where clause.
assert.equal(
  whereSql([], accessWithBind(ADMIN_ACCESS, 1)),
  '',
  'admin + includeDeleted must yield an empty WHERE (the "near ORDER" bug)',
);

// Live SQLite: every generated query must parse and execute.
let live = 0;
try {
  execFileSync('/usr/bin/sqlite3', [':memory:'], { input: 'SELECT 1;', encoding: 'utf8' });
  for (const c of cases) {
    for (const q of [summariesQuery(c.where), pageQuery(c.where)]) {
      runSqlite(q); // throws on syntax error
      live++;
    }
  }
  // Semantic spot-check: non-admin sees own + shared, not hidden.
  const nonAdmin = summariesQuery(whereSql([], accessWithBind(NON_ADMIN_ACCESS, 1)));
  const rows = runSqlite(nonAdmin);
  assert.ok(rows.includes('p1') && rows.includes('p2'), 'non-admin sees own + shared');
  assert.ok(!rows.includes('p3'), 'non-admin must not see hidden patients');
  const admin = runSqlite(summariesQuery(whereSql([], accessWithBind(ADMIN_ACCESS, 1))));
  assert.ok(admin.includes('p3'), 'admin sees everything');
} catch (err) {
  if (String(err.message).includes('ENOENT')) {
    console.log('  (sqlite3 not found — string-level checks only)');
  } else {
    throw err;
  }
}

console.log(
  `self-check-photo-where: all assertions passed (${cases.length} cases${live ? `, ${live} live-executed` : ''})`,
);
