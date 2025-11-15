/**
 * ExportService implementation with jsPDF integration
 * Handles PDF report generation and export operations
 */

import jsPDF from 'jspdf';
import { DatabaseService } from './database-service';
// import { PatientService } from './patient-service'; // Unused, using DB directly
import { PhotoService } from './photo-service';
import { FileSystemService } from './file-system-service';
import {
  ExportReport,
  ExportRequest,
  ReportPreview,
  ReportTemplate,
  ReportParameters,
  ExportValidator,
  ExportReportFactory,
  ExportUtils,
  ReportNotFoundError,
  ExportValidationError,
  ExportGenerationError,
} from '../models/export';
import type { Patient } from '../models/patient';
import type { Photo, PhotoSearchFilters } from '../models/photo';
import type { BodyPartCategory } from '../models/body-part';

export interface ExportProgress {
  step: string;
  percentage: number;
  currentOperation: string;
  estimatedTimeRemaining?: number;
}

export interface ExportOptions {
  includeWatermark?: boolean;
  watermarkText?: string;
  compression?: boolean;
  onProgress?: (progress: ExportProgress) => void;
}

export class ExportService {
  private databaseService: DatabaseService;
  // private patientService: PatientService; // Currently unused, using DB directly
  private photoService: PhotoService;
  private fileSystemService: FileSystemService;

  constructor() {
    this.databaseService = new DatabaseService();
    // this.patientService = new PatientService();
    this.photoService = new PhotoService();
    this.fileSystemService = new FileSystemService();
  }

  /**
   * Generate PDF report from export request
   */
  async generateReport(
    request: ExportRequest,
    options: ExportOptions = {}
  ): Promise<ExportReport> {
    try {
      // Validate request
      const validation = ExportValidator.validateExportRequest(request);
      if (!validation.isValid) {
        throw new ExportValidationError(validation.errors);
      }

      this.reportProgress(options.onProgress, 'Validating', 5, 'Validating export parameters');

      // Get patient data
      const patient = await this.getPatientData(request.patientId);
      if (!patient) {
        throw new Error(`Patient not found: ${request.patientId}`);
      }

      this.reportProgress(options.onProgress, 'Data Collection', 15, 'Collecting patient data');

      // Get photos based on parameters
      const photos = await this.getPhotosForReport(request);

      this.reportProgress(options.onProgress, 'Data Collection', 25, 'Collecting photos');

      // Get body part categories
      const bodyParts = await this.getBodyPartsForReport(request, photos);

      this.reportProgress(options.onProgress, 'PDF Generation', 35, 'Initializing PDF document');

      // Generate PDF
      const pdf = await this.createPDFDocument(request, patient, photos, bodyParts, options);

      this.reportProgress(options.onProgress, 'PDF Generation', 70, 'Rendering PDF content');

      // Save PDF
      const pdfBlob = pdf.output('blob');
      const filePath = `reports/${request.patientId}/${Date.now()}_${request.reportType}.pdf`;

      this.reportProgress(options.onProgress, 'File Save', 85, 'Saving PDF file');

      await this.fileSystemService.saveFileAs(filePath, pdfBlob, `${request.reportType}_${Date.now()}.pdf`);

      // Create export report record
      const reportInfo = {
        filePath,
        pageCount: pdf.getNumberOfPages(),
        includedPhotoIds: photos.map(p => p.id),
        fileSize: pdfBlob.size,
      };

      const exportReport = ExportReportFactory.create(request, reportInfo);

      // Save export record to database
      await this.saveExportRecord(exportReport);

      this.reportProgress(options.onProgress, 'Complete', 100, 'Report generation complete');

      console.log('Report generated successfully:', exportReport.id);
      return exportReport;

    } catch (error) {
      console.error('Failed to generate report:', error);
      if (error instanceof ExportValidationError) {
        throw error;
      }
      throw new ExportGenerationError(
        error instanceof Error ? error.message : 'Unknown error occurred'
      );
    }
  }

