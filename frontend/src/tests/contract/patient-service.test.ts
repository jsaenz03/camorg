import { describe, it, expect, beforeEach } from 'vitest';
import { PatientService } from '../../services/patient-service';
import type { CreatePatientRequest, UpdatePatientRequest } from '../../models/patient';

describe('PatientService Contract Tests', () => {
  let patientService: PatientService;

  beforeEach(() => {
    patientService = new PatientService();
  });

  describe('createPatient', () => {
    it('should create a new patient with generated ID', async () => {
      const request: CreatePatientRequest = {
        name: 'John Doe',
        dateOfBirth: new Date('1985-06-15'),
        assignedDoctor: 'Dr. Smith',
        isUrgent: false,
        notes: 'Initial consultation'
      };

      const patient = await patientService.createPatient(request);

      expect(patient).toBeDefined();
      expect(patient.id).toBeTruthy();
      expect(patient.name).toBe(request.name);
      expect(patient.dateOfBirth).toEqual(request.dateOfBirth);
      expect(patient.assignedDoctor).toBe(request.assignedDoctor);
      expect(patient.isUrgent).toBe(false);
      expect(patient.createdAt).toBeInstanceOf(Date);
      expect(patient.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw PatientValidationError for invalid data', async () => {
      const invalidRequest: CreatePatientRequest = {
        name: '', // Invalid: empty name
        dateOfBirth: new Date('2030-01-01'), // Invalid: future date
        assignedDoctor: 'Dr. Smith'
      };

      await expect(patientService.createPatient(invalidRequest))
        .rejects.toThrow('PatientValidationError');
    });
  });

  describe('getPatients', () => {
    it('should return array of patients', async () => {
      const patients = await patientService.getPatients();

      expect(Array.isArray(patients)).toBe(true);
    });

    it('should filter patients by search criteria', async () => {
      const filters = {
        name: 'John',
        isUrgent: true,
        assignedDoctor: 'Dr. Smith'
      };

      const patients = await patientService.getPatients(filters);

      expect(Array.isArray(patients)).toBe(true);
      // All returned patients should match filter criteria
      patients.forEach(patient => {
        if (filters.name) {
          expect(patient.name.toLowerCase()).toContain(filters.name.toLowerCase());
        }
        if (filters.isUrgent !== undefined) {
          expect(patient.isUrgent).toBe(filters.isUrgent);
        }
        if (filters.assignedDoctor) {
          expect(patient.assignedDoctor).toBe(filters.assignedDoctor);
        }
      });
    });
  });

  describe('updatePatient', () => {
    it('should update existing patient', async () => {
      // This test will fail until implementation exists
      const updateRequest: UpdatePatientRequest = {
        name: 'John Updated',
        isUrgent: true
      };

      const updatedPatient = await patientService.updatePatient('test-id', updateRequest);

      expect(updatedPatient.name).toBe(updateRequest.name);
      expect(updatedPatient.isUrgent).toBe(updateRequest.isUrgent);
      expect(updatedPatient.updatedAt).toBeInstanceOf(Date);
    });

    it('should throw PatientNotFoundError for non-existent patient', async () => {
      const updateRequest: UpdatePatientRequest = {
        name: 'Updated Name'
      };

      await expect(patientService.updatePatient('non-existent-id', updateRequest))
        .rejects.toThrow('PatientNotFoundError');
    });
  });
});