/**
 * PatientService implementation with IndexedDB operations
 * Manages patient data operations and business logic
 */

import {
  Patient,
  CreatePatientRequest,
  UpdatePatientRequest,
  PatientSearchFilters,
  PatientValidator,
  PatientFactory,
  PatientNotFoundError,
  PatientValidationError,
} from '../models/patient';
import { databaseService } from './database-service';
import { bodyPartInitializer } from './body-part-initializer';

export class PatientService {
  /**
   * Create a new patient record
   */
  async createPatient(request: CreatePatientRequest): Promise<Patient> {
    // Validate request
    const validationErrors = PatientValidator.validateCreateRequest(request);
    if (validationErrors.length > 0) {
      throw new PatientValidationError('createPatient', validationErrors.join(', '));
    }

    // Create patient instance
    const patient = PatientFactory.create(request);

    try {
      const db = await databaseService.getDatabase();
      await db.patients.add(patient);

      console.log(`Patient created: ${patient.id}`);

      // Initialize default body parts for the new patient
      try {
        const bodyPartsCount = await bodyPartInitializer.initializeBodyPartsForPatient(patient.id);
        console.log(`Initialized ${bodyPartsCount} body parts for patient ${patient.id}`);
      } catch (error) {
        console.warn('Failed to initialize body parts for patient:', error);
        // Don't throw - patient was created successfully, body parts can be added later
      }

      return patient;
    } catch (error) {
      console.error('Failed to create patient:', error);
      throw new PatientValidationError('createPatient', 'Failed to save patient to database');
    }
  }

  /**
   * Update existing patient record
   */
  async updatePatient(id: string, request: UpdatePatientRequest): Promise<Patient> {
    // Validate request
    const validationErrors = PatientValidator.validateUpdateRequest(request);
    if (validationErrors.length > 0) {
      throw new PatientValidationError('updatePatient', validationErrors.join(', '));
    }

    try {
      const db = await databaseService.getDatabase();

      // Get existing patient
      const existingPatient = await db.patients.get(id);
      if (!existingPatient) {
        throw new PatientNotFoundError(id);
      }

      // Update patient
      const updatedPatient = PatientFactory.update(existingPatient, request);
      await db.patients.put(updatedPatient);

      console.log(`Patient updated: ${id}`);
      return updatedPatient;
    } catch (error) {
      if (error instanceof PatientNotFoundError) {
        throw error;
      }
      console.error('Failed to update patient:', error);
      throw new PatientValidationError('updatePatient', 'Failed to update patient in database');
    }
  }

  /**
   * Get patient by ID
   */
  async getPatient(id: string): Promise<Patient | null> {
    try {
      const db = await databaseService.getDatabase();
      const patient = await db.patients.get(id);
      return patient || null;
    } catch (error) {
      console.error('Failed to get patient:', error);
      return null;
    }
  }

  /**
   * Get all patients with optional filtering
   */
  async getPatients(filters?: PatientSearchFilters): Promise<Patient[]> {
    try {
      const db = await databaseService.getDatabase();
      let query = db.patients.toCollection();

      // Apply filters
      if (filters) {
        // Filter by name
        if (filters.name) {
          query = query.filter(patient =>
            patient.name.toLowerCase().includes(filters.name!.toLowerCase())
          );
        }

        // Filter by assigned doctor
        if (filters.assignedDoctor) {
          query = query.filter(patient =>
            patient.assignedDoctor.toLowerCase().includes(filters.assignedDoctor!.toLowerCase())
          );
        }

        // Filter by urgent status
        if (filters.isUrgent !== undefined) {
          query = query.filter(patient => patient.isUrgent === filters.isUrgent);
        }

        // Filter by follow-up status
        if (filters.hasFollowUp !== undefined) {
          query = query.filter(patient =>
            filters.hasFollowUp ? patient.followUpDate !== null : patient.followUpDate === null
          );
        }

        // Filter by date range (creation date)
        if (filters.dateRange) {
          query = query.filter(patient => {
            const createdTime = patient.createdAt.getTime();
            return createdTime >= filters.dateRange!.start.getTime() &&
                   createdTime <= filters.dateRange!.end.getTime();
          });
        }
      }

      // Sort by name by default
      const patients = await query.sortBy('name');
      return patients;
    } catch (error) {
      console.error('Failed to get patients:', error);
      return [];
    }
  }

