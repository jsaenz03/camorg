/**
 * Patient model with validation
 * Represents an individual patient receiving dermatological care
 */

export interface Patient {
  id: string;
  name: string;
  dateOfBirth: Date;
  assignedDoctor: string;
  isUrgent: boolean;
  followUpDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  notes: string;
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

/**
 * Validates patient data according to business rules
 */
export class PatientValidator {
  static validateCreateRequest(request: CreatePatientRequest): string[] {
    const errors: string[] = [];

    // Name validation
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Name is required');
    } else if (request.name.trim().length < 2) {
      errors.push('Name must be at least 2 characters long');
    } else if (request.name.trim().length > 100) {
      errors.push('Name must be less than 100 characters');
    }

    // Date of birth validation
    if (!request.dateOfBirth) {
      errors.push('Date of birth is required');
    } else {
      const today = new Date();
      today.setHours(23, 59, 59, 999); // End of today
      if (request.dateOfBirth > today) {
        errors.push('Date of birth cannot be in the future');
      }

      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 150);
      if (request.dateOfBirth < minDate) {
        errors.push('Date of birth is too far in the past');
      }
    }

    // Assigned doctor validation
    if (!request.assignedDoctor || request.assignedDoctor.trim().length === 0) {
      errors.push('Assigned doctor is required');
    }

    // Follow-up date validation
    if (request.followUpDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today
      if (request.followUpDate < today) {
        errors.push('Follow-up date must be in the future');
      }
    }

    return errors;
  }

  static validateUpdateRequest(request: UpdatePatientRequest): string[] {
    const errors: string[] = [];

    // Name validation (if provided)
    if (request.name !== undefined) {
      if (request.name.trim().length === 0) {
        errors.push('Name cannot be empty');
      } else if (request.name.trim().length < 2) {
        errors.push('Name must be at least 2 characters long');
      } else if (request.name.trim().length > 100) {
        errors.push('Name must be less than 100 characters');
      }
    }

    // Date of birth validation (if provided)
    if (request.dateOfBirth !== undefined) {
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (request.dateOfBirth > today) {
        errors.push('Date of birth cannot be in the future');
      }

      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 150);
      if (request.dateOfBirth < minDate) {
        errors.push('Date of birth is too far in the past');
      }
    }

    // Assigned doctor validation (if provided)
    if (request.assignedDoctor !== undefined && request.assignedDoctor.trim().length === 0) {
      errors.push('Assigned doctor cannot be empty');
    }

    // Follow-up date validation (if provided)
    if (request.followUpDate !== undefined && request.followUpDate !== null) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (request.followUpDate < today) {
        errors.push('Follow-up date must be in the future');
      }
    }

    return errors;
  }
}

/**
 * Patient factory for creating patient instances
 */
export class PatientFactory {
  static create(request: CreatePatientRequest): Patient {
    const now = new Date();
    const id = crypto.randomUUID();

    return {
      id,
      name: request.name.trim(),
      dateOfBirth: request.dateOfBirth,
      assignedDoctor: request.assignedDoctor.trim(),
      isUrgent: request.isUrgent ?? false,
      followUpDate: request.followUpDate ?? null,
      notes: request.notes?.trim() ?? '',
      createdAt: now,
      updatedAt: now,
    };
  }

  static update(existing: Patient, request: UpdatePatientRequest): Patient {
    return {
      ...existing,
      name: request.name?.trim() ?? existing.name,
      dateOfBirth: request.dateOfBirth ?? existing.dateOfBirth,
      assignedDoctor: request.assignedDoctor?.trim() ?? existing.assignedDoctor,
      isUrgent: request.isUrgent ?? existing.isUrgent,
      followUpDate: request.followUpDate !== undefined ? request.followUpDate : existing.followUpDate,
      notes: request.notes?.trim() !== undefined ? request.notes.trim() : existing.notes,
      updatedAt: new Date(),
    };
  }
}

// Error classes
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