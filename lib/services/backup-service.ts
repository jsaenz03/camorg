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
import { readDir, remove } from '@tauri-apps/plugin-fs';
import { auditService } from '@/lib/services/audit-service';
import { accessService } from '@/lib/services/access-service';

/** Backups kept before the oldest is pruned (one per createBackup call). */
const KEEP_BACKUPS = 10;

export interface BackupResult {
  /** Absolute path of the written backup file. */
  path: string;
  createdAt: Date;
}

class BackupService {
  /**
   * Write a timestamped snapshot of camog.db into the photos directory.
   * Throws on failure — callers must surface it (a silent bad backup is a
   * data-loss trap). Admin-only: the snapshot contains every clinician's
   * patient data.
   */
  async createBackup(): Promise<BackupResult> {
    await accessService.requireAdmin();
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

    // Prune old snapshots so "backup now" can't fill the disk forever.
    // Best-effort: a prune failure must not fail an otherwise good backup.
    await this.pruneOldBackups(dir, target).catch((err) => {
      console.warn('[backup] retention prune failed:', err);
    });

    void auditService.record('backup.create', {
      entityType: 'database',
      detail: filename,
    });

    return { path: target, createdAt: now };
  }

  /** Timestamp of the newest camog-backup-*.db in the photos dir, null if none. */
  async getLastBackupAt(): Promise<Date | null> {
    const dir = await getPhotosDir();
    const entries = await readDir(dir);
    const stamps = entries
      .filter((e) => !e.isDirectory)
      .map((e) => /^camog-backup-(\d{14})\.db$/.exec(e.name))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => {
        const s = m[1];
        // Written with local getFullYear/getMonth/… — parse back as local.
        return new Date(
          Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)),
          Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14)),
        ).getTime();
      });
    return stamps.length ? new Date(Math.max(...stamps)) : null;
  }

  /** Remove the oldest camog-backup-*.db files beyond KEEP_BACKUPS. */
  private async pruneOldBackups(dir: string, justWritten: string): Promise<void> {
    const entries = await readDir(dir);
    const backups = entries
      .filter((e) => !e.isDirectory && /^camog-backup-\d{14}\.db$/.test(e.name))
      .map((e) => e.name)
      // Timestamped names sort chronologically; newest first.
      .sort((a, b) => b.localeCompare(a));
    for (const name of backups.slice(KEEP_BACKUPS)) {
      const victim = await join(dir, name);
      if (victim === justWritten) continue;
      await remove(victim);
    }
  }
}

// Export singleton instance
export const backupService = new BackupService();
