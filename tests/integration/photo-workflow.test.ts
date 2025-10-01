import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Photo Capture Workflow Integration Tests', () => {
  let testPatient: any;
  let testBodyPart: any;

  beforeEach(async () => {
    // Setup test patient and body part
    testPatient = await window.patientService.createPatient({
      name: 'Photo Test Patient',
      dateOfBirth: new Date('1980-01-01'),
      assignedDoctor: 'Dr. Photo'
    });

    testBodyPart = await window.bodyPartService.createBodyPart({
      patientId: testPatient.id,
      name: 'Test Arm',
      parentId: null
    });
  });

  afterEach(async () => {
    // Clean up test data
    if (testPatient) {
      await window.patientService.deletePatient(testPatient.id);
    }
  });

  it('should complete full photo capture workflow', async () => {
    // Step 1: Capture photo from camera
    const captureRequest = {
      patientId: testPatient.id,
      bodyPartCategoryId: testBodyPart.id,
      description: 'Initial lesion documentation',
      isUrgent: false
    };

    // This will fail until PhotoService and camera integration are implemented
    const capturedPhoto = await window.photoService.capturePhoto(captureRequest);
    expect(capturedPhoto.id).toBeTruthy();
    expect(capturedPhoto.patientId).toBe(testPatient.id);
    expect(capturedPhoto.filePath).toBeTruthy();

    // Step 2: Verify photo file exists on filesystem
    const photoBlob = await window.photoService.getPhotoBlob(capturedPhoto.id);
    expect(photoBlob).toBeInstanceOf(Blob);
    expect(photoBlob.type).toMatch(/^image\//);

    // Step 3: Generate thumbnail
    const thumbnailPath = await window.photoService.generateThumbnail(capturedPhoto.id, 150);
    expect(thumbnailPath).toBeTruthy();

    // Step 4: Update photo metadata
    const updateData = {
      description: 'Updated description with more details',
      isUrgent: true
    };

    const updatedPhoto = await window.photoService.updatePhoto(capturedPhoto.id, updateData);
    expect(updatedPhoto.description).toBe(updateData.description);
    expect(updatedPhoto.isUrgent).toBe(true);

    // Step 5: Retrieve photos for patient
    const patientPhotos = await window.photoService.getPhotosForPatient(testPatient.id);
    expect(patientPhotos.length).toBeGreaterThan(0);
    expect(patientPhotos.some(p => p.id === capturedPhoto.id)).toBe(true);

    // Step 6: Delete photo
    const deleteResult = await window.photoService.deletePhoto(capturedPhoto.id);
    expect(deleteResult).toBe(true);
  });

  it('should handle photo import workflow', async () => {
    // Create mock image file
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, 800, 600);

    // Convert canvas to blob and create file
    const blob = await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.8);
    });

    const imageFile = new File([blob], 'imported-photo.jpg', { type: 'image/jpeg' });

    // Import photo
    const importRequest = {
      patientId: testPatient.id,
      bodyPartCategoryId: testBodyPart.id,
      file: imageFile,
      description: 'Imported historical photo',
      captureDate: new Date('2023-01-15')
    };

    const importedPhoto = await window.photoService.importPhoto(importRequest);
    expect(importedPhoto.fileName).toBe('imported-photo.jpg');
    expect(importedPhoto.mimeType).toBe('image/jpeg');
    expect(importedPhoto.captureDate).toEqual(importRequest.captureDate);
    expect(importedPhoto.width).toBe(800);
    expect(importedPhoto.height).toBe(600);

    // Clean up
    await window.photoService.deletePhoto(importedPhoto.id);
  });

  it('should handle progress photo comparison', async () => {
    // Create multiple photos for the same body part over time
    const photos = [];

    for (let i = 0; i < 3; i++) {
      const photo = await window.photoService.capturePhoto({
        patientId: testPatient.id,
        bodyPartCategoryId: testBodyPart.id,
        description: `Progress photo ${i + 1}`
      });
      photos.push(photo);

      // Simulate time progression
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Get progress photos
    const progressPhotos = await window.photoService.getProgressPhotos(testBodyPart.id);
    expect(progressPhotos.length).toBe(3);

    // Verify chronological order
    for (let i = 1; i < progressPhotos.length; i++) {
      expect(progressPhotos[i].captureDate.getTime())
        .toBeGreaterThan(progressPhotos[i - 1].captureDate.getTime());
    }

    // Clean up
    await Promise.all(photos.map(p => window.photoService.deletePhoto(p.id)));
  });

  it('should validate photo file constraints', async () => {
    // Test invalid file type
    const textFile = new File(['text content'], 'document.txt', { type: 'text/plain' });

    await expect(window.photoService.importPhoto({
      patientId: testPatient.id,
      bodyPartCategoryId: testBodyPart.id,
      file: textFile
    })).rejects.toThrow('InvalidFileTypeError');

    // Test missing required fields
    await expect(window.photoService.capturePhoto({
      patientId: '', // Invalid: empty patient ID
      bodyPartCategoryId: testBodyPart.id
    })).rejects.toThrow();
  });

  it('should handle offline photo storage', async () => {
    // Simulate offline mode
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      value: false
    });

    // Capture photo while offline
    const photo = await window.photoService.capturePhoto({
      patientId: testPatient.id,
      bodyPartCategoryId: testBodyPart.id,
      description: 'Offline captured photo'
    });

    expect(photo.id).toBeTruthy();

    // Verify photo is stored locally
    const photoBlob = await window.photoService.getPhotoBlob(photo.id);
    expect(photoBlob).toBeInstanceOf(Blob);

    // Restore online mode
    Object.defineProperty(navigator, 'onLine', {
      value: true
    });

    // Clean up
    await window.photoService.deletePhoto(photo.id);
  });
});