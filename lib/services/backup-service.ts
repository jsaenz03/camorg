/**
 * Backup Service
 *
 * One-click database backup via SQLite's `VACUUM INTO`, which writes a
 * consistent snapshot even while the app holds open connections. Backups land
 * in the photos directory (Settings → Storage) so they ride the same
 * local/cloud-synced folder as the images — the DB is the only metadata file
 * that never leaves the app data dir otherwise.
 *
 * Restore is deliberately manual (quit app → replace camog.db): swapping the
 * live DB under an open connection pool risks corruption, and doing it
 * Rust-side at startup needs a pre-launch flag. Instructions ship in the UI.
 */

import { getDB, getPhotosDir } from '@/lib/db/database';
import { join } from '@tauri-apps/api/path';
import { auditService } from '@/lib/services/audit-service';

export interface BackupResult {
  /** Absolute path of the written backup file. */
  path: string;
  createdAt: Date;
}

class BackupService {
  /**
   * Write a timestamped snapshot of camog.db into the photos directory.
   * Throws on failure — callers must surface it (a silent bad backup is a
   * data-loss trap).
   */
  async createBackup(): Promise<BackupResult> {
    const db = await getDB();
    const dir = await getPhotosDir();
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const filename = `camog-backup-${stamp}.db`;
    const target = await join(dir, filename);

    // ponytail: inline the path as an escaped SQL literal — VACUUM INTO takes
    // an expression, so bound params work on modern SQLite, but sqlx/param
    // handling varies by driver version and a mis-bind fails silently late.
    // If backup targets grow (scheduled, network), switch to a Rust command.
    const literal = `'${target.replace(/'/g, "''")}'`;
    await db.execute(`VACUUM INTO ${literal}`);

    void auditService.record('backup.create', {
      entityType: 'database',
      detail: filename,
    });

    return { path: target, createdAt: now };
  }
}

// Export singleton instance
export const backupService = new BackupService();
