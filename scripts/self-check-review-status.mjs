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
import { escalatePatientReview, photoReviewState } from '../lib/utils/photo-review.ts';

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

// ---- photoReviewState (per-photo flavour: staleness runs off the photo) --

// Same due-date rules as the patient: due yesterday overdue, today due-soon,
// a week out at the warning edge due-soon, past it scheduled.
const photoBase = { reviewDueAt: null, lastReviewedAt: null, capturedAt: new Date(now.getTime() - 5 * DAY) };
assert.equal(photoReviewState({ ...photoBase, reviewDueAt: new Date(todayStart.getTime() - DAY) }, { now }), 'overdue');
assert.equal(photoReviewState({ ...photoBase, reviewDueAt: todayStart }, { now }), 'due-soon');
assert.equal(photoReviewState({ ...photoBase, reviewDueAt: new Date(now.getTime() + 7 * DAY) }, { now, warningDays: 7 }), 'due-soon');
assert.equal(photoReviewState({ ...photoBase, reviewDueAt: new Date(now.getTime() + 7 * DAY + 1000) }, { now, warningDays: 7 }), 'scheduled');

// No schedule: a recent capture is none; a capture older than the stale
// window (never reviewed) goes stale; a recent review rescues it.
assert.equal(photoReviewState(photoBase, { now }), 'none', 'recent capture must be none');
assert.equal(
  photoReviewState({ ...photoBase, capturedAt: new Date(now.getTime() - 91 * DAY) }, { now }),
  'stale',
  'old unreviewed photo must be stale',
);
assert.equal(
  photoReviewState(
    { ...photoBase, capturedAt: new Date(now.getTime() - 91 * DAY), lastReviewedAt: new Date(now.getTime() - 2 * DAY) },
    { now },
  ),
  'none',
  'recent review must rescue an old photo',
);

// Patient rows escalate on their photos' worst state — a photo due/overdue
// flags the patient even when the patient record itself is quiet; quieter
// photo states never change the patient's own banner.
assert.equal(escalatePatientReview('none', 'overdue'), 'overdue', 'photo overdue flags the patient');
assert.equal(escalatePatientReview('scheduled', 'overdue'), 'overdue', 'photo overdue beats a scheduled patient date');
assert.equal(escalatePatientReview('overdue', 'due-soon'), 'overdue', 'patient overdue never downgrades');
assert.equal(escalatePatientReview('none', 'due-soon'), 'due-soon', 'photo due-soon flags the patient');
assert.equal(escalatePatientReview('none', 'scheduled'), 'none', 'quiet photo state never escalates');
assert.equal(escalatePatientReview('stale', 'stale'), 'stale', 'stale stands on its own');
assert.equal(escalatePatientReview('none', undefined), 'none', 'no photos leaves the patient row alone');

console.log('review-status self-check passed');
