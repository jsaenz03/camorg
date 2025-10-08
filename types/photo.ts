import { BodyPart } from './body-part';

/**
 * Represents a single clinical photograph with associated metadata
 */
export interface PhotoRecord {
  // Identity
  id: string; // UUID v4, primary key

  // Relationships
  patientId: string; // Foreign key to Patient.id

  // Photo Data
  imageBlob: Blob; // Binary photo data (JPEG, compressed)
  imageThumbnail: Blob; // Thumbnail 200x200px for timeline performance
  originalFileName: string; // Original file name if uploaded
  mimeType: string; // e.g., "image/jpeg", "image/png"
  fileSizeBytes: number; // Compressed file size

  // Clinical Metadata
  bodyPart: BodyPart; // Enumerated anatomical region
  subpart: string | null; // Custom anatomical detail (optional)
  clinicalNotes: string | null; // Free-text clinical observations (optional)

  // Timestamps
  capturedAt: Date; // When photo was taken (camera timestamp)
  createdAt: Date; // When record was created in system
  updatedAt: Date; // Last metadata modification timestamp

  // Audit Fields
  clinicianId: string; // Who captured the photo
  isDeleted: boolean; // Soft delete flag
  deletedAt: Date | null; // When record was soft deleted
}
