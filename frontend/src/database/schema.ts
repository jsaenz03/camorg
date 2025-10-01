/**
 * Database schema for IndexedDB
 * Defines the structure and indexes for the dermatology application database
 */

import Dexie, { Table } from 'dexie';
import type { Patient } from '../models/patient';
import type { BodyPartCategory } from '../models/body-part';
import type { Photo } from '../models/photo';
import type { ProgressSession } from '../models/progress-session';
import type { ExportReport } from '../models/export';

// Database version and name
export const DATABASE_NAME = 'DermatologyApp';
export const DATABASE_VERSION = 1;

/**
 * Main database class extending Dexie
 */
export class DermatologyDatabase extends Dexie {
  // Table declarations
  patients!: Table<Patient>;
  bodyPartCategories!: Table<BodyPartCategory>;
  photos!: Table<Photo>;
  progressSessions!: Table<ProgressSession>;
  exportReports!: Table<ExportReport>;

  constructor() {
    super(DATABASE_NAME);

    // Define schema with indexes
    this.version(DATABASE_VERSION).stores({
      // Patients table
      patients: `
        id,
        name,
        dateOfBirth,
        assignedDoctor,
        isUrgent,
        followUpDate,
        createdAt,
        updatedAt,
        [assignedDoctor+isUrgent],
        [isUrgent+followUpDate]
      `,

      // Body part categories table
      bodyPartCategories: `
        id,
        patientId,
        name,
        parentId,
        level,
        displayOrder,
        createdAt,
        photoCount,
        [patientId+parentId],
        [patientId+level],
        [patientId+name]
      `,

      // Photos table
      photos: `
        id,
        patientId,
        bodyPartCategoryId,
        fileName,
        filePath,
        captureDate,
        fileSize,
        width,
        height,
        mimeType,
        thumbnailPath,
        description,
        isUrgent,
        createdAt,
        [patientId+captureDate],
        [bodyPartCategoryId+captureDate],
        [patientId+isUrgent],
        [captureDate+isUrgent]
      `,

      // Progress sessions table
      progressSessions: `
        id,
        patientId,
        sessionDate,
        sessionType,
        doctorName,
        createdAt,
        updatedAt,
        [patientId+sessionDate],
        [patientId+sessionType],
        [doctorName+sessionDate]
      `,

      // Export reports table
      exportReports: `
        id,
        patientId,
        reportType,
        generatedAt,
        filePath,
        pageCount,
        fileSize,
        fileName,
        createdAt,
        [patientId+generatedAt],
        [patientId+reportType],
        [reportType+generatedAt]
      `,
    });

    // Define hooks for data integrity and maintenance
    this.setupHooks();
  }

  /**
   * Set up database hooks for data integrity and maintenance
   */
  private setupHooks(): void {
    const db = this;

    // Patient deletion cascade
    this.patients.hook('deleting', (_primKey, obj) => {
      if (obj) {
        // Delete related body part categories
        db.bodyPartCategories.where('patientId').equals(obj.id).delete();

        // Delete related photos
        db.photos.where('patientId').equals(obj.id).delete();

        // Delete related progress sessions
        db.progressSessions.where('patientId').equals(obj.id).delete();

        // Delete related export reports
        db.exportReports.where('patientId').equals(obj.id).delete();
      }
    });

    // Body part category deletion cascade
    this.bodyPartCategories.hook('deleting', (_primKey, obj) => {
      if (obj) {
        // Delete child categories recursively
        db.bodyPartCategories.where('parentId').equals(obj.id).delete();

        // Delete related photos
        db.photos.where('bodyPartCategoryId').equals(obj.id).delete();
      }
    });

    // Photo count maintenance for body part categories
    this.photos.hook('creating', (_primKey, obj) => {
      // Increment photo count for body part category
      db.bodyPartCategories
        .where('id')
        .equals(obj.bodyPartCategoryId)
        .modify((category: BodyPartCategory) => {
          category.photoCount = (category.photoCount || 0) + 1;
        });
    });

    this.photos.hook('deleting', (_primKey, obj) => {
      if (obj) {
        // Decrement photo count for body part category
        db.bodyPartCategories
          .where('id')
          .equals(obj.bodyPartCategoryId)
          .modify((category: BodyPartCategory) => {
            category.photoCount = Math.max(0, (category.photoCount || 0) - 1);
          });
      }
    });

    this.photos.hook('updating', (modifications, _primKey, obj) => {
      // Handle body part category changes
      const mods = modifications as Partial<Photo>;
      if (mods.bodyPartCategoryId && obj) {
        const photo = obj as Photo;
        const oldCategoryId = photo.bodyPartCategoryId;
        const newCategoryId = mods.bodyPartCategoryId;

        if (oldCategoryId !== newCategoryId) {
          // Decrement old category
          db.bodyPartCategories
            .where('id')
            .equals(oldCategoryId)
            .modify((category: BodyPartCategory) => {
              category.photoCount = Math.max(0, (category.photoCount || 0) - 1);
            });

          // Increment new category
          db.bodyPartCategories
            .where('id')
            .equals(newCategoryId)
            .modify((category: BodyPartCategory) => {
              category.photoCount = (category.photoCount || 0) + 1;
            });
        }
      }
    });

    // Update timestamps
    this.patients.hook('updating', (modifications) => {
      (modifications as { updatedAt: Date }).updatedAt = new Date();
    });

    this.progressSessions.hook('updating', (modifications) => {
      (modifications as { updatedAt: Date }).updatedAt = new Date();
    });
  }
}

