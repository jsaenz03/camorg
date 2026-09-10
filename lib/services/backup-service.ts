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
 * Restore is one click (restoreDatabase): decrypt + validate the chosen
 * backup, stage it as camog.restore in the app config dir, and relaunch. The
 * Rust shell swaps it in at startup (src-tauri/src/db_restore.rs) before any
 * connection can open — swapping under the live pool risks corruption — and
 * keeps the replaced database as camog.pre-restore.db, so a restore can be
 * undone by hand. "Prepare a restore copy" remains for by-hand restores on
 * any machine; the instructions stay in the UI for the app-won't-start case.
 *
 * A locked-out admin recovers without losing data via
 * restoreForPasscodeRecovery, offered on the sign-in screen's "Forgot
 * passcode?": the same stage-and-restart flow plus a passcode reset for every
 * admin inside the staged backup — restoring a backup alone would bring back
 * the very passcode hashes nobody remembers. It trusts the backup passphrase,
 * which already unlocks the data anywhere (see prepareRestoreCopy), so the
 * passphrase doubles as the practice's recovery credential.
 */

import { getDB, getPhotosDir } from '@/lib/db/database';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { readDir, readFile, writeFile, rename, remove } from '@tauri-apps/plugin-fs';
import { auditService } from '@/lib/services/audit-service';
import { accessService } from '@/lib/services/access-service';
import { hashPasscode, randomToken } from '@/lib/utils/crypto';
import {
  encryptBackupBytes,
  decryptBackupBytes,
} from '@/lib/utils/backup-crypto';
import { ValidationError } from '@/lib/validators/errors';

/** Backups kept before the oldest is pruned (one per createBackup call). */
const KEEP_BACKUPS = 10;

/**
 * Newest schema this app can open (highest migration version in
 * src-tauri/src/lib.rs). A backup from a newer schema is refused below —
 * restoring it would leave a database the running app fails to open on
 * every launch. scripts/self-check-db-restore.mjs pins this to the Rust
 * migration list so the two can't drift.
 */
export const LATEST_MIGRATION_VERSION = 21;

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

/** What restoreForPasscodeRecovery hands the sign-in screen before the restart. */
export interface PasscodeRecoveryResult {
  /** One-time sign-in passcode set on every administrator in the restored backup. */
  tempPasscode: string;
  /** Usernames that passcode opens (restored, active, approved admins). */
  adminUsernames: string[];
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

  /**
   * The shared front half of both restore paths: decrypt the chosen backup,
   * stage it atomically as camog.restore in the app config dir, and validate
   * it. Returns the staged path and the still-open validation connection —
   * callers must close it (the passcode-recovery path keeps writing to the
   * staged database first). Any failure here removes the staged file, so an
   * unattended launch can never swap in a bad database.
   */
  private async stageValidatedBackup(
    filename: string,
    passphrase: string,
  ): Promise<{ staged: string; check: Database }> {
    const dir = await getPhotosDir();
    const raw = new Uint8Array(await readFile(await join(dir, filename)));
    const plain = await decryptBackupBytes(raw, passphrase);

    // Stage atomically: a crash mid-write must never leave a truncated file
    // under the name boot swaps in (Rust re-checks the header anyway).
    // appConfigDir, not appDataDir: the sql plugin opens sqlite: paths in
    // the config dir, and staging must sit exactly where the validation
    // below and the Rust boot swap both look.
    const staged = await join(await appConfigDir(), 'camog.restore');
    await writeFile(`${staged}.tmp`, plain);
    await rename(`${staged}.tmp`, staged);

    // Validate before committing to a restart: a corrupt or foreign file
    // must fail here, with the app still running, not at the next boot.
    // Opens the staged path directly — migrations are registered for
    // sqlite:camog.db only, so this never migrates the staged file.
    const check = await Database.load('sqlite:camog.restore');
    try {
      const integrity = await check.select<{ quick_check: string }[]>(
        'PRAGMA quick_check',
      );
      if (integrity[0]?.quick_check !== 'ok') {
        throw new Error(
          `That backup failed its integrity check: ${integrity[0]?.quick_check ?? 'no result'}.`,
        );
      }
      let version: number;
      try {
        const rows = await check.select<{ v: number | null }[]>(
          'SELECT MAX(version) AS v FROM _sqlx_migrations',
        );
        version = Number(rows[0]?.v ?? 0);
      } catch {
        throw new ValidationError('That file is not a Camog database backup.');
      }
      if (version < 1) {
        throw new ValidationError('That file is not a Camog database backup.');
      }
      if (version > LATEST_MIGRATION_VERSION) {
        throw new Error(
          `That backup is from a newer Camog (schema ${version} of ${LATEST_MIGRATION_VERSION}). Update Camog first, then restore it.`,
        );
      }
    } catch (err) {
      await check.close().catch(() => {});
      await remove(staged).catch(() => {});
      throw err;
    }
    return { staged, check };
  }

