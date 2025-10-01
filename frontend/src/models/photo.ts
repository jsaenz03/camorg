/**
 * Photo model with metadata interface
 * Represents individual medical photographs with metadata
 */

export interface Photo {
  id: string;
  patientId: string;
  bodyPartCategoryId: string;
  fileName: string;
  filePath: string;
  captureDate: Date;
  fileSize: number;
  width: number;
  height: number;
  mimeType: string;
  thumbnailPath: string | null;
  description: string;
  isUrgent: boolean;
  metadata: PhotoMetadata;
  createdAt: Date;
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

/**
 * Validates photo data according to business rules
 */
export class PhotoValidator {
  static readonly SUPPORTED_MIME_TYPES = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/bmp',
    'image/tiff'
  ];

  static readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  static readonly MIN_DIMENSIONS = { width: 100, height: 100 };
  static readonly MAX_DIMENSIONS = { width: 8192, height: 8192 };

  static validateCaptureRequest(request: CapturePhotoRequest): string[] {
    const errors: string[] = [];

    // Patient ID validation
    if (!request.patientId || request.patientId.trim().length === 0) {
      errors.push('Patient ID is required');
    }

    // Body part category ID validation
    if (!request.bodyPartCategoryId || request.bodyPartCategoryId.trim().length === 0) {
      errors.push('Body part category ID is required');
    }

    // Description validation (optional)
    if (request.description && request.description.length > 500) {
      errors.push('Description must be less than 500 characters');
    }

    // Metadata validation
    if (request.metadata) {
      errors.push(...this.validateMetadata(request.metadata));
    }

    return errors;
  }

  static validateImportRequest(request: ImportPhotoRequest): string[] {
    const errors: string[] = [];

    // Basic field validation
    errors.push(...this.validateCaptureRequest({
      patientId: request.patientId,
      bodyPartCategoryId: request.bodyPartCategoryId,
      description: request.description,
      isUrgent: request.isUrgent,
      metadata: request.metadata
    }));

    // File validation
    if (!request.file) {
      errors.push('File is required');
    } else {
      errors.push(...this.validateFile(request.file));
    }

    // Capture date validation
    if (request.captureDate) {
      const now = new Date();
      if (request.captureDate > now) {
        errors.push('Capture date cannot be in the future');
      }

      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - 10);
      if (request.captureDate < minDate) {
        errors.push('Capture date cannot be more than 10 years in the past');
      }
    }