  /**
   * Preview report without generating full PDF
   */
  async previewReport(request: ExportRequest): Promise<ReportPreview> {
    try {
      // Validate request
      const validation = ExportValidator.validateExportRequest(request);
      if (!validation.isValid) {
        throw new ExportValidationError(validation.errors);
      }

      // Get photos for preview
      const photos = await this.getPhotosForReport(request);

      // Calculate preview data
      const photoCount = photos.length;
      const bodyPartIds = new Set(photos.map(p => p.bodyPartCategoryId));
      const sessionIds = new Set(photos.map(p => p.captureDate.toDateString()));

      const dateRange = this.calculateDateRange(photos);
      const estimatedPages = ExportUtils.estimatePageCount(photoCount, request.parameters);
      const estimatedFileSize = ExportUtils.estimateFileSize(photoCount, request.parameters);
      const includedSections = ExportUtils.getIncludedSections(request.parameters);

      return {
        estimatedPages,
        photoCount,
        bodyPartCount: bodyPartIds.size,
        sessionCount: sessionIds.size,
        dateRange,
        estimatedFileSize,
        includedSections,
      };

    } catch (error) {
      console.error('Failed to preview report:', error);
      throw new ExportGenerationError(
        error instanceof Error ? error.message : 'Failed to preview report'
      );
    }
  }

  /**
   * Get available report templates
   */
  getReportTemplates(): ReportTemplate[] {
    return ExportUtils.getDefaultTemplates();
  }

  /**
   * Get export history for patient
   */
  async getExportHistory(patientId: string): Promise<ExportReport[]> {
    try {
      const db = await this.databaseService.getDatabase();
      const reports = await db.exportReports
        .where('patientId')
        .equals(patientId)
        .reverse()
        .sortBy('generatedAt');

      return reports;

    } catch (error) {
      console.error('Failed to get export history:', error);
      throw new Error('Failed to retrieve export history');
    }
  }

  /**
   * Delete export report and associated file
   */
  async deleteExportReport(reportId: string): Promise<void> {
    try {
      const db = await this.databaseService.getDatabase();
      const report = await db.exportReports.get(reportId);

      if (!report) {
        throw new ReportNotFoundError(reportId);
      }

      // Delete file
      try {
        // TODO: Implement deleteFile method in FileSystemService
        console.warn('File deletion not implemented, skipping file cleanup for:', report.filePath);
      } catch (fileError) {
        console.warn('Failed to delete report file:', fileError);
        // Continue with database deletion even if file deletion fails
      }

      // Delete from database
      await db.exportReports.delete(reportId);

      console.log('Export report deleted successfully:', reportId);

    } catch (error) {
      console.error('Failed to delete export report:', error);
      if (error instanceof ReportNotFoundError) {
        throw error;
      }
      throw new Error('Failed to delete export report');
    }
  }

  // Private helper methods

  private async getPatientData(patientId: string): Promise<Patient | undefined> {
    try {
      const db = await this.databaseService.getDatabase();
      return await db.patients.get(patientId);
    } catch (error) {
      console.error('Failed to get patient data:', error);
      return undefined;
    }
  }

  private async getPhotosForReport(request: ExportRequest): Promise<Photo[]> {
    const filters = this.buildPhotoFilters(request.parameters);
    return await this.photoService.getPhotosForPatient(request.patientId, filters);
  }

  private async getBodyPartsForReport(
    _request: ExportRequest,
    photos: Photo[]
  ): Promise<BodyPartCategory[]> {
    try {
      const db = await this.databaseService.getDatabase();
      const bodyPartIds = new Set(photos.map(p => p.bodyPartCategoryId));
      const bodyParts: BodyPartCategory[] = [];

      for (const id of bodyPartIds) {
        const bodyPart = await db.bodyPartCategories.get(id);
        if (bodyPart) {
          bodyParts.push(bodyPart);
        }
      }

      return bodyParts;

    } catch (error) {
      console.error('Failed to get body parts for report:', error);
      return [];
    }
  }

  private buildPhotoFilters(parameters: ReportParameters): PhotoSearchFilters {
    return {
      dateRange: parameters.dateRange ? {
        start: parameters.dateRange.startDate,
        end: parameters.dateRange.endDate,
      } : undefined,
      bodyPartCategoryId: parameters.bodyPartIds?.[0], // Simplified for now
      sortBy: this.mapSortOrderToPhotoSort(parameters.sortOrder),
      sortOrder: (parameters.sortOrder.includes('desc') ? 'desc' : 'asc') as 'asc' | 'desc',
    };
  }

  private mapSortOrderToPhotoSort(sortOrder: string): 'date' | 'name' | 'size' {
    if (sortOrder.startsWith('date')) return 'date';
    if (sortOrder === 'bodypart') return 'name';
    return 'date';
  }

