/**
 * ExportReport model with parameters interface
 * PDF export configuration and history
 */

export interface ExportReport {
  id: string;
  patientId: string;
  reportType: ReportType;
  generatedAt: Date;
  parameters: ReportParameters;
  filePath: string;
  pageCount: number;
  includedPhotoIds: string[];
  fileSize: number;
  fileName: string;
  createdAt: Date;
}

export type ReportType = 'progress' | 'summary' | 'session' | 'comparison' | 'timeline';

export interface ReportParameters {
  dateRange?: {
    startDate: Date;
    endDate: Date;
  };
  bodyPartIds?: string[]; // Specific body part categories
  sessionIds?: string[]; // Specific sessions
  includeProgressComparison: boolean;
  includeMedicalNotes: boolean;
  includeMetadata: boolean;
  photoLayout: PhotoLayout;
  sortOrder: SortOrder;
  maxPhotosPerPage?: number;
  photoQuality: PhotoQuality;
  showThumbnailsOnly?: boolean;
}

export type PhotoLayout = 'grid' | 'timeline' | 'comparison' | 'detailed';
export type SortOrder = 'date-asc' | 'date-desc' | 'bodypart' | 'urgency' | 'session';
export type PhotoQuality = 'low' | 'medium' | 'high' | 'original';

export interface ExportRequest {
  patientId: string;
  reportType: ReportType;
  parameters: ReportParameters;
  templateId?: string;
  fileName?: string;
}

