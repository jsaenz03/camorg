/**
 * FileSystemService for File System Access API
 * Manages file operations for photo storage and PDF exports
 */

export class FileSystemService {
  private rootDirectoryHandle: FileSystemDirectoryHandle | null = null;
  private isInitialized = false;

  /**
   * Check if File System Access API is supported
   */
  isSupported(): boolean {
    return 'showDirectoryPicker' in window && 'showSaveFilePicker' in window;
  }

  /**
   * Initialize the file system by selecting a root directory
   */
  async initialize(): Promise<void> {
    if (!this.isSupported()) {
      throw new FileSystemNotSupportedError('File System Access API is not supported in this browser');
    }

    try {
      // Check if we have a stored directory handle
      const storedHandle = await this.getStoredDirectoryHandle();

      if (storedHandle) {
        // Verify we still have permission
        const permission = await storedHandle.queryPermission({ mode: 'readwrite' });

        if (permission === 'granted') {
          this.rootDirectoryHandle = storedHandle;
          this.isInitialized = true;
          console.log('File system initialized with stored directory');
          return;
        }
      }

      // Request new directory selection
      await this.selectRootDirectory();
    } catch (error) {
      console.error('Failed to initialize file system:', error);
      throw new FileSystemError('initialize', (error as Error).message);
    }
  }

  /**
   * Select root directory for file storage
   */
  async selectRootDirectory(): Promise<void> {
    if (!this.isSupported()) {
      throw new FileSystemNotSupportedError('File System Access API is not supported');
    }

    try {
      this.rootDirectoryHandle = await window.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
      });

      // Store the directory handle for future use
      await this.storeDirectoryHandle(this.rootDirectoryHandle);