/**
 * Database utility functions
 */
export class DatabaseUtils {
  /**
   * Initialize database with proper error handling
   */
  static async initializeDatabase(): Promise<DermatologyDatabase> {
    const db = new DermatologyDatabase();

    try {
      await db.open();
      console.log('Database initialized successfully');
      return db;
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw new DatabaseInitializationError('Failed to initialize database', error as Error);
    }
  }

  /**
   * Clear all data from database (for testing or reset)
   */
  static async clearDatabase(db: DermatologyDatabase): Promise<void> {
    await db.transaction('rw', db.tables, async () => {
      await Promise.all(db.tables.map(table => table.clear()));
    });
  }

  /**
   * Get database size information
   */
  static async getDatabaseInfo(db: DermatologyDatabase): Promise<DatabaseInfo> {
    const info: DatabaseInfo = {
      name: db.name,
      version: db.verno,
      tables: {},
      totalRecords: 0,
    };

    for (const table of db.tables) {
      const count = await table.count();
      info.tables[table.name] = count;
      info.totalRecords += count;
    }

    return info;
  }

  /**
   * Export database for backup
   */
  static async exportDatabase(db: DermatologyDatabase): Promise<DatabaseExport> {
    const exportData: DatabaseExport = {
      version: DATABASE_VERSION,
      exportDate: new Date(),
      data: {},
    };

    await db.transaction('r', db.tables, async () => {
      exportData.data.patients = await db.patients.toArray();
      exportData.data.bodyPartCategories = await db.bodyPartCategories.toArray();
      exportData.data.photos = await db.photos.toArray();
      exportData.data.progressSessions = await db.progressSessions.toArray();
      exportData.data.exportReports = await db.exportReports.toArray();
    });

    return exportData;
  }

  /**
   * Import database from backup
   */
  static async importDatabase(db: DermatologyDatabase, exportData: DatabaseExport): Promise<void> {
    if (exportData.version !== DATABASE_VERSION) {
      throw new DatabaseVersionMismatchError(
        `Database version mismatch. Expected ${DATABASE_VERSION}, got ${exportData.version}`
      );
    }

    await db.transaction('rw', db.tables, async () => {
      // Clear existing data
      await Promise.all(db.tables.map(table => table.clear()));

      // Import data
      if (exportData.data.patients) {
        await db.patients.bulkAdd(exportData.data.patients);
      }
      if (exportData.data.bodyPartCategories) {
        await db.bodyPartCategories.bulkAdd(exportData.data.bodyPartCategories);
      }
      if (exportData.data.photos) {
        await db.photos.bulkAdd(exportData.data.photos);
      }
      if (exportData.data.progressSessions) {
        await db.progressSessions.bulkAdd(exportData.data.progressSessions);
      }
      if (exportData.data.exportReports) {
        await db.exportReports.bulkAdd(exportData.data.exportReports);
      }
    });
  }