export interface ReportPreview {
  estimatedPages: number;
  photoCount: number;
  bodyPartCount: number;
  sessionCount: number;
  dateRange: {
    earliest: Date;
    latest: Date;
  };
  estimatedFileSize: string;
  includedSections: string[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  defaultParameters: Partial<ReportParameters>;
  supportedReportTypes: ReportType[];
  previewImageUrl?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

/**
 * Validates export data according to business rules
 */
export class ExportValidator {
  static readonly VALID_REPORT_TYPES: ReportType[] = [
    'progress',
    'summary',
    'session',
    'comparison',
    'timeline'
  ];

  static readonly VALID_PHOTO_LAYOUTS: PhotoLayout[] = [
    'grid',
    'timeline',
    'comparison',
    'detailed'
  ];

  static readonly VALID_SORT_ORDERS: SortOrder[] = [
    'date-asc',
    'date-desc',
    'bodypart',
    'urgency',
    'session'
  ];

  static readonly VALID_PHOTO_QUALITIES: PhotoQuality[] = [
    'low',
    'medium',
    'high',
    'original'
  ];

  static readonly MAX_PHOTOS_PER_PAGE = 20;
  static readonly MIN_PHOTOS_PER_PAGE = 1;

  static validateExportRequest(request: ExportRequest): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Patient ID validation
    if (!request.patientId || request.patientId.trim().length === 0) {
      errors.push('Patient ID is required');
    }

    // Report type validation
    if (!request.reportType) {
      errors.push('Report type is required');
    } else if (!this.VALID_REPORT_TYPES.includes(request.reportType)) {
      errors.push(`Invalid report type. Valid types: ${this.VALID_REPORT_TYPES.join(', ')}`);
    }

    // Parameters validation
    if (!request.parameters) {
      errors.push('Report parameters are required');
    } else {
      const paramErrors = this.validateReportParameters(request.parameters);
      errors.push(...paramErrors.errors);
      warnings.push(...paramErrors.warnings);
      suggestions.push(...paramErrors.suggestions);
    }

    // File name validation (if provided)
    if (request.fileName) {
      if (!this.isValidFileName(request.fileName)) {
        errors.push('Invalid file name. Use only letters, numbers, hyphens, underscores, and dots.');
      }
    }

    // Template ID validation (if provided)
    if (request.templateId && request.templateId.trim().length === 0) {
      errors.push('Template ID cannot be empty');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  static validateReportParameters(parameters: ReportParameters): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Photo layout validation
    if (!this.VALID_PHOTO_LAYOUTS.includes(parameters.photoLayout)) {
      errors.push(`Invalid photo layout. Valid layouts: ${this.VALID_PHOTO_LAYOUTS.join(', ')}`);
    }

    // Sort order validation
    if (!this.VALID_SORT_ORDERS.includes(parameters.sortOrder)) {
      errors.push(`Invalid sort order. Valid orders: ${this.VALID_SORT_ORDERS.join(', ')}`);
    }

    // Photo quality validation
    if (!this.VALID_PHOTO_QUALITIES.includes(parameters.photoQuality)) {
      errors.push(`Invalid photo quality. Valid qualities: ${this.VALID_PHOTO_QUALITIES.join(', ')}`);
    }

    // Date range validation
    if (parameters.dateRange) {
      const { startDate, endDate } = parameters.dateRange;

      if (startDate >= endDate) {
        errors.push('Start date must be before end date');
      }

      const now = new Date();
      if (startDate > now) {
        warnings.push('Start date is in the future');
      }

      if (endDate > now) {
        warnings.push('End date is in the future');
      }

      const maxPastDate = new Date();
      maxPastDate.setFullYear(maxPastDate.getFullYear() - 10);
      if (startDate < maxPastDate) {
        warnings.push('Start date is more than 10 years in the past');
      }
    }

    // Photos per page validation
    if (parameters.maxPhotosPerPage !== undefined) {
      if (parameters.maxPhotosPerPage < this.MIN_PHOTOS_PER_PAGE) {
        errors.push(`Minimum photos per page is ${this.MIN_PHOTOS_PER_PAGE}`);
      } else if (parameters.maxPhotosPerPage > this.MAX_PHOTOS_PER_PAGE) {
        errors.push(`Maximum photos per page is ${this.MAX_PHOTOS_PER_PAGE}`);
      }
    }

    // Body part IDs validation
    if (parameters.bodyPartIds) {
      if (parameters.bodyPartIds.length === 0) {
        warnings.push('No body parts selected - report may be empty');
      } else if (parameters.bodyPartIds.length > 50) {
        warnings.push('Large number of body parts may result in very long report');
      }

      // Check for duplicates
      const uniqueIds = new Set(parameters.bodyPartIds);
      if (uniqueIds.size !== parameters.bodyPartIds.length) {
        errors.push('Duplicate body part IDs are not allowed');
      }
    }

    // Session IDs validation
    if (parameters.sessionIds) {
      if (parameters.sessionIds.length === 0) {
        warnings.push('No sessions selected - report may be empty');
      } else if (parameters.sessionIds.length > 20) {
        warnings.push('Large number of sessions may result in very long report');
      }

      // Check for duplicates
      const uniqueIds = new Set(parameters.sessionIds);
      if (uniqueIds.size !== parameters.sessionIds.length) {
        errors.push('Duplicate session IDs are not allowed');
      }
    }

    // Logic validation and suggestions
    if (parameters.photoLayout === 'comparison' && !parameters.includeProgressComparison) {
      suggestions.push('Consider enabling progress comparison for comparison layout');
    }

    if (parameters.photoLayout === 'timeline' && parameters.sortOrder !== 'date-asc' && parameters.sortOrder !== 'date-desc') {
      suggestions.push('Timeline layout works best with date-based sorting');
    }

    if (parameters.photoQuality === 'original' && !parameters.maxPhotosPerPage) {
      suggestions.push('Consider limiting photos per page when using original quality to avoid large file sizes');
    }

    if (parameters.showThumbnailsOnly && parameters.photoQuality !== 'low') {
      suggestions.push('Consider using low quality when showing thumbnails only');
    }

    if (!parameters.includeProgressComparison && !parameters.includeMedicalNotes && !parameters.includeMetadata) {
      warnings.push('Report will contain only photos without additional information');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  private static isValidFileName(fileName: string): boolean {
    // Allow letters, numbers, hyphens, underscores, dots, and spaces
    const validFileNameRegex = /^[a-zA-Z0-9._\-\s]+$/;
    return validFileNameRegex.test(fileName) && fileName.length > 0 && fileName.length <= 255;
  }
}

/**
 * Export report factory for creating report instances
 */
export class ExportReportFactory {
  static create(request: ExportRequest, reportInfo: {
    filePath: string;
    pageCount: number;
    includedPhotoIds: string[];
    fileSize: number;
  }): ExportReport {
    const now = new Date();
    const id = crypto.randomUUID();
    const fileName = request.fileName ?? this.generateFileName(request.reportType, request.patientId, now);

    return {
      id,
      patientId: request.patientId,
      reportType: request.reportType,
      generatedAt: now,
      parameters: request.parameters,
      filePath: reportInfo.filePath,
      pageCount: reportInfo.pageCount,
      includedPhotoIds: reportInfo.includedPhotoIds,
      fileSize: reportInfo.fileSize,
      fileName,
      createdAt: now,
    };
  }

  private static generateFileName(reportType: ReportType, patientId: string, date: Date): string {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const patientPrefix = patientId.substring(0, 8);
    return `${reportType}-report-${patientPrefix}-${dateStr}.pdf`;
  }
}

/**
 * Export utilities for common operations
 */
export class ExportUtils {
  /**
   * Estimate file size based on parameters
   */
  static estimateFileSize(
    photoCount: number,
    parameters: ReportParameters,
    averagePhotoSize = 2 * 1024 * 1024 // 2MB average
  ): string {
    let sizeMultiplier = 1;

    // Adjust based on photo quality
    switch (parameters.photoQuality) {
      case 'low':
        sizeMultiplier = 0.3;
        break;
      case 'medium':
        sizeMultiplier = 0.6;
        break;
      case 'high':
        sizeMultiplier = 1.0;
        break;
      case 'original':
        sizeMultiplier = 1.5;
        break;
    }

    // Adjust for thumbnails only
    if (parameters.showThumbnailsOnly) {
      sizeMultiplier *= 0.1;
    }

    // Base PDF overhead
    const basePdfSize = 100 * 1024; // 100KB

    // Estimated photo contribution
    const photoContribution = photoCount * averagePhotoSize * sizeMultiplier;

    // Text content contribution
    const textContribution = 50 * 1024; // 50KB for text content

    const totalBytes = basePdfSize + photoContribution + textContribution;

    return this.formatFileSize(totalBytes);
  }

  /**
   * Format file size in human-readable format
   */
  static formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${Math.round(size * 100) / 100} ${units[unitIndex]}`;
  }

  /**
   * Estimate page count based on layout and photos
   */
  static estimatePageCount(photoCount: number, parameters: ReportParameters): number {
    const photosPerPage = parameters.maxPhotosPerPage ?? this.getDefaultPhotosPerPage(parameters.photoLayout);

    // Base pages for content
    let pages = 1; // Cover page

    if (parameters.includeMedicalNotes || parameters.includeMetadata) {
      pages += 1; // Summary page
    }

    // Photo pages
    if (photoCount > 0) {
      pages += Math.ceil(photoCount / photosPerPage);
    }

    return pages;
  }

  /**
   * Get default photos per page for layout
   */
  private static getDefaultPhotosPerPage(layout: PhotoLayout): number {
    switch (layout) {
      case 'grid':
        return 6;
      case 'timeline':
        return 4;
      case 'comparison':
        return 2;
      case 'detailed':
        return 1;
      default:
        return 4;
    }
  }

  /**
   * Get report sections based on parameters
   */
  static getIncludedSections(parameters: ReportParameters): string[] {
    const sections: string[] = ['Photos'];

    if (parameters.includeProgressComparison) {
      sections.push('Progress Comparison');
    }

    if (parameters.includeMedicalNotes) {
      sections.push('Medical Notes');
    }

    if (parameters.includeMetadata) {
      sections.push('Photo Metadata');
    }

    if (parameters.dateRange) {
      sections.push('Date Range Filter');
    }

    if (parameters.bodyPartIds && parameters.bodyPartIds.length > 0) {
      sections.push('Body Part Filter');
    }

    if (parameters.sessionIds && parameters.sessionIds.length > 0) {
      sections.push('Session Filter');
    }

    return sections;
  }

  /**
   * Create default report templates
   */
  static getDefaultTemplates(): ReportTemplate[] {
    return [
      {
        id: 'quick-summary',
        name: 'Quick Summary',
        description: 'Basic report with photos in grid layout',
        defaultParameters: {
          includeProgressComparison: false,
          includeMedicalNotes: false,
          includeMetadata: false,
          photoLayout: 'grid',
          sortOrder: 'date-desc',
          photoQuality: 'medium',
          maxPhotosPerPage: 6,
        },
        supportedReportTypes: ['summary', 'session'],
      },
      {
        id: 'detailed-progress',
        name: 'Detailed Progress Report',
        description: 'Comprehensive report with timeline and medical notes',
        defaultParameters: {
          includeProgressComparison: true,
          includeMedicalNotes: true,
          includeMetadata: true,
          photoLayout: 'timeline',
          sortOrder: 'date-asc',
          photoQuality: 'high',
          maxPhotosPerPage: 4,
        },
        supportedReportTypes: ['progress', 'timeline'],
      },
      {
        id: 'comparison-analysis',
        name: 'Comparison Analysis',
        description: 'Side-by-side photo comparison with detailed metadata',
        defaultParameters: {
          includeProgressComparison: true,
          includeMedicalNotes: true,
          includeMetadata: true,
          photoLayout: 'comparison',
          sortOrder: 'date-asc',
          photoQuality: 'high',
          maxPhotosPerPage: 2,
        },
        supportedReportTypes: ['comparison', 'progress'],
      },
      {
        id: 'session-summary',
        name: 'Session Summary',
        description: 'Quick overview of specific examination sessions',
        defaultParameters: {
          includeProgressComparison: false,
          includeMedicalNotes: true,
          includeMetadata: false,
          photoLayout: 'grid',
          sortOrder: 'session',
          photoQuality: 'medium',
          maxPhotosPerPage: 6,
        },
        supportedReportTypes: ['session', 'summary'],
      },
    ];
  }
}

// Error classes
export class ReportNotFoundError extends Error {
  constructor(id: string) {
    super(`Report with ID ${id} not found`);
    this.name = 'ReportNotFoundError';
  }
}

export class ExportValidationError extends Error {
  constructor(errors: string[]) {
    super(`Export validation failed: ${errors.join(', ')}`);
    this.name = 'ExportValidationError';
  }
}

export class ExportGenerationError extends Error {
  constructor(message: string, cause?: Error) {
    super(`Report generation failed: ${message}`);
    this.name = 'ExportGenerationError';
    this.cause = cause;
  }
}

export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'FileNotFoundError';
  }
}