  private async createPDFDocument(
    request: ExportRequest,
    patient: Patient,
    photos: Photo[],
    bodyParts: BodyPartCategory[],
    options: ExportOptions
  ): Promise<jsPDF> {
    const pdf = new jsPDF('p', 'mm', 'a4');

    // Add title page
    this.addTitlePage(pdf, request, patient);

    if (request.parameters.includeMedicalNotes || request.parameters.includeMetadata) {
      this.addSummaryPage(pdf, patient, photos, bodyParts, request.parameters);
    }

    // Add photo pages based on layout
    await this.addPhotoPages(pdf, photos, request.parameters, options);

    // Add watermark if requested
    if (options.includeWatermark) {
      this.addWatermark(pdf, options.watermarkText || 'CONFIDENTIAL MEDICAL RECORD');
    }

    return pdf;
  }

  private addTitlePage(pdf: jsPDF, request: ExportRequest, patient: Patient): void {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    // Title
    pdf.setFontSize(20);
    pdf.setFont('helvetica', 'bold');
    pdf.text('cIQCam Medical Report', pageWidth / 2, 30, { align: 'center' });

    // Report type
    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'normal');
    const reportTypeTitle = this.formatReportType(request.reportType);
    pdf.text(reportTypeTitle, pageWidth / 2, 45, { align: 'center' });

    // Patient information
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Patient Information:', 20, 70);

    pdf.setFont('helvetica', 'normal');
    pdf.text(`Name: ${patient.name}`, 20, 85);
    pdf.text(`Date of Birth: ${patient.dateOfBirth.toLocaleDateString()}`, 20, 95);
    pdf.text(`Assigned Doctor: ${patient.assignedDoctor}`, 20, 105);

    if (patient.isUrgent) {
      pdf.setTextColor(255, 0, 0);
      pdf.setFont('helvetica', 'bold');
      pdf.text('URGENT CASE', 20, 115);
      pdf.setTextColor(0, 0, 0);
    }

