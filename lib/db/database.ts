/**
 * SQLite database + photo storage directory for the Tauri shell.
 *
 * - Database file lives at {appDataDir}/camog.db (managed by tauri-plugin-sql).
 * - Photo files live at {appDataDir}/photos/{photoId}.jpg (managed by tauri-plugin-fs).
 *
 * Migrations are registered Rust-side (src-tauri/src/lib.rs) and run
 * automatically when `Database.load` opens the DB.
 */

import Database from '@tauri-apps/plugin-sql';
import { appDataDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { mkdir, exists } from '@tauri-apps/plugin-fs';

let dbInstance: Database | null = null;
let photosDirInstance: string | null = null;
let bootstrapPromise: Promise<void> | null = null;

// Custom directories granted to the fs scope this session.
const grantedDirs = new Set<string>();

/**
 * Grant the fs plugin runtime access to a directory outside the app data dir.
 * Idempotent per path per session. Needed because capability scopes are
 * static; a persisted custom photos dir must be re-granted on every launch.
 */
export async function grantDirAccess(path: string): Promise<void> {
  if (grantedDirs.has(path)) return;
  await invoke('grant_directory_access', { path });
  grantedDirs.add(path);
}

/**
 * Read the user-configured photos directory override from settings.
 * Returns null when photos live in the default {appDataDir}/photos.
 * Exported for storage-service (display + change flow).
 */
export async function getPhotosDirOverride(): Promise<string | null> {
  try {
    const db = await getDB();
    const rows = await db.select<{ photos_dir: string | null }[]>(
      "SELECT photos_dir FROM settings WHERE id = 'app'"
    );
    return rows[0]?.photos_dir ?? null;
  } catch {
    // Settings table missing (pre-migration) — fall back to the default dir.
    return null;
  }
}

/**
 * Get or create the SQLite database singleton.
 * Migration is handled by the Rust plugin; this call just opens the connection.
 *
 * On first open, kicks off a one-shot env-driven admin bootstrap (no-op unless
 * CAMOG_BOOTSTRAP_ADMIN_* env vars are set AND zero clinicians exist). The
 * bootstrap runs in the background; callers don't await it so the UI isn't
 * blocked. Use ensureBootstrapped() to await it (e.g. before deciding whether
 * to show the seed button).
 */
export async function getDB(): Promise<Database> {
  if (dbInstance) return dbInstance;
  dbInstance = await Database.load('sqlite:camog.db');

  // Fire-and-forget bootstrap on first connection. Lazy import to avoid a
  // circular dependency (auth-service imports database for getDB).
  if (!bootstrapPromise) {
    bootstrapPromise = import('@/lib/services/auth-service')
      .then(({ authService }) => authService.bootstrapFromEnv())
      .catch((err) => {
        console.error('[bootstrap] failed:', err);
      });
  }

  return dbInstance;
}

/**
 * Await the env-driven bootstrap if it's running. Safe to call multiple times.
 * Returns immediately if no bootstrap was triggered.
 */
export async function ensureBootstrapped(): Promise<void> {
  if (bootstrapPromise) await bootstrapPromise;
}

/**
 * Get or create the on-disk directory for photo files.
 * Honours the user-configured override (Settings → Storage), which may point
 * at a local folder or a cloud-synced folder; otherwise resolves to
 * {appDataDir}/photos. Creates the directory if missing.
 */
export async function getPhotosDir(): Promise<string> {
  if (photosDirInstance) return photosDirInstance;

  const override = await getPhotosDirOverride();
  const photosDir = override ?? (await join(await appDataDir(), 'photos'));

  if (override) {
    await grantDirAccess(override);
  }

  if (!(await exists(photosDir))) {
    await mkdir(photosDir, { recursive: true });
  }

  photosDirInstance = photosDir;
  return photosDir;
}

/**
 * Drop the cached photos dir so the next getPhotosDir() re-reads the
 * settings override. Call after changing the storage location.
 */
export function resetPhotosDirCache(): void {
  photosDirInstance = null;
}

/**
 * Join a photo filename into the photos dir.
 * Convenience helper used by photo-service.
 */
export async function photoPath(filename: string): Promise<string> {
  const dir = await getPhotosDir();
  return await join(dir, filename);
}

/**
 * Close the database connection (mainly for tests).
 */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
