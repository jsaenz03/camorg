/**
 * Self-check for the review-status derivation (types/patient.ts).
 *
 * Run: node scripts/self-check-review-status.mjs
 *
 * Exercises every derived review state — none / scheduled / due-soon /
 * overdue / stale — including the boundary cases (due today, warning-edge,
 * review-recency rescuing an otherwise stale patient). Fails loudly
 * (non-zero exit) if any invariant breaks.
 */

import assert from 'node:assert/strict';
import {
  reviewStatus,
  DEFAULT_REVIEW_WARNING_DAYS,
  DEFAULT_REVIEW_STALE_DAYS,
} from '../types/patient.ts';

const DAY = 24 * 60 * 60 * 1000;
// Fixed "now": 30 Aug 2026, 10:00 local — keeps every case deterministic.
const now = new Date(2026, 7, 30, 10, 0);
const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

const base = { reviewDueAt: null, lastReviewedAt: null, lastPhotoAt: null, photoCount: 0 };

// No schedule, no photos → nothing to flag.
assert.equal(reviewStatus(base, { now }), 'none', 'empty patient must be none');

// Recent activity, no schedule → none (not stale yet).
assert.equal(
  reviewStatus({ ...base, photoCount: 3, lastPhotoAt: new Date(now - 10 * DAY) }, { now, staleDays: 90 }),
  'none',
  'recent photo without schedule must be none',
);

// Photos but silent past the stale window → stale.
assert.equal(
  reviewStatus({ ...base, photoCount: 3, lastPhotoAt: new Date(now - 100 * DAY) }, { now, staleDays: 90 }),
  'stale',
  'old unreviewed photos must be stale',
);

// Exactly at the stale boundary is not yet stale; a day past it is.
assert.equal(
  reviewStatus({ ...base, photoCount: 1, lastPhotoAt: new Date(now - 90 * DAY) }, { now, staleDays: 90 }),
  'none',
  'exactly staleDays quiet must still be none',
);
assert.equal(
  reviewStatus({ ...base, photoCount: 1, lastPhotoAt: new Date(now - 90 * DAY - 1) }, { now, staleDays: 90 }),
  'stale',
  'a day past the stale window must be stale',
);

// A recent review rescues an otherwise ancient photo set (latest activity wins).
assert.equal(
  reviewStatus(
    { ...base, photoCount: 3, lastPhotoAt: new Date(now - 200 * DAY), lastReviewedAt: new Date(now - 10 * DAY) },
    { now, staleDays: 90 },
  ),
  'none',
  'recent review must rescue old photos',
);

// A patient with no photos at all never goes stale, however old.
assert.equal(
  reviewStatus({ ...base, photoCount: 0, createdAt: new Date(now - 400 * DAY) }, { now, staleDays: 90 }),
  'none',
  'photoless patient must never be stale',
);

// Scheduled far out → scheduled.
assert.equal(
  reviewStatus({ ...base, photoCount: 1, reviewDueAt: new Date(now.getTime() + 30 * DAY) }, { now, warningDays: 7 }),
  'scheduled',
  'review far in the future must be scheduled',
);

// Within the warning window → due-soon.
assert.equal(
  reviewStatus({ ...base, photoCount: 1, reviewDueAt: new Date(now.getTime() + 3 * DAY) }, { now, warningDays: 7 }),
  'due-soon',
  'review inside the warning window must be due-soon',
);

// Boundary: exactly at the warning edge is still due-soon; just past is scheduled.
assert.equal(
  reviewStatus({ ...base, photoCount: 1, reviewDueAt: new Date(now.getTime() + 7 * DAY) }, { now, warningDays: 7 }),
  'due-soon',
  'exact warning edge must be due-soon',
);
assert.equal(
  reviewStatus(
    { ...base, photoCount: 1, reviewDueAt: new Date(now.getTime() + 7 * DAY + 1000) },
    { now, warningDays: 7 },
  ),
  'scheduled',
  'just past the warning edge must be scheduled',
);

// Due today → due-soon (not overdue); yesterday → overdue.
assert.equal(
  reviewStatus({ ...base, photoCount: 1, reviewDueAt: todayStart }, { now }),
  'due-soon',
  'due today must be due-soon',
);
assert.equal(
  reviewStatus({ ...base, photoCount: 1, reviewDueAt: new Date(todayStart.getTime() - DAY) }, { now }),
  'overdue',
  'due yesterday must be overdue',
);

// Migration defaults match the docs.
assert.equal(DEFAULT_REVIEW_WARNING_DAYS, 7);
assert.equal(DEFAULT_REVIEW_STALE_DAYS, 90);

console.log('review-status self-check passed');
