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
import { readDir, copyFile, mkdir, exists } from '@tauri-apps/plugin-fs';

import {
  getDB,
  getPhotosDir,
  getPhotosDirOverride,
  grantDirAccess,
  resetPhotosDirCache,
} from '@/lib/db/database';
import { accessService } from '@/lib/services/access-service';
import { photosDirSchema } from '@/lib/validators/schemas';
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
}

export interface ChangePhotosDirOptions {
  /**
   * Proceed when the current folder is unreachable (e.g. a disconnected
   * network drive): skip copying and just repoint storage. Photos stay on
   * the unavailable folder and reappear if storage is pointed back at it.
   */
  allowMissingSource?: boolean;
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
          for (const file of files) {
            await copyFile(await join(oldDir, file.name), await join(targetDir, file.name));
            moved++;
          }
        }
      }

      const db = await getDB();
      await db.execute(
        "UPDATE settings SET photos_dir = $1, updated_at = $2 WHERE id = 'app'",
        [target, Date.now()]
      );
      resetPhotosDirCache();

      return { moved, activeDir: targetDir };
    } finally {
      this.changing = false;
    }
  }
}

// Export singleton instance
export const storageService = new StorageService();
