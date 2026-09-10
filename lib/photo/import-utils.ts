/**
 * Pure helpers for the bulk photo import (folder → patient).
 *
 * No runtime imports and no Tauri dependencies: everything here is plain
 * data wrangling so scripts/self-check-photo-import.mjs can run the exact
 * logic the dialog runs (mirrored like licence-keygen mirrors verify.ts).
 */

import type { BodyPart } from '@/types/body-part';

const IMPORT_EXTENSION_MAP = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heic',
} as const;

/** The mime values above, as a union the create DTO's enum accepts. */
export type ImportMimeType = (typeof IMPORT_EXTENSION_MAP)[keyof typeof IMPORT_EXTENSION_MAP];

/** Schema-accepted mime types, keyed by lowercased file extension. */
export const IMPORT_EXTENSIONS: Record<string, ImportMimeType> = IMPORT_EXTENSION_MAP;

/** Hard cap shared with photoRecordCreateSchema's imageBlob refine. */
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;

/** File extensions for the native picker filter (keys of IMPORT_EXTENSIONS). */
export const IMPORT_PICKER_EXTENSIONS = Object.keys(IMPORT_EXTENSIONS);

/**
 * Maps a file name to a schema-accepted mime type, or null when the
 * extension isn't supported.
 */
export function mimeTypeForFileName(name: string): ImportMimeType | null {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return IMPORT_EXTENSIONS[ext] ?? null;
}

/** Base name without directories, tolerating both / and \ separators. */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * A file's modified time can sit in the future (clock skew, camera tz
 * quirks, copy tools) but capturedAt must not. Clamp to `now`; a zero/negative
 * stamp (missing stat) also falls back to now.
 */
export function clampCaptureDate(modifiedMs: number, nowMs: number = Date.now()): number {
  if (!Number.isFinite(modifiedMs) || modifiedMs <= 0 || modifiedMs > nowMs) return nowMs;
  return modifiedMs;
}

/**
 * Split candidate file names into fresh vs already-imported for one patient.
 * Name-only match per patient: it exists to make re-running the same folder
 * a no-op, not to catch different cameras reusing "IMG_001.jpg" — a skipped
 * name is always reported so nothing disappears silently.
 * ponytail: name-only dedupe; upgrade path is a content hash column.
 */
export function partitionByExisting(
  names: string[],
  existingNames: ReadonlySet<string>,
): { fresh: string[]; skipped: string[] } {
  const fresh: string[] = [];
  const skipped: string[] = [];
  for (const name of names) {
    (existingNames.has(name) ? skipped : fresh).push(name);
  }
  return { fresh, skipped };
}

/** One importable file, as classified at pick time. */
export interface ImportCandidate {
  /** Absolute path from the picker. */
  path: string;
  /** Base name — stored as original_file_name and used for dedupe. */
  name: string;
  sizeBytes: number;
  modifiedMs: number;
  mimeType: ImportMimeType;
  /** True when sizeBytes exceeds IMPORT_MAX_BYTES — listed but never imported. */
  tooLarge: boolean;
}

/** Options the dialog collects before the loop runs. */
export interface ImportOptions {
  patientId: string;
  /** Optional — photos imported without one read as Unspecified (and
      inherit a body part when linked into a series). */
  bodyPart: BodyPart | null;
  /** 'file' uses each file's modified time; 'custom' uses one date for all. */
  dateMode: 'file' | 'custom';
  customDateMs: number | null;
}

/** Classify picked paths into candidates + rejects (unsupported extensions). */
export function classifyPickedFile(
  path: string,
  stat: { size: number; mtimeMs: number },
): ImportCandidate | null {
  const name = baseName(path);
  const mimeType = mimeTypeForFileName(name);
  if (!mimeType) return null;
  return {
    path,
    name,
    sizeBytes: stat.size,
    modifiedMs: stat.mtimeMs,
    mimeType,
    tooLarge: stat.size > IMPORT_MAX_BYTES,
  };
}

/**
 * The capturedAt a candidate imports under, honouring the date mode.
 * ponytail: the date source is the file's modified time, not EXIF
 * DateTimeOriginal — copy operations and some cameras reset mtime, so a
 * migrated folder can land on its copy date. Upgrade path: parse EXIF at
 * pick time (with mtime as the fallback) before calling this.
 */
export function captureDateFor(
  candidate: ImportCandidate,
  options: ImportOptions,
  nowMs: number = Date.now(),
): number {
  if (options.dateMode === 'custom' && options.customDateMs != null) {
    return clampCaptureDate(options.customDateMs, nowMs);
  }
  return clampCaptureDate(candidate.modifiedMs, nowMs);
}
