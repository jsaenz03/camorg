/**
 * Photo Service Contract
 * Defines the interface for photo management operations
 */

import { Photo, CreatePhotoRequest, UpdatePhotoRequest, PhotoSearchFilters } from '../models/photo';

export interface PhotoService {
  /**
   * Capture photo from camera and save to file system
   * @param request Photo capture configuration
   * @returns Promise resolving to created photo record
   * @throws CameraAccessError if camera is unavailable
   * @throws FileSystemError if file save fails
   */
  capturePhoto(request: CapturePhotoRequest): Promise<Photo>;

  /**
   * Import existing photo file
   * @param request Photo import data
   * @returns Promise resolving to created photo record
   * @throws FileNotFoundError if file doesn't exist
   * @throws InvalidFileTypeError if file type unsupported
   */
  importPhoto(request: ImportPhotoRequest): Promise<Photo>;

  /**
   * Update photo metadata
   * @param id Photo ID
   * @param request Updated photo data
   * @returns Promise resolving to updated photo
   * @throws PhotoNotFoundError if photo doesn't exist
   */
  updatePhoto(id: string, request: UpdatePhotoRequest): Promise<Photo>;

  /**
   * Get photo by ID
   * @param id Photo ID
   * @returns Promise resolving to photo or null if not found
   */
  getPhoto(id: string): Promise<Photo | null>;

  /**
   * Get photos for specific patient
   * @param patientId Patient ID
   * @param filters Optional filters
   * @returns Promise resolving to array of photos
   */
  getPhotosForPatient(patientId: string, filters?: PhotoSearchFilters): Promise<Photo[]>;

  /**
   * Get photos for specific body part
   * @param bodyPartCategoryId Body part category ID
   * @param sortBy Sort order ('date' | 'name' | 'size')
   * @returns Promise resolving to array of photos
   */
  getPhotosForBodyPart(bodyPartCategoryId: string, sortBy?: string): Promise<Photo[]>;

  /**
   * Delete photo and associated files
   * @param id Photo ID
   * @returns Promise resolving to boolean indicating success
   * @throws PhotoNotFoundError if photo doesn't exist
   */
  deletePhoto(id: string): Promise<boolean>;

  /**
   * Generate thumbnail for photo
   * @param id Photo ID
   * @param size Thumbnail size in pixels
   * @returns Promise resolving to thumbnail file path
   * @throws PhotoNotFoundError if photo doesn't exist
   */
  generateThumbnail(id: string, size?: number): Promise<string>;

  /**
   * Get photo file as blob for display
   * @param id Photo ID
   * @returns Promise resolving to image blob
   * @throws PhotoNotFoundError if photo doesn't exist
   * @throws FileNotFoundError if file missing from disk
   */
  getPhotoBlob(id: string): Promise<Blob>;

  /**
   * Get progress photos for comparison
   * @param bodyPartCategoryId Body part category ID
   * @param dateRange Optional date range filter
   * @returns Promise resolving to chronologically sorted photos
   */
  getProgressPhotos(bodyPartCategoryId: string, dateRange?: { start: Date; end: Date }): Promise<Photo[]>;
}

export interface CapturePhotoRequest {
  patientId: string;
  bodyPartCategoryId: string;
  description?: string;
  isUrgent?: boolean;
  metadata?: PhotoMetadata;
}

export interface ImportPhotoRequest {
  patientId: string;
  bodyPartCategoryId: string;
  file: File;
  description?: string;
  isUrgent?: boolean;
  captureDate?: Date;
  metadata?: PhotoMetadata;
}

export interface UpdatePhotoRequest {
  bodyPartCategoryId?: string;
  description?: string;
  isUrgent?: boolean;
  metadata?: PhotoMetadata;
}

export interface PhotoSearchFilters {
  bodyPartCategoryId?: string;
  isUrgent?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
  fileTypes?: string[];
  sortBy?: 'date' | 'name' | 'size';
  sortOrder?: 'asc' | 'desc';
}

export interface PhotoMetadata {
  cameraInfo?: {
    make: string;
    model: string;
    settings: string;
  };
  medicalInfo?: {
    lesionType: string;
    size: string;
    color: string;
    symptoms: string[];
  };
  location?: {
    anatomicalRegion: string;
    laterality: 'left' | 'right' | 'bilateral' | 'midline';
    proximity: string;
  };
}

// Error types
export class PhotoNotFoundError extends Error {
  constructor(id: string) {
    super(`Photo with ID ${id} not found`);
    this.name = 'PhotoNotFoundError';
  }
}

export class CameraAccessError extends Error {
  constructor(message: string) {
    super(`Camera access error: ${message}`);
    this.name = 'CameraAccessError';
  }
}

export class FileSystemError extends Error {
  constructor(operation: string, message: string) {
    super(`File system error during ${operation}: ${message}`);
    this.name = 'FileSystemError';
  }
}

export class InvalidFileTypeError extends Error {
  constructor(fileType: string) {
    super(`Invalid file type: ${fileType}. Only image files are supported.`);
    this.name = 'InvalidFileTypeError';
  }
}