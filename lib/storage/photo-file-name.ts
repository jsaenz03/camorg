/**
 * Pure helpers for the old-photo-folder cleanup after a storage move.
 *
 * No runtime imports so scripts/self-check-storage-cleanup.mjs can run the
 * exact decision logic the service runs (same pattern as import-utils).
 *
 * The filename gate exists because the old photos folder may be a folder the
 * user owns (OneDrive, Dropbox, a Documents subfolder) that can hold files
 * Camog never wrote — cleanup must never touch those.
 */

/** Camog writes photos as {uuid}.jpg and thumbnails as {uuid}.thumb.jpg. */
const CAMOG_PHOTO_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.thumb)?\.jpg$/;

/** True only for filenames Camog itself writes into the photos folder. */
export function isCamogPhotoFileName(name: string): boolean {
  return CAMOG_PHOTO_FILE_RE.test(name);
}

/**
 * Decide whether one copied file may be deleted from the old folder: it must
 * be a Camog-named file, and the copy at the new location must exist with a
 * byte-identical size. A missing or size-mismatched copy means "keep the
 * original" — cleanup skips it and reports the count.
 */
export function canDeleteSourceFile(
  name: string,
  sourceSize: number | null,
  targetSize: number | null,
): boolean {
  if (!isCamogPhotoFileName(name)) return false;
  if (sourceSize == null || targetSize == null) return false;
  return sourceSize === targetSize;
}