      this.isInitialized = true;
      console.log('Root directory selected and stored');
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new DirectorySelectionCancelledError('Directory selection was cancelled');
      }
      throw new FileSystemError('selectDirectory', (error as Error).message);
    }
  }

  /**
   * Get the root directory handle
   */
  getRootDirectory(): FileSystemDirectoryHandle {
    if (!this.isInitialized || !this.rootDirectoryHandle) {
      throw new FileSystemNotInitializedError('File system not initialized. Call initialize() first.');
    }
    return this.rootDirectoryHandle;
  }

  /**
   * Create directory structure for patient data
   */
  async createPatientDirectory(patientId: string): Promise<FileSystemDirectoryHandle> {
    const rootDir = this.getRootDirectory();

    try {
      // Create patients directory if it doesn't exist
      const patientsDir = await rootDir.getDirectoryHandle('patients', { create: true });

      // Create patient-specific directory
      const patientDir = await patientsDir.getDirectoryHandle(patientId, { create: true });

      // Create subdirectories
      await patientDir.getDirectoryHandle('photos', { create: true });
      await patientDir.getDirectoryHandle('reports', { create: true });

      return patientDir;
    } catch (error) {
      throw new FileSystemError('createPatientDirectory', (error as Error).message);
    }
  }

  /**
   * Create directory structure for body part photos
   */
  async createBodyPartDirectory(patientId: string, bodyPartName: string): Promise<FileSystemDirectoryHandle> {
    try {
      const patientDir = await this.createPatientDirectory(patientId);
      const photosDir = await patientDir.getDirectoryHandle('photos');

      // Sanitize body part name for file system
      const sanitizedName = this.sanitizeFileName(bodyPartName);
      const bodyPartDir = await photosDir.getDirectoryHandle(sanitizedName, { create: true });

      // Create subdirectories for original and thumbnail images
      await bodyPartDir.getDirectoryHandle('original', { create: true });
      await bodyPartDir.getDirectoryHandle('thumbnails', { create: true });

      return bodyPartDir;
    } catch (error) {
      throw new FileSystemError('createBodyPartDirectory', (error as Error).message);
    }
  }

  /**
   * Save photo file to the file system
   */
  async savePhoto(
    patientId: string,
    bodyPartName: string,
    fileName: string,
    blob: Blob,
    isOriginal = true
  ): Promise<string> {
    try {
      const bodyPartDir = await this.createBodyPartDirectory(patientId, bodyPartName);
      const subDir = await bodyPartDir.getDirectoryHandle(isOriginal ? 'original' : 'thumbnails');

      const sanitizedFileName = this.sanitizeFileName(fileName);
      const fileHandle = await subDir.getFileHandle(sanitizedFileName, { create: true });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      // Return the file path
      return `patients/${patientId}/photos/${this.sanitizeFileName(bodyPartName)}/${isOriginal ? 'original' : 'thumbnails'}/${sanitizedFileName}`;
    } catch (error) {
      throw new FileSystemError('savePhoto', (error as Error).message);
    }
  }

  /**
   * Load photo file from the file system
   */
  async loadPhoto(filePath: string): Promise<Blob> {
    try {
      const rootDir = this.getRootDirectory();
      const pathParts = filePath.split('/');

      let currentDir: FileSystemDirectoryHandle = rootDir;

      // Navigate to the correct directory
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(pathParts[i]);
      }

      // Get the file
      const fileName = pathParts[pathParts.length - 1];
      const fileHandle = await currentDir.getFileHandle(fileName);

      return await fileHandle.getFile();
    } catch (error) {
      throw new FileNotFoundError(filePath);
    }
  }

  /**
   * Delete photo file from the file system
   */
  async deletePhoto(filePath: string): Promise<void> {
    try {
      const rootDir = this.getRootDirectory();
      const pathParts = filePath.split('/');

      let currentDir: FileSystemDirectoryHandle = rootDir;

      // Navigate to the parent directory
      for (let i = 0; i < pathParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(pathParts[i]);
      }

      // Delete the file
      const fileName = pathParts[pathParts.length - 1];
      await currentDir.removeEntry(fileName);
    } catch (error) {
      throw new FileSystemError('deletePhoto', (error as Error).message);
    }
  }

  /**
   * Save PDF report to the file system
   */
  async saveReport(patientId: string, fileName: string, blob: Blob): Promise<string> {
    try {
      const patientDir = await this.createPatientDirectory(patientId);
      const reportsDir = await patientDir.getDirectoryHandle('reports');

      const sanitizedFileName = this.sanitizeFileName(fileName);
      const fileHandle = await reportsDir.getFileHandle(sanitizedFileName, { create: true });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      return `patients/${patientId}/reports/${sanitizedFileName}`;
    } catch (error) {
      throw new FileSystemError('saveReport', (error as Error).message);
    }
  }

  /**
   * Load PDF report from the file system
   */
  async loadReport(filePath: string): Promise<Blob> {
    return await this.loadPhoto(filePath); // Same logic as loading photos
  }

  /**
   * Delete PDF report from the file system
   */
  async deleteReport(filePath: string): Promise<void> {
    await this.deletePhoto(filePath); // Same logic as deleting photos
  }

  /**
   * Save file using Save As dialog
   */
  async saveFileAs(fileName: string, blob: Blob, suggestedName?: string): Promise<void> {
    if (!this.isSupported()) {
      // Fallback for browsers without File System Access API
      this.downloadFile(blob, suggestedName || fileName);
      return;
    }

    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: suggestedName || fileName,
        types: [
          {
            description: 'PDF files',
            accept: {
              'application/pdf': ['.pdf'],
            },
          },
          {
            description: 'Image files',
            accept: {
              'image/*': ['.jpg', '.jpeg', '.png', '.webp'],
            },
          },
        ],
      });

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new FileSaveCancelledError('File save was cancelled');
      }
      throw new FileSystemError('saveFileAs', (error as Error).message);
    }
  }

  /**
   * Import file using Open dialog
   */
  async importFile(acceptedTypes: string[] = ['image/*']): Promise<File> {
    if (!('showOpenFilePicker' in window)) {
      throw new FileSystemNotSupportedError('File picker is not supported');
    }

    try {
      const [fileHandle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'Image files',
            accept: {
              'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff'],
            },
          },
        ],
      });

      return await fileHandle.getFile();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new FileImportCancelledError('File import was cancelled');
      }
      throw new FileSystemError('importFile', (error as Error).message);
    }
  }

  /**
   * Get directory listing
   */
  async getDirectoryListing(path = ''): Promise<DirectoryEntry[]> {
    try {
      const rootDir = this.getRootDirectory();
      let currentDir = rootDir;

      if (path) {
        const pathParts = path.split('/').filter(part => part.length > 0);
        for (const part of pathParts) {
          currentDir = await currentDir.getDirectoryHandle(part);
        }
      }

      const entries: DirectoryEntry[] = [];

      for await (const [name, handle] of currentDir.entries()) {
        entries.push({
          name,
          kind: handle.kind,
          path: path ? `${path}/${name}` : name,
        });
      }

      return entries.sort((a, b) => {
        // Directories first, then files
        if (a.kind !== b.kind) {
          return a.kind === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
    } catch (error) {
      throw new FileSystemError('getDirectoryListing', (error as Error).message);
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await this.loadPhoto(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file size
   */
  async getFileSize(filePath: string): Promise<number> {
    try {
      const blob = await this.loadPhoto(filePath);
      return blob.size;
    } catch (error) {
      throw new FileNotFoundError(filePath);
    }
  }

  /**
   * Sanitize file name for file system compatibility
   */
  private sanitizeFileName(fileName: string): string {
    // Remove or replace invalid characters
    return fileName
      .replace(/[<>:"/\\|?*]/g, '-') // Replace invalid characters with hyphens
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .substring(0, 255); // Limit length
  }

  /**
   * Fallback download method for browsers without File System Access API
   */
  private downloadFile(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Store directory handle in IndexedDB for persistence
   */
  private async storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    try {
      // Use OPFS (Origin Private File System) or IndexedDB to store the handle
      // For now, we'll use a simple approach with IndexedDB
      const request = indexedDB.open('FileSystemHandles', 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles');
        }
      };

      return new Promise((resolve, reject) => {
        request.onsuccess = async (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const transaction = db.transaction(['handles'], 'readwrite');
          const store = transaction.objectStore('handles');

          store.put(handle, 'rootDirectory');

          transaction.oncomplete = () => {
            db.close();
            resolve();
          };

          transaction.onerror = () => {
            db.close();
            reject(new Error('Failed to store directory handle'));
          };
        };

        request.onerror = () => {
          reject(new Error('Failed to open handles database'));
        };
      });
    } catch (error) {
      console.warn('Failed to store directory handle:', error);
    }
  }

  /**
   * Retrieve stored directory handle from IndexedDB
   */
  private async getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
    try {
      const request = indexedDB.open('FileSystemHandles', 1);

      return new Promise((resolve) => {
        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          if (!db.objectStoreNames.contains('handles')) {
            db.close();
            resolve(null);
            return;
          }

          const transaction = db.transaction(['handles'], 'readonly');
          const store = transaction.objectStore('handles');
          const getRequest = store.get('rootDirectory');

          getRequest.onsuccess = () => {
            db.close();
            resolve(getRequest.result || null);
          };

          getRequest.onerror = () => {
            db.close();
            resolve(null);
          };
        };

        request.onerror = () => {
          resolve(null);
        };
      });
    } catch (error) {
      console.warn('Failed to retrieve stored directory handle:', error);
      return null;
    }
  }
}

// Types and interfaces
export interface DirectoryEntry {
  name: string;
  kind: 'file' | 'directory';
  path: string;
}

// Error classes
export class FileSystemNotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSystemNotSupportedError';
  }
}

export class FileSystemNotInitializedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSystemNotInitializedError';
  }
}

export class FileSystemError extends Error {
  constructor(operation: string, message: string) {
    super(`File system error during ${operation}: ${message}`);
    this.name = 'FileSystemError';
  }
}

export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'FileNotFoundError';
  }
}

export class DirectorySelectionCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectorySelectionCancelledError';
  }
}

export class FileSaveCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSaveCancelledError';
  }
}

export class FileImportCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileImportCancelledError';
  }
}

// Export singleton instance
export const fileSystemService = new FileSystemService();