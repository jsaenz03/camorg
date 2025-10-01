/**
 * PhotoService implementation with camera integration
 * Handles photo capture, import, storage, and retrieval operations
 */

import { DatabaseService } from './database-service';
import { FileSystemService } from './file-system-service';
import type {
  Photo,
  CapturePhotoRequest,
  ImportPhotoRequest,
  UpdatePhotoRequest,
  PhotoSearchFilters,
} from '../models/photo';
import {
  PhotoValidator,
  PhotoFactory,
  PhotoUtils,
  PhotoNotFoundError,
  CameraAccessError,
  FileSystemError
} from '../models/photo';

export interface CameraConstraints {
  video: {
    width?: { ideal: number };
    height?: { ideal: number };
    facingMode?: string;
  };
}

export interface CaptureSettings {
  quality?: number; // 0.1 to 1.0
  format?: 'jpeg' | 'png' | 'webp';
  maxWidth?: number;
  maxHeight?: number;
}

export class PhotoService {
  private databaseService: DatabaseService;
  private fileSystemService: FileSystemService;
  private currentStream: MediaStream | null = null;

  constructor() {
    this.databaseService = new DatabaseService();
    this.fileSystemService = new FileSystemService();
  }

  /**
   * Capture photo using device camera
   */
  async capturePhoto(
    request: CapturePhotoRequest,
    settings: CaptureSettings = {}
  ): Promise<Photo> {
    try {
      // Validate request
      const validationErrors = PhotoValidator.validateCaptureRequest(request);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Get camera stream
      const stream = await this.getCameraStream();

      // Capture image from stream
      const imageBlob = await this.captureImageFromStream(stream, settings);

      // Process captured image
      const imageInfo = await this.processImageBlob(imageBlob, 'captured');

      // Validate image dimensions
      const dimensionErrors = PhotoValidator.validateImageDimensions(
        imageInfo.width,
        imageInfo.height
      );
      if (dimensionErrors.length > 0) {
        throw new Error(`Invalid image dimensions: ${dimensionErrors.join(', ')}`);
      }

      // Create photo record
      const photo = PhotoFactory.create(request, imageInfo);

      // Save to database
      await this.savePhotoToDatabase(photo);

      // Save image file
      await this.savePhotoFile(photo, imageBlob);

      // Generate thumbnail
      await this.generateThumbnail(photo, imageBlob);

      console.log('Photo captured successfully:', photo.id);
      return photo;

    } catch (error) {
      console.error('Failed to capture photo:', error);
      throw error instanceof Error ? error : new Error('Unknown capture error');
    }
  }

  /**
   * Import photo from file
   */
  async importPhoto(request: ImportPhotoRequest): Promise<Photo> {
    try {
      // Validate request
      const validationErrors = PhotoValidator.validateImportRequest(request);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      // Process imported file
      const imageInfo = await this.processImageFile(request.file);

      // Validate image dimensions
      const dimensionErrors = PhotoValidator.validateImageDimensions(
        imageInfo.width,
        imageInfo.height
      );
      if (dimensionErrors.length > 0) {
        throw new Error(`Invalid image dimensions: ${dimensionErrors.join(', ')}`);
      }

      // Create photo record
      const photo = PhotoFactory.createFromImport(request, imageInfo);

      // Save to database
      await this.savePhotoToDatabase(photo);

      // Save image file
      const imageBlob = await this.fileToBlob(request.file);
      await this.savePhotoFile(photo, imageBlob);

      // Generate thumbnail
      await this.generateThumbnail(photo, imageBlob);

      console.log('Photo imported successfully:', photo.id);
      return photo;

    } catch (error) {
      console.error('Failed to import photo:', error);
      throw error instanceof Error ? error : new Error('Unknown import error');
    }
  }

  /**
   * Get photos for a patient
   */
  async getPhotosForPatient(
    patientId: string,
    filters?: PhotoSearchFilters
  ): Promise<Photo[]> {
    try {
      const db = await this.databaseService.getDatabase();
      let photos = await db.photos.where('patientId').equals(patientId).toArray();

      // Apply filters if provided
      if (filters) {
        photos = PhotoUtils.filterPhotos(photos, filters);
      }

      // Apply sorting if specified
      if (filters?.sortBy) {
        photos = PhotoUtils.sortPhotos(
          photos,
          filters.sortBy,
          filters.sortOrder || 'desc'
        );
      } else {
        // Default sort by capture date, newest first
        photos = PhotoUtils.sortPhotos(photos, 'date', 'desc');
      }

      return photos;

    } catch (error) {
      console.error('Failed to get photos for patient:', error);
      throw new Error('Failed to retrieve photos');
    }
  }

