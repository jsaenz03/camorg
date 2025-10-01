/**
 * ProgressSession model
 * Groups photos taken during the same examination session for progress tracking
 */

export interface ProgressSession {
  id: string;
  patientId: string;
  sessionDate: Date;
  sessionType: SessionType;
  description: string;
  doctorName: string;
  photoIds: string[];
  findings: string;
  recommendations: string;
  nextFollowUp: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SessionType = 'initial' | 'follow-up' | 'urgent' | 'routine' | 'post-treatment';

export interface CreateProgressSessionRequest {
  patientId: string;
  sessionDate?: Date;
  sessionType: SessionType;
  description?: string;
  doctorName: string;
  photoIds?: string[];
  findings?: string;
  recommendations?: string;
  nextFollowUp?: Date;
}

export interface UpdateProgressSessionRequest {
  sessionDate?: Date;
  sessionType?: SessionType;
  description?: string;
  doctorName?: string;
  photoIds?: string[];
  findings?: string;
  recommendations?: string;
  nextFollowUp?: Date;
}

export interface ProgressSessionSearchFilters {
  sessionType?: SessionType;
  doctorName?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  hasPhotos?: boolean;
  hasFindings?: boolean;
  hasRecommendations?: boolean;
  sortBy?: 'date' | 'type' | 'doctor';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Validates progress session data according to business rules
 */
export class ProgressSessionValidator {
  static readonly VALID_SESSION_TYPES: SessionType[] = [
    'initial',
    'follow-up',
    'urgent',
    'routine',
    'post-treatment'
  ];

  static validateCreateRequest(request: CreateProgressSessionRequest): string[] {
    const errors: string[] = [];

    // Patient ID validation
    if (!request.patientId || request.patientId.trim().length === 0) {
      errors.push('Patient ID is required');
    }

    // Session type validation
    if (!request.sessionType) {
      errors.push('Session type is required');
    } else if (!this.VALID_SESSION_TYPES.includes(request.sessionType)) {
      errors.push(`Invalid session type. Valid types: ${this.VALID_SESSION_TYPES.join(', ')}`);
    }

    // Doctor name validation
    if (!request.doctorName || request.doctorName.trim().length === 0) {
      errors.push('Doctor name is required');
    } else if (request.doctorName.trim().length > 100) {
      errors.push('Doctor name must be less than 100 characters');
    }

    // Session date validation
    if (request.sessionDate) {
      const now = new Date();
      if (request.sessionDate > now) {
        errors.push('Session date cannot be in the future');
      }

      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 5);
      if (request.sessionDate < minDate) {
        errors.push('Session date cannot be more than 5 years in the past');
      }
    }

    // Description validation
    if (request.description && request.description.length > 1000) {
      errors.push('Description must be less than 1000 characters');
    }

    // Findings validation
    if (request.findings && request.findings.length > 2000) {
      errors.push('Findings must be less than 2000 characters');
    }

    // Recommendations validation
    if (request.recommendations && request.recommendations.length > 2000) {
      errors.push('Recommendations must be less than 2000 characters');
    }

    // Next follow-up validation
    if (request.nextFollowUp) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (request.nextFollowUp < today) {
        errors.push('Next follow-up date must be in the future');
      }

      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() + 2);
      if (request.nextFollowUp > maxDate) {
        errors.push('Next follow-up date cannot be more than 2 years in the future');
      }
    }

    // Photo IDs validation
    if (request.photoIds) {
      if (request.photoIds.length > 50) {
        errors.push('Maximum 50 photos allowed per session');
      }

      // Check for duplicate photo IDs
      const uniqueIds = new Set(request.photoIds);
      if (uniqueIds.size !== request.photoIds.length) {
        errors.push('Duplicate photo IDs are not allowed');
      }
    }

