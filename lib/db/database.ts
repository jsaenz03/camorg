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
import { mkdir, exists } from '@tauri-apps/plugin-fs';

let dbInstance: Database | null = null;
let photosDirInstance: string | null = null;
let bootstrapPromise: Promise<void> | null = null;

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
 * Resolves to {appDataDir}/photos and creates it if missing.
 */
export async function getPhotosDir(): Promise<string> {
  if (photosDirInstance) return photosDirInstance;

  const base = await appDataDir();
  const photosDir = await join(base, 'photos');

  if (!(await exists(photosDir))) {
    await mkdir(photosDir, { recursive: true });
  }

  photosDirInstance = photosDir;
  return photosDir;
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