    // Report generation info
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Generated: ${new Date().toLocaleDateString()}`, 20, pageHeight - 30);
    pdf.text(`Report Type: ${reportTypeTitle}`, 20, pageHeight - 20);

    // Add new page
    pdf.addPage();
  }

  private addSummaryPage(
    pdf: jsPDF,
    patient: Patient,
    photos: Photo[],
    bodyParts: BodyPartCategory[],
    parameters: ReportParameters
  ): void {
    let currentY = 20;

    pdf.setFontSize(16);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Summary', 20, currentY);
    currentY += 15;

    // Photo summary
    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Photo Summary:', 20, currentY);
    currentY += 8;

    pdf.setFont('helvetica', 'normal');
    pdf.text(`Total Photos: ${photos.length}`, 25, currentY);
    currentY += 6;
    pdf.text(`Body Parts: ${bodyParts.length}`, 25, currentY);
    currentY += 6;

    if (photos.length > 0) {
      const dateRange = this.calculateDateRange(photos);
      pdf.text(`Date Range: ${dateRange.earliest.toLocaleDateString()} - ${dateRange.latest.toLocaleDateString()}`, 25, currentY);
      currentY += 10;
    }

    // Medical notes if included
    if (parameters.includeMedicalNotes && patient.notes) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Medical Notes:', 20, currentY);
      currentY += 8;

      pdf.setFont('helvetica', 'normal');
      const notes = pdf.splitTextToSize(patient.notes, 170);
      pdf.text(notes, 25, currentY);
      currentY += notes.length * 6 + 10;
    }

    // Body parts list
    if (bodyParts.length > 0) {
      pdf.setFont('helvetica', 'bold');
      pdf.text('Body Parts Documented:', 20, currentY);
      currentY += 8;

      pdf.setFont('helvetica', 'normal');
      bodyParts.forEach(bodyPart => {
        const photosForPart = photos.filter(p => p.bodyPartCategoryId === bodyPart.id);
        pdf.text(`• ${bodyPart.name} (${photosForPart.length} photos)`, 25, currentY);
        currentY += 6;
      });
    }

    pdf.addPage();
  }

  private async addPhotoPages(
    pdf: jsPDF,
    photos: Photo[],
    parameters: ReportParameters,
    options: ExportOptions
  ): Promise<void> {
    if (photos.length === 0) {
      pdf.setFontSize(12);
      pdf.text('No photos to display', 20, 30);
      return;
    }

    const photosPerPage = parameters.maxPhotosPerPage ||
      ExportUtils['getDefaultPhotosPerPage'](parameters.photoLayout);

    for (let i = 0; i < photos.length; i += photosPerPage) {
      const pagePhotos = photos.slice(i, i + photosPerPage);

      if (i > 0) {
        pdf.addPage();
      }

      await this.addPhotoPage(pdf, pagePhotos, parameters, options);

      // Report progress
      const progress = Math.min(90, 40 + (i / photos.length) * 40);
      this.reportProgress(
        options.onProgress,
        'PDF Generation',
        progress,
        `Adding photos ${i + 1}-${Math.min(i + photosPerPage, photos.length)} of ${photos.length}`
      );
    }
  }

  private async addPhotoPage(
    pdf: jsPDF,
    photos: Photo[],
    _parameters: ReportParameters,
    _options: ExportOptions
  ): Promise<void> {
    const pageHeight = pdf.internal.pageSize.getHeight();

    let currentY = 20;

    for (const photo of photos) {
      try {
        // Add photo metadata
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Capture Date: ${photo.captureDate.toLocaleDateString()}`, 20, currentY);
        currentY += 5;

        pdf.setFont('helvetica', 'normal');
        if (photo.description) {
          pdf.text(`Description: ${photo.description}`, 20, currentY);
          currentY += 5;
        }

        if (photo.isUrgent) {
          pdf.setTextColor(255, 0, 0);
          pdf.text('URGENT', 20, currentY);
          pdf.setTextColor(0, 0, 0);
          currentY += 5;
        }

        currentY += 5;

        // For now, add placeholder for photo
        // In a full implementation, you would load and add the actual image
        pdf.setDrawColor(200, 200, 200);
        pdf.rect(20, currentY, 80, 60);
        pdf.setFontSize(8);
        pdf.text('[Photo placeholder]', 25, currentY + 30);
        pdf.text(`${photo.fileName}`, 25, currentY + 35);
        pdf.text(`${photo.width}x${photo.height}`, 25, currentY + 40);

        currentY += 70;

        // Check if we need a new page
        if (currentY > pageHeight - 40) {
          break;
        }

      } catch (error) {
        console.warn('Failed to add photo to PDF:', photo.id, error);
        // Continue with next photo
      }
    }
  }

  private addWatermark(pdf: jsPDF, text: string): void {
    const pageCount = pdf.getNumberOfPages();

    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);

      pdf.saveGraphicsState();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pdf.setGState(new (pdf as any).GState({ opacity: 0.1 }));
      pdf.setTextColor(128, 128, 128);
      pdf.setFontSize(40);
      pdf.setFont('helvetica', 'bold');

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      pdf.text(text, pageWidth / 2, pageHeight / 2, {
        align: 'center',
        angle: 45
      });

      pdf.restoreGraphicsState();
    }
  }

  private formatReportType(reportType: string): string {
    const formatMap: Record<string, string> = {
      progress: 'Progress Report',
      summary: 'Summary Report',
      session: 'Session Report',
      comparison: 'Comparison Report',
      timeline: 'Timeline Report',
    };

    return formatMap[reportType] || reportType.charAt(0).toUpperCase() + reportType.slice(1);
  }

  private calculateDateRange(photos: Photo[]): { earliest: Date; latest: Date } {
    if (photos.length === 0) {
      const now = new Date();
      return { earliest: now, latest: now };
    }

    const dates = photos.map(p => p.captureDate.getTime());
    return {
      earliest: new Date(Math.min(...dates)),
      latest: new Date(Math.max(...dates)),
    };
  }

  private async saveExportRecord(exportReport: ExportReport): Promise<void> {
    try {
      const db = await this.databaseService.getDatabase();
      await db.exportReports.add(exportReport);
    } catch (error) {
      console.error('Failed to save export record:', error);
      // Don't throw - the PDF was generated successfully
    }
  }

  private reportProgress(
    onProgress: ExportOptions['onProgress'],
    step: string,
    percentage: number,
    operation: string
  ): void {
    if (onProgress) {
      onProgress({
        step,
        percentage,
        currentOperation: operation,
      });
    }
  }
}

// Export service instance and types
export type { ExportRequest, ReportPreview };
export { ExportReport, ReportNotFoundError, ExportValidationError, ExportGenerationError };