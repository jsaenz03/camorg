/**
 * Backup Service
 *
 * One-click database backup via SQLite's `VACUUM INTO`, which writes a
 * consistent snapshot even while the app holds open connections. Backups land
 * in the photos directory (Settings → Storage) so they ride the same
 * local/cloud-synced folder as the images — the DB is the only metadata file
 * that never leaves the app data dir otherwise.
 *
 * The snapshot is sealed in place with the practice's passphrase
 * (lib/utils/backup-crypto.ts): a backup is the most complete PHI artifact
 * the app produces and is designed to be copied elsewhere, so its key must
 * travel with it — a passphrase, not the machine-local photo key.
 *
 * Restore is deliberately manual (quit app → replace camog.db) with one
 * extra step: "prepare a restore copy" decrypts a backup to a chosen path.
 * Swapping the live DB under an open connection pool risks corruption, and
 * doing it Rust-side at startup needs a pre-launch flag. Instructions ship
 * in the UI.
 */

import { getDB, getPhotosDir } from '@/lib/db/database';
import { join } from '@tauri-apps/api/path';
import { readDir, readFile, writeFile, rename, remove } from '@tauri-apps/plugin-fs';
import { auditService } from '@/lib/services/audit-service';
import { accessService } from '@/lib/services/access-service';
import {
  encryptBackupBytes,
  decryptBackupBytes,
} from '@/lib/utils/backup-crypto';
import { ValidationError } from '@/lib/validators/errors';

/** Backups kept before the oldest is pruned (one per createBackup call). */
const KEEP_BACKUPS = 10;

/** Passphrase floor/ceiling: short fails PBKDF2's job; long is a DoS bound. */
export const MIN_PASSPHRASE_LENGTH = 8;
const MAX_PASSPHRASE_LENGTH = 128;

const BACKUP_NAME = /^camog-backup-(\d{14})\.db$/;

export interface BackupResult {
  /** Absolute path of the written backup file. */
  path: string;
  createdAt: Date;
}

export interface BackupInfo {
  filename: string;
  createdAt: Date;
}

function assertValidPassphrase(passphrase: unknown): string {
  if (
    typeof passphrase !== 'string' ||
    passphrase.length < MIN_PASSPHRASE_LENGTH ||
    passphrase.length > MAX_PASSPHRASE_LENGTH
  ) {
    throw new ValidationError(
      `Backup passphrase must be ${MIN_PASSPHRASE_LENGTH}–${MAX_PASSPHRASE_LENGTH} characters.`,
    );
  }
  return passphrase;
}

/** Local timestamp of a `camog-backup-<stamp>.db` name, parsed as local. */
function backupCreatedAt(filename: string): Date {
  const s = BACKUP_NAME.exec(filename)![1];
  return new Date(
    Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)),
    Number(s.slice(8, 10)), Number(s.slice(10, 12)), Number(s.slice(12, 14)),
  );
}

class BackupService {
  /**
   * Write a timestamped, passphrase-encrypted snapshot of camog.db into the
   * photos directory. Throws on failure — callers must surface it (a silent
   * bad backup is a data-loss trap). Admin-only: the snapshot contains every
   * clinician's patient data.
   */
  async createBackup(passphrase: string): Promise<BackupResult> {
    await accessService.requireAdmin();
    assertValidPassphrase(passphrase);
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

    // Seal in place: read the plaintext snapshot VACUUM just wrote, encrypt
    // with the passphrase, and rename a .tmp sibling over it (a crash
    // mid-seal leaves the plaintext snapshot, never a truncated cipher).
    // ponytail: the plaintext file exists briefly; the live camog.db is
    // plaintext anyway by design, so this window adds no new exposure.
    const plain = new Uint8Array(await readFile(target));
    const sealed = await encryptBackupBytes(plain, passphrase);
    await writeFile(`${target}.tmp`, sealed);
    await rename(`${target}.tmp`, target);

    // Prune old snapshots so "backup now" can't fill the disk forever.
    // Best-effort: a prune failure must not fail an otherwise good backup.
    await this.pruneOldBackups(dir, target).catch((err) => {
      console.warn('[backup] retention prune failed:', err);
    });

    void auditService.record('backup.create', {
      entityType: 'database',
      detail: `${filename} (encrypted)`,
    });

    return { path: target, createdAt: now };
  }

  /** Timestamp of the newest camog-backup-*.db in the photos dir, null if none. */
  async getLastBackupAt(): Promise<Date | null> {
    const backups = await this.listBackups();
    return backups.length ? backups[0].createdAt : null;
  }

  /** Every backup in the photos dir, newest first. */
  async listBackups(): Promise<BackupInfo[]> {
    const dir = await getPhotosDir();
    const entries = await readDir(dir);
    return entries
      .filter((e) => !e.isDirectory && BACKUP_NAME.test(e.name))
      .map((e) => ({ filename: e.name, createdAt: backupCreatedAt(e.name) }))
      // Timestamped names sort chronologically.
      .sort((a, b) => b.filename.localeCompare(a.filename));
  }

  /**
   * Decrypt a backup from the photos dir to a clinician-chosen path (native
   * save dialog), ready for the manual restore (quit app → replace camog.db).
   * Pre-encryption backups pass through as-is; a wrong passphrase on an
   * encrypted one fails without writing anything. Admin-only, like backup
   * creation.
   */
  async prepareRestoreCopy(
    filename: string,
    passphrase: string,
    targetPath: string,
  ): Promise<void> {
    await accessService.requireAdmin();
    // Strict name check before it joins a path — nothing outside the photos
    // dir's backup naming is reachable.
    if (typeof filename !== 'string' || !BACKUP_NAME.test(filename)) {
      throw new ValidationError('Pick a Camog backup file.');
    }
    if (typeof passphrase !== 'string' || passphrase.length > MAX_PASSPHRASE_LENGTH) {
      throw new ValidationError('Enter the backup passphrase.');
    }

    const dir = await getPhotosDir();
    const raw = new Uint8Array(await readFile(await join(dir, filename)));
    const plain = await decryptBackupBytes(raw, passphrase);
    await writeFile(targetPath, plain);

    void auditService.record('backup.restore_copy', {
      entityType: 'database',
      detail: `prepared a restore copy of ${filename}`,
    });
  }

  /** Remove the oldest camog-backup-*.db files beyond KEEP_BACKUPS. */
  private async pruneOldBackups(dir: string, justWritten: string): Promise<void> {
    const entries = await readDir(dir);
    const backups = entries
      .filter((e) => !e.isDirectory && BACKUP_NAME.test(e.name))
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
