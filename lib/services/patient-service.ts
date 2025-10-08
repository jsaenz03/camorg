/**
 * Patient Service Implementation
 *
 * Handles all patient-related operations including CRUD, search, and denormalized count updates.
 * Implements IPatientService interface from contracts/patient-service.ts
 */

import { v4 as uuidv4 } from 'uuid';
import type { Patient, PatientCreate, PatientUpdate } from '@/types/patient';
import type { IPatientService } from '@/specs/001-role-you-are/contracts/patient-service';
import { patientCreateSchema, patientUpdateSchema } from '@/lib/validators/schemas';
import { getDB } from '@/lib/db/indexeddb';
import { STORES } from '@/lib/db/schema';
import {
  NotFoundError,
  ValidationError,
  DuplicateWarning,
} from '@/lib/validators/errors';

export class PatientService implements IPatientService {
  /**
   * Creates a new patient record
   */
  async createPatient(data: PatientCreate): Promise<Patient> {
    // Validate data
    const validated = patientCreateSchema.parse(data);

    // Check for duplicate name (warning, non-blocking)
    const isDuplicate = await this.isDuplicateName(validated.name);
    if (isDuplicate) {
      console.warn(`Duplicate patient name: ${validated.name}`);
      // Note: This is a warning, not an error - allow creation
    }

    const now = new Date();
    const patient: Patient = {
      id: uuidv4(),
      name: validated.name,
      normalizedName: validated.name.trim().toLowerCase(),
      photoCount: 0,
      deletedPhotoCount: 0,
      createdAt: now,
      updatedAt: now,
      lastPhotoAt: null,
      clinicianId: '', // Will be set by auth context in real implementation
      isArchived: false,
      archivedAt: null,
    };

    const db = await getDB();
    await db.add(STORES.PATIENTS, patient);

    return patient;
  }

  /**
   * Retrieves a single patient by ID
   */
  async getPatientById(id: string): Promise<Patient | null> {
    const db = await getDB();
    const patient = await db.get(STORES.PATIENTS, id);
    return patient || null;
  }

