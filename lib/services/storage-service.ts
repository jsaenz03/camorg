/**
 * Storage Service — configurable photo storage location.
 *
 * Photos can live in the default app data folder or any folder the user
 * points the app at (including a cloud-synced folder such as OneDrive,
 * Dropbox, or iCloud Drive). The setting is machine-local: it lives in the
 * local SQLite `settings` row, while the DB itself always stays in the app
 * data dir. Photo rows in the DB store only filenames, so they resolve
 * against whichever dir is configured at read time.
 *
 * Changing the location copies (never moves) existing photo files to the
 * new folder, then flips the setting. Originals are left behind so a failed
 * copy can never lose data; the user can delete them once satisfied.
 */

import { appDataDir, join } from '@tauri-apps/api/path';
import { readDir, copyFile, mkdir, exists, stat, remove } from '@tauri-apps/plugin-fs';

import {
  getDB,
  getPhotosDir,
  getPhotosDirOverride,
  grantDirAccess,
  resetPhotosDirCache,
} from '@/lib/db/database';
import { accessService } from '@/lib/services/access-service';
import { auditService } from '@/lib/services/audit-service';
import { photosDirSchema } from '@/lib/validators/schemas';
import { canDeleteSourceFile } from '@/lib/storage/photo-file-name';
import {
  PermissionDeniedError,
  StorageUnavailableError,
  ValidationError,
} from '@/lib/validators/errors';

export interface StorageInfo {
  /** Directory photos are currently written to (resolved, exists). */
  resolvedDir: string;
  /** User-configured override, or null when using the default app folder. */
  customDir: string | null;
  /** The default {appDataDir}/photos path, for display and reset. */
  defaultDir: string;
}

export interface ChangePhotosDirResult {
  /** Number of photo files copied to the new location. */
  moved: number;
  /** The newly active photos directory. */
  activeDir: string;
  /** The directory files were copied FROM, when a copy happened. */
  sourceDir: string | null;
  /** Names of the files copied out of sourceDir (empty when none). */
  sourceFiles: string[];
}

/** Outcome of deleting copied files from the old storage folder. */
export interface DeleteSourceFilesResult {
  /** Files permanently removed from the old folder. */
  deleted: number;
  /** Files left in place (copy unverified at the new location, or not
   *  Camog-named) — reported so nothing silently remains. */
  skipped: number;
  /** Files that errored or timed out (evicted cloud files, offline drives) —
   *  kept untouched, deletable by hand later. */
  failed: number;
  /** True when the caller cancelled before the batch finished. */
  cancelled: boolean;
}

export interface ChangePhotosDirOptions {
  /**
   * Proceed when the current folder is unreachable (e.g. a disconnected
   * network drive): skip copying and just repoint storage. Photos stay on
   * the unavailable folder and reappear if storage is pointed back at it.
   */
  allowMissingSource?: boolean;
  /** Called after each file copy (1-based done count, total files). */
  onProgress?: (copied: number, total: number) => void;
}

export interface DeleteSourceFilesOptions {
  /** Called after each file is handled (deleted, skipped, or failed). */
  onProgress?: (done: number, total: number) => void;
  /** Checked before each file — returning true stops the batch cleanly. */
  isCancelled?: () => boolean;
}

/**
 * Bound one filesystem IPC call so a wedged file (offline drive, cloud
 * eviction) can never freeze the whole operation on a pending promise.
 */
