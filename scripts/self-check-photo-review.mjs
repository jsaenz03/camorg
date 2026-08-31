/**
 * Self-check for the scheduled photo-review derivation
 * (lib/utils/photo-review.ts, migration 014).
 *
 * Run: node scripts/self-check-photo-review.mjs
 *
 * Pins the same day-precision semantics as the patient reviewStatus:
 * a stored local-midnight due date becomes overdue the moment today
 * starts, today itself is "due soon", and dates beyond the warning
 * window stay quiet.
 */

import assert from 'node:assert/strict';
import { photoReviewStatus } from '../lib/utils/photo-review.ts';

const DAY = 24 * 60 * 60 * 1000;
// Fixed "now": 30 Aug 2026, 10:00 local — keeps every case deterministic.
const now = new Date(2026, 7, 30, 10, 0);
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const due = (offsetDays) => new Date(todayStart.getTime() + offsetDays * DAY);

const opts = { warningDays: 7, now };

// No date set → nothing to flag.
assert.equal(photoReviewStatus(null, opts), 'none', 'no date must be none');

// Past dates are overdue; today itself is not overdue yet (day-precision).
assert.equal(photoReviewStatus(due(-1), opts), 'overdue', 'yesterday must be overdue');
assert.equal(photoReviewStatus(due(-30), opts), 'overdue', 'a month ago must be overdue');
assert.equal(photoReviewStatus(due(0), opts), 'due-soon', 'today must be due-soon, not overdue');

// The warning window is inclusive at its edge; a day past it goes quiet.
assert.equal(photoReviewStatus(due(6), opts), 'due-soon', 'inside window must be due-soon');
assert.equal(photoReviewStatus(due(7), opts), 'due-soon', 'window edge (7 days) must be due-soon');
assert.equal(photoReviewStatus(due(8), opts), 'none', 'past the window must be none');

// A wider window pulls further-out dates into the alert.
assert.equal(
  photoReviewStatus(due(10), { warningDays: 14, now }),
  'due-soon',
  'wider window must catch day 10',
);

console.log('self-check-photo-review: all assertions passed');
