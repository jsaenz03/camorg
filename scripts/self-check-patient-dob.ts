/**
 * Self-check for the patient DOB parse/normalise pipeline.
 *
 * Run: node scripts/self-check-patient-dob.ts
 * (Node >= 22.6 with type stripping; Node 24 runs .ts natively.)
 *
 * Exercises the pure pipeline both manual entry and search rely on:
 * text -> parseDobInput -> dobToMs -> patients.dob equality match,
 * plus the dobFromMs display/mapping round-trip.
 * Fails loudly (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import {
  dobFromMs,
  dobToMs,
  formatDateOfBirth,
  parseDobInput,
} from '../lib/utils/date-formatting.ts';

const canonical = Date.UTC(1985, 1, 4); // 4 Feb 1985, stored form

// Two-digit year, day-first, with each accepted separator.
for (const term of ['4/2/85', '4-2-85', '4.2.85', '04/02/85']) {
  const d = parseDobInput(term);
  assert.ok(d, `${term} should parse`);
  assert.equal(dobToMs(d), canonical, `${term} must normalise to 04/02/1985`);
}

// Four-digit year, day-first.
for (const term of ['4/2/1985', '04/02/1985']) {
  const d = parseDobInput(term);
  assert.ok(d, `${term} should parse`);
  assert.equal(dobToMs(d), canonical, `${term} must normalise to 04/02/1985`);
}

// Year-first ISO with 1- or 2-digit parts, either separator.
for (const term of ['1985-02-04', '1985/2/4']) {
  const d = parseDobInput(term);
  assert.ok(d, `${term} should parse`);
  assert.equal(dobToMs(d), canonical, `${term} must normalise to 04/02/1985`);
}

// Whitespace is tolerated.
assert.equal(dobToMs(parseDobInput('  4/2/85  ')!), canonical);

// Two-digit-year pivot (POSIX-style): 69-99 → 1900s, 00-68 → 2000s,
// and any result in the future folds back a century (a DOB can't be unborn).
assert.equal(parseDobInput('1/1/99')!.getFullYear(), 1999);
assert.equal(parseDobInput('1/1/69')!.getFullYear(), 1969);
assert.equal(parseDobInput('1/1/00')!.getFullYear(), 2000);
assert.equal(parseDobInput('1/1/68')!.getFullYear(), 1968, '2068 is future → folds to 1968');
{
  // A two-digit year that would land in the future folds back a century.
  const nextYear = new Date().getFullYear() + 1;
  const twoDigit = String(nextYear % 100).padStart(2, '0');
  assert.equal(
    parseDobInput(`1/1/${twoDigit}`)!.getFullYear(),
    nextYear - 100,
    `two-digit year for ${nextYear} must fold back a century`,
  );
}

// Not dates at all, or impossible implausible ones → null.
assert.equal(parseDobInput('John Smith'), null, 'names must not parse');
assert.equal(parseDobInput(''), null, 'empty must not parse');
assert.equal(parseDobInput('24/01'), null, 'missing year must not parse');
assert.equal(parseDobInput('1990'), null, 'bare year must not parse');
assert.equal(parseDobInput('4/2/850'), null, 'three-digit year must not parse');
assert.equal(parseDobInput('31/02/1990'), null, '31/02 must not parse (no rollover)');
assert.equal(parseDobInput('4/13/1985'), null, 'month 13 must not parse');
assert.equal(parseDobInput('0/2/1985'), null, 'day 0 must not parse');
assert.equal(parseDobInput('31/12/2999'), null, 'future dates must not parse');
assert.equal(parseDobInput('1/1/1899'), null, 'pre-1900 must not parse');

// The invariant the SQL depends on: however the Date was constructed
// (typed text, calendar picker at local midnight, local noon), the same
// calendar day normalises to one storage value.
const pickerDate = new Date(1985, 1, 4, 0, 0, 0, 0);
const midday = new Date(1985, 1, 4, 12, 0, 0, 0);
assert.equal(dobToMs(pickerDate), canonical, 'picker date must match typed text');
assert.equal(dobToMs(midday), canonical, 'time-of-day must not affect the stored DOB');

// Storage round-trip: read-back maps to the same calendar day in any zone,
// and re-normalising is a fixed point.
const readBack = dobFromMs(canonical);
assert.equal(readBack.getFullYear(), 1985);
assert.equal(readBack.getMonth(), 1);
assert.equal(readBack.getDate(), 4);
assert.equal(dobToMs(readBack), canonical, 'dobFromMs(dobToMs(x)) must be the identity');
assert.equal(dobToMs(dobFromMs(dobToMs(readBack))), canonical);

// A typed search term for the stored day matches exactly what was stored.
assert.equal(dobToMs(parseDobInput('4/2/85')!), canonical);
assert.equal(dobToMs(parseDobInput('04/02/1985')!), canonical);

// Display formatting round-trips.
assert.equal(formatDateOfBirth(readBack), '4 Feb 1985');
assert.equal(formatDateOfBirth(null), null, 'missing DOB formats to null');

console.log('self-check-patient-dob: all assertions passed');
