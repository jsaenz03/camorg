import { BodyPart, type BodyView, type Laterality, type PinpointSpace } from './body-part';

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
  laterality: Laterality | null; // Patient's left/right side (bilateral regions only)
  subpart: string | null; // Custom anatomical detail (optional)
  clinicalNotes: string | null; // Free-text clinical observations (optional)

  // Exact pinpoint mark (migration 016): normalized 0..1 coordinates of the X
  // on the body-map diagram, plus which diagram they belong to and which face
  // (front/back) it was marked on — palm vs back of hand differ (migration
  // 017). Null = unmarked; pinView null = pre-017 row, read as 'front'.
  pinX: number | null;
  pinY: number | null;
  pinSpace: PinpointSpace | null;
  pinView: BodyView | null;

  // Review + series (migrations 013/014)
  reviewDueAt: Date | null; // Next scheduled review date for this photo; null = none set
  lastReviewedAt: Date | null; // When a clinician last marked this photo reviewed
  lesionGroup: string | null; // Free-text series name; photos sharing it on the
  // same patient form a before/after lesion series

  // Attached result files (documents). Filled by the photo list reads
  // (getAllPhotos / getPhotosByPatient); single-photo reads report 0 —
  // the detail dialog lists the files themselves.
  attachmentCount: number;

  // Timestamps
  capturedAt: Date; // When photo was taken (camera timestamp)
  createdAt: Date; // When record was created in system
  updatedAt: Date; // Last metadata modification timestamp

  // Audit Fields
  clinicianId: string; // Who captured the photo
  isDeleted: boolean; // Soft delete flag
  deletedAt: Date | null; // When record was soft deleted
}
