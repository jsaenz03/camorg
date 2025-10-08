/**
 * Photo Service Implementation
 *
 * Handles all photo-related operations including creation, retrieval, updates, and search.
 * Implements IPhotoService interface from contracts/photo-service.ts
 */

import { v4 as uuidv4 } from 'uuid';
import type { PhotoRecord, PhotoRecordCreate, PhotoRecordUpdate } from '@/types/photo';
import type { BodyPart } from '@/types/body-part';
import type { IPhotoService } from '@/specs/001-role-you-are/contracts/photo-service';
import { photoRecordCreateSchema, photoRecordUpdateSchema } from '@/lib/validators/schemas';
import { getDB } from '@/lib/db/indexeddb';
import { STORES } from '@/lib/db/schema';
import { compressImage, generateThumbnail, blobToDataUrl } from '@/lib/utils/image-processing';
import { patientService } from '@/lib/services/patient-service';
import { subpartService } from '@/lib/services/subpart-service';
import {
  NotFoundError,
  ValidationError,
  StorageQuotaError,
} from '@/lib/validators/errors';

export class PhotoService implements IPhotoService {
  /**
   * Creates a new photo record with metadata
   */
  async createPhoto(data: PhotoRecordCreate): Promise<PhotoRecord> {
    // Validate data
    const validated = photoRecordCreateSchema.parse(data);

    try {
      // Compress photo and generate thumbnail
      const compressedBlob = await compressImage(validated.imageBlob, 1920, 0.85);
      const thumbnailBlob = await generateThumbnail(compressedBlob, 200);

      const now = new Date();
      const photo: PhotoRecord = {
        id: uuidv4(),
        patientId: validated.patientId,
        imageBlob: compressedBlob,
        imageThumbnail: thumbnailBlob,
        originalFileName: validated.originalFileName || '',
        mimeType: validated.mimeType,
        fileSizeBytes: compressedBlob.size,
        bodyPart: validated.bodyPart,
        subpart: validated.subpart || null,
        clinicalNotes: validated.clinicalNotes || null,
        capturedAt: validated.capturedAt,
        createdAt: now,
        updatedAt: now,
        clinicianId: '', // Will be set by auth context in real implementation
        isDeleted: false,
        deletedAt: null,
      };

      // Use transaction to ensure atomicity
      const db = await getDB();
      const tx = db.transaction([STORES.PHOTOS, STORES.PATIENTS], 'readwrite');

      try {
        // Add photo
        await tx.objectStore(STORES.PHOTOS).add(photo);

        // Update patient denormalized counts
        await patientService.updatePhotoCount(validated.patientId, 1, false);

        // Record subpart usage if provided
        if (validated.subpart) {
          await subpartService.recordUsage(validated.bodyPart, validated.subpart);
        }

        await tx.done;

        return photo;
      } catch (error) {
        // Transaction failed, rollback
        tx.abort();
        throw error;
      }
    } catch (error) {
      // Check for quota exceeded error
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        throw new StorageQuotaError('Storage quota exceeded. Please delete old photos or clear browser data.');
      }
      throw error;
    }
  }

  /**
   * Retrieves a single photo by ID
   */
  async getPhotoById(id: string): Promise<PhotoRecord | null> {
    const db = await getDB();
    const photo = await db.get(STORES.PHOTOS, id);
    return photo || null;
  }

  /**
   * Retrieves all photos for a specific patient
   */
  async getPhotosByPatient(
    patientId: string,
    options: { includeDeleted?: boolean; bodyPart?: BodyPart } = {}
  ): Promise<PhotoRecord[]> {
    const { includeDeleted = false, bodyPart } = options;

    const db = await getDB();
    let photos: PhotoRecord[];

    if (bodyPart) {
      // Use composite index for filtered query
      photos = await db.getAllFromIndex(
        STORES.PHOTOS,
        'patientId_bodyPart',
        [patientId, bodyPart]
      );
    } else {
      // Use patientId index
      photos = await db.getAllFromIndex(STORES.PHOTOS, 'patientId', patientId);
    }

    // Filter deleted if needed
    if (!includeDeleted) {
      photos = photos.filter((p) => !p.isDeleted);
    }

    // Sort by capturedAt DESC (newest first)
    photos.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());

    return photos;
  }

  /**
   * Updates photo metadata (notes and subpart only)
   */
  async updatePhoto(id: string, data: PhotoRecordUpdate): Promise<PhotoRecord> {
    // Validate data
    const validated = photoRecordUpdateSchema.parse(data);

    const db = await getDB();
    const photo = await db.get(STORES.PHOTOS, id);

    if (!photo) {
      throw new NotFoundError(`Photo not found: ${id}`);
    }

    // Update photo
    const updatedPhoto: PhotoRecord = {
      ...photo,
      subpart: validated.subpart !== undefined ? validated.subpart : photo.subpart,
      clinicalNotes: validated.clinicalNotes !== undefined ? validated.clinicalNotes : photo.clinicalNotes,
      updatedAt: new Date(),
    };

    await db.put(STORES.PHOTOS, updatedPhoto);

    // Update subpart usage if changed and provided
    if (validated.subpart && validated.subpart !== photo.subpart) {
      await subpartService.recordUsage(photo.bodyPart, validated.subpart);
    }

    return updatedPhoto;
  }

  /**
   * Soft deletes a photo
   */
  async deletePhoto(id: string): Promise<void> {
    const db = await getDB();
    const photo = await db.get(STORES.PHOTOS, id);

    if (!photo) {
      throw new NotFoundError(`Photo not found: ${id}`);
    }

    const now = new Date();
    const updatedPhoto: PhotoRecord = {
      ...photo,
      isDeleted: true,
      deletedAt: now,
      updatedAt: now,
    };

    // Use transaction to ensure atomicity
    const tx = db.transaction([STORES.PHOTOS, STORES.PATIENTS], 'readwrite');

    try {
      await tx.objectStore(STORES.PHOTOS).put(updatedPhoto);

      // Update patient denormalized counts
      await patientService.updatePhotoCount(photo.patientId, -1, false);
      await patientService.updatePhotoCount(photo.patientId, 1, true);

      await tx.done;
    } catch (error) {
      tx.abort();
      throw error;
    }
  }

  /**
   * Restores a soft-deleted photo
   */
  async restorePhoto(id: string): Promise<PhotoRecord> {
    const db = await getDB();
    const photo = await db.get(STORES.PHOTOS, id);

    if (!photo) {
      throw new NotFoundError(`Photo not found: ${id}`);
    }

    if (!photo.isDeleted) {
      throw new NotFoundError(`Photo is not deleted: ${id}`);
    }

    const updatedPhoto: PhotoRecord = {
      ...photo,
      isDeleted: false,
      deletedAt: null,
      updatedAt: new Date(),
    };

    // Use transaction to ensure atomicity
    const tx = db.transaction([STORES.PHOTOS, STORES.PATIENTS], 'readwrite');

    try {
      await tx.objectStore(STORES.PHOTOS).put(updatedPhoto);

      // Update patient denormalized counts
      await patientService.updatePhotoCount(photo.patientId, 1, false);
      await patientService.updatePhotoCount(photo.patientId, -1, true);

      await tx.done;

      return updatedPhoto;
    } catch (error) {
      tx.abort();
      throw error;
    }
  }

  /**
   * Searches photos by clinical notes keyword
   */
  async searchPhotosByNotes(
    keyword: string,
    options: { patientId?: string; bodyPart?: BodyPart } = {}
  ): Promise<PhotoRecord[]> {
    const { patientId, bodyPart } = options;

    const db = await getDB();
    const normalizedKeyword = keyword.trim().toLowerCase();

    let photos: PhotoRecord[];

    if (patientId) {
      photos = await db.getAllFromIndex(STORES.PHOTOS, 'patientId', patientId);
    } else {
      photos = await db.getAll(STORES.PHOTOS);
    }

    // Filter by keyword, body part, and deleted status
    photos = photos.filter((p) => {
      const matchesKeyword = p.clinicalNotes?.toLowerCase().includes(normalizedKeyword);
      const matchesBodyPart = bodyPart ? p.bodyPart === bodyPart : true;
      const notDeleted = !p.isDeleted;
      return matchesKeyword && matchesBodyPart && notDeleted;
    });

    // Sort by capturedAt DESC
    photos.sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());

    return photos;
  }

  /**
   * Gets count of photos for a patient
   */
  async getPhotoCount(patientId: string, includeDeleted: boolean = false): Promise<number> {
    const db = await getDB();
    const photos = await db.getAllFromIndex(STORES.PHOTOS, 'patientId', patientId);

    if (includeDeleted) {
      return photos.length;
    } else {
      return photos.filter((p) => !p.isDeleted).length;
    }
  }

  /**
   * Exports photo as data URL
   */
  async exportPhotoAsDataUrl(id: string, useThumbnail: boolean = false): Promise<string> {
    const db = await getDB();
    const photo = await db.get(STORES.PHOTOS, id);

    if (!photo) {
      throw new NotFoundError(`Photo not found: ${id}`);
    }

    const blob = useThumbnail ? photo.imageThumbnail : photo.imageBlob;
    const dataUrl = await blobToDataUrl(blob);

    return dataUrl;
  }

  /**
   * Gets photos for comparison
   */
  async getPhotosForComparison(photoIds: string[]): Promise<PhotoRecord[]> {
    if (photoIds.length < 2 || photoIds.length > 4) {
      throw new ValidationError('Photo comparison requires 2-4 photos');
    }

    const db = await getDB();
    const photos: PhotoRecord[] = [];

    for (const id of photoIds) {
      const photo = await db.get(STORES.PHOTOS, id);
      if (!photo) {
        throw new NotFoundError(`Photo not found: ${id}`);
      }
      photos.push(photo);
    }

    // Return in requested order
    return photos;
  }
}

// Export singleton instance
export const photoService = new PhotoService();
