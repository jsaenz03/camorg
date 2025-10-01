import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('PDF Export Workflow Integration Tests', () => {
  let testPatient: any;
  let testBodyPart: any;
  let testPhotos: any[];

  beforeEach(async () => {
    // Setup test data
    testPatient = await window.patientService.createPatient({
      name: 'Export Test Patient',
      dateOfBirth: new Date('1970-12-25'),
      assignedDoctor: 'Dr. Export'
    });

    testBodyPart = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Export Test Area',
      parentId: null
    });

    // Create test photos
    testPhotos = [];
    for (let i = 0; i < 3; i++) {
      const photo = await window.photoService.capturePhoto({
        patientId: testPatient.id,
        bodyPartCategoryId: testBodyPart.id,
        description: `Export test photo ${i + 1}`
      });
      testPhotos.push(photo);

      // Add some time between photos
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });

  afterEach(async () => {
    // Clean up test data
    if (testPatient) {
      await window.patientService.deletePatient(testPatient.id);
    }
  });

  it('should generate complete PDF progress report', async () => {
    // Step 1: Preview report to understand content
    const exportRequest = {
      patientId: testPatient.id,
      reportType: 'progress' as const,
      parameters: {
        dateRange: {
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
          endDate: new Date()
        },
        bodyPartIds: [testBodyPart.id],
        includeProgressComparison: true,
        includeMedicalNotes: true,
        includeMetadata: true,
        photoLayout: 'timeline' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'medium' as const,
        maxPhotosPerPage: 6
      },
      fileName: 'test-progress-report.pdf'
    };

    const preview = await window.exportService.previewReport(exportRequest);
    expect(preview.photoCount).toBe(testPhotos.length);
    expect(preview.bodyPartCount).toBe(1);
    expect(preview.estimatedPages).toBeGreaterThan(0);
    expect(preview.estimatedFileSize).toBeTruthy();

    // Step 2: Generate PDF report
    const report = await window.exportService.generateReport(exportRequest);
    expect(report.id).toBeTruthy();
    expect(report.patientId).toBe(testPatient.id);
    expect(report.reportType).toBe('progress');
    expect(report.pageCount).toBeGreaterThan(0);
    expect(report.includedPhotoIds).toHaveLength(testPhotos.length);
    expect(report.filePath).toBeTruthy();

    // Step 3: Download and verify PDF
    const pdfBlob = await window.exportService.downloadReport(report.id);
    expect(pdfBlob).toBeInstanceOf(Blob);
    expect(pdfBlob.type).toBe('application/pdf');
    expect(pdfBlob.size).toBeGreaterThan(0);

    // Step 4: Verify report is listed for patient
    const patientReports = await window.exportService.getReportsForPatient(testPatient.id);
    expect(patientReports.some(r => r.id === report.id)).toBe(true);

    // Step 5: Clean up
    await window.exportService.deleteReport(report.id);
  });

  it('should generate different report types with various layouts', async () => {
    const reportTypes = ['summary', 'session', 'comparison'] as const;
    const layouts = ['grid', 'timeline', 'comparison'] as const;

    for (const reportType of reportTypes) {
      for (const layout of layouts) {
        const exportRequest = {
          patientId: testPatient.id,
          reportType,
          parameters: {
            includeProgressComparison: true,
            includeMedicalNotes: true,
            includeMetadata: false,
            photoLayout: layout,
            sortOrder: 'date-desc' as const,
            photoQuality: 'high' as const
          }
        };

        const report = await window.exportService.generateReport(exportRequest);
        expect(report.reportType).toBe(reportType);
        expect(report.parameters.photoLayout).toBe(layout);

        // Clean up
        await window.exportService.deleteReport(report.id);
      }
    }
  });

  it('should validate export requests before generation', async () => {
    // Test valid request
    const validRequest = {
      patientId: testPatient.id,
      reportType: 'progress' as const,
      parameters: {
        includeProgressComparison: true,
        includeMedicalNotes: true,
        includeMetadata: true,
        photoLayout: 'grid' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'medium' as const
      }
    };

    const validResult = await window.exportService.validateExportRequest(validRequest);
    expect(validResult.isValid).toBe(true);
    expect(validResult.errors).toHaveLength(0);

    // Test invalid request
    const invalidRequest = {
      patientId: '', // Invalid: empty patient ID
      reportType: 'progress' as const,
      parameters: {
        includeProgressComparison: false,
        includeMedicalNotes: false,
        includeMetadata: false,
        photoLayout: 'grid' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'medium' as const
      }
    };

    const invalidResult = await window.exportService.validateExportRequest(invalidRequest);
    expect(invalidResult.isValid).toBe(false);
    expect(invalidResult.errors.length).toBeGreaterThan(0);
  });

  it('should provide report templates', async () => {
    const templates = await window.exportService.getReportTemplates();
    expect(templates.length).toBeGreaterThan(0);

    templates.forEach(template => {
      expect(template.id).toBeTruthy();
      expect(template.name).toBeTruthy();
      expect(template.description).toBeTruthy();
      expect(template.supportedReportTypes.length).toBeGreaterThan(0);
      expect(template.defaultParameters).toBeDefined();
    });

    // Test using a template
    const template = templates[0];
    const exportRequest = {
      patientId: testPatient.id,
      reportType: template.supportedReportTypes[0],
      parameters: {
        ...template.defaultParameters,
        includeProgressComparison: true,
        includeMedicalNotes: true,
        includeMetadata: true,
        photoLayout: 'grid' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'medium' as const
      },
      templateId: template.id
    };

    const report = await window.exportService.generateReport(exportRequest);
    expect(report.parameters).toMatchObject(template.defaultParameters);

    // Clean up
    await window.exportService.deleteReport(report.id);
  });

  it('should handle large reports with many photos', async () => {
    // Create additional photos for stress testing
    const additionalPhotos = [];
    for (let i = 0; i < 20; i++) {
      const photo = await window.photoService.capturePhoto({
        patientId: testPatient.id,
        bodyPartCategoryId: testBodyPart.id,
        description: `Stress test photo ${i + 1}`
      });
      additionalPhotos.push(photo);
    }

    const exportRequest = {
      patientId: testPatient.id,
      reportType: 'summary' as const,
      parameters: {
        includeProgressComparison: true,
        includeMedicalNotes: true,
        includeMetadata: true,
        photoLayout: 'grid' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'low' as const, // Use low quality for performance
        maxPhotosPerPage: 4
      }
    };

    const report = await window.exportService.generateReport(exportRequest);
    expect(report.includedPhotoIds.length).toBe(testPhotos.length + additionalPhotos.length);
    expect(report.pageCount).toBeGreaterThan(5); // Should span multiple pages

    // Clean up
    await window.exportService.deleteReport(report.id);
    await Promise.all(additionalPhotos.map(p => window.photoService.deletePhoto(p.id)));
  });

  it('should handle export errors gracefully', async () => {
    // Test with non-existent patient
    const invalidRequest = {
      patientId: 'non-existent-patient',
      reportType: 'progress' as const,
      parameters: {
        includeProgressComparison: false,
        includeMedicalNotes: false,
        includeMetadata: false,
        photoLayout: 'grid' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'medium' as const
      }
    };

    await expect(window.exportService.generateReport(invalidRequest))
      .rejects.toThrow();

    // Test downloading non-existent report
    await expect(window.exportService.downloadReport('non-existent-report'))
      .rejects.toThrow('ReportNotFoundError');

    // Test deleting non-existent report
    await expect(window.exportService.deleteReport('non-existent-report'))
      .rejects.toThrow('ReportNotFoundError');
  });

  it('should maintain report history and metadata', async () => {
    // Generate multiple reports
    const reports = [];
    for (let i = 0; i < 3; i++) {
      const exportRequest = {
        patientId: testPatient.id,
        reportType: 'progress' as const,
        parameters: {
          includeProgressComparison: true,
          includeMedicalNotes: i % 2 === 0,
          includeMetadata: i % 2 === 1,
          photoLayout: 'grid' as const,
          sortOrder: 'date-asc' as const,
          photoQuality: 'medium' as const
        },
        fileName: `report-${i + 1}.pdf`
      };

      const report = await window.exportService.generateReport(exportRequest);
      reports.push(report);

      // Add small delay between reports
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // Verify all reports are tracked
    const patientReports = await window.exportService.getReportsForPatient(testPatient.id);
    expect(patientReports.length).toBeGreaterThanOrEqual(3);

    // Verify report metadata
    for (const report of reports) {
      const retrievedReport = await window.exportService.getReport(report.id);
      expect(retrievedReport).toBeDefined();
      expect(retrievedReport?.generatedAt).toBeInstanceOf(Date);
      expect(retrievedReport?.parameters).toBeDefined();
    }

    // Clean up
    await Promise.all(reports.map(r => window.exportService.deleteReport(r.id)));
  });
});