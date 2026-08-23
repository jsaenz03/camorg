/**
 * Self-check for the patient DOB search helpers.
 *
 * Run: node scripts/self-check-patient-dob.ts
 * (Node >= 22.6 with type stripping; Node 24 runs .ts natively.)
 *
 * Exercises the pure pipeline the search SQL relies on:
 * term -> parseDobSearchTerm -> dobToMs -> patients.dob equality match.
 * Fails loudly (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import {
  dobToMs,
  formatDateOfBirth,
  parseDobSearchTerm,
} from '../lib/utils/date-formatting.ts';

// AU format parses, with correct calendar components.
const au = parseDobSearchTerm('24/01/1990');
assert.ok(au, 'AU format 24/01/1990 should parse');
assert.equal(au.getFullYear(), 1990);
assert.equal(au.getMonth(), 0);
assert.equal(au.getDate(), 24);

// ISO format parses to the same calendar date.
const iso = parseDobSearchTerm('1990-01-24');
assert.ok(iso, 'ISO format 1990-01-24 should parse');
assert.equal(dobToMs(iso), dobToMs(au), 'ISO and AU forms of the same day must normalise equally');

// Single-digit day/month still accepted (d/M/yyyy).
assert.ok(parseDobSearchTerm('5/6/1985'), 'single-digit d/M/yyyy should parse');

// Impossible calendar dates are rejected, not silently rolled over.
assert.equal(parseDobSearchTerm('31/02/1990'), null, '31/02/1990 must not parse');
assert.equal(parseDobSearchTerm('1990-13-01'), null, 'month 13 must not parse');

// Name-like terms and junk are not dates.
assert.equal(parseDobSearchTerm('John Smith'), null, 'names must not parse as dates');
assert.equal(parseDobSearchTerm(''), null, 'empty term must not parse');
assert.equal(parseDobSearchTerm('24-01-1990'), null, 'dash form is not an accepted format');

// The invariant the SQL depends on: however the Date was constructed
// (calendar picker at local midnight, parsed term, or local noon),
// the same calendar day normalises to one storage value.
const pickerDate = new Date(1990, 0, 24, 0, 0, 0, 0);
const midday = new Date(1990, 0, 24, 12, 0, 0, 0);
assert.equal(dobToMs(pickerDate), dobToMs(au!), 'picker date must match parsed term');
assert.equal(dobToMs(midday), dobToMs(au!), 'time-of-day must not affect the stored DOB');

// Storage value is UTC midnight of the calendar date.
assert.equal(dobToMs(au!), Date.UTC(1990, 0, 24), 'DOB stores UTC midnight');

// Display formatting round-trips.
assert.equal(formatDateOfBirth(au!), '24 Jan 1990');
assert.equal(formatDateOfBirth(null), null, 'missing DOB formats to null');

console.log('self-check-patient-dob: all assertions passed');