  /**
   * Get photos for body part category
   */
  async getPhotosForBodyPart(
    bodyPartCategoryId: string,
    filters?: PhotoSearchFilters
  ): Promise<Photo[]> {
    try {
      const db = await this.databaseService.getDatabase();
      let photos = await db.photos
        .where('bodyPartCategoryId')
        .equals(bodyPartCategoryId)
        .toArray();

      // Apply filters if provided
      if (filters) {
        photos = PhotoUtils.filterPhotos(photos, filters);
      }

      // Apply sorting
      if (filters?.sortBy) {
        photos = PhotoUtils.sortPhotos(
          photos,
          filters.sortBy,
          filters.sortOrder || 'desc'
        );
      } else {
        photos = PhotoUtils.sortPhotos(photos, 'date', 'desc');
      }

      return photos;

    } catch (error) {
      console.error('Failed to get photos for body part:', error);
      throw new Error('Failed to retrieve body part photos');
    }
  }

  /**
   * Update photo metadata
   */
  async updatePhoto(photoId: string, request: UpdatePhotoRequest): Promise<Photo> {
    try {
      // Validate request
      const validationErrors = PhotoValidator.validateUpdateRequest(request);
      if (validationErrors.length > 0) {
        throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
      }

      const db = await this.databaseService.getDatabase();
      const existingPhoto = await db.photos.get(photoId);

      if (!existingPhoto) {
        throw new PhotoNotFoundError(photoId);
      }

      // Update photo
      const updatedPhoto = PhotoFactory.update(existingPhoto, request);

      // Save to database
      await db.photos.put(updatedPhoto);

      console.log('Photo updated successfully:', photoId);
      return updatedPhoto;

    } catch (error) {
      console.error('Failed to update photo:', error);
      if (error instanceof PhotoNotFoundError) {
        throw error;
      }
      throw new Error('Failed to update photo');
    }
  }

  /**
   * Delete photo and associated files
   */
  async deletePhoto(photoId: string): Promise<void> {
    try {
      const db = await this.databaseService.getDatabase();
      const photo = await db.photos.get(photoId);

      if (!photo) {
        throw new PhotoNotFoundError(photoId);
      }

      // Delete files
      try {
        // TODO: Implement deleteFile method in FileSystemService
        console.warn('File deletion not implemented, skipping cleanup for:', photo.filePath);
      } catch (fileError) {
        console.warn('Failed to delete photo files:', fileError);
        // Continue with database deletion even if file deletion fails
      }

      // Delete from database
      await db.photos.delete(photoId);

      console.log('Photo deleted successfully:', photoId);

    } catch (error) {
      console.error('Failed to delete photo:', error);
      if (error instanceof PhotoNotFoundError) {
        throw error;
      }
      throw new Error('Failed to delete photo');
    }
  }

