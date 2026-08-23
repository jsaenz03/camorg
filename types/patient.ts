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