    return errors;
  }

  static validateUpdateRequest(request: UpdatePhotoRequest): string[] {
    const errors: string[] = [];

    // Body part category ID validation (if provided)
    if (request.bodyPartCategoryId !== undefined && request.bodyPartCategoryId.trim().length === 0) {
      errors.push('Body part category ID cannot be empty');
    }

    // Description validation (if provided)
    if (request.description !== undefined && request.description.length > 500) {
      errors.push('Description must be less than 500 characters');
    }

    // Metadata validation (if provided)
    if (request.metadata) {
      errors.push(...this.validateMetadata(request.metadata));
    }

    return errors;
  }

  static validateFile(file: File): string[] {
    const errors: string[] = [];

    // MIME type validation
    if (!this.SUPPORTED_MIME_TYPES.includes(file.type)) {
      errors.push(`Unsupported file type: ${file.type}. Supported types: ${this.SUPPORTED_MIME_TYPES.join(', ')}`);
    }

    // File size validation
    if (file.size > this.MAX_FILE_SIZE) {
      errors.push(`File size too large: ${Math.round(file.size / 1024 / 1024)}MB. Maximum: ${this.MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (file.size === 0) {
      errors.push('File is empty');
    }

    // File name validation
    if (!this.isValidFileName(file.name)) {
      errors.push('Invalid file name. File name must contain only letters, numbers, hyphens, underscores, and dots.');
    }

    return errors;
  }

  static validateImageDimensions(width: number, height: number): string[] {
    const errors: string[] = [];

    if (width < this.MIN_DIMENSIONS.width || height < this.MIN_DIMENSIONS.height) {
      errors.push(`Image dimensions too small: ${width}x${height}. Minimum: ${this.MIN_DIMENSIONS.width}x${this.MIN_DIMENSIONS.height}`);
    }

    if (width > this.MAX_DIMENSIONS.width || height > this.MAX_DIMENSIONS.height) {
      errors.push(`Image dimensions too large: ${width}x${height}. Maximum: ${this.MAX_DIMENSIONS.width}x${this.MAX_DIMENSIONS.height}`);
    }

    return errors;
  }

  static validateMetadata(metadata: PhotoMetadata): string[] {
    const errors: string[] = [];

    // Medical info validation
    if (metadata.medicalInfo) {
      const { lesionType, size, color, symptoms } = metadata.medicalInfo;

      if (lesionType && lesionType.length > 100) {
        errors.push('Lesion type must be less than 100 characters');
      }

      if (size && size.length > 50) {
        errors.push('Size description must be less than 50 characters');
      }

      if (color && color.length > 50) {
        errors.push('Color description must be less than 50 characters');
      }

      if (symptoms && symptoms.length > 10) {
        errors.push('Maximum 10 symptoms allowed');
      }

      if (symptoms) {
        symptoms.forEach((symptom, index) => {
          if (symptom.length > 50) {
            errors.push(`Symptom ${index + 1} must be less than 50 characters`);
          }
        });
      }
    }

    // Location validation
    if (metadata.location) {
      const { anatomicalRegion, laterality, proximity } = metadata.location;

      if (anatomicalRegion && anatomicalRegion.length > 100) {
        errors.push('Anatomical region must be less than 100 characters');
      }

      if (laterality && !['left', 'right', 'bilateral', 'midline'].includes(laterality)) {
        errors.push('Invalid laterality value');
      }

      if (proximity && proximity.length > 100) {
        errors.push('Proximity description must be less than 100 characters');
      }
    }

    // Camera info validation
    if (metadata.cameraInfo) {
      const { make, model, settings } = metadata.cameraInfo;

      if (make && make.length > 50) {
        errors.push('Camera make must be less than 50 characters');
      }

      if (model && model.length > 50) {
        errors.push('Camera model must be less than 50 characters');
      }

      if (settings && settings.length > 200) {
        errors.push('Camera settings must be less than 200 characters');
      }
    }

    return errors;
  }

  private static isValidFileName(fileName: string): boolean {
    // Allow letters, numbers, hyphens, underscores, dots, and spaces
    const validFileNameRegex = /^[a-zA-Z0-9._\-\s]+$/;
    return validFileNameRegex.test(fileName) && fileName.length > 0 && fileName.length <= 255;
  }
}

/**
 * Photo factory for creating photo instances
 */
export class PhotoFactory {
  static create(request: CapturePhotoRequest, fileInfo: {
    fileName: string;
    filePath: string;
    fileSize: number;
    width: number;
    height: number;
    mimeType: string;
  }): Photo {
    const now = new Date();
    const id = crypto.randomUUID();

    return {
      id,
      patientId: request.patientId,
      bodyPartCategoryId: request.bodyPartCategoryId,
      fileName: fileInfo.fileName,
      filePath: fileInfo.filePath,
      captureDate: now,
      fileSize: fileInfo.fileSize,
      width: fileInfo.width,
      height: fileInfo.height,
      mimeType: fileInfo.mimeType,
      thumbnailPath: null,
      description: request.description?.trim() ?? '',
      isUrgent: request.isUrgent ?? false,
      metadata: request.metadata ?? {},
      createdAt: now,
    };
  }

  static createFromImport(request: ImportPhotoRequest, fileInfo: {
    fileName: string;
    filePath: string;
    fileSize: number;
    width: number;
    height: number;
    mimeType: string;
  }): Photo {
    const now = new Date();
    const id = crypto.randomUUID();

    return {
      id,
      patientId: request.patientId,
      bodyPartCategoryId: request.bodyPartCategoryId,
      fileName: fileInfo.fileName,
      filePath: fileInfo.filePath,
      captureDate: request.captureDate ?? now,
      fileSize: fileInfo.fileSize,
      width: fileInfo.width,
      height: fileInfo.height,
      mimeType: fileInfo.mimeType,
      thumbnailPath: null,
      description: request.description?.trim() ?? '',
      isUrgent: request.isUrgent ?? false,
      metadata: request.metadata ?? {},
      createdAt: now,
    };
  }

  static update(existing: Photo, request: UpdatePhotoRequest): Photo {
    return {
      ...existing,
      bodyPartCategoryId: request.bodyPartCategoryId ?? existing.bodyPartCategoryId,
      description: request.description?.trim() !== undefined ? request.description.trim() : existing.description,
      isUrgent: request.isUrgent ?? existing.isUrgent,
      metadata: request.metadata ?? existing.metadata,
    };
  }
}

/**
 * Photo utilities for common operations
 */
export class PhotoUtils {
  /**
   * Generate thumbnail file name from original file name
   */
  static generateThumbnailFileName(originalFileName: string, size: number): string {
    const extension = originalFileName.split('.').pop();
    const baseName = originalFileName.replace(`.${extension}`, '');
    return `${baseName}_thumb_${size}.${extension}`;
  }

  /**
   * Sort photos by specified criteria
   */
  static sortPhotos(photos: Photo[], sortBy: 'date' | 'name' | 'size', order: 'asc' | 'desc' = 'asc'): Photo[] {
    const sorted = [...photos].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'date':
          comparison = a.captureDate.getTime() - b.captureDate.getTime();
          break;
        case 'name':
          comparison = a.fileName.localeCompare(b.fileName);
          break;
        case 'size':
          comparison = a.fileSize - b.fileSize;
          break;
      }

      return order === 'desc' ? -comparison : comparison;
    });

    return sorted;
  }

  /**
   * Filter photos by search criteria
   */
  static filterPhotos(photos: Photo[], filters: PhotoSearchFilters): Photo[] {
    return photos.filter(photo => {
      // Body part filter
      if (filters.bodyPartCategoryId && photo.bodyPartCategoryId !== filters.bodyPartCategoryId) {
        return false;
      }

      // Urgent filter
      if (filters.isUrgent !== undefined && photo.isUrgent !== filters.isUrgent) {
        return false;
      }

      // Date range filter
      if (filters.dateRange) {
        const captureTime = photo.captureDate.getTime();
        const startTime = filters.dateRange.start.getTime();
        const endTime = filters.dateRange.end.getTime();
        if (captureTime < startTime || captureTime > endTime) {
          return false;
        }
      }

      // File type filter
      if (filters.fileTypes && filters.fileTypes.length > 0) {
        if (!filters.fileTypes.includes(photo.mimeType)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get file extension from MIME type
   */
  static getFileExtensionFromMimeType(mimeType: string): string {
    const mimeToExtension: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff',
    };

    return mimeToExtension[mimeType] || 'jpg';
  }
}

// Error classes
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