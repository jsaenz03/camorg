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

/**
 * The full review state of a photo — the same due-date rules as above, plus
 * the scheduled state and staleness measured from the photo's own last
 * review-or-capture (mirroring the patient-level reviewStatus shape). This is
 * what the phone link's review banners and per-photo Mark reviewed flag on,
 * so the phone flags exactly the photos the desktop would.
 *
 * Kept here (dependency-free) beside the alert derivation so both derivations
 * read from one place. Defaults mirror DEFAULT_REVIEW_WARNING_DAYS /
 * DEFAULT_REVIEW_STALE_DAYS in types/patient.
 */
export type PhotoReviewState = 'none' | 'scheduled' | 'due-soon' | 'overdue' | 'stale';

export function photoReviewState(
  photo: {
    reviewDueAt: Date | null;
    lastReviewedAt: Date | null;
    capturedAt: Date;
  },
  options: { warningDays?: number; staleDays?: number; now?: Date } = {},
): PhotoReviewState {
  const { warningDays = 7, staleDays = 90, now = new Date() } = options;

  if (photo.reviewDueAt) {
    // Due dates are stored day-precision (local midnight), so anything
    // before today's local midnight is past due — today itself is "due soon".
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (photo.reviewDueAt.getTime() < todayStart.getTime()) return 'overdue';
    if (photo.reviewDueAt.getTime() <= now.getTime() + warningDays * DAY_MS) {
      return 'due-soon';
    }
    return 'scheduled';
  }

  const lastActivity = Math.max(
    photo.lastReviewedAt?.getTime() ?? 0,
    photo.capturedAt.getTime(),
  );
  if (now.getTime() - lastActivity > staleDays * DAY_MS) {
    return 'stale';
  }
  return 'none';
}

/**
 * Patient-row review state for the phone's patients list: the patient's own
 * status, escalated when one of their photos is due or overdue at the photo
 * level (the phone has no dashboard alert list, so that banner is the only
 * place a photo-level review surfaces). Quieter photo states never escalate —
 * the photo grid already shows those.
 */
export function escalatePatientReview(
  patientReview: PhotoReviewState,
  worstPhotoReview: PhotoReviewState | undefined,
): PhotoReviewState {
  if (worstPhotoReview === 'overdue') return 'overdue';
  if (worstPhotoReview === 'due-soon' && patientReview !== 'overdue') return 'due-soon';
  return patientReview;
}
