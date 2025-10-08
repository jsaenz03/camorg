/**
 * Represents an individual patient as an organizational container for photos
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
  clinicianId: string; // Who created the patient record
  isArchived: boolean; // Soft archive flag
  archivedAt: Date | null;
}
