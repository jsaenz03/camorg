/**
 * Per-photo review schedule derivation (migration 014).
 *
 * The photo-level counterpart of types/patient.ts reviewStatus — same
 * day-precision semantics (a stored local-midnight due date is overdue
 * the moment today starts), narrowed to the states a photo can alert on.
 * Kept dependency-free so scripts/self-check-photo-review.mjs can import
 * it straight from Node and pin the boundary cases.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A photo with a scheduled review date is overdue, due soon, or quiet. */
export type PhotoReviewStatus = 'none' | 'due-soon' | 'overdue';

/**
 * Derive the alert state of a scheduled photo review at read time so
 * upcoming/overdue states never need a background job.
 *
 * - `overdue`  the scheduled date is before today (day-precision: today
 *              itself is not overdue yet)
 * - `due-soon` the scheduled date falls within the warning window
 * - `none`     no date set, or the date is further out than the window
 */
export function photoReviewStatus(
  reviewDueAt: Date | null,
  options: { warningDays?: number; now?: Date } = {},
): PhotoReviewStatus {
  const { warningDays = 7, now = new Date() } = options;
  if (!reviewDueAt) return 'none';

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (reviewDueAt.getTime() < todayStart.getTime()) return 'overdue';
  if (reviewDueAt.getTime() <= now.getTime() + warningDays * DAY_MS) return 'due-soon';
  return 'none';
}
