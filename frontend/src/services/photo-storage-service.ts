/**
 * Photo Storage Service
 * Provides abstraction layer for storing photos using either IndexedDB or File System Access API
 */

import { SettingsService } from './settings-service';
import { fileSystemService } from './file-system-service';
import { getDatabase } from '@/database/schema';
import type { PhotoBlob } from '@/database/schema';

export interface PhotoStorageResult {
  filePath: string;
  fileSize: number;
}

export class PhotoStorageService {
  /**
   * Save a photo using the currently selected storage method
   */
  static async savePhoto(
    patientId: string,
    bodyPartName: string,
    fileName: string,
    blob: Blob,
    photoId: string
  ): Promise<PhotoStorageResult> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      return await this.saveToFileSystem(patientId, bodyPartName, fileName, blob);
    } else {
      return await this.saveToIndexedDB(photoId, blob);
    }
  }

  /**
   * Save a thumbnail using the currently selected storage method
   */
  static async saveThumbnail(
    patientId: string,
    bodyPartName: string,
    fileName: string,
    blob: Blob,
    photoId: string
  ): Promise<PhotoStorageResult> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      return await this.saveToFileSystem(patientId, bodyPartName, fileName, blob, false);
    } else {
      return await this.saveToIndexedDB(photoId, blob, 'thumbnail');
    }
  }

  /**
   * Load a photo using the currently selected storage method
   */
  static async loadPhoto(filePath: string, photoId?: string): Promise<Blob> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      return await this.loadFromFileSystem(filePath);
    } else {
      if (!photoId) {
        throw new Error('Photo ID is required for IndexedDB storage');
      }
      return await this.loadFromIndexedDB(photoId);
    }
  }

  /**
   * Load a thumbnail using the currently selected storage method
   */
  static async loadThumbnail(filePath: string, photoId?: string): Promise<Blob> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      return await this.loadFromFileSystem(filePath);
    } else {
      if (!photoId) {
        throw new Error('Photo ID is required for IndexedDB storage');
      }
      return await this.loadFromIndexedDB(photoId, 'thumbnail');
    }
  }

  /**
   * Delete a photo using the currently selected storage method
   */
  static async deletePhoto(filePath: string, photoId?: string): Promise<void> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      await this.deleteFromFileSystem(filePath);
    } else {
      if (!photoId) {
        throw new Error('Photo ID is required for IndexedDB storage');
      }
      await this.deleteFromIndexedDB(photoId);
    }
  }

  /**
   * Delete a thumbnail using the currently selected storage method
   */
  static async deleteThumbnail(filePath: string, photoId?: string): Promise<void> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      await this.deleteFromFileSystem(filePath);
    } else {
      if (!photoId) {
        throw new Error('Photo ID is required for IndexedDB storage');
      }
      await this.deleteFromIndexedDB(photoId, 'thumbnail');
    }
  }

  /**
   * Check if File System Access API needs initialization
   */
  static async requiresInitialization(): Promise<boolean> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      return !fileSystemService.isSupported() || !fileSystemService['isInitialized'];
    }

    return false;
  }

  /**
   * Initialize the storage system (only needed for File System Access API)
   */
  static async initialize(): Promise<void> {
    const storageType = SettingsService.getStorageType();

    if (storageType === 'filesystem') {
      await fileSystemService.initialize();
    }
  }

  // Private helper methods

  private static async saveToFileSystem(
    patientId: string,
    bodyPartName: string,
    fileName: string,
    blob: Blob,
    isOriginal = true
  ): Promise<PhotoStorageResult> {
    const filePath = await fileSystemService.savePhoto(
      patientId,
      bodyPartName,
      fileName,
      blob,
      isOriginal
    );

    return {
      filePath,
      fileSize: blob.size,
    };
  }

  private static async saveToIndexedDB(
    photoId: string,
    blob: Blob,
    type: 'original' | 'thumbnail' = 'original'
  ): Promise<PhotoStorageResult> {
    const db = await getDatabase();

    const photoBlob: PhotoBlob = {
      id: `${photoId}_${type}`,
      blob,
      type,
    };

    await db.photoBlobs.put(photoBlob);

    // Return a virtual file path for compatibility
    return {
      filePath: `indexeddb://${photoId}/${type}`,
      fileSize: blob.size,
    };
  }

  private static async loadFromFileSystem(filePath: string): Promise<Blob> {
    return await fileSystemService.loadPhoto(filePath);
  }

  private static async loadFromIndexedDB(
    photoId: string,
    type: 'original' | 'thumbnail' = 'original'
  ): Promise<Blob> {
    const db = await getDatabase();
    const photoBlob = await db.photoBlobs.get(`${photoId}_${type}`);

    if (!photoBlob) {
      throw new Error(`Photo blob not found: ${photoId}_${type}`);
    }

    return photoBlob.blob;
  }

  private static async deleteFromFileSystem(filePath: string): Promise<void> {
    await fileSystemService.deletePhoto(filePath);
  }

  private static async deleteFromIndexedDB(
    photoId: string,
    type: 'original' | 'thumbnail' = 'original'
  ): Promise<void> {
    const db = await getDatabase();
    await db.photoBlobs.delete(`${photoId}_${type}`);
  }
}
