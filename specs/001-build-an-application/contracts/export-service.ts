/**
 * Export Service Contract
 * Defines the interface for PDF report generation and export
 */

import { ExportReport, ExportRequest, ReportParameters } from '../models/export';

export interface ExportService {
  /**
   * Generate PDF report for patient
   * @param request Export configuration
   * @returns Promise resolving to generated report metadata
   * @throws ExportValidationError if request is invalid
   * @throws ExportGenerationError if PDF generation fails
   */
  generateReport(request: ExportRequest): Promise<ExportReport>;

  /**
   * Get report by ID
   * @param id Report ID
   * @returns Promise resolving to report metadata or null if not found
   */
  getReport(id: string): Promise<ExportReport | null>;

  /**
   * Get all reports for a patient
   * @param patientId Patient ID
   * @returns Promise resolving to array of reports
   */
  getReportsForPatient(patientId: string): Promise<ExportReport[]>;

  /**
   * Download report file as blob
   * @param id Report ID
   * @returns Promise resolving to PDF blob
   * @throws ReportNotFoundError if report doesn't exist
   * @throws FileNotFoundError if PDF file missing
   */
  downloadReport(id: string): Promise<Blob>;

  /**
   * Delete report and associated file
   * @param id Report ID
   * @returns Promise resolving to boolean indicating success
   * @throws ReportNotFoundError if report doesn't exist
   */
  deleteReport(id: string): Promise<boolean>;

  /**
   * Preview report data before generation
   * @param request Export configuration
   * @returns Promise resolving to preview data
   */
  previewReport(request: ExportRequest): Promise<ReportPreview>;

  /**
   * Get available report templates
   * @returns Promise resolving to array of template definitions
   */
  getReportTemplates(): Promise<ReportTemplate[]>;

  /**
   * Validate export request
   * @param request Export configuration to validate
   * @returns Promise resolving to validation result
   */
  validateExportRequest(request: ExportRequest): Promise<ValidationResult>;
}

export interface ExportRequest {
  patientId: string;
  reportType: ReportType;
  parameters: ReportParameters;
  templateId?: string;
  fileName?: string;
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

// Error types
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