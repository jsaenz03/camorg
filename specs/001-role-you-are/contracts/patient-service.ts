/**
 * Patient Service Contract
 *
 * Defines the interface for patient-related operations in the clinical photo
 * documentation system. All operations are client-side (IndexedDB).
 */

import { Patient } from '@/types/patient';
import type { PatientCreate, PatientUpdate } from '@/lib/validators/schemas';

export interface IPatientService {
  /**
   * Creates a new patient record
   *
   * @param data - Patient creation data (validated via Zod schema)
   * @returns Promise resolving to the created Patient with generated ID
   * @throws ValidationError if data fails schema validation
   * @throws DuplicateWarning if patient with same normalized name exists (non-blocking)
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Auto-generates normalizedName from name
   * - Sets photoCount = 0, deletedPhotoCount = 0
   * - Sets isArchived = false
   * - Stores optional dateOfBirth as UTC-midnight unix ms (NULL when omitted)
   */
  createPatient(data: PatientCreate): Promise<Patient>;

  /**
   * Retrieves a single patient by ID
   *
   * @param id - Patient UUID
   * @returns Promise resolving to Patient or null if not found
   * @throws Error if IndexedDB query fails
   */
  getPatientById(id: string): Promise<Patient | null>;

  /**
   * Retrieves all patients
   *
   * @param options.includeArchived - Whether to include archived patients (default: false)
   * @returns Promise resolving to array of Patients, sorted by lastPhotoAt DESC (most recent first)
   * @throws Error if IndexedDB query fails
   */
  getAllPatients(options?: { includeArchived?: boolean }): Promise<Patient[]>;

  /**
   * Searches patients by name (case-insensitive, partial match)
   *
   * @param searchTerm - Name to search for (partial match supported)
   * @param options.includeArchived - Whether to include archived patients (default: false)
   * @returns Promise resolving to array of matching Patients
   * @throws Error if IndexedDB query fails
   *
   * Performance: Uses normalizedName index with filter for partial matches
   */
  searchPatients(searchTerm: string, options?: { includeArchived?: boolean }): Promise<Patient[]>;

  /**
   * Updates patient name and optional date of birth
   *
   * @param id - Patient UUID
   * @param data - Update data (validated via Zod schema; absent dateOfBirth clears it)
   * @returns Promise resolving to updated Patient
   * @throws NotFoundError if patient does not exist
   * @throws ValidationError if data fails schema validation
   * @throws DuplicateWarning if new name matches existing patient (non-blocking)
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Updates Patient.updatedAt
   * - Regenerates Patient.normalizedName from new name
   * - Rewrites Patient.dateOfBirth (null clears it)
   */
  updatePatient(id: string, data: PatientUpdate): Promise<Patient>;

  /**
   * Archives a patient (hides from default views)
   *
   * @param id - Patient UUID
   * @returns Promise resolving to void
   * @throws NotFoundError if patient does not exist
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Sets Patient.isArchived = true
   * - Sets Patient.archivedAt = now
   *
   * Note: Photos remain accessible but patient hidden from patient list
   */
  archivePatient(id: string): Promise<void>;

  /**
   * Unarchives a patient
   *
   * @param id - Patient UUID
   * @returns Promise resolving to Patient
   * @throws NotFoundError if patient does not exist or is not archived
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Sets Patient.isArchived = false
   * - Sets Patient.archivedAt = null
   */
  unarchivePatient(id: string): Promise<Patient>;

  /**
   * Gets patient with photo count (real-time count, not denormalized)
   *
   * @param id - Patient UUID
   * @returns Promise resolving to Patient with accurate photoCount
   * @throws NotFoundError if patient does not exist
   * @throws Error if IndexedDB query fails
   *
   * Note: Recalculates photoCount from photos table (use for accuracy validation)
   */
  getPatientWithAccurateCount(id: string): Promise<Patient>;

  /**
   * Checks if patient name already exists (case-insensitive)
   *
   * @param name - Patient name to check
   * @param excludeId - Optional patient ID to exclude from check (for updates)
   * @returns Promise resolving to boolean (true if duplicate exists)
   * @throws Error if IndexedDB query fails
   *
   * Use case: Warn user before creating duplicate patient names
   */
  isDuplicateName(name: string, excludeId?: string): Promise<boolean>;

  /**
   * Recomputes denormalized photo counts from the photos table (internal,
   * called by PhotoService after any create/delete/restore)
   *
   * @param id - Patient UUID
   * @returns Promise resolving to void
   *
   * Side effects (single atomic UPDATE):
   * - photoCount = count of active photos, deletedPhotoCount = deleted ones
   * - lastPhotoAt = latest active capture time
   * - Updates Patient.updatedAt
   */
  recountPhotos(id: string): Promise<void>;
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

export class DuplicateWarning extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateWarning';
  }
}