  /**
   * Delete patient and all associated data
   */
  async deletePatient(id: string): Promise<boolean> {
    try {
      const db = await databaseService.getDatabase();

      // Check if patient exists
      const patient = await db.patients.get(id);
      if (!patient) {
        throw new PatientNotFoundError(id);
      }

      // Delete patient (cascade deletion handled by database hooks)
      await db.patients.delete(id);

      console.log(`Patient deleted: ${id}`);
      return true;
    } catch (error) {
      if (error instanceof PatientNotFoundError) {
        throw error;
      }
      console.error('Failed to delete patient:', error);
      return false;
    }
  }

  /**
   * Search patients by name
   */
  async searchPatients(query: string): Promise<Patient[]> {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const searchQuery = query.trim().toLowerCase();

    try {
      const db = await databaseService.getDatabase();

      const patients = await db.patients
        .filter(patient =>
          patient.name.toLowerCase().includes(searchQuery) ||
          patient.assignedDoctor.toLowerCase().includes(searchQuery) ||
          patient.notes.toLowerCase().includes(searchQuery)
        )
        .sortBy('name');

      return patients;
    } catch (error) {
      console.error('Failed to search patients:', error);
      return [];
    }
  }

  /**
   * Get patients with urgent flags
   */
  async getUrgentPatients(): Promise<Patient[]> {
    try {
      const db = await databaseService.getDatabase();

      const urgentPatients = await db.patients
        .where('isUrgent')
        .equals(1) // Dexie uses 1 for true in indexes
        .sortBy('updatedAt');

      return urgentPatients.reverse(); // Most recently updated first
    } catch (error) {
      console.error('Failed to get urgent patients:', error);
      return [];
    }
  }

  /**
   * Get patients with upcoming follow-ups
   */
  async getUpcomingFollowUps(days = 7): Promise<Patient[]> {
    try {
      const db = await databaseService.getDatabase();
      const now = new Date();
      const futureDate = new Date();
      futureDate.setDate(now.getDate() + days);

      const patientsWithFollowUps = await db.patients
        .where('followUpDate')
        .between(now, futureDate, true, true)
        .sortBy('followUpDate');

      return patientsWithFollowUps;
    } catch (error) {
      console.error('Failed to get upcoming follow-ups:', error);
      return [];
    }
  }

