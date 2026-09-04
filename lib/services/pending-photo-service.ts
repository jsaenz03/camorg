/**
 * Pending phone photos (disk-backed review tray).
 *
 * A photo the phone sends while the clinician is away from the Capture screen
 * (or while another photo is mid-review) is staged here instead of the
 * single-slot capture draft — that draft was last-write-wins, so a burst of
 * phone photos silently destroyed all but the last one. Each photo lands as
 * {appDataDir}/pending-photos/{id}.jpg + {id}.thumb.jpg + {id}.json, with the
 * sidecar written last as the completion marker. The Capture screen lists the
 * tray; each photo is either saved into the library (file removed on save) or
 * explicitly deleted. Entries never claimed are purged after a week so
 * unreviewed clinical photos cannot linger invisibly on disk.
 */

import { v4 as uuidv4 } from 'uuid';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readDir, readFile, writeFile, remove } from '@tauri-apps/plugin-fs';
import { generateThumbnail } from '@/lib/utils/image-processing';
import { decryptPhotoBytes, encryptPhotoBytes } from '@/lib/utils/photo-crypto';
import type { CapturedPhoto } from '@/specs/001-role-you-are/contracts/camera-service';

/** Unclaimed photos are stale, not restorable — drop them after this long. */
export const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Sidecar ({id}.json) contents — the file is JSON, minus the thumb bytes. */
export interface PendingPhotoMeta {
  id: string;
  /** unix ms — when the phone took the photo */
  capturedAt: number;
  /** unix ms — when the desktop staged it; drives the age purge */
  receivedAt: number;
  width: number;
  height: number;
}

/** A tray row for the Capture screen. */
export interface PendingPhotoEntry extends PendingPhotoMeta {
  thumbDataUrl: string;
}

