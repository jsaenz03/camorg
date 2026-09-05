/**
 * Result File Service (Tauri SQLite + filesystem)
 *
 * Documents (pathology PDFs, referral letters, …) attached to a photo — and
 * through the photo to its patient. Mirrors photo-service's split storage:
 * bytes on disk under {photosDir}/results/{uuid}.{ext}, metadata in the
 * result_files table (migration 015). Sharing the photos dir means custom
 * storage locations (cloud-synced folders) cover results too, and the fs
 * scope grant (recursive) already covers the subfolder.
 *
 * Bytes are encrypted at rest with the same key and CMGE1 format as photos
 * (photo_encrypt_bytes / photo_decrypt_bytes); legacy plaintext files pass
 * through decrypt unchanged, so reads work during and after the boot
 * migration (photo-crypto-migration walks this directory too).
 *
 * Remove is a soft delete; bytes stay on disk like photos do, so the record
 * of what was attached survives for the audit trail.
 */

import { v4 as uuidv4 } from 'uuid';
import { join } from '@tauri-apps/api/path';
import { exists, mkdir, readFile, writeFile } from '@tauri-apps/plugin-fs';

import { getDB, getPhotosDir } from '@/lib/db/database';
import { ensureWritable } from '@/lib/licence/guard';
import { accessService } from '@/lib/services/access-service';
import { auditService } from '@/lib/services/audit-service';
// Attachment changes must reach every open surface: the photo grids badge
// attachment counts (they background-refetch on the attention event) and the
// phone's shared library carries the count in its manifest.
import { notifyAttentionChanged } from '@/lib/services/attention-events';
import { companionService } from '@/lib/services/companion-service';
import { encryptPhotoBytes, decryptPhotoBytes } from '@/lib/utils/photo-crypto';
import { resolveResultFileType } from '@/types/result-file';
import type { ResultFileRecord } from '@/types/result-file';
import { NotFoundError, StorageQuotaError, ValidationError } from '@/lib/validators/errors';

/** Uploads are read into memory to copy them — cap the damage. */
export const MAX_RESULT_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function rowToResultFile(row: Record<string, unknown>): ResultFileRecord {
  return {
    id: row.id as string,
    photoId: row.photo_id as string,
    patientId: row.patient_id as string,
    originalName: row.original_name as string,
    storedName: row.stored_name as string,
    mimeType: row.mime_type as string,
    fileSizeBytes: row.file_size_bytes as number,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
    clinicianId: (row.clinician_id as string) || '',
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at != null ? new Date(row.deleted_at as number) : null,
  };
}

/** Basename across platform separators (a picked path may be Windows-style). */
export function baseName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

