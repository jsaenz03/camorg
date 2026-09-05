/**
 * One-time at-rest encryption migration for existing photo and result files.
 *
 * Photos captured before v0.4.6 sit on disk as plain JPEGs; result files
 * attached before the same change are plain PDFs/images. On boot, the photos
 * directory (default or user-configured), the pending-photos tray and the
 * results subfolder are walked once: every plaintext file is encrypted in
 * place (write to a .tmp sibling, then rename over — a crash mid-rewrite can
 * never destroy a clinical file) and a `.camog-encrypted` sentinel marks the
 * directory done. New captures and uploads are encrypted at write time
 * (photo-service / pending-photo-service / result-file-service), so this walk
 * only ever handles legacy files.
 *
 * Photos are recognised by the JPEG SOI; result files come in many formats,
 * so their walk encrypts anything with a stored `{uuid}.{ext}` name that does
 * not already carry the CMGE1 magic — the results folder is app-owned, so
 * every uuid-named file in it is ours.
 *
 * Runs in the background from the app layout; failures land in Settings →
 * Diagnostics and the walk is retried on the next launch (no sentinel).
 */

import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readDir, readFile, writeFile, remove, rename } from '@tauri-apps/plugin-fs';
import { getPhotosDir } from '@/lib/db/database';
import { recordDiagnostic } from '@/lib/diagnostics';
import { encryptPhotoBytes, isPlaintextJpeg, isEncryptedBytes } from '@/lib/utils/photo-crypto';

/** Sentinel written once every file in a directory is encrypted. */
const SENTINEL = '.camog-encrypted';

/** Stored result-file names are `{uuid}.{ext}`; nothing else in results/ is ours. */
const RESULT_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9a-z]+$/i;

/**
 * Encrypt every plaintext JPEG in a directory. Returns how many files were
 * rewritten. Already-encrypted files (CMGE1 magic) and non-JPEG strangers
 * (e.g. the sentinel) are left untouched.
 */
async function encryptDirJpegs(dir: string): Promise<number> {
  let migrated = 0;
  for (const entry of await readDir(dir)) {
    // Debris from an interrupted migration rewrite of this same file.
    if (entry.name.endsWith('.tmp')) {
      await remove(await join(dir, entry.name)).catch(() => {});
      continue;
    }
    if (!entry.name.endsWith('.jpg')) continue;

    const path = await join(dir, entry.name);
    const raw = await readFile(path).catch(() => null);
    if (!raw) continue; // unreadable right now (e.g. cloud placeholder) — next boot retries
    const bytes = new Uint8Array(raw);
    if (!isPlaintextJpeg(bytes)) continue; // encrypted already, or not ours

    const sealed = await encryptPhotoBytes(bytes);
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, sealed);
    await rename(tmpPath, path);
    migrated += 1;
  }
  return migrated;
}

/**
 * Encrypt every stored result file that isn't sealed yet. Result files have
 * no single plaintext signature (PDF, images, documents), so the test is
 * inverted from photos: a uuid-named file without the CMGE1 magic is legacy
 * plaintext and gets rewritten; anything else (the sentinel, .tmp debris,
 * strangers) is left alone.
 */
async function encryptResultFiles(dir: string): Promise<number> {
  let migrated = 0;
  for (const entry of await readDir(dir)) {
    if (entry.isDirectory) continue;
    if (entry.name.endsWith('.tmp')) {
      await remove(await join(dir, entry.name)).catch(() => {});
      continue;
    }
    if (!RESULT_FILE_NAME.test(entry.name)) continue;

    const path = await join(dir, entry.name);
    const raw = await readFile(path).catch(() => null);
    if (!raw) continue; // unreadable right now (e.g. cloud placeholder) — next boot retries
    const bytes = new Uint8Array(raw);
    if (isEncryptedBytes(bytes)) continue;

    const sealed = await encryptPhotoBytes(bytes);
    const tmpPath = `${path}.tmp`;
    await writeFile(tmpPath, sealed);
    await rename(tmpPath, path);
    migrated += 1;
  }
  return migrated;
}

/** Encrypt legacy plaintext photos and result files on disk. Safe to call on every boot. */
export async function runPhotoEncryptionMigration(): Promise<void> {
  try {
    const dir = await getPhotosDir();
    const sentinelPath = await join(dir, SENTINEL);
    if (!(await exists(sentinelPath))) {
      const migrated = await encryptDirJpegs(dir);
      await writeFile(sentinelPath, new TextEncoder().encode(new Date().toISOString()));
      if (migrated > 0) {
        recordDiagnostic('info', 'photo-crypto', `Encrypted ${migrated} existing photo file(s) at rest`);
      }
    }

    // The pending tray has no sentinel: it holds a handful of files that
    // purge within a week, so the walk is cheap and self-retiring.
    const pendingDir = await join(await appDataDir(), 'pending-photos');
    if (await exists(pendingDir)) {
      await encryptDirJpegs(pendingDir);
    }

    // Result files joined the at-rest encryption later than photos; their
    // folder gets its own sentinel for the same reason.
    const resultsDir = await join(dir, 'results');
    if (await exists(resultsDir)) {
      const resultsSentinel = await join(resultsDir, SENTINEL);
      if (!(await exists(resultsSentinel))) {
        const migrated = await encryptResultFiles(resultsDir);
        await writeFile(resultsSentinel, new TextEncoder().encode(new Date().toISOString()));
        if (migrated > 0) {
          recordDiagnostic('info', 'photo-crypto', `Encrypted ${migrated} existing result file(s) at rest`);
        }
      }
    }
  } catch (err) {
    // e.g. the photo key file is missing or unreadable, or the photos folder
    // is unreachable. New captures will surface the same error at write time.
    recordDiagnostic(
      'error',
      'photo-crypto',
      'Could not encrypt existing photos on disk',
      err instanceof Error ? err.message : String(err),
    );
  }
}