    return errors;
  }

  static validateUpdateRequest(request: UpdateProgressSessionRequest): string[] {
    const errors: string[] = [];

    // Session type validation (if provided)
    if (request.sessionType && !this.VALID_SESSION_TYPES.includes(request.sessionType)) {
      errors.push(`Invalid session type. Valid types: ${this.VALID_SESSION_TYPES.join(', ')}`);
    }

    // Doctor name validation (if provided)
    if (request.doctorName !== undefined) {
      if (request.doctorName.trim().length === 0) {
        errors.push('Doctor name cannot be empty');
      } else if (request.doctorName.trim().length > 100) {
        errors.push('Doctor name must be less than 100 characters');
      }
    }

    // Session date validation (if provided)
    if (request.sessionDate) {
      const now = new Date();
      if (request.sessionDate > now) {
        errors.push('Session date cannot be in the future');
      }

      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 5);
      if (request.sessionDate < minDate) {
        errors.push('Session date cannot be more than 5 years in the past');
      }
    }

    // Description validation (if provided)
    if (request.description !== undefined && request.description.length > 1000) {
      errors.push('Description must be less than 1000 characters');
    }

    // Findings validation (if provided)
    if (request.findings !== undefined && request.findings.length > 2000) {
      errors.push('Findings must be less than 2000 characters');
    }

    // Recommendations validation (if provided)
    if (request.recommendations !== undefined && request.recommendations.length > 2000) {
      errors.push('Recommendations must be less than 2000 characters');
    }

    // Next follow-up validation (if provided)
    if (request.nextFollowUp !== undefined && request.nextFollowUp !== null) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (request.nextFollowUp < today) {
        errors.push('Next follow-up date must be in the future');
      }

      const maxDate = new Date();
      maxDate.setFullYear(maxDate.getFullYear() + 2);
      if (request.nextFollowUp > maxDate) {
        errors.push('Next follow-up date cannot be more than 2 years in the future');
      }
    }

    // Photo IDs validation (if provided)
    if (request.photoIds) {
      if (request.photoIds.length > 50) {
        errors.push('Maximum 50 photos allowed per session');
      }

      // Check for duplicate photo IDs
      const uniqueIds = new Set(request.photoIds);
      if (uniqueIds.size !== request.photoIds.length) {
        errors.push('Duplicate photo IDs are not allowed');
      }
    }

    return errors;
  }
}

/**
 * Progress session factory for creating session instances
 */