  /**
   * Retrieves all patients
   */
  async getAllPatients(options: { includeArchived?: boolean } = {}): Promise<Patient[]> {
    const { includeArchived = false } = options;

    const db = await getDB();
    let patients = await db.getAll(STORES.PATIENTS);

    // Filter archived if needed
    if (!includeArchived) {
      patients = patients.filter((p) => !p.isArchived);
    }

    // Sort by lastPhotoAt DESC (most recent first), then by createdAt DESC
    patients.sort((a, b) => {
      if (a.lastPhotoAt && b.lastPhotoAt) {
        return b.lastPhotoAt.getTime() - a.lastPhotoAt.getTime();
      }
      if (a.lastPhotoAt) return -1;
      if (b.lastPhotoAt) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return patients;
  }

  /**
   * Searches patients by name (case-insensitive, partial match)
   */
  async searchPatients(
    searchTerm: string,
    options: { includeArchived?: boolean } = {}
  ): Promise<Patient[]> {
    const { includeArchived = false } = options;

    const db = await getDB();
    const normalizedSearch = searchTerm.trim().toLowerCase();

    // Get all patients from index and filter
    let patients = await db.getAll(STORES.PATIENTS);

    // Filter by search term and archived status
    patients = patients.filter((p) => {
      const matchesSearch = p.normalizedName.includes(normalizedSearch);
      const matchesArchived = includeArchived || !p.isArchived;
      return matchesSearch && matchesArchived;
    });

    // Sort by relevance (exact match first, then partial, then by lastPhotoAt)
    patients.sort((a, b) => {
      const aExact = a.normalizedName === normalizedSearch;
      const bExact = b.normalizedName === normalizedSearch;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = a.normalizedName.startsWith(normalizedSearch);
      const bStarts = b.normalizedName.startsWith(normalizedSearch);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      // Fallback to lastPhotoAt
      if (a.lastPhotoAt && b.lastPhotoAt) {
        return b.lastPhotoAt.getTime() - a.lastPhotoAt.getTime();
      }
      if (a.lastPhotoAt) return -1;
      if (b.lastPhotoAt) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return patients;
  }

  /**
   * Updates patient name
   */
  async updatePatient(id: string, data: PatientUpdate): Promise<Patient> {
    // Validate data
    const validated = patientUpdateSchema.parse(data);

    const db = await getDB();
    const patient = await db.get(STORES.PATIENTS, id);

    if (!patient) {
      throw new NotFoundError(`Patient not found: ${id}`);
    }

    // Check for duplicate name (excluding current patient)
    const isDuplicate = await this.isDuplicateName(validated.name, id);
    if (isDuplicate) {
      console.warn(`Duplicate patient name: ${validated.name}`);
      // Non-blocking warning
    }

    // Update patient
    const updatedPatient: Patient = {
      ...patient,
      name: validated.name,
      normalizedName: validated.name.trim().toLowerCase(),
      updatedAt: new Date(),
    };

    await db.put(STORES.PATIENTS, updatedPatient);

    return updatedPatient;
  }

  /**
   * Archives a patient
   */
  async archivePatient(id: string): Promise<void> {
    const db = await getDB();
    const patient = await db.get(STORES.PATIENTS, id);

    if (!patient) {
      throw new NotFoundError(`Patient not found: ${id}`);
    }

    const updatedPatient: Patient = {
      ...patient,
      isArchived: true,
      archivedAt: new Date(),
      updatedAt: new Date(),
    };

    await db.put(STORES.PATIENTS, updatedPatient);
  }

  /**
   * Unarchives a patient
   */
  async unarchivePatient(id: string): Promise<Patient> {
    const db = await getDB();
    const patient = await db.get(STORES.PATIENTS, id);

    if (!patient) {
      throw new NotFoundError(`Patient not found: ${id}`);
    }

    if (!patient.isArchived) {
      throw new NotFoundError(`Patient is not archived: ${id}`);
    }

    const updatedPatient: Patient = {
      ...patient,
      isArchived: false,
      archivedAt: null,
      updatedAt: new Date(),
    };

    await db.put(STORES.PATIENTS, updatedPatient);

    return updatedPatient;
  }

  /**
   * Gets patient with accurate photo count (recalculated from photos table)
   */
  async getPatientWithAccurateCount(id: string): Promise<Patient> {
    const db = await getDB();
    const patient = await db.get(STORES.PATIENTS, id);

    if (!patient) {
      throw new NotFoundError(`Patient not found: ${id}`);
    }

    // Count photos from photos table
    const photos = await db.getAllFromIndex(STORES.PHOTOS, 'patientId', id);
    const activePhotos = photos.filter((p) => !p.isDeleted);
    const deletedPhotos = photos.filter((p) => p.isDeleted);

    // Update counts if they differ
    if (
      patient.photoCount !== activePhotos.length ||
      patient.deletedPhotoCount !== deletedPhotos.length
    ) {
      const updatedPatient: Patient = {
        ...patient,
        photoCount: activePhotos.length,
        deletedPhotoCount: deletedPhotos.length,
        updatedAt: new Date(),
      };

      await db.put(STORES.PATIENTS, updatedPatient);
      return updatedPatient;
    }

    return patient;
  }

  /**
   * Checks if patient name already exists
   */
  async isDuplicateName(name: string, excludeId?: string): Promise<boolean> {
    const db = await getDB();
    const normalizedName = name.trim().toLowerCase();

    const patients = await db.getAllFromIndex(
      STORES.PATIENTS,
      'normalizedName',
      normalizedName
    );

    // Filter out the excluded ID if provided
    const duplicates = excludeId
      ? patients.filter((p) => p.id !== excludeId)
      : patients;

    return duplicates.length > 0;
  }

  /**
   * Updates denormalized photo counts
   */
  async updatePhotoCount(id: string, delta: number, isDeleted: boolean): Promise<void> {
    const db = await getDB();
    const patient = await db.get(STORES.PATIENTS, id);

    if (!patient) {
      throw new NotFoundError(`Patient not found: ${id}`);
    }

    const now = new Date();
    const updatedPatient: Patient = {
      ...patient,
      photoCount: isDeleted
        ? patient.photoCount
        : Math.max(0, patient.photoCount + delta),
      deletedPhotoCount: isDeleted
        ? Math.max(0, patient.deletedPhotoCount + delta)
        : patient.deletedPhotoCount,
      lastPhotoAt: delta > 0 && !isDeleted ? now : patient.lastPhotoAt,
      updatedAt: now,
    };

    await db.put(STORES.PATIENTS, updatedPatient);
  }
}

// Export singleton instance
export const patientService = new PatientService();
