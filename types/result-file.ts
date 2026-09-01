/**
 * Result files: documents (PDF, RTF, …) attached to a photo, and through the
 * photo to its patient (result_files table, migration 015). Bytes live on
 * disk under {photosDir}/results/{storedName}; this record is metadata only.
 *
 * The allowlist helpers are pure and free of Tauri imports so
 * scripts/self-check-result-files.mjs can exercise them in plain Node.
 */

export interface ResultFileRecord {
  id: string;
  photoId: string;
  patientId: string;
  /** Name as picked by the clinician. */
  originalName: string;
  /** Filename inside the results dir. */
  storedName: string;
  mimeType: string;
  fileSizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
  clinicianId: string;
  isDeleted: boolean;
  deletedAt: Date | null;
}

/**
 * Document/image types a clinician can reasonably attach as a result or
 * report. Deliberately excludes executables and archives: the upload path
 * copies bytes verbatim, so the allowlist is the guardrail against someone
 * parking arbitrary payload in the clinical record.
 */
export const RESULT_FILE_EXTENSIONS = [
  'pdf',
  'rtf',
  'txt',
  'md',
  'csv',
  'doc',
  'docx',
  'odt',
  'xls',
  'xlsx',
  'ods',
  'jpg',
  'jpeg',
  'png',
  'tif',
  'tiff',
  'heic',
  'html',
  'xml',
  'json',
] as const;

const RESULT_FILE_MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  html: 'text/html',
  xml: 'application/xml',
  json: 'application/json',
};

/**
 * Resolve an original filename to its allowed extension + MIME type.
 * Returns null when the name has no extension or one outside the allowlist
 * (case-insensitive). Callers show a friendly "file type not supported"
 * message for null.
 */
export function resolveResultFileType(
  originalName: string,
): { extension: string; mimeType: string } | null {
  const name = originalName.trim();
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) return null;
  const extension = name.slice(lastDot + 1).toLowerCase();
  const mimeType = RESULT_FILE_MIME_BY_EXT[extension];
  if (!mimeType) return null;
  return { extension, mimeType };
}

/** Dialog + picker filter label/extensions for the allowlist. */
export const RESULT_FILE_DIALOG_FILTER = {
  name: 'Documents and images',
  extensions: [...RESULT_FILE_EXTENSIONS],
};

/** What the in-app viewer can show without converting or saving a copy. */
export type ResultFilePreviewKind = 'pdf' | 'image' | 'text' | 'none';

/** Browsers render PDFs and a few image/text types natively; the rest
 *  (RTF, Word, Excel, TIFF, HEIC…) fall back to "save a copy". */
const PREVIEW_KIND_BY_EXT: Partial<Record<string, ResultFilePreviewKind>> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  txt: 'text',
  md: 'text',
  csv: 'text',
  xml: 'text',
  json: 'text',
  // HTML previews as plain text — never executed.
  html: 'text',
};

export function resultFilePreviewKind(fileName: string): ResultFilePreviewKind {
  const resolved = resolveResultFileType(fileName);
  return resolved ? (PREVIEW_KIND_BY_EXT[resolved.extension] ?? 'none') : 'none';
}