export class ProgressSessionFactory {
  static create(request: CreateProgressSessionRequest): ProgressSession {
    const now = new Date();
    const id = crypto.randomUUID();

    return {
      id,
      patientId: request.patientId,
      sessionDate: request.sessionDate ?? now,
      sessionType: request.sessionType,
      description: request.description?.trim() ?? '',
      doctorName: request.doctorName.trim(),
      photoIds: request.photoIds ?? [],
      findings: request.findings?.trim() ?? '',
      recommendations: request.recommendations?.trim() ?? '',
      nextFollowUp: request.nextFollowUp ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  static update(existing: ProgressSession, request: UpdateProgressSessionRequest): ProgressSession {
    return {
      ...existing,
      sessionDate: request.sessionDate ?? existing.sessionDate,
      sessionType: request.sessionType ?? existing.sessionType,
      description: request.description?.trim() !== undefined ? request.description.trim() : existing.description,
      doctorName: request.doctorName?.trim() ?? existing.doctorName,
      photoIds: request.photoIds ?? existing.photoIds,
      findings: request.findings?.trim() !== undefined ? request.findings.trim() : existing.findings,
      recommendations: request.recommendations?.trim() !== undefined ? request.recommendations.trim() : existing.recommendations,
      nextFollowUp: request.nextFollowUp !== undefined ? request.nextFollowUp : existing.nextFollowUp,
      updatedAt: new Date(),
    };
  }
}

/**
 * Progress session utilities for common operations
 */
export class ProgressSessionUtils {
  /**
   * Sort sessions by specified criteria
   */
  static sortSessions(
    sessions: ProgressSession[],
    sortBy: 'date' | 'type' | 'doctor',
    order: 'asc' | 'desc' = 'desc'
  ): ProgressSession[] {
    const sorted = [...sessions].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = a.sessionDate.getTime() - b.sessionDate.getTime();
          break;
        case 'type':
          comparison = a.sessionType.localeCompare(b.sessionType);
          break;
        case 'doctor':
          comparison = a.doctorName.localeCompare(b.doctorName);
          break;
      }

      return order === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }

  /**
   * Filter sessions by search criteria
   */
  static filterSessions(sessions: ProgressSession[], filters: ProgressSessionSearchFilters): ProgressSession[] {
    return sessions.filter(session => {
      // Session type filter
      if (filters.sessionType && session.sessionType !== filters.sessionType) {
        return false;
      }

      // Doctor name filter
      if (filters.doctorName && !session.doctorName.toLowerCase().includes(filters.doctorName.toLowerCase())) {
        return false;
      }

      // Date range filter
      if (filters.dateRange) {
        const sessionTime = session.sessionDate.getTime();
        const startTime = filters.dateRange.start.getTime();
        const endTime = filters.dateRange.end.getTime();
        if (sessionTime < startTime || sessionTime > endTime) {
          return false;
        }
      }

      // Has photos filter
      if (filters.hasPhotos !== undefined) {
        const hasPhotos = session.photoIds.length > 0;
        if (hasPhotos !== filters.hasPhotos) {
          return false;
        }
      }

      // Has findings filter
      if (filters.hasFindings !== undefined) {
        const hasFindings = session.findings.trim().length > 0;
        if (hasFindings !== filters.hasFindings) {
          return false;
        }
      }

      // Has recommendations filter
      if (filters.hasRecommendations !== undefined) {
        const hasRecommendations = session.recommendations.trim().length > 0;
        if (hasRecommendations !== filters.hasRecommendations) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Group sessions by time period
   */
  static groupSessionsByPeriod(sessions: ProgressSession[], period: 'week' | 'month' | 'quarter' | 'year'): Record<string, ProgressSession[]> {
    const groups: Record<string, ProgressSession[]> = {};

    sessions.forEach(session => {
      const date = session.sessionDate;
      let key: string;

      switch (period) {
        case 'week':
          const week = Math.floor(date.getTime() / (7 * 24 * 60 * 60 * 1000));
          key = `Week ${week}`;
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'quarter':
          const quarter = Math.floor(date.getMonth() / 3) + 1;
          key = `${date.getFullYear()}-Q${quarter}`;
          break;
        case 'year':
          key = date.getFullYear().toString();
          break;
      }

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(session);
    });

    return groups;
  }

  /**
   * Calculate session statistics
   */
  static calculateSessionStats(sessions: ProgressSession[]): {
    totalSessions: number;
    sessionsByType: Record<SessionType, number>;
    averagePhotosPerSession: number;
    sessionsWithFindings: number;
    sessionsWithRecommendations: number;
    upcomingFollowUps: number;
  } {
    const stats = {
      totalSessions: sessions.length,
      sessionsByType: {} as Record<SessionType, number>,
      averagePhotosPerSession: 0,
      sessionsWithFindings: 0,
      sessionsWithRecommendations: 0,
      upcomingFollowUps: 0,
    };

    // Initialize session type counts
    ProgressSessionValidator.VALID_SESSION_TYPES.forEach(type => {
      stats.sessionsByType[type] = 0;
    });

    if (sessions.length === 0) {
      return stats;
    }

    let totalPhotos = 0;
    const now = new Date();

    sessions.forEach(session => {
      // Count by type
      stats.sessionsByType[session.sessionType]++;

      // Count photos
      totalPhotos += session.photoIds.length;

      // Count sessions with findings
      if (session.findings.trim().length > 0) {
        stats.sessionsWithFindings++;
      }

      // Count sessions with recommendations
      if (session.recommendations.trim().length > 0) {
        stats.sessionsWithRecommendations++;
      }

      // Count upcoming follow-ups
      if (session.nextFollowUp && session.nextFollowUp > now) {
        stats.upcomingFollowUps++;
      }
    });

    stats.averagePhotosPerSession = Math.round((totalPhotos / sessions.length) * 100) / 100;

    return stats;
  }
}

// Error classes
export class ProgressSessionNotFoundError extends Error {
  constructor(id: string) {
    super(`Progress session with ID ${id} not found`);
    this.name = 'ProgressSessionNotFoundError';
  }
}

export class ProgressSessionValidationError extends Error {
  constructor(field: string, message: string) {
    super(`Validation error for ${field}: ${message}`);
    this.name = 'ProgressSessionValidationError';
  }
}