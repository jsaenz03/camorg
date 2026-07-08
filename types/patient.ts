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
}
