/**
 * DatabaseService for IndexedDB initialization
 * Manages database connection, initialization, and utility operations
 */

import {
  DermatologyDatabase,
  DatabaseUtils,
  getDatabase,
  closeDatabase,
  DatabaseInfo,
  DatabaseExport,
  IntegrityReport
} from '../database/schema';

export class DatabaseService {
  private database: DermatologyDatabase | null = null;
  private initializationPromise: Promise<DermatologyDatabase> | null = null;

  /**
   * Initialize the database connection
   */
  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    this.initializationPromise = this.performInitialization();
    await this.initializationPromise;
  }

  private async performInitialization(): Promise<DermatologyDatabase> {
    try {
      this.database = await getDatabase();
      console.log('Database service initialized successfully');
      return this.database;
    } catch (error) {
      console.error('Failed to initialize database service:', error);
      throw error;
    }
  }

  /**
   * Get the database instance
   */
  async getDatabase(): Promise<DermatologyDatabase> {
    if (!this.database) {
      await this.initialize();
    }
    return this.database!;
  }

  /**
   * Check if database is connected and ready
   */
  async isConnected(): Promise<boolean> {
    try {
      if (!this.database) {
        return false;
      }

      // Try a simple operation to verify connection
      await this.database.patients.limit(1).count();
      return true;
    } catch (error) {
      console.warn('Database connection check failed:', error);
      return false;
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    try {
      await closeDatabase();
      this.database = null;
      this.initializationPromise = null;
      console.log('Database service closed');
    } catch (error) {
      console.error('Error closing database:', error);
      throw error;
    }
  }

  /**
   * Clear all data from the database
   */
  async clearAllData(): Promise<void> {
    const db = await this.getDatabase();
    await DatabaseUtils.clearDatabase(db);
    console.log('All database data cleared');
  }

  /**
   * Get database information and statistics
   */
  async getDatabaseInfo(): Promise<DatabaseInfo> {
    const db = await this.getDatabase();
    return await DatabaseUtils.getDatabaseInfo(db);
  }

  /**
   * Export database for backup
   */
  async exportDatabase(): Promise<DatabaseExport> {
    const db = await this.getDatabase();
    return await DatabaseUtils.exportDatabase(db);
  }

  /**
   * Import database from backup
   */
  async importDatabase(exportData: DatabaseExport): Promise<void> {
    const db = await this.getDatabase();
    await DatabaseUtils.importDatabase(db, exportData);
    console.log('Database imported successfully');
  }

  /**
   * Validate database integrity
   */
  async validateIntegrity(): Promise<IntegrityReport> {
    const db = await this.getDatabase();
    return await DatabaseUtils.validateIntegrity(db);
  }

  /**
   * Optimize database performance
   */
  async optimizeDatabase(): Promise<void> {
    await this.getDatabase();

    try {
      // Run integrity check first
      const integrityReport = await this.validateIntegrity();

      if (!integrityReport.isValid) {
        console.warn('Database integrity issues found:', integrityReport.errors);
        // Could implement auto-repair logic here
      }

      // Update photo counts for body part categories
      await this.updatePhotoCountsForBodyParts();

      console.log('Database optimization completed');
    } catch (error) {
      console.error('Database optimization failed:', error);
      throw error;
    }
  }

  /**
   * Update photo counts for all body part categories
   */
  private async updatePhotoCountsForBodyParts(): Promise<void> {
    const db = await this.getDatabase();

    await db.transaction('rw', [db.bodyPartCategories, db.photos], async () => {
      const bodyParts = await db.bodyPartCategories.toArray();

      for (const bodyPart of bodyParts) {
        const photoCount = await db.photos
          .where('bodyPartCategoryId')
          .equals(bodyPart.id)
          .count();

        if (bodyPart.photoCount !== photoCount) {
          await db.bodyPartCategories.update(bodyPart.id, { photoCount });
        }
      }
    });
  }

  /**
   * Check and repair database if needed
   */
  async checkAndRepair(): Promise<{ repaired: boolean; issues: string[] }> {
    const integrityReport = await this.validateIntegrity();
    const issues: string[] = [...integrityReport.errors, ...integrityReport.warnings];

    if (!integrityReport.isValid) {
      await this.performRepairs(integrityReport);
      return { repaired: true, issues };
    }

    return { repaired: false, issues };
  }

  /**
   * Perform automatic repairs based on integrity report
   */
  private async performRepairs(_report: IntegrityReport): Promise<void> {
    const db = await this.getDatabase();

    await db.transaction('rw', db.tables, async () => {
      // Remove orphaned records
      const patientIds = new Set((await db.patients.toArray()).map(p => p.id));
      const bodyPartIds = new Set((await db.bodyPartCategories.toArray()).map(bp => bp.id));

      // Remove orphaned body parts
      await db.bodyPartCategories
        .where('patientId')
        .noneOf(Array.from(patientIds))
        .delete();

      // Remove orphaned photos
      await db.photos
        .where('patientId')
        .noneOf(Array.from(patientIds))
        .delete();

      await db.photos
        .where('bodyPartCategoryId')
        .noneOf(Array.from(bodyPartIds))
        .delete();

      // Remove orphaned sessions
      await db.progressSessions
        .where('patientId')
        .noneOf(Array.from(patientIds))
        .delete();

      // Remove orphaned reports
      await db.exportReports
        .where('patientId')
        .noneOf(Array.from(patientIds))
        .delete();

      // Fix photo counts
      await this.updatePhotoCountsForBodyParts();
    });

    console.log('Database repairs completed');
  }

  /**
   * Get storage usage information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    const info: StorageInfo = {
      supported: false,
      usage: 0,
      quota: 0,
      available: 0,
      percentage: 0,
    };

    if ('storage' in navigator && 'estimate' in navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate();
        info.supported = true;
        info.usage = estimate.usage || 0;
        info.quota = estimate.quota || 0;
        info.available = info.quota - info.usage;
        info.percentage = info.quota > 0 ? (info.usage / info.quota) * 100 : 0;
      } catch (error) {
        console.warn('Failed to get storage estimate:', error);
      }
    }

    return info;
  }

  /**
   * Clean up old data based on retention policies
   */
  async cleanupOldData(retentionDays = 365): Promise<{ deletedRecords: number }> {
    const db = await this.getDatabase();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    let deletedRecords = 0;

    await db.transaction('rw', db.tables, async () => {
      // Clean up old export reports
      const oldReports = await db.exportReports
        .where('generatedAt')
        .below(cutoffDate)
        .toArray();

      for (const report of oldReports) {
        // Could implement file cleanup here
        await db.exportReports.delete(report.id);
        deletedRecords++;
      }

      // Clean up old progress sessions (optional, based on business rules)
      // This is commented out as medical records typically have longer retention
      /*
      const oldSessions = await db.progressSessions
        .where('sessionDate')
        .below(cutoffDate)
        .toArray();

      for (const session of oldSessions) {
        await db.progressSessions.delete(session.id);
        deletedRecords++;
      }
      */
    });

    console.log(`Cleanup completed: ${deletedRecords} records deleted`);
    return { deletedRecords };
  }

  /**
   * Create a backup of the database
   */
  async createBackup(): Promise<{ backup: DatabaseExport; size: number }> {
    const backup = await this.exportDatabase();
    const size = JSON.stringify(backup).length;

    return { backup, size };
  }

  /**
   * Restore database from backup
   */
  async restoreFromBackup(backup: DatabaseExport): Promise<void> {
    try {
      await this.importDatabase(backup);
      console.log('Database restored from backup successfully');
    } catch (error) {
      console.error('Failed to restore database from backup:', error);
      throw error;
    }
  }
}

// Storage information interface
export interface StorageInfo {
  supported: boolean;
  usage: number;
  quota: number;
  available: number;
  percentage: number;
}

// Export singleton instance
export const databaseService = new DatabaseService();