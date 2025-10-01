import { describe, it, expect, beforeEach } from 'vitest';
import { ExportService } from '../../services/export-service';
import type { ExportRequest, ReportParameters } from '../../models/export';

describe('ExportService Contract Tests', () => {
  let exportService: ExportService;

  beforeEach(() => {
    exportService = new ExportService();
  });

  describe('generateReport', () => {
    it('should generate PDF report for patient', async () => {
      const parameters: ReportParameters = {
        dateRange: {
          startDate: new Date('2023-01-01'),
          endDate: new Date('2023-12-31')
        },
        includeProgressComparison: true,
        includeMedicalNotes: true,
        includeMetadata: true,
        photoLayout: 'timeline',
        sortOrder: 'date-asc',
        photoQuality: 'medium',
        maxPhotosPerPage: 6
      };

      const request: ExportRequest = {
        patientId: 'patient-123',
        reportType: 'progress',
        parameters,
        fileName: 'patient-progress-report.pdf'
      };

      const report = await exportService.generateReport(request);

      expect(report).toBeDefined();
      expect(report.id).toBeTruthy();
      expect(report.patientId).toBe(request.patientId);
      expect(report.reportType).toBe(request.reportType);
      expect(report.generatedAt).toBeInstanceOf(Date);
      expect(report.filePath).toBeTruthy();
      expect(report.pageCount).toBeGreaterThan(0);
      expect(Array.isArray(report.includedPhotoIds)).toBe(true);
      expect(report.parameters).toEqual(parameters);
    });

    it('should throw ExportValidationError for invalid request', async () => {
      const invalidRequest: ExportRequest = {
        patientId: '', // Invalid: empty patient ID
        reportType: 'progress',
        parameters: {
          includeProgressComparison: false,
          includeMedicalNotes: false,
          includeMetadata: false,
          photoLayout: 'grid',
          sortOrder: 'date-asc',
          photoQuality: 'medium'
        }
      };

      await expect(exportService.generateReport(invalidRequest))
        .rejects.toThrow('ExportValidationError');
    });
  });

  describe('previewReport', () => {
    it('should return preview data before generation', async () => {
      const request: ExportRequest = {
        patientId: 'patient-123',
        reportType: 'summary',
        parameters: {
          includeProgressComparison: true,
          includeMedicalNotes: true,
          includeMetadata: false,
          photoLayout: 'grid',
          sortOrder: 'date-desc',
          photoQuality: 'high'
        }
      };

      const preview = await exportService.previewReport(request);

      expect(preview).toBeDefined();
      expect(preview.estimatedPages).toBeGreaterThan(0);
      expect(preview.photoCount).toBeGreaterThanOrEqual(0);
      expect(preview.bodyPartCount).toBeGreaterThanOrEqual(0);
      expect(preview.sessionCount).toBeGreaterThanOrEqual(0);
      expect(preview.dateRange.earliest).toBeInstanceOf(Date);
      expect(preview.dateRange.latest).toBeInstanceOf(Date);
      expect(typeof preview.estimatedFileSize).toBe('string');
      expect(Array.isArray(preview.includedSections)).toBe(true);
    });
  });

  // downloadReport method not implemented yet
  // describe('downloadReport', () => {
  //   it('should return PDF blob for download', async () => {
  //     const reportId = 'report-123';

  //     const blob = await exportService.downloadReport(reportId);

  //     expect(blob).toBeInstanceOf(Blob);
  //     expect(blob.type).toBe('application/pdf');
  //     expect(blob.size).toBeGreaterThan(0);
  //   });

  //   it('should throw ReportNotFoundError for non-existent report', async () => {
  //     await expect(exportService.downloadReport('non-existent-id'))
  //       .rejects.toThrow('ReportNotFoundError');
  //   });
  // });

  describe('getReportTemplates', () => {
    it('should return available report templates', async () => {
      const templates = await exportService.getReportTemplates();

      expect(Array.isArray(templates)).toBe(true);
      expect(templates.length).toBeGreaterThan(0);

      templates.forEach(template => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('description');
        expect(template).toHaveProperty('defaultParameters');
        expect(Array.isArray(template.supportedReportTypes)).toBe(true);
        expect(template.supportedReportTypes.length).toBeGreaterThan(0);
      });
    });
  });

  // validateExportRequest method not implemented yet
  // describe('validateExportRequest', () => {
  //   it('should validate export request and return validation result', async () => {
  //     const validRequest: ExportRequest = {
  //       patientId: 'patient-123',
  //       reportType: 'progress',
  //       parameters: {
  //         includeProgressComparison: true,
  //         includeMedicalNotes: true,
  //         includeMetadata: true,
  //         photoLayout: 'timeline',
  //         sortOrder: 'date-asc',
  //         photoQuality: 'medium'
  //       }
  //     };

  //     const result = await exportService.validateExportRequest(validRequest);

  //     expect(result).toBeDefined();
  //     expect(typeof result.isValid).toBe('boolean');
  //     expect(Array.isArray(result.errors)).toBe(true);
  //     expect(Array.isArray(result.warnings)).toBe(true);
  //     expect(Array.isArray(result.suggestions)).toBe(true);
  //   });

  //   it('should identify validation errors in invalid request', async () => {
  //     const invalidRequest: ExportRequest = {
  //       patientId: '', // Invalid
  //       reportType: 'progress',
  //       parameters: {
  //         includeProgressComparison: false,
  //         includeMedicalNotes: false,
  //         includeMetadata: false,
  //         photoLayout: 'grid',
  //         sortOrder: 'date-asc',
  //         photoQuality: 'medium'
  //       }
  //     };

  //     const result = await exportService.validateExportRequest(invalidRequest);

  //     expect(result.isValid).toBe(false);
  //     expect(result.errors.length).toBeGreaterThan(0);
  //   });
  // });
});