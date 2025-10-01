import { describe, it, expect, beforeEach } from 'vitest';
import { PhotoService } from '../../services/photo-service';
import type { CapturePhotoRequest, ImportPhotoRequest } from '../../models/photo';

describe('PhotoService Contract Tests', () => {
  let photoService: PhotoService;

  beforeEach(() => {
    photoService = new PhotoService();
  });

  describe('capturePhoto', () => {
    it('should capture photo from camera and return photo record', async () => {
      const request: CapturePhotoRequest = {
        patientId: 'patient-123',
        bodyPartCategoryId: 'body-part-456',
        description: 'Initial lesion documentation',
        isUrgent: false
      };

      const photo = await photoService.capturePhoto(request);

      expect(photo).toBeDefined();
      expect(photo.id).toBeTruthy();
      expect(photo.patientId).toBe(request.patientId);
      expect(photo.bodyPartCategoryId).toBe(request.bodyPartCategoryId);
      expect(photo.description).toBe(request.description);
      expect(photo.captureDate).toBeInstanceOf(Date);
      expect(photo.filePath).toBeTruthy();
      expect(photo.fileName).toBeTruthy();
      expect(photo.mimeType).toMatch(/^image\//);
      expect(photo.width).toBeGreaterThan(0);
      expect(photo.height).toBeGreaterThan(0);
      expect(photo.fileSize).toBeGreaterThan(0);
    });

    it('should throw CameraAccessError when camera unavailable', async () => {
      const request: CapturePhotoRequest = {
        patientId: 'patient-123',
        bodyPartCategoryId: 'body-part-456'
      };

      // Simulate camera access failure
      await expect(photoService.capturePhoto(request))
        .rejects.toThrow('CameraAccessError');
    });
  });

  describe('importPhoto', () => {
    it('should import existing photo file', async () => {
      const mockFile = new File(['mock image data'], 'test.jpg', { type: 'image/jpeg' });

      const request: ImportPhotoRequest = {
        patientId: 'patient-123',
        bodyPartCategoryId: 'body-part-456',
        file: mockFile,
        description: 'Imported documentation',
        captureDate: new Date('2023-01-15')
      };

      const photo = await photoService.importPhoto(request);

      expect(photo).toBeDefined();
      expect(photo.id).toBeTruthy();
      expect(photo.patientId).toBe(request.patientId);
      expect(photo.fileName).toBe('test.jpg');
      expect(photo.mimeType).toBe('image/jpeg');
      expect(photo.captureDate).toEqual(request.captureDate);
    });

    it('should throw InvalidFileTypeError for non-image files', async () => {
      const mockFile = new File(['text content'], 'document.txt', { type: 'text/plain' });

      const request: ImportPhotoRequest = {
        patientId: 'patient-123',
        bodyPartCategoryId: 'body-part-456',
        file: mockFile
      };

      await expect(photoService.importPhoto(request))
        .rejects.toThrow('InvalidFileTypeError');
    });
  });

  describe('getPhotosForPatient', () => {
    it('should return photos for specific patient', async () => {
      const patientId = 'patient-123';

      const photos = await photoService.getPhotosForPatient(patientId);

      expect(Array.isArray(photos)).toBe(true);
      photos.forEach(photo => {
        expect(photo.patientId).toBe(patientId);
      });
    });

    it('should filter photos by date range', async () => {
      const patientId = 'patient-123';
      const filters = {
        dateRange: {
          start: new Date('2023-01-01'),
          end: new Date('2023-12-31')
        }
      };

      const photos = await photoService.getPhotosForPatient(patientId, filters);

      expect(Array.isArray(photos)).toBe(true);
      photos.forEach(photo => {
        expect(photo.captureDate.getTime()).toBeGreaterThanOrEqual(filters.dateRange.start.getTime());
        expect(photo.captureDate.getTime()).toBeLessThanOrEqual(filters.dateRange.end.getTime());
      });
    });
  });

  describe('generateThumbnail', () => {
    it('should generate thumbnail for photo', async () => {
      const photoId = 'photo-123';
      const size = 150;

      const thumbnailPath = await photoService.generateThumbnail(photoId, size);

      expect(typeof thumbnailPath).toBe('string');
      expect(thumbnailPath).toBeTruthy();
    });

    it('should throw PhotoNotFoundError for non-existent photo', async () => {
      await expect(photoService.generateThumbnail('non-existent-id'))
        .rejects.toThrow('PhotoNotFoundError');
    });
  });
});