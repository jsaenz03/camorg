/**
 * Photo Service Contract
 *
 * Defines the interface for photo-related operations in the clinical photo
 * documentation system. All operations are client-side (IndexedDB).
 */

import { PhotoRecord, PhotoRecordCreate, PhotoRecordUpdate } from '@/types/photo';
import { BodyPart } from '@/types/body-part';

export interface IPhotoService {
  /**
   * Creates a new photo record with metadata
   *
   * @param data - Photo creation data (validated via Zod schema)
   * @returns Promise resolving to the created PhotoRecord with generated ID
   * @throws ValidationError if data fails schema validation
   * @throws StorageQuotaError if IndexedDB quota exceeded
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Increments Patient.photoCount
   * - Updates Patient.lastPhotoAt
   * - Updates SubpartSuggestion.usageCount if subpart provided
   * - Generates thumbnail (200x200px)
   * - Compresses image to max 1920px dimension, 85% quality
   */
  createPhoto(data: PhotoRecordCreate): Promise<PhotoRecord>;

  /**
   * Retrieves a single photo by ID
   *
   * @param id - Photo UUID
   * @returns Promise resolving to PhotoRecord or null if not found
   * @throws Error if IndexedDB query fails
   */
  getPhotoById(id: string): Promise<PhotoRecord | null>;

  /**
   * Retrieves all photos for a specific patient
   *
   * @param patientId - Patient UUID
   * @param options.includeDeleted - Whether to include soft-deleted photos (default: false)
   * @param options.bodyPart - Optional filter by body part
   * @returns Promise resolving to array of PhotoRecords, sorted by capturedAt DESC
   * @throws Error if IndexedDB query fails
   *
   * Performance: Uses indexed query (patientId or patientId_bodyPart index)
   */
  getPhotosByPatient(
    patientId: string,
    options?: { includeDeleted?: boolean; bodyPart?: BodyPart }
  ): Promise<PhotoRecord[]>;

  /**
   * Updates photo metadata (notes and subpart only)
   *
   * @param id - Photo UUID
   * @param data - Update data (validated via Zod schema)
   * @returns Promise resolving to updated PhotoRecord
   * @throws NotFoundError if photo does not exist
   * @throws ValidationError if data fails schema validation
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Updates PhotoRecord.updatedAt
   * - Updates SubpartSuggestion if subpart changed
   *
   * Note: imageBlob and capturedAt are immutable and cannot be updated
   */
  updatePhoto(id: string, data: PhotoRecordUpdate): Promise<PhotoRecord>;

  /**
   * Soft deletes a photo (sets isDeleted flag)
   *
   * @param id - Photo UUID
   * @returns Promise resolving to void
   * @throws NotFoundError if photo does not exist
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Sets PhotoRecord.isDeleted = true
   * - Sets PhotoRecord.deletedAt = now
   * - Decrements Patient.photoCount
   * - Increments Patient.deletedPhotoCount
   *
   * Note: Photo data remains in database for potential recovery
   */
  deletePhoto(id: string): Promise<void>;

  /**
   * Restores a soft-deleted photo
   *
   * @param id - Photo UUID
   * @returns Promise resolving to restored PhotoRecord
   * @throws NotFoundError if photo does not exist or is not deleted
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Sets PhotoRecord.isDeleted = false
   * - Sets PhotoRecord.deletedAt = null
   * - Increments Patient.photoCount
   * - Decrements Patient.deletedPhotoCount
   */
  restorePhoto(id: string): Promise<PhotoRecord>;

  /**
   * Searches photos by clinical notes keyword
   *
   * @param keyword - Search term (case-insensitive)
   * @param options.patientId - Optional filter by specific patient
   * @param options.bodyPart - Optional filter by body part
   * @returns Promise resolving to array of matching PhotoRecords
   * @throws Error if IndexedDB query fails
   *
   * Performance: O(n) scan of all photos (no full-text index in IndexedDB)
   * Note: For large datasets (10,000+ photos), consider debouncing search input
   */
  searchPhotosByNotes(
    keyword: string,
    options?: { patientId?: string; bodyPart?: BodyPart }
  ): Promise<PhotoRecord[]>;

  /**
   * Gets count of photos for a patient
   *
   * @param patientId - Patient UUID
   * @param includeDeleted - Whether to include soft-deleted photos (default: false)
   * @returns Promise resolving to count
   * @throws Error if IndexedDB query fails
   *
   * Performance: Uses denormalized Patient.photoCount when possible
   */
  getPhotoCount(patientId: string, includeDeleted?: boolean): Promise<number>;

  /**
   * Exports photo as data URL for sharing/printing
   *
   * @param id - Photo UUID
   * @param useThumbnail - Whether to export thumbnail or full resolution (default: false)
   * @returns Promise resolving to data URL (base64 encoded image)
   * @throws NotFoundError if photo does not exist
   * @throws Error if Blob conversion fails
   */
  exportPhotoAsDataUrl(id: string, useThumbnail?: boolean): Promise<string>;

  /**
   * Gets photos for comparison (validates selection constraints)
   *
   * @param photoIds - Array of photo UUIDs (2-4 items)
   * @returns Promise resolving to array of PhotoRecords in requested order
   * @throws ValidationError if photoIds length not 2-4
   * @throws NotFoundError if any photo does not exist
   * @throws Error if IndexedDB query fails
   *
   * Note: No constraint that photos must be from same patient or body part
   * (clinician may want to compare different patients/sites)
   */
  getPhotosForComparison(photoIds: string[]): Promise<PhotoRecord[]>;
}

/**
 * Error Types
 */

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StorageQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageQuotaError';
  }
}
