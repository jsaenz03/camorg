#!/usr/bin/env node
/**
 * Feature wiring self-check (no framework, no fixtures).
 *
 * Asserts the cross-file invariants that TypeScript cannot: the DB migration
 * actually contains the columns the services read, the Rust shell registers
 * the migration, and the body-map picker can reach every BodyPart value.
 * Run: node scripts/check-features.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
function check(name, ok) {
  if (ok) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`FAIL  ${name}`);
  }
}

// 1. Migration 007 exists and carries consent + audit + idle-lock schema.
const migration = read('src-tauri/migrations/007_consent_audit.sql');
for (const needle of [
  'ALTER TABLE patients ADD COLUMN consent_given_at',
  'ALTER TABLE patients ADD COLUMN consent_scope',
  'ALTER TABLE patients ADD COLUMN consent_expires_at',
  'CREATE TABLE IF NOT EXISTS audit_log',
  'ALTER TABLE settings ADD COLUMN idle_lock_timeout_ms',
]) {
  check(`migration 007: ${needle}`, migration.includes(needle));
}

// 2. The Rust shell registers migration 007.
check(
  'lib.rs registers migration 007',
  /version:\s*7[\s\S]*?007_consent_audit\.sql/.test(read('src-tauri/src/lib.rs')),
);

// 3. patient-service reads every consent column migration 007 adds.
const patientService = read('lib/services/patient-service.ts');
for (const col of ['consent_given_at', 'consent_scope', 'consent_expires_at']) {
  check(`patient-service selects ${col}`, patientService.includes(`p.${col}`));
}

// 4. Body-map picker covers every BodyPart enum value (torso via its chip,
//    everything else via diagram regions in the front or back view).
const bodyPartSrc = read('types/body-part.ts');
const enumValues = [...bodyPartSrc.matchAll(/^\s{2}([A-Z_]+) = '([a-z_]+)',$/gm)].map(
  (m) => m[2],
);
check('body-part enum parsed (14 values)', enumValues.length === 14);

const pickerSrc = read('components/patient/body-map-picker.tsx');
// Constants used in the picker, mapped back to enum values by name.
const usedNames = new Set([...pickerSrc.matchAll(/BodyPart\.([A-Z_]+)/g)].map((m) => m[1]));
for (const value of enumValues) {
  check(`body map reaches BodyPart.${value}`, usedNames.has(value.toUpperCase()));
}

// 5. Consent status derivation sanity (mirrors types/patient.ts logic —
//    kept in sync deliberately; the pure function itself is TS-only).
const now = Date.now();
const derive = (givenAt, expiresAt) =>
  !givenAt ? 'none' : expiresAt && expiresAt < now ? 'expired' : 'valid';
check('consent: none when never given', derive(null, null) === 'none');
check('consent: valid with no expiry', derive(now - 1000, null) === 'valid');
check('consent: expired past expiry', derive(now - 1000, now - 1) === 'expired');
check('consent: valid before expiry', derive(now - 1000, now + 10_000) === 'valid');

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll feature wiring checks passed.');
