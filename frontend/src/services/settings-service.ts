/**
 * Settings Service
 * Manages application settings stored in localStorage
 */

export type StorageType = 'indexeddb' | 'filesystem';

const STORAGE_TYPE_KEY = 'camorg-storage-type';

export class SettingsService {
  /**
   * Get the current storage type setting
   * @returns The storage type ('indexeddb' or 'filesystem')
   */
  static getStorageType(): StorageType {
    const stored = localStorage.getItem(STORAGE_TYPE_KEY);
    // Default to IndexedDB for backward compatibility
    return (stored as StorageType) || 'indexeddb';
  }

  /**
   * Set the storage type setting
   * @param type - The storage type to use
   */
  static setStorageType(type: StorageType): void {
    localStorage.setItem(STORAGE_TYPE_KEY, type);
  }

  /**
   * Check if File System Access API is supported
   * @returns True if the API is supported
   */
  static isFileSystemAccessSupported(): boolean {
    return 'showDirectoryPicker' in window;
  }
}
