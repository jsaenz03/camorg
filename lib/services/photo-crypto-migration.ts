/**
 * One-time at-rest encryption migration for existing photo files.
 *
 * Photos captured before v0.4.6 sit on disk as plain JPEGs. On boot, the
 * photos directory (default or user-configured) and the pending-photos tray
 * are walked once: every plaintext JPEG is encrypted in place (write to a
 * .tmp sibling, then rename over — a crash mid-rewrite can never destroy a
 * clinical photo) and a `.camog-encrypted` sentinel marks the directory done.
 * New captures are encrypted at write time (photo-service /
 * pending-photo-service), so this walk only ever handles legacy files.
 *
 * Runs in the background from the app layout; failures land in Settings →
 * Diagnostics and the walk is retried on the next launch (no sentinel).
 */

import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readDir, readFile, writeFile, remove, rename } from '@tauri-apps/plugin-fs';
import { getPhotosDir } from '@/lib/db/database';
import { recordDiagnostic } from '@/lib/diagnostics';
import { encryptPhotoBytes, isPlaintextJpeg } from '@/lib/utils/photo-crypto';

/** Sentinel written once every file in a directory is encrypted. */
const SENTINEL = '.camog-encrypted';

/**
 * Encrypt every plaintext JPEG in a directory. Returns how many files were
 * rewritten. Already-encrypted files (CMGE1 magic) and non-JPEG strangers
 * (e.g. the sentinel, result files) are left untouched.
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

/** Encrypt legacy plaintext photos on disk. Safe to call on every boot. */
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
  } catch (err) {
    // e.g. the OS credential store refused the key, or the photos folder is
    // unreachable. New captures will surface the same error at write time.
    recordDiagnostic(
      'error',
      'photo-crypto',
      'Could not encrypt existing photos on disk',
      err instanceof Error ? err.message : String(err),
    );
  }
}
