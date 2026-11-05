/**
 * Picked-file entry into the capture flow — a photo chosen from disk behaves
 * like a camera capture: it enters the metadata review form as the same
 * CapturedPhoto the built-in camera produces, so Save, draft restore and the
 * parse of its anatomy all ride the existing path.
 *
 * Decodes with the WebKit-compatible subset only (see the mime note) and
 * stamps the file's own modified date as the capture date — the same default
 * the form back-fills when the clinician doesn't set one.
 */

import type { CapturedPhoto } from '@/specs/001-role-you-are/contracts/camera-service';

// Mirrors photo-upload.tsx: despite HEIC's validity at the schema level,
// WebView2's canvas decoder can't reliably decode it, so accepting it here
// would produce files that fail at thumbnail time.
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** Why a picked file can't enter the capture flow, or null when it can. */
export function uploadRejection(file: File): 'mime' | 'size' | null {
  if (!UPLOAD_MIME_TYPES.includes(file.type)) return 'mime';
  if (file.size > UPLOAD_MAX_BYTES) return 'size';
  return null;
}

/**
 * Decode a picked image file into a CapturedPhoto. The blob is the file
 * itself (compression happens in photoService.createPhoto, exactly as for
 * the file-picker uploads); the data URL feeds the review preview and the
 * session-storage draft, so it must be base64 — a revoked object URL would
 * survive the dialog but die at the next restore.
 */
export async function fileToCapturedPhoto(file: File): Promise<CapturedPhoto> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = objectUrl;
    });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('That file could not be read.'));
      reader.readAsDataURL(file);
    });
    return {
      blob: file,
      dataUrl,
      width: size.width,
      height: size.height,
      // When the photo was (likely) taken, not when it was picked.
      capturedAt: new Date(file.lastModified || Date.now()),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
