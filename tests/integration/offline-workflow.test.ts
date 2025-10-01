import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Offline Functionality Integration Tests', () => {
  let originalOnLine: boolean;

  beforeEach(async () => {
    // Store original online status
    originalOnLine = navigator.onLine;

    // Ensure clean database state
    await window.databaseService.initialize();
  });

  afterEach(async () => {
    // Restore original online status
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: originalOnLine
    });
  });

  it('should handle complete patient workflow while offline', async () => {
    // Go offline
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false
    });

    // Create patient while offline
    const patient = await window.patientService.createPatient({
      name: 'Offline Patient',
      dateOfBirth: new Date('1985-03-15'),
      assignedDoctor: 'Dr. Offline'
    });

    expect(patient.id).toBeTruthy();

    // Create body part while offline
    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: patient.id,
      name: 'Offline Body Part',
      parentId: null
    });

    expect(bodyPart.id).toBeTruthy();

    // Capture photo while offline
    const photo = await window.photoService.capturePhoto({
      patientId: patient.id,
      bodyPartCategoryId: bodyPart.id,
      description: 'Offline captured photo'
    });

    expect(photo.id).toBeTruthy();
    expect(photo.filePath).toBeTruthy();

    // Verify data persistence while offline
    const retrievedPatient = await window.patientService.getPatient(patient.id);
    expect(retrievedPatient).toBeDefined();
    expect(retrievedPatient?.name).toBe('Offline Patient');

    const patientPhotos = await window.photoService.getPhotosForPatient(patient.id);
    expect(patientPhotos).toHaveLength(1);

    // Go back online
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    // Verify data still accessible after coming online
    const onlinePatient = await window.patientService.getPatient(patient.id);
    expect(onlinePatient).toBeDefined();

    const onlinePhotos = await window.photoService.getPhotosForPatient(patient.id);
    expect(onlinePhotos).toHaveLength(1);

    // Clean up
    await window.patientService.deletePatient(patient.id);
  });

  it('should handle photo storage and retrieval offline', async () => {
    // Create test data online first
    const patient = await window.patientService.createPatient({
      name: 'Photo Offline Test',
      dateOfBirth: new Date('1980-01-01'),
      assignedDoctor: 'Dr. Photo'
    });

    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: patient.id,
      name: 'Test Area',
      parentId: null
    });

    // Go offline
    Object.defineProperty(navigator, 'onLine', {
      value: false
    });

    // Create multiple photos while offline
    const offlinePhotos = [];
    for (let i = 0; i < 3; i++) {
      const photo = await window.photoService.capturePhoto({
        patientId: patient.id,
        bodyPartCategoryId: bodyPart.id,
        description: `Offline photo ${i + 1}`
      });
      offlinePhotos.push(photo);
    }

    // Verify all photos are accessible offline
    for (const photo of offlinePhotos) {
      const photoBlob = await window.photoService.getPhotoBlob(photo.id);
      expect(photoBlob).toBeInstanceOf(Blob);
      expect(photoBlob.size).toBeGreaterThan(0);

      // Generate thumbnail offline
      const thumbnailPath = await window.photoService.generateThumbnail(photo.id, 150);
      expect(thumbnailPath).toBeTruthy();
    }

    // Test photo filtering and search offline
    const filteredPhotos = await window.photoService.getPhotosForPatient(patient.id, {
      dateRange: {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 24 hours ago
        end: new Date()
      }
    });

    expect(filteredPhotos).toHaveLength(3);

    // Go back online and verify persistence
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    const onlinePhotos = await window.photoService.getPhotosForPatient(patient.id);
    expect(onlinePhotos).toHaveLength(3);

    // Clean up
    await window.patientService.deletePatient(patient.id);
  });

  it('should handle database operations during connectivity changes', async () => {
    // Start online
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    const patient = await window.patientService.createPatient({
      name: 'Connectivity Test Patient',
      dateOfBirth: new Date('1975-06-20'),
      assignedDoctor: 'Dr. Connectivity'
    });

    // Go offline mid-operation
    Object.defineProperty(navigator, 'onLine', {
      value: false
    });

    // Update patient while offline
    const updatedPatient = await window.patientService.updatePatient(patient.id, {
      isUrgent: true,
      notes: 'Updated while offline'
    });

    expect(updatedPatient.isUrgent).toBe(true);
    expect(updatedPatient.notes).toBe('Updated while offline');

    // Create body part while offline
    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: patient.id,
      name: 'Offline Created Part',
      parentId: null
    });

    // Go back online
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    // Verify all changes persisted
    const finalPatient = await window.patientService.getPatient(patient.id);
    expect(finalPatient?.isUrgent).toBe(true);
    expect(finalPatient?.notes).toBe('Updated while offline');

    const bodyParts = await window.bodyPartService.getRootBodyParts(patient.id);
    expect(bodyParts.some(bp => bp.name === 'Offline Created Part')).toBe(true);

    // Clean up
    await window.patientService.deletePatient(patient.id);
  });

  it('should handle PDF export while offline', async () => {
    // Create test data
    const patient = await window.patientService.createPatient({
      name: 'Export Offline Test',
      dateOfBirth: new Date('1970-11-11'),
      assignedDoctor: 'Dr. Export'
    });

    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: patient.id,
      name: 'Export Test Area',
      parentId: null
    });

    const photo = await window.photoService.capturePhoto({
      patientId: patient.id,
      bodyPartCategoryId: bodyPart.id,
      description: 'Export test photo'
    });

    // Go offline
    Object.defineProperty(navigator, 'onLine', {
      value: false
    });

    // Generate PDF report while offline
    const exportRequest = {
      patientId: patient.id,
      reportType: 'summary' as const,
      parameters: {
        includeProgressComparison: false,
        includeMedicalNotes: true,
        includeMetadata: true,
        photoLayout: 'grid' as const,
        sortOrder: 'date-asc' as const,
        photoQuality: 'medium' as const
      }
    };

    const report = await window.exportService.generateReport(exportRequest);
    expect(report.id).toBeTruthy();
    expect(report.filePath).toBeTruthy();

    // Download report while offline
    const pdfBlob = await window.exportService.downloadReport(report.id);
    expect(pdfBlob).toBeInstanceOf(Blob);
    expect(pdfBlob.type).toBe('application/pdf');

    // Go back online and verify report still accessible
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    const onlineReport = await window.exportService.getReport(report.id);
    expect(onlineReport).toBeDefined();

    // Clean up
    await window.exportService.deleteReport(report.id);
    await window.patientService.deletePatient(patient.id);
  });

  it('should handle service worker caching for offline access', async () => {
    // This test verifies that the PWA service worker caches resources
    // and the app shell remains functional offline

    // Go offline
    Object.defineProperty(navigator, 'onLine', {
      value: false
    });

    // Verify core application functionality remains available
    // These operations should work from cached resources

    // Test that services are still accessible
    expect(window.patientService).toBeDefined();
    expect(window.photoService).toBeDefined();
    expect(window.bodyPartService).toBeDefined();
    expect(window.exportService).toBeDefined();
    expect(window.databaseService).toBeDefined();

    // Test basic database connectivity offline
    const isConnected = await window.databaseService.isConnected();
    expect(isConnected).toBe(true);

    // Test that cached data is accessible
    const patients = await window.patientService.getPatients();
    expect(Array.isArray(patients)).toBe(true);

    // Go back online
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });
  });

  it('should sync offline changes when coming back online', async () => {
    // Create initial data online
    const patient = await window.patientService.createPatient({
      name: 'Sync Test Patient',
      dateOfBirth: new Date('1982-08-08'),
      assignedDoctor: 'Dr. Sync'
    });

    // Go offline
    Object.defineProperty(navigator, 'onLine', {
      value: false
    });

    // Make changes while offline
    await window.patientService.updatePatient(patient.id, {
      notes: 'Offline modification 1'
    });

    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: patient.id,
      name: 'Offline Body Part',
      parentId: null
    });

    const photo = await window.photoService.capturePhoto({
      patientId: patient.id,
      bodyPartCategoryId: bodyPart.id,
      description: 'Offline photo'
    });

    // Simulate network reconnection
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    // Trigger sync (this would normally happen automatically)
    if (window.syncService && window.syncService.sync) {
      await window.syncService.sync();
    }

    // Verify all offline changes are preserved
    const syncedPatient = await window.patientService.getPatient(patient.id);
    expect(syncedPatient?.notes).toBe('Offline modification 1');

    const bodyParts = await window.bodyPartService.getRootBodyParts(patient.id);
    expect(bodyParts.some(bp => bp.name === 'Offline Body Part')).toBe(true);

    const photos = await window.photoService.getPhotosForPatient(patient.id);
    expect(photos.some(p => p.description === 'Offline photo')).toBe(true);

    // Clean up
    await window.patientService.deletePatient(patient.id);
  });

  it('should handle storage quota and cleanup in offline mode', async () => {
    // Go offline
    Object.defineProperty(navigator, 'onLine', {
      value: false
    });

    // Create test data to fill storage
    const patient = await window.patientService.createPatient({
      name: 'Storage Test Patient',
      dateOfBirth: new Date('1978-02-14'),
      assignedDoctor: 'Dr. Storage'
    });

    const bodyPart = await window.bodyPartService.createBodyPart({
      patientId: patient.id,
      name: 'Storage Test Area',
      parentId: null
    });

    // Create multiple photos to test storage management
    const photos = [];
    for (let i = 0; i < 5; i++) {
      const photo = await window.photoService.capturePhoto({
        patientId: patient.id,
        bodyPartCategoryId: bodyPart.id,
        description: `Storage test photo ${i + 1}`
      });
      photos.push(photo);
    }

    // Check storage usage (if available)
    if ('storage' in navigator && 'estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      expect(estimate.usage).toBeGreaterThan(0);
    }

    // Test cleanup functionality
    for (const photo of photos) {
      await window.photoService.deletePhoto(photo.id);
    }

    // Go back online
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    // Verify cleanup
    const remainingPhotos = await window.photoService.getPhotosForPatient(patient.id);
    expect(remainingPhotos).toHaveLength(0);

    // Clean up
    await window.patientService.deletePatient(patient.id);
  });
});