function timely<T>(fn: () => Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} did not respond within ${Math.round(ms / 1000)}s`)),
      ms,
    );
    fn().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export class StorageService {
  private changing = false;

  async getStorageInfo(): Promise<StorageInfo> {
    const [resolvedDir, customDir] = await Promise.all([
      getPhotosDir(),
      getPhotosDirOverride(),
    ]);
    return {
      resolvedDir,
      customDir,
      defaultDir: await join(await appDataDir(), 'photos'),
    };
  }

  /**
   * Point photo storage at a new folder (validated absolute path) or back at
   * the default app folder (`null`). Copies existing photo files first; the
   * setting is only updated after every copy succeeded.
   */
  async changePhotosDir(
    newDir: string | null,
    opts?: ChangePhotosDirOptions,
  ): Promise<ChangePhotosDirResult> {
    if (this.changing) {
      throw new ValidationError('A storage change is already in progress');
    }
    const admin = await accessService.isAdmin().catch(() => false);
    if (!admin) {
      throw new PermissionDeniedError('Only admins can change photo storage');
    }

    const target = newDir !== null ? photosDirSchema.parse(newDir) : null;
    const targetDir = target ?? (await join(await appDataDir(), 'photos'));
    // The configured dir (not getPhotosDir) — the copy source must not be
    // created, and must not throw, when it sits on an offline drive.
    const oldDirOverride = await getPhotosDirOverride();
    const oldDir = oldDirOverride ?? (await join(await appDataDir(), 'photos'));

    this.changing = true;
    try {
      let moved = 0;
      const sourceFiles: string[] = [];

      // ponytail: plain string compare — same volume/case quirks on Windows
      // may miss aliases; worst case we copy files onto themselves harmlessly.
      if (oldDir !== targetDir) {
        const sourceAvailable = await exists(oldDir);
        if (!sourceAvailable && !opts?.allowMissingSource) {
          throw new StorageUnavailableError(oldDir);
        }

        if (target) await grantDirAccess(target);
        if (!(await exists(targetDir))) {
          await mkdir(targetDir, { recursive: true });
        }

        if (sourceAvailable) {
          const entries = await readDir(oldDir);
          const files = entries.filter((e) => e.isFile);
          let copied = 0;
          for (const file of files) {
            await copyFile(await join(oldDir, file.name), await join(targetDir, file.name));
            copied++;
            moved++;
            sourceFiles.push(file.name);
            opts?.onProgress?.(copied, files.length);
          }
        }
      }

      const db = await getDB();
      await db.execute(
        "UPDATE settings SET photos_dir = $1, updated_at = $2 WHERE id = 'app'",
        [target, Date.now()]
      );
      resetPhotosDirCache();

      // Where PHI lives moved — audited like an export. Admin-gated above,
      // so the entry always carries the acting admin.
      void auditService.record('storage.photos_dir', {
        detail: `${oldDirOverride ? 'custom folder' : 'default folder'} → ${
          target ? targetDir : 'default folder'
        } (${moved} ${moved === 1 ? 'file' : 'files'} copied)`,
      });

      return {
        moved,
        activeDir: targetDir,
        sourceDir: sourceFiles.length > 0 ? oldDir : null,
        sourceFiles,
      };
    } finally {
      this.changing = false;
    }
  }

  /**
   * Permanently delete copied photo files from a previous storage folder —
   * the optional cleanup after a successful changePhotosDir. Defensive by
   * design: only Camog-named files whose copy exists at the active directory
   * with a matching size are removed; everything else is skipped and
   * counted. The folder itself is never deleted (it may be a folder the
   * user owns), and the live storage directory can never be the target.
   */
  async deleteSourceFiles(
    oldDir: string,
    fileNames: string[],
    activeDir: string,
    opts?: DeleteSourceFilesOptions,
  ): Promise<DeleteSourceFilesResult> {
    const admin = await accessService.isAdmin().catch(() => false);
    if (!admin) {
      throw new PermissionDeniedError('Only admins can clean up the old photo folder');
    }
    if (fileNames.length === 0) {
      return { deleted: 0, skipped: 0, failed: 0, cancelled: false };
    }
    // Never delete from the directory photos resolve against now.
    // ponytail: plain string compare (same ceiling as changePhotosDir's
    // oldDir/targetDir check) — a path alias to the same physical dir evades
    // it; both values are service-canonical, so the shipped UI can't hit that.
    const currentDir = await getPhotosDir();
    if (oldDir === currentDir || oldDir === activeDir) {
      throw new ValidationError('Refusing to delete files in the active photo folder');
    }
    if (!(await exists(oldDir))) {
      throw new StorageUnavailableError(oldDir);
    }
    // The old folder's scope was granted while it was active this session;
    // re-grant in case cleanup runs later (Rust re-validates the path).
    await grantDirAccess(oldDir);

    // Per-file timeouts (not one batch timeout): a single wedged file —
    // offline drive, cloud-evicted — costs its own skip, not the whole
    // operation. The stat path joins are IPC too, so they ride inside.
    const STAT_TIMEOUT_MS = 15_000;
    const REMOVE_TIMEOUT_MS = 30_000;

    let deleted = 0;
    let skipped = 0;
    let failed = 0;
    let cancelled = false;
    let done = 0;
    for (const name of fileNames) {
      if (opts?.isCancelled?.()) {
        cancelled = true;
        break;
      }
      try {
        // A missing copy at the new location is an expected skip, not an
        // error — only source-side failures count as failed.
        const sourceStat = await timely(
          async () => stat(await join(oldDir, name)),
          STAT_TIMEOUT_MS,
          'Reading the old file',
        );
        const targetStat = await timely(
          async () => stat(await join(activeDir, name)).catch(() => null),
          STAT_TIMEOUT_MS,
          'Reading the copied file',
        );
        if (sourceStat && canDeleteSourceFile(name, sourceStat.size, targetStat?.size ?? null)) {
          await timely(
            async () => remove(await join(oldDir, name)),
            REMOVE_TIMEOUT_MS,
            'Deleting the old file',
          );
          deleted++;
        } else {
          skipped++;
        }
      } catch {
        failed++;
      }
      done++;
      opts?.onProgress?.(done, fileNames.length);
    }

    void auditService.record('storage.source_cleanup', {
      detail: `deleted ${deleted} of ${fileNames.length} copied file${
        fileNames.length === 1 ? '' : 's'
      } from ${oldDir}${
        skipped > 0 ? ` (${skipped} skipped — copy unverified)` : ''
      }${failed > 0 ? ` (${failed} failed)` : ''}${cancelled ? ' (cancelled)' : ''}`,
    });

    return { deleted, skipped, failed, cancelled };
  }
}

// Export singleton instance
export const storageService = new StorageService();
