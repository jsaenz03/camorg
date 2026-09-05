/**
 * Self-check for the audit trail's identity enrichment + redaction rule
 * (lib/utils/audit.ts — the pure half of auditService.list).
 *
 * Run: node scripts/self-check-audit-redact.mjs
 *
 * Pins what an admin sees (patient name + "Left arm · 05/09/2026" photo
 * label) versus what a non-admin 'mine' response may contain (identities
 * nulled even when the join data is present). Fails loudly (non-zero exit)
 * if any invariant breaks.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultAuditRange,
  mapAuditRow,
  parseYmd,
  photoAuditLabel,
  toAuditCsv,
} from '../lib/utils/audit.ts';

// Structural guard on the service's assembled SQL: AUDIT_SELECT owns the
// `FROM audit_log a` (and the JOINs) and the single list() query must inject
// it exactly once. A second FROM after the interpolation is a syntax error
// that only bites at runtime (it once emptied every audit view unnoticed).
const serviceSrc = readFileSync(new URL('../lib/services/audit-service.ts', import.meta.url), 'utf8');
const fromCount = (serviceSrc.match(/FROM audit_log/g) ?? []).length;
assert.equal(fromCount, 1, `audit-service must declare FROM audit_log exactly once (got ${fromCount})`);
assert.equal((serviceSrc.match(/SELECT \$\{AUDIT_SELECT\}/g) ?? []).length, 1,
  'the list() query must go through AUDIT_SELECT');

const CAPTURED_AT = new Date(2026, 8, 5, 9, 30).getTime(); // 5 Sep 2026 local

// --- Photo label formatting ---

assert.equal(photoAuditLabel('Left arm', CAPTURED_AT), 'Left arm · 05/09/2026', 'label is part + AU capture date');
assert.equal(photoAuditLabel('Upper Arm', null), 'Upper Arm', 'no captured_at → bare part label');
assert.equal(photoAuditLabel(null, CAPTURED_AT), null, 'no body part (non-photo action / missed join) → null');
assert.equal(photoAuditLabel('', CAPTURED_AT), null, 'empty body part reads as absent');

// --- Row mapping: a photo.create row as the JOINed SELECT returns it ---

function joinedRow(overrides = {}) {
  return {
    id: 'a1',
    clinician_id: 'c1',
    clinician_name: 'Dr Jane Doe',
    action: 'photo.create',
    entity_type: 'photo',
    entity_id: 'p1',
    patient_id: 'pat1',
    detail: 'left arm · series: s1',
    created_at: CAPTURED_AT + 1000,
    patient_name: 'John Smith',
    photo_body_part: 'upper_arm',
    photo_captured_at: CAPTURED_AT,
    ...overrides,
  };
}
const label = 'Left arm · 05/09/2026';

// Admin (resolveIdentity: true): identities resolve.
const admin = mapAuditRow(joinedRow(), true, label);
assert.equal(admin.patientName, 'John Smith', 'admin must see the patient name');
assert.equal(admin.photoLabel, label, 'admin must see the photo label');

// Patient action (no photo columns populated → no label, name still resolves).
const patientRow = mapAuditRow(
  joinedRow({ action: 'patient.update', entity_type: 'patient', photo_body_part: null, photo_captured_at: null }),
  true,
  null,
);
assert.equal(patientRow.patientName, 'John Smith', 'patient actions resolve the name too');
assert.equal(patientRow.photoLabel, null, 'non-photo actions have no photo label');

// LEFT JOIN misses (patient purged externally, dangling photo id) → nulls, never a crash.
const missed = mapAuditRow(joinedRow({ patient_name: null }), true, null);
assert.equal(missed.patientName, null, 'unmatched join must read as null');
assert.equal(missed.photoLabel, null, 'unmatched photo join must read as null');

// Non-admin 'mine' (resolveIdentity: false): identities redacted even though
// the join data is sitting right there in the row.
const mine = mapAuditRow(joinedRow(), false, label);
assert.equal(mine.patientName, null, 'non-admin must NOT receive the patient name');
assert.equal(mine.photoLabel, null, 'non-admin must NOT receive the photo identity');
assert.equal(mine.clinicianName, 'Dr Jane Doe', 'own clinician name still passes through');
assert.equal(mine.detail, 'left arm · series: s1', 'own free-text detail unchanged (pre-existing behaviour)');
assert.equal(mine.action, 'photo.create', 'action unchanged');
assert.equal(mine.patientId, 'pat1', 'opaque ids still pass through');
assert.ok(mine.createdAt instanceof Date, 'createdAt stays a Date');

// --- Date range defaults + parsing ---

const now = new Date(2026, 8, 5, 15, 30); // 5 Sep 2026, 3:30pm local
const range = defaultAuditRange(now);
assert.deepEqual(
  [range.from.getFullYear(), range.from.getMonth(), range.from.getDate(), range.from.getHours()],
  [2026, 7, 7, 0],
  'default range starts at local midnight 29 days back (30 days incl. today)',
);
assert.deepEqual(
  [range.to.getFullYear(), range.to.getMonth(), range.to.getDate(), range.to.getHours(), range.to.getMinutes(), range.to.getSeconds(), range.to.getMilliseconds()],
  [2026, 8, 5, 23, 59, 59, 999],
  'default range ends at the end of today',
);

const parsed = parseYmd('2026-09-05');
assert.ok(parsed && parsed.getTime() === new Date(2026, 8, 5).getTime(), 'yyyy-MM-dd parses to LOCAL midnight, not UTC');
assert.equal(parseYmd('not a date'), null, 'garbage parses to null');
assert.equal(parseYmd(''), null, 'empty input parses to null');

// --- CSV report ---

const csv = toAuditCsv([admin, mine]);
const lines = csv.split('\r\n');
assert.ok(csv.startsWith('\uFEFF'), 'file opens with a UTF-8 BOM so Excel reads names correctly');
assert.equal(lines[0], '\uFEFFWhen,Who,Action,Patient,Photo,Detail', 'header row names every column');
assert.equal(lines[1], '05/09/2026 09:30,Dr Jane Doe,Added photo,John Smith,Left arm · 05/09/2026,left arm · series: s1',
  'plain fields stay unquoted; AU timestamp; null identity of redacted entry renders as empty');
assert.ok(csv.endsWith('\r\n'), 'rows end with CRLF (RFC 4180)');

const thorny = toAuditCsv([mapAuditRow(joinedRow({ clinician_name: 'Dr Quote "Q", Jr', detail: 'said "hi", twice' }), true, label)]);
assert.ok(thorny.includes('"Dr Quote ""Q"", Jr"'), 'commas and quotes force quoting with doubled quotes');
assert.ok(thorny.includes('"said ""hi"", twice"'), 'detail text survives round-trip quoting');

console.log('self-check-audit-redact: all assertions passed.');
