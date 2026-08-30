/**
 * Represents an individual patient as an organizational container for photos.
 *
 * Access control (see lib/services/access-service.ts):
 * - `ownerClinicianId`: the doctor who first captured a photo for this patient.
 *   They are the only non-admin who can manage it unless sharing is enabled.
 * - `isOrgShared`: when true, every clinician in the org can view this patient.
 *   Mutually exclusive with per-doctor grants in practice (admin picks a mode).
 * - `ownerName`: denormalised display name of the owner, populated at read time
 *   for UI badges. May be null on legacy rows or if the owner was deleted.
 */
export interface Patient {
  // Identity
  id: string; // UUID v4, primary key
  name: string; // Display name (as entered)
  normalizedName: string; // Lowercase, trimmed for case-insensitive search
  dateOfBirth: Date | null; // Optional DOB, stored as UTC-midnight unix ms

  // Metadata
  photoCount: number; // Denormalized count of active photos
  deletedPhotoCount: number; // Count of soft-deleted photos

  // Timestamps
  createdAt: Date; // When patient record was created
  updatedAt: Date; // Last modification timestamp
  lastPhotoAt: Date | null; // Timestamp of most recent photo

  // Audit
  clinicianId: string; // Who created the patient record (legacy creator column)
  isArchived: boolean; // Soft archive flag
  archivedAt: Date | null;

  // Access control (migration 003)
  ownerClinicianId: string | null; // Owning doctor (NULL only on unmigrated legacy rows)
  isOrgShared: boolean; // Visible to every clinician in the org
  ownerName: string | null; // Display name of the owner (joined at read time)

  // Photo consent (migration 007). Status is derived, never stored.
  consentGivenAt: Date | null; // When consent was recorded; null = never
  consentScope: ConsentScope | null; // What the patient agreed to
  consentExpiresAt: Date | null; // Optional expiry; null = no expiry

  // Clinician review scheduling (migration 010). Status is derived, never stored.
  reviewDueAt: Date | null; // Next scheduled review date; null = none set
  lastReviewedAt: Date | null; // When the clinician last marked it reviewed
}

/** What a patient's photo consent covers. */
export type ConsentScope = 'care' | 'education' | 'research';

export const ConsentScopeLabels: Record<ConsentScope, string> = {
  care: 'Clinical care',
  education: 'Education & training',
  research: 'Research',
};

export type ConsentStatus = 'none' | 'valid' | 'expired';

/** Derive consent status at read time so expiries take effect without a job. */
export function consentStatus(patient: {
  consentGivenAt: Date | null;
  consentExpiresAt: Date | null;
}): ConsentStatus {
  if (!patient.consentGivenAt) return 'none';
  if (
    patient.consentExpiresAt &&
    patient.consentExpiresAt.getTime() < Date.now()
  ) {
    return 'expired';
  }
  return 'valid';
}

/**
 * Review alerting (migration 010), derived at read time like consent so
 * upcoming/overdue/stale states never need a background job.
 *
 * - `overdue`   a scheduled review date has passed
 * - `due-soon`  a scheduled review falls within the warning window
 * - `scheduled` a review date is set but further out
 * - `stale`     no review scheduled, and the patient has photos but has been
 *               quiet (no review or capture) for longer than the stale window
 * - `none`      nothing to flag
 */
export type ReviewStatus = 'none' | 'scheduled' | 'due-soon' | 'overdue' | 'stale';

export const DEFAULT_REVIEW_WARNING_DAYS = 7;
export const DEFAULT_REVIEW_STALE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function reviewStatus(
  patient: {
    reviewDueAt: Date | null;
    lastReviewedAt: Date | null;
    lastPhotoAt: Date | null;
    photoCount: number;
  },
  options: { warningDays?: number; staleDays?: number; now?: Date } = {},
): ReviewStatus {
  const {
    warningDays = DEFAULT_REVIEW_WARNING_DAYS,
    staleDays = DEFAULT_REVIEW_STALE_DAYS,
    now = new Date(),
  } = options;

  if (patient.reviewDueAt) {
    // Due dates are stored day-precision (local midnight), so anything
    // before today's local midnight is past due — today itself is "due soon".
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (patient.reviewDueAt.getTime() < todayStart.getTime()) return 'overdue';
    if (patient.reviewDueAt.getTime() <= now.getTime() + warningDays * DAY_MS) {
      return 'due-soon';
    }
    return 'scheduled';
  }

  const lastActivity = Math.max(
    patient.lastReviewedAt?.getTime() ?? 0,
    patient.lastPhotoAt?.getTime() ?? 0,
  );
  if (
    patient.photoCount > 0 &&
    lastActivity > 0 &&
    now.getTime() - lastActivity > staleDays * DAY_MS
  ) {
    return 'stale';
  }
  return 'none';
}