class ResultFileService {
  /** {photosDir}/results — created on demand. */
  private async resultsDir(): Promise<string> {
    const dir = await join(await getPhotosDir(), 'results');
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Copy a clinician-picked file into the results dir and record it against
   * a photo. The photo must exist and be accessible; uploading onto a
   * soft-deleted photo is refused (restore it first, like annotating).
   */
  async upload(photoId: string, pickedPath: string): Promise<ResultFileRecord> {
    await ensureWritable();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT id, patient_id, is_deleted FROM photos WHERE id = $1',
      [photoId],
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${photoId}`);
    if (Boolean(rows[0].is_deleted)) {
      throw new ValidationError('Restore this photo before attaching result files.');
    }
    const patientId = rows[0].patient_id as string;
    await accessService.assertCanManagePatient(patientId);

    const originalName = baseName(pickedPath);
    const resolved = resolveResultFileType(originalName);
    if (!resolved) {
      throw new ValidationError(
        'That file type isn’t supported. Use PDF, RTF, a document, or an image.',
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(pickedPath));
    } catch {
      throw new ValidationError(
        'Camog couldn’t read that file. Pick it again from the file dialog.',
      );
    }
    if (bytes.byteLength === 0) {
      throw new ValidationError('That file is empty.');
    }
    if (bytes.byteLength > MAX_RESULT_FILE_BYTES) {
      throw new ValidationError(
        `That file is too large (limit ${Math.round(MAX_RESULT_FILE_BYTES / 1024 / 1024)} MB).`,
      );
    }

    const id = uuidv4();
    // ponytail: store only the filename in DB so paths stay portable across
    // machines/OSes (same rule as photos). Resolved against resultsDir().
    const storedName = `${id}.${resolved.extension}`;
    const targetPath = await join(await this.resultsDir(), storedName);
    try {
      await writeFile(targetPath, await encryptPhotoBytes(bytes));
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'QuotaExceededError' || /No space left/i.test(error.message))
      ) {
        throw new StorageQuotaError(
          'Storage quota exceeded. Please free disk space and try again.',
        );
      }
      throw error;
    }

    const nowMs = Date.now();
    await db.execute(
      `INSERT INTO result_files
         (id, photo_id, patient_id, original_name, stored_name, mime_type,
          file_size_bytes, created_at, updated_at, clinician_id, is_deleted, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, 0, NULL)`,
      [
        id,
        photoId,
        patientId,
        originalName,
        storedName,
        resolved.mimeType,
        bytes.byteLength,
        nowMs,
        (await accessService.getCurrentClinician()).id,
      ],
    );

    void auditService.record('result_file.add', {
      entityType: 'photo',
      entityId: photoId,
      patientId,
      detail: `attached ${originalName} (${(bytes.byteLength / 1024).toFixed(0)} KB)`,
    });
    notifyAttentionChanged();
    void companionService.publish().catch(() => {});

    return {
      id,
      photoId,
      patientId,
      originalName,
      storedName,
      mimeType: resolved.mimeType,
      fileSizeBytes: bytes.byteLength,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
      clinicianId: '',
      isDeleted: false,
      deletedAt: null,
    };
  }

  /** A photo's active result files, newest upload first. Access-scoped. */
  async listByPhoto(photoId: string): Promise<ResultFileRecord[]> {
    const db = await getDB();
    const rows = await db.select<{ patient_id: string }[]>(
      'SELECT patient_id FROM photos WHERE id = $1',
      [photoId],
    );
    if (!rows.length) return [];
    if (!(await accessService.canAccessPatient(rows[0].patient_id))) return [];

    const files = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM result_files WHERE photo_id = $1 AND is_deleted = 0
        ORDER BY created_at DESC`,
      [photoId],
    );
    return files.map(rowToResultFile);
  }

  /**
   * Write a copy of a stored result file to a clinician-chosen path (native
   * save dialog). Nothing is opened in-place — the clinician opens the copy
   * with whatever app they like.
   */
  async saveCopy(id: string, targetPath: string): Promise<void> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM result_files WHERE id = $1 AND is_deleted = 0',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Result file not found: ${id}`);
    const file = rowToResultFile(rows[0]);
    if (!(await accessService.canAccessPatient(file.patientId))) {
      throw new NotFoundError(`Result file not found: ${id}`);
    }

    const dir = await this.resultsDir();
    const bytes = await decryptPhotoBytes(
      new Uint8Array(await readFile(await join(dir, file.storedName))),
    );
    await writeFile(targetPath, bytes);

    void auditService.record('photo.export', {
      entityType: 'photo',
      entityId: file.photoId,
      patientId: file.patientId,
      detail: `saved result file copy ${file.originalName}`,
    });
  }

  /**
   * Bytes + metadata for in-app preview, access-checked. Reads the stored
   * file straight off disk — the viewer never writes a copy.
   */
  async readFileBytes(
    id: string,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; mimeType: string; originalName: string }> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM result_files WHERE id = $1 AND is_deleted = 0',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Result file not found: ${id}`);
    const file = rowToResultFile(rows[0]);
    if (!(await accessService.canAccessPatient(file.patientId))) {
      throw new NotFoundError(`Result file not found: ${id}`);
    }

    const dir = await this.resultsDir();
    const bytes = await decryptPhotoBytes(
      new Uint8Array(await readFile(await join(dir, file.storedName))),
    );
    return { bytes, mimeType: file.mimeType, originalName: file.originalName };
  }

  /** Soft-deletes an attached result file; the bytes stay on disk. */
  async delete(id: string): Promise<void> {
    await ensureWritable();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM result_files WHERE id = $1 AND is_deleted = 0',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Result file not found: ${id}`);
    const file = rowToResultFile(rows[0]);
    await accessService.assertCanManagePatient(file.patientId);

    const nowMs = Date.now();
    await db.execute(
      'UPDATE result_files SET is_deleted = 1, deleted_at = $1, updated_at = $2 WHERE id = $3',
      [nowMs, nowMs, id],
    );

    void auditService.record('result_file.delete', {
      entityType: 'photo',
      entityId: file.photoId,
      patientId: file.patientId,
      detail: `removed ${file.originalName}`,
    });
    notifyAttentionChanged();
    void companionService.publish().catch(() => {});
  }
}

// Export singleton instance
export const resultFileService = new ResultFileService();
