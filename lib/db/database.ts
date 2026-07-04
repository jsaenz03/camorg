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

/**
 * Get or create the SQLite database singleton.
 * Migration is handled by the Rust plugin; this call just opens the connection.
 */
export async function getDB(): Promise<Database> {
  if (dbInstance) return dbInstance;
  dbInstance = await Database.load('sqlite:camog.db');
  return dbInstance;
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