  /**
   * Get camera stream with specified constraints
   */
  async getCameraStream(constraints?: CameraConstraints): Promise<MediaStream> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new CameraAccessError('Camera API not supported');
      }

      const defaultConstraints: CameraConstraints = {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user'
        }
      };

      const finalConstraints = { ...defaultConstraints, ...constraints };

      this.currentStream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      return this.currentStream;

    } catch (error) {
      console.error('Failed to get camera stream:', error);
      throw new CameraAccessError('Failed to access camera');
    }
  }

  /**
   * Stop current camera stream
   */
  stopCameraStream(): void {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach(track => track.stop());
      this.currentStream = null;
    }
  }

  /**
   * Get available camera devices
   */
  async getCameraDevices(): Promise<MediaDeviceInfo[]> {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        throw new CameraAccessError('Device enumeration not supported');
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'videoinput');

    } catch (error) {
      console.error('Failed to get camera devices:', error);
      throw new CameraAccessError('Failed to enumerate camera devices');
    }
  }

  // Private helper methods

  private async captureImageFromStream(
    stream: MediaStream,
    settings: CaptureSettings
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      video.srcObject = stream;
      video.play();

      video.onloadedmetadata = () => {
        const maxWidth = settings.maxWidth || 1920;
        const maxHeight = settings.maxHeight || 1080;

        // Calculate dimensions maintaining aspect ratio
        let { width, height } = this.calculateDimensions(
          video.videoWidth,
          video.videoHeight,
          maxWidth,
          maxHeight
        );

        canvas.width = width;
        canvas.height = height;

        // Draw video frame to canvas
        ctx.drawImage(video, 0, 0, width, height);

        // Convert to blob
        const quality = settings.quality || 0.9;
        const format = settings.format || 'jpeg';

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to capture image'));
            }
          },
          `image/${format}`,
          quality
        );
      };

      video.onerror = () => {
        reject(new CameraAccessError('Video stream error'));
      };
    });
  }

  private async processImageBlob(blob: Blob, prefix: string): Promise<{
    fileName: string;
    filePath: string;
    fileSize: number;
    width: number;
    height: number;
    mimeType: string;
  }> {
    const dimensions = await this.getImageDimensions(blob);
    const timestamp = Date.now();
    const extension = PhotoUtils.getFileExtensionFromMimeType(blob.type);
    const fileName = `${prefix}_${timestamp}.${extension}`;
    const filePath = `photos/${fileName}`;

    return {
      fileName,
      filePath,
      fileSize: blob.size,
      width: dimensions.width,
      height: dimensions.height,
      mimeType: blob.type
    };
  }

  private async processImageFile(file: File): Promise<{
    fileName: string;
    filePath: string;
    fileSize: number;
    width: number;
    height: number;
    mimeType: string;
  }> {
    const dimensions = await this.getImageDimensions(file);
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `imported_${timestamp}_${sanitizedName}`;
    const filePath = `photos/${fileName}`;

    return {
      fileName,
      filePath,
      fileSize: file.size,
      width: dimensions.width,
      height: dimensions.height,
      mimeType: file.type
    };
  }

  private async getImageDimensions(file: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.width, height: img.height });
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to load image'));
      };

      img.src = url;
    });
  }

  private calculateDimensions(
    originalWidth: number,
    originalHeight: number,
    maxWidth: number,
    maxHeight: number
  ): { width: number; height: number } {
    const aspectRatio = originalWidth / originalHeight;

    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }

    if (aspectRatio > 1) {
      // Landscape
      const width = Math.min(originalWidth, maxWidth);
      const height = width / aspectRatio;
      return { width: Math.round(width), height: Math.round(height) };
    } else {
      // Portrait or square
      const height = Math.min(originalHeight, maxHeight);
      const width = height * aspectRatio;
      return { width: Math.round(width), height: Math.round(height) };
    }
  }

  private async fileToBlob(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Blob([reader.result], { type: file.type }));
        } else {
          reject(new Error('Failed to convert file to blob'));
        }
      };
      reader.onerror = () => reject(new Error('File read error'));
      reader.readAsArrayBuffer(file);
    });
  }

  private async savePhotoToDatabase(photo: Photo): Promise<void> {
    try {
      const db = await this.databaseService.getDatabase();
      await db.photos.add(photo);
    } catch (error) {
      throw new Error('Failed to save photo to database');
    }
  }

  private async savePhotoFile(photo: Photo, blob: Blob): Promise<void> {
    try {
      await this.fileSystemService.saveFileAs(photo.filePath, blob, photo.fileName);
    } catch (error) {
      throw new FileSystemError('photo save', 'Failed to save photo file');
    }
  }

  private async generateThumbnail(photo: Photo, originalBlob: Blob): Promise<void> {
    try {
      const thumbnailSize = 200;
      const thumbnailBlob = await this.createThumbnail(originalBlob, thumbnailSize);

      const thumbnailFileName = PhotoUtils.generateThumbnailFileName(
        photo.fileName,
        thumbnailSize
      );
      const thumbnailPath = `thumbnails/${thumbnailFileName}`;

      await this.fileSystemService.saveFileAs(thumbnailPath, thumbnailBlob, thumbnailFileName);

      // Update photo record with thumbnail path
      const db = await this.databaseService.getDatabase();
      await db.photos.update(photo.id, { thumbnailPath });

    } catch (error) {
      console.warn('Failed to generate thumbnail:', error);
      // Don't throw - thumbnail generation is optional
    }
  }

  private async createThumbnail(blob: Blob, size: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      img.onload = () => {
        const { width, height } = this.calculateDimensions(
          img.width,
          img.height,
          size,
          size
        );

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (thumbnailBlob) => {
            if (thumbnailBlob) {
              resolve(thumbnailBlob);
            } else {
              reject(new Error('Failed to create thumbnail'));
            }
          },
          'image/jpeg',
          0.8
        );
      };

      img.onerror = () => reject(new Error('Failed to load image for thumbnail'));
      img.src = URL.createObjectURL(blob);
    });
  }
}

// Export service instance and types
export type { CapturePhotoRequest, ImportPhotoRequest, UpdatePhotoRequest, PhotoSearchFilters };
export { Photo, PhotoNotFoundError, CameraAccessError, FileSystemError };