/** Filenames are always {id}.jpg / {id}.thumb.jpg / {id}.json with uuid ids. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Chunked base64 so a multi-MB JPEG does not blow the call stack. */
function bytesToDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function pendingDir(): Promise<string> {
  const dir = await join(await appDataDir(), 'pending-photos');
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

/**
 * Group a directory listing into complete ids (sidecar present = all three
 * files landed) and orphans (partial write, e.g. the app died mid-store).
 * Pure — mirrored in scripts/self-check-pending-photos.mjs.
 */
export function collatePendingFiles(names: string[]): { ids: string[]; orphans: string[] } {
  const hasJson = new Set<string>();
  const hasOther = new Set<string>();
  for (const name of names) {
    const json = /^(.+)\.json$/.exec(name);
    if (json) {
      if (UUID_RE.test(json[1])) hasJson.add(json[1]);
      continue;
    }
    const other = /^(.+)\.(?:thumb\.jpg|jpg)$/.exec(name);
    if (other && UUID_RE.test(other[1])) hasOther.add(other[1]);
  }
  const ids = [...hasJson];
  // An id is only complete with its sidecar; anything else is a partial
  // store whose bytes are unusable (no capturedAt to restore).
  const orphans = [...hasOther].filter((id) => !hasJson.has(id));
  return { ids, orphans };
}

/** Parse + validate a sidecar payload. Pure. Returns null when unusable. */
export function parsePendingSidecar(raw: string, id: string): PendingPhotoMeta | null {
  try {
    const d = JSON.parse(raw) as Partial<PendingPhotoMeta>;
    if (
      d?.id !== id ||
      typeof d.capturedAt !== 'number' ||
      typeof d.receivedAt !== 'number' ||
      typeof d.width !== 'number' ||
      typeof d.height !== 'number'
    ) {
      return null;
    }
    return { id, capturedAt: d.capturedAt, receivedAt: d.receivedAt, width: d.width, height: d.height };
  } catch {
    return null;
  }
}

/** Stage a photo for review. The sidecar is written last (completion marker). */
export async function storePendingPhoto(photo: CapturedPhoto): Promise<PendingPhotoEntry> {
  const id = uuidv4();
  const dir = await pendingDir();
  const bytes = new Uint8Array(await photo.blob.arrayBuffer());
  const thumb = await generateThumbnail(photo.blob, 200);
  const thumbBytes = new Uint8Array(await thumb.arrayBuffer());

  const meta: PendingPhotoMeta = {
    id,
    capturedAt: photo.capturedAt.getTime(),
    receivedAt: Date.now(),
    width: photo.width,
    height: photo.height,
  };
  // Photo bytes are encrypted at rest (the .json sidecar holds no clinical
  // content — ids, timestamps, dimensions — and stays plain).
  await writeFile(await join(dir, `${id}.jpg`), await encryptPhotoBytes(bytes));
  await writeFile(await join(dir, `${id}.thumb.jpg`), await encryptPhotoBytes(thumbBytes));
  await writeFile(await join(dir, `${id}.json`), new TextEncoder().encode(JSON.stringify(meta)));
  return { ...meta, thumbDataUrl: bytesToDataUrl(thumbBytes) };
}

/**
 * List the tray, oldest capture first. Stale entries and partial-write
 * orphans are deleted as part of the walk.
 */
export async function listPendingPhotos(nowMs = Date.now()): Promise<PendingPhotoEntry[]> {
  const dir = await pendingDir();
  const names = (await readDir(dir)).map((e) => e.name);
  const { ids, orphans } = collatePendingFiles(names);

  // ponytail: a store() racing this list in the same webview could have an
  // in-flight photo mistaken for an orphan. The window is one await wide and
  // requires arriving on the Capture screen mid-photo; upgrade path is
  // mtime-based purging once fs stat is in the capability scope.
  for (const id of orphans) {
    await deletePendingPhoto(id);
  }

  const entries: PendingPhotoEntry[] = [];
  for (const id of ids) {
    const raw = new TextDecoder().decode(await readFile(await join(dir, `${id}.json`)));
    const meta = parsePendingSidecar(raw, id);
    if (!meta) {
      await deletePendingPhoto(id);
      continue;
    }
    if (nowMs - meta.receivedAt > PENDING_MAX_AGE_MS) {
      await deletePendingPhoto(id);
      continue;
    }
    const rawThumb = await readFile(await join(dir, `${id}.thumb.jpg`)).catch(() => null);
    if (!rawThumb) {
      await deletePendingPhoto(id);
      continue;
    }
    // Encrypted at rest; legacy plaintext passes through unchanged.
    const thumbBytes = await decryptPhotoBytes(new Uint8Array(rawThumb));
    entries.push({ ...meta, thumbDataUrl: bytesToDataUrl(thumbBytes) });
  }
  entries.sort((a, b) => a.capturedAt - b.capturedAt);
  return entries;
}

/** Rebuild a staged photo for the metadata form (same shape as a live capture). */
export async function loadPendingPhoto(id: string): Promise<CapturedPhoto> {
  if (!UUID_RE.test(id)) throw new Error('Invalid pending photo id');
  const dir = await pendingDir();
  // Encrypted at rest; legacy plaintext passes through unchanged.
  const bytes = await decryptPhotoBytes(new Uint8Array(await readFile(await join(dir, `${id}.jpg`))));
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  const raw = new TextDecoder().decode(await readFile(await join(dir, `${id}.json`)));
  const meta = parsePendingSidecar(raw, id);
  if (!meta) throw new Error('Pending photo metadata is missing');
  return {
    blob,
    dataUrl: bytesToDataUrl(bytes),
    width: bitmap.width,
    height: bitmap.height,
    capturedAt: new Date(meta.capturedAt),
  };
}

/** Remove a staged photo (after it is saved, or when the user deletes it). */
export async function deletePendingPhoto(id: string): Promise<void> {
  if (!UUID_RE.test(id)) return;
  const dir = await pendingDir();
  for (const name of [`${id}.jpg`, `${id}.thumb.jpg`, `${id}.json`]) {
    await remove(await join(dir, name)).catch(() => {});
  }
}

/** Empty the tray: remove every staged photo and partial-write orphan. */
export async function deleteAllPendingPhotos(): Promise<void> {
  const dir = await pendingDir();
  if (!(await exists(dir))) return;
  for (const entry of await readDir(dir)) {
    await remove(await join(dir, entry.name)).catch(() => {});
  }
}