  /**
   * One-click restore: decrypt + validate the chosen backup, stage it as
   * camog.restore in the app config dir (the base tauri-plugin-sql resolves
   * sqlite: paths against — same as the data dir on Windows/macOS, distinct
   * on Linux), then relaunch — the Rust shell swaps
   * it in at startup and keeps the replaced database as camog.pre-restore.db
   * (src-tauri/src/db_restore.rs). A wrong passphrase throws before
   * anything is written; a failed integrity/schema check removes the staged
   * file, so an unattended launch can never swap in a bad database. (Crash
   * window: dying between staging and validation leaves a decrypted,
   * header-valid file that boot swaps after only a magic-header check —
   * recoverable via the pre-restore copy.) Admin-only, like backup
   * creation. On success the app exits — the returned promise never
   * resolves.
   */
  async restoreDatabase(filename: string, passphrase: string): Promise<void> {
    await accessService.requireAdmin();
    if (typeof filename !== 'string' || !BACKUP_NAME.test(filename)) {
      throw new ValidationError('Pick a Camog backup file.');
    }
    if (typeof passphrase !== 'string' || passphrase.length > MAX_PASSPHRASE_LENGTH) {
      throw new ValidationError('Enter the backup passphrase.');
    }

    const { check } = await this.stageValidatedBackup(filename, passphrase);
    await check.close().catch(() => {});

    // Awaited, not fire-and-forget: the restart below exits the process, and
    // the entry must land (in the database being replaced — i.e. the future
    // camog.pre-restore copy) before that happens.
    await auditService.record('backup.restore', {
      entityType: 'database',
      detail: `restored ${filename}; previous database kept as camog.pre-restore.db`,
    });

    try {
      await invoke('restart_for_restore');
    } catch {
      // The stage is on disk — the swap happens at the next launch anyway.
      throw new Error(
        'Restore staged, but the restart failed — quit and reopen Camog to finish it.',
      );
    }
  }

  /**
   * The locked-out-admin path from the sign-in screen's "Forgot passcode?":
   * stage and validate a backup exactly like restoreDatabase, then reset
   * every active admin's passcode inside the staged database to one
   * temporary passcode (must-change on first sign-in, sessions killed) —
   * restoring the backup alone would bring back the very passcode hashes
   * nobody remembers. Deliberately NOT admin-gated: nobody can sign in, and
   * the backup passphrase already unlocks the data anywhere (see
   * prepareRestoreCopy), so it — not a login — is the credential this flow
   * trusts.
   *
   * Does NOT restart: the temporary passcode must be shown (once) before the
   * process exits. Call restartForRestore after the user acknowledges it;
   * the staged file applies at the next launch either way, and a lost
   * temporary passcode is recoverable by running this again — the backup
   * file is untouched by a restore.
   */
  async restoreForPasscodeRecovery(
    filename: string,
    passphrase: string,
  ): Promise<PasscodeRecoveryResult> {
    if (typeof filename !== 'string' || !BACKUP_NAME.test(filename)) {
      throw new ValidationError('Pick a Camog backup file.');
    }
    if (typeof passphrase !== 'string' || passphrase.length > MAX_PASSPHRASE_LENGTH) {
      throw new ValidationError('Enter the backup passphrase.');
    }

    const { staged, check } = await this.stageValidatedBackup(filename, passphrase);

    // randomToken's alphabet has no I/O/0/1; regenerate in the rare case the
    // draw missed letters or digits entirely (mirrors the admin-side reset).
    let tempPasscode = randomToken(10);
    while (!/[A-Z]/.test(tempPasscode) || !/[0-9]/.test(tempPasscode)) {
      tempPasscode = randomToken(10);
    }

    let result: PasscodeRecoveryResult;
    try {
      const admins = await check.select<{ username: string }[]>(
        "SELECT username FROM clinicians WHERE role = 'admin' AND is_active = 1 AND is_pending = 0",
      );
      if (!admins.length) {
        throw new ValidationError(
          'That backup has no administrator account to sign back in with.',
        );
      }
      const passcodeHash = await hashPasscode(tempPasscode);
      await check.execute(
        `UPDATE clinicians
            SET passcode_hash = $1,
                must_change_passcode = 1,
                passcode_changed_at = $2,
                session_expires_at = NULL
          WHERE role = 'admin' AND is_active = 1 AND is_pending = 0`,
        [passcodeHash, Date.now()],
      );
      // Pre-auth there is no clinician to attribute an audit row to, and the
      // live audit log ends up inside the replaced database — the durable
      // trace is this diagnostics entry outside the database, like resetApp's.
      await invoke('record_web_diagnostic', {
        level: 'info',
        source: 'db-restore',
        message: `Backup ${filename} staged for restore from the sign-in screen (forgotten passcode); administrator passcodes reset to a temporary one`,
      }).catch((err: unknown) => {
        console.warn('[backup] recovery restore diagnostic failed:', err);
      });
      result = {
        tempPasscode,
        adminUsernames: admins.map((a) => a.username),
      };
    } catch (err) {
      // Close before remove: Windows refuses to delete a file an open SQLite
      // connection holds, and a surviving staged file would boot-swap the
      // backup in with its still-forgotten passcodes.
      await check.close().catch(() => {});
      await remove(staged).catch(() => {});
      throw err;
    }
    await check.close().catch(() => {});
    return result;
  }

  /**
   * Relaunch so a staged restore (either restore path) is applied at boot.
   * Split out of restoreDatabase because the passcode-recovery flow must
   * show the temporary passcode before the process exits. On success the app
   * exits — the returned promise never resolves.
   */
  async restartForRestore(): Promise<void> {
    try {
      await invoke('restart_for_restore');
    } catch (err) {
      // Both a real failure and the dev build's deliberate refusal land here
      // with a message that already tells the user what to do next.
      throw err instanceof Error ? err : new Error(String(err));
    }
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
