/**
 * Patient Service Contract
 * Defines the interface for patient management operations
 */

import { Patient, CreatePatientRequest, UpdatePatientRequest, PatientSearchFilters } from '../models/patient';

export interface PatientService {
  /**
   * Create a new patient record
   * @param request Patient creation data
   * @returns Promise resolving to created patient with generated ID
   * @throws PatientValidationError if data is invalid
   */
  createPatient(request: CreatePatientRequest): Promise<Patient>;

  /**
   * Update existing patient record
   * @param id Patient ID
   * @param request Updated patient data
   * @returns Promise resolving to updated patient
   * @throws PatientNotFoundError if patient doesn't exist
   * @throws PatientValidationError if data is invalid
   */
  updatePatient(id: string, request: UpdatePatientRequest): Promise<Patient>;

  /**
   * Get patient by ID
   * @param id Patient ID
   * @returns Promise resolving to patient or null if not found
   */
  getPatient(id: string): Promise<Patient | null>;

  /**
   * Get all patients with optional filtering
   * @param filters Optional search and filter criteria
   * @returns Promise resolving to array of patients
   */
  getPatients(filters?: PatientSearchFilters): Promise<Patient[]>;

  /**
   * Delete patient and all associated data
   * @param id Patient ID
   * @returns Promise resolving to boolean indicating success
   * @throws PatientNotFoundError if patient doesn't exist
   */
  deletePatient(id: string): Promise<boolean>;

  /**
   * Search patients by name
   * @param query Search query string
   * @returns Promise resolving to matching patients
   */
  searchPatients(query: string): Promise<Patient[]>;

  /**
   * Get patients with urgent flags
   * @returns Promise resolving to urgent patients
   */
  getUrgentPatients(): Promise<Patient[]>;

  /**
   * Get patients with upcoming follow-ups
   * @param days Number of days to look ahead (default: 7)
   * @returns Promise resolving to patients with follow-ups
   */
  getUpcomingFollowUps(days?: number): Promise<Patient[]>;
}

export interface CreatePatientRequest {
  name: string;
  dateOfBirth: Date;
  assignedDoctor: string;
  isUrgent?: boolean;
  followUpDate?: Date;
  notes?: string;
}

export interface UpdatePatientRequest {
  name?: string;
  dateOfBirth?: Date;
  assignedDoctor?: string;
  isUrgent?: boolean;
  followUpDate?: Date;
  notes?: string;
}

export interface PatientSearchFilters {
  name?: string;
  assignedDoctor?: string;
  isUrgent?: boolean;
  hasFollowUp?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

// Error types
export class PatientNotFoundError extends Error {
  constructor(id: string) {
    super(`Patient with ID ${id} not found`);
    this.name = 'PatientNotFoundError';
  }
}

export class PatientValidationError extends Error {
  constructor(field: string, message: string) {
    super(`Validation error for ${field}: ${message}`);
    this.name = 'PatientValidationError';
  }
}