  /**
   * Get patient statistics
   */
  async getPatientStatistics(): Promise<PatientStatistics> {
    try {
      const db = await databaseService.getDatabase();

      const [
        totalPatients,
        urgentPatients,
        patientsWithFollowUps,
        patientsCreatedThisMonth
      ] = await Promise.all([
        db.patients.count(),
        db.patients.where('isUrgent').equals(1).count(),
        db.patients.where('followUpDate').above(new Date()).count(),
        this.getPatientsCreatedThisMonth()
      ]);

      // Get patients by doctor
      const allPatients = await db.patients.toArray();
      const patientsByDoctor = allPatients.reduce((acc, patient) => {
        acc[patient.assignedDoctor] = (acc[patient.assignedDoctor] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalPatients,
        urgentPatients,
        patientsWithFollowUps,
        patientsCreatedThisMonth,
        patientsByDoctor,
      };
    } catch (error) {
      console.error('Failed to get patient statistics:', error);
      return {
        totalPatients: 0,
        urgentPatients: 0,
        patientsWithFollowUps: 0,
        patientsCreatedThisMonth: 0,
        patientsByDoctor: {},
      };
    }
  }

  /**
   * Get patients created this month
   */
  private async getPatientsCreatedThisMonth(): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    try {
      const db = await databaseService.getDatabase();

      const count = await db.patients
        .where('createdAt')
        .between(startOfMonth, endOfMonth, true, true)
        .count();

      return count;
    } catch (error) {
      console.error('Failed to get patients created this month:', error);
      return 0;
    }
  }

  /**
   * Update patient's urgent status
   */
  async updateUrgentStatus(id: string, isUrgent: boolean): Promise<Patient> {
    return await this.updatePatient(id, { isUrgent });
  }

  /**
   * Update patient's follow-up date
   */
  async updateFollowUpDate(id: string, followUpDate: Date | null): Promise<Patient> {
    return await this.updatePatient(id, { followUpDate: followUpDate ?? undefined });
  }

  /**
   * Add note to patient
   */
  async addPatientNote(id: string, note: string): Promise<Patient> {
    const patient = await this.getPatient(id);
    if (!patient) {
      throw new PatientNotFoundError(id);
    }

    const existingNotes = patient.notes.trim();
    const timestamp = new Date().toISOString();
    const newNote = `${timestamp}: ${note.trim()}`;

    const updatedNotes = existingNotes
      ? `${existingNotes}\n${newNote}`
      : newNote;

    return await this.updatePatient(id, { notes: updatedNotes });
  }

  /**
   * Get all doctors from patient records
   */
  async getAllDoctors(): Promise<string[]> {
    try {
      const db = await databaseService.getDatabase();
      const patients = await db.patients.toArray();

      const doctors = [...new Set(patients.map(p => p.assignedDoctor))]
        .filter(doctor => doctor.trim().length > 0)
        .sort();

      return doctors;
    } catch (error) {
      console.error('Failed to get all doctors:', error);
      return [];
    }
  }

  /**
   * Bulk update patients
   */
  async bulkUpdatePatients(updateList: Array<{ id: string; updates: UpdatePatientRequest }>): Promise<Patient[]> {
    const results: Patient[] = [];

    try {
      const db = await databaseService.getDatabase();

      await db.transaction('rw', db.patients, async () => {
        for (const { id, updates } of updateList) {
          const patient = await this.updatePatient(id, updates);
          results.push(patient);
        }
      });

      console.log(`Bulk updated ${results.length} patients`);
      return results;
    } catch (error) {
      console.error('Failed to bulk update patients:', error);
      throw error;
    }
  }

  /**
   * Export patients data
   */
  async exportPatients(patientIds?: string[]): Promise<Patient[]> {
    try {
      const db = await databaseService.getDatabase();

      if (patientIds && patientIds.length > 0) {
        const patients = await db.patients
          .where('id')
          .anyOf(patientIds)
          .toArray();
        return patients;
      } else {
        return await db.patients.toArray();
      }
    } catch (error) {
      console.error('Failed to export patients:', error);
      return [];
    }
  }

  /**
   * Get patient along with related data counts
   */
  async getPatientWithCounts(id: string): Promise<PatientWithCounts | null> {
    const patient = await this.getPatient(id);
    if (!patient) {
      return null;
    }

    try {
      const db = await databaseService.getDatabase();

      const [photoCount, bodyPartCount, sessionCount, reportCount] = await Promise.all([
        db.photos.where('patientId').equals(id).count(),
        db.bodyPartCategories.where('patientId').equals(id).count(),
        db.progressSessions.where('patientId').equals(id).count(),
        db.exportReports.where('patientId').equals(id).count(),
      ]);

      return {
        ...patient,
        photoCount,
        bodyPartCount,
        sessionCount,
        reportCount,
      };
    } catch (error) {
      console.error('Failed to get patient with counts:', error);
      return { ...patient, photoCount: 0, bodyPartCount: 0, sessionCount: 0, reportCount: 0 };
    }
  }
}

// Interface for patient statistics
export interface PatientStatistics {
  totalPatients: number;
  urgentPatients: number;
  patientsWithFollowUps: number;
  patientsCreatedThisMonth: number;
  patientsByDoctor: Record<string, number>;
}

// Interface for patient with related data counts
export interface PatientWithCounts extends Patient {
  photoCount: number;
  bodyPartCount: number;
  sessionCount: number;
  reportCount: number;
}

// Export singleton instance
export const patientService = new PatientService();