  /**
   * Validate database integrity
   */
  static async validateIntegrity(db: DermatologyDatabase): Promise<IntegrityReport> {
    const report: IntegrityReport = {
      isValid: true,
      errors: [],
      warnings: [],
      statistics: {
        totalPatients: 0,
        totalBodyParts: 0,
        totalPhotos: 0,
        totalSessions: 0,
        totalReports: 0,
        orphanedRecords: 0,
      },
    };

    try {
      // Get all data
      const [patients, bodyParts, photos, sessions, reports] = await Promise.all([
        db.patients.toArray(),
        db.bodyPartCategories.toArray(),
        db.photos.toArray(),
        db.progressSessions.toArray(),
        db.exportReports.toArray(),
      ]);

      report.statistics.totalPatients = patients.length;
      report.statistics.totalBodyParts = bodyParts.length;
      report.statistics.totalPhotos = photos.length;
      report.statistics.totalSessions = sessions.length;
      report.statistics.totalReports = reports.length;

      const patientIds = new Set(patients.map(p => p.id));
      const bodyPartIds = new Set(bodyParts.map(bp => bp.id));

      // Check for orphaned body parts
      bodyParts.forEach(bodyPart => {
        if (!patientIds.has(bodyPart.patientId)) {
          report.errors.push(`Body part ${bodyPart.id} references non-existent patient ${bodyPart.patientId}`);
          report.statistics.orphanedRecords++;
        }

        if (bodyPart.parentId && !bodyPartIds.has(bodyPart.parentId)) {
          report.errors.push(`Body part ${bodyPart.id} references non-existent parent ${bodyPart.parentId}`);
        }
      });

      // Check for orphaned photos
      photos.forEach(photo => {
        if (!patientIds.has(photo.patientId)) {
          report.errors.push(`Photo ${photo.id} references non-existent patient ${photo.patientId}`);
          report.statistics.orphanedRecords++;
        }

        if (!bodyPartIds.has(photo.bodyPartCategoryId)) {
          report.errors.push(`Photo ${photo.id} references non-existent body part ${photo.bodyPartCategoryId}`);
          report.statistics.orphanedRecords++;
        }
      });

      // Check for orphaned sessions
      sessions.forEach(session => {
        if (!patientIds.has(session.patientId)) {
          report.errors.push(`Session ${session.id} references non-existent patient ${session.patientId}`);
          report.statistics.orphanedRecords++;
        }
      });

      // Check for orphaned reports
      reports.forEach(reportItem => {
        if (!patientIds.has(reportItem.patientId)) {
          report.errors.push(`Report ${reportItem.id} references non-existent patient ${reportItem.patientId}`);
          report.statistics.orphanedRecords++;
        }
      });

      // Check photo counts
      const photoCountsByBodyPart = photos.reduce((acc, photo) => {
        acc[photo.bodyPartCategoryId] = (acc[photo.bodyPartCategoryId] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      bodyParts.forEach(bodyPart => {
        const actualCount = photoCountsByBodyPart[bodyPart.id] || 0;
        if (bodyPart.photoCount !== actualCount) {
          report.warnings.push(
            `Body part ${bodyPart.id} has incorrect photo count: stored ${bodyPart.photoCount}, actual ${actualCount}`
          );
        }
      });

      report.isValid = report.errors.length === 0;
    } catch (error) {
      report.isValid = false;
      report.errors.push(`Integrity check failed: ${(error as Error).message}`);
    }

    return report;
  }
}

// Type definitions for database utilities
export interface DatabaseInfo {
  name: string;
  version: number;
  tables: Record<string, number>;
  totalRecords: number;
}

export interface DatabaseExport {
  version: number;
  exportDate: Date;
  data: {
    patients?: Patient[];
    bodyPartCategories?: BodyPartCategory[];
    photos?: Photo[];
    progressSessions?: ProgressSession[];
    exportReports?: ExportReport[];
  };
}

export interface IntegrityReport {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  statistics: {
    totalPatients: number;
    totalBodyParts: number;
    totalPhotos: number;
    totalSessions: number;
    totalReports: number;
    orphanedRecords: number;
  };
}

// Error classes
export class DatabaseInitializationError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = 'DatabaseInitializationError';
    this.cause = cause;
  }
}

export class DatabaseVersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseVersionMismatchError';
  }
}

export class DatabaseIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseIntegrityError';
  }
}

// Singleton database instance
let databaseInstance: DermatologyDatabase | null = null;

/**
 * Get the singleton database instance
 */
export async function getDatabase(): Promise<DermatologyDatabase> {
  if (!databaseInstance) {
    databaseInstance = await DatabaseUtils.initializeDatabase();
  }
  return databaseInstance;
}

/**
 * Close the database connection
 */
export async function closeDatabase(): Promise<void> {
  if (databaseInstance) {
    await databaseInstance.close();
    databaseInstance = null;
  }
}