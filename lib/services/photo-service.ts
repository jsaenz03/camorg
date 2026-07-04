/**
 * Photo Service Implementation (Tauri SQLite + filesystem)
 *
 * Persists photo binaries as JPEG files on disk (via tauri-plugin-fs) and
 * metadata in SQLite (via tauri-plugin-sql). Drop-in replacement for the
 * prior IndexedDB version: same class name, same method signatures, same
 * returned PhotoRecord shape (imageBlob/imageThumbnail carry placeholder
 * Blobs — no component reads them; exportPhotoAsDataUrl is the byte path).
 */

import { v4 as uuidv4 } from 'uuid';
import type { PhotoRecord } from '@/types/photo';
import type { PhotoRecordCreate, PhotoRecordUpdate } from '@/lib/validators/schemas';
import type { BodyPart } from '@/types/body-part';
import type { IPhotoService } from '@/specs/001-role-you-are/contracts/photo-service';
import { photoRecordCreateSchema, photoRecordUpdateSchema } from '@/lib/validators/schemas';
import { getDB, photoPath } from '@/lib/db/database';
import { compressImage, generateThumbnail } from '@/lib/utils/image-processing';
import { patientService } from '@/lib/services/patient-service';
import { subpartService } from '@/lib/services/subpart-service';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import {
  NotFoundError,
  ValidationError,
  StorageQuotaError,
} from '@/lib/validators/errors';

// ponytail: empty Blob placeholder — PhotoRecord.imageBlob stays on the type
// for contract compatibility, but bytes live on disk. No component reads it.
const PLACEHOLDER_BLOB = new Blob();

/**
 * Convert a SQLite row to a PhotoRecord.
 * Dates come back as INTEGER unix ms; booleans as 0/1.
 */
function rowToPhoto(row: Record<string, unknown>): PhotoRecord {
  return {
    id: row.id as string,
    patientId: row.patient_id as string,
    imageBlob: PLACEHOLDER_BLOB,
    imageThumbnail: PLACEHOLDER_BLOB,
    originalFileName: (row.original_file_name as string) || '',
    mimeType: row.mime_type as string,
    fileSizeBytes: row.file_size_bytes as number,
    bodyPart: row.body_part as BodyPart,
    subpart: (row.subpart as string | null) ?? null,
    clinicalNotes: (row.clinical_notes as string | null) ?? null,
    capturedAt: new Date(row.captured_at as number),
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
    clinicianId: (row.clinician_id as string) || '',
    isDeleted: Boolean(row.is_deleted),
    deletedAt: row.deleted_at != null ? new Date(row.deleted_at as number) : null,
  };
}

/**
 * Convert a Uint8Array to a base64 string, chunked to avoid call-stack limits.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000; // 32k
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export class PhotoService implements IPhotoService {
  /**
   * Creates a new photo record with metadata.
   * Compresses the source blob, generates a thumbnail, writes both JPEGs to
   * disk, then inserts the row and updates denormalised patient counts.
   */
  async createPhoto(data: PhotoRecordCreate): Promise<PhotoRecord> {
    const validated = photoRecordCreateSchema.parse(data);

    try {
      const compressedBlob = await compressImage(validated.imageBlob, 1920, 0.85);
      const thumbnailBlob = await generateThumbnail(compressedBlob, 200);

      const id = uuidv4();
      const imagePath = await photoPath(`${id}.jpg`);
      const thumbPath = await photoPath(`${id}.thumb.jpg`);

      // Write JPEGs to disk (binary-safe via Uint8Array).
      await writeFile(imagePath, new Uint8Array(await compressedBlob.arrayBuffer()));
      await writeFile(thumbPath, new Uint8Array(await thumbnailBlob.arrayBuffer()));

      const now = new Date();
      const nowMs = now.getTime();
      const capturedMs = validated.capturedAt.getTime();

      const db = await getDB();

      await db.execute('BEGIN');
      try {
        await db.execute(
          `INSERT INTO photos
             (id, patient_id, image_path, thumbnail_path, original_file_name,
              mime_type, file_size_bytes, body_part, subpart, clinical_notes,
              captured_at, created_at, updated_at, clinician_id, is_deleted, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 0, NULL)`,
          [
            id,
            validated.patientId,
            imagePath,
            thumbPath,
            '', // originalFileName: not in the create DTO
            validated.mimeType,
            compressedBlob.size,
            validated.bodyPart,
            validated.subpart ?? null,
            validated.clinicalNotes ?? null,
            capturedMs,
            nowMs,
            nowMs,
            '', // clinicianId: set by auth context when implemented
          ]
        );

        // Update patient denormalised counts (separate statements, same tx).
        await patientService.updatePhotoCount(validated.patientId, 1, false);

        // Record subpart usage if provided.
        if (validated.subpart) {
          await subpartService.recordUsage(validated.bodyPart, validated.subpart);
        }

        await db.execute('COMMIT');
      } catch (error) {
        await db.execute('ROLLBACK');
        throw error;
      }

      return {
        id,
        patientId: validated.patientId,
        imageBlob: PLACEHOLDER_BLOB,
        imageThumbnail: PLACEHOLDER_BLOB,
        originalFileName: '',
        mimeType: validated.mimeType,
        fileSizeBytes: compressedBlob.size,
        bodyPart: validated.bodyPart,
        subpart: validated.subpart || null,
        clinicalNotes: validated.clinicalNotes || null,
        capturedAt: validated.capturedAt,
        createdAt: now,
        updatedAt: now,
        clinicianId: '',
        isDeleted: false,
        deletedAt: null,
      };
    } catch (error) {
      // Surface disk-full / quota as StorageQuotaError for UI parity.
      if (
        error instanceof Error &&
        (error.name === 'QuotaExceededError' || /No space left/i.test(error.message))
      ) {
        throw new StorageQuotaError(
          'Storage quota exceeded. Please delete old photos or free disk space.'
        );
      }
      throw error;
    }
  }

  /**
   * Retrieves a single photo by ID.
   */
  async getPhotoById(id: string): Promise<PhotoRecord | null> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    return rows.length ? rowToPhoto(rows[0]) : null;
  }

  /**
   * Retrieves all photos for a specific patient, newest first.
   */
  async getPhotosByPatient(
    patientId: string,
    options: { includeDeleted?: boolean; bodyPart?: BodyPart } = {}
  ): Promise<PhotoRecord[]> {
    const { includeDeleted = false, bodyPart } = options;

    const db = await getDB();
    let sql = 'SELECT * FROM photos WHERE patient_id = $1';
    const binds: unknown[] = [patientId];

    if (bodyPart) {
      sql += ' AND body_part = $2';
      binds.push(bodyPart);
    }

    if (!includeDeleted) {
      sql += ' AND is_deleted = 0';
    }

    sql += ' ORDER BY captured_at DESC';

    const rows = await db.select<Record<string, unknown>[]>(sql, binds);
    return rows.map(rowToPhoto);
  }

  /**
   * Updates photo metadata (notes and subpart only).
   */
  async updatePhoto(id: string, data: PhotoRecordUpdate): Promise<PhotoRecord> {
    const validated = photoRecordUpdateSchema.parse(data);

    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);

    const updatedSubpart =
      validated.subpart !== undefined ? validated.subpart : photo.subpart;
    const updatedNotes =
      validated.clinicalNotes !== undefined ? validated.clinicalNotes : photo.clinicalNotes;
    const nowMs = Date.now();

    await db.execute(
      `UPDATE photos
         SET subpart = $1, clinical_notes = $2, updated_at = $3
       WHERE id = $4`,
      [updatedSubpart ?? null, updatedNotes ?? null, nowMs, id]
    );

    // Record subpart usage if changed and provided.
    if (validated.subpart && validated.subpart !== photo.subpart) {
      await subpartService.recordUsage(photo.bodyPart, validated.subpart);
    }

    return { ...photo, subpart: updatedSubpart, clinicalNotes: updatedNotes, updatedAt: new Date(nowMs) };
  }

  /**
   * Soft deletes a photo.
   */
  async deletePhoto(id: string): Promise<void> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);

    const nowMs = Date.now();

    await db.execute('BEGIN');
    try {
      await db.execute(
        `UPDATE photos SET is_deleted = 1, deleted_at = $1, updated_at = $2 WHERE id = $3`,
        [nowMs, nowMs, id]
      );

      // Maintain denormalised counts: active -1, deleted +1.
      await patientService.updatePhotoCount(photo.patientId, -1, false);
      await patientService.updatePhotoCount(photo.patientId, 1, true);

      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }
  }

  /**
   * Restores a soft-deleted photo.
   */
  async restorePhoto(id: string): Promise<PhotoRecord> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);

    if (!photo.isDeleted) throw new NotFoundError(`Photo is not deleted: ${id}`);

    const nowMs = Date.now();

    await db.execute('BEGIN');
    try {
      await db.execute(
        `UPDATE photos SET is_deleted = 0, deleted_at = NULL, updated_at = $1 WHERE id = $2`,
        [nowMs, id]
      );

      await patientService.updatePhotoCount(photo.patientId, 1, false);
      await patientService.updatePhotoCount(photo.patientId, -1, true);

      await db.execute('COMMIT');
    } catch (error) {
      await db.execute('ROLLBACK');
      throw error;
    }

    return { ...photo, isDeleted: false, deletedAt: null, updatedAt: new Date(nowMs) };
  }

  /**
   * Searches photos by clinical notes keyword.
   */
  async searchPhotosByNotes(
    keyword: string,
    options: { patientId?: string; bodyPart?: BodyPart } = {}
  ): Promise<PhotoRecord[]> {
    const { patientId, bodyPart } = options;
    const normalizedKeyword = keyword.trim().toLowerCase();

    const db = await getDB();
    let sql = 'SELECT * FROM photos WHERE is_deleted = 0';
    const binds: unknown[] = [];

    if (patientId) {
      binds.push(patientId);
      sql += ` AND patient_id = $${binds.length}`;
    }
    if (bodyPart) {
      binds.push(bodyPart);
      sql += ` AND body_part = $${binds.length}`;
    }
    binds.push(`%${normalizedKeyword}%`);
    sql += ` AND LOWER(COALESCE(clinical_notes, '')) LIKE $${binds.length}`;

    sql += ' ORDER BY captured_at DESC';

    const rows = await db.select<Record<string, unknown>[]>(sql, binds);
    return rows.map(rowToPhoto);
  }

  /**
   * Gets count of photos for a patient.
   */
  async getPhotoCount(patientId: string, includeDeleted: boolean = false): Promise<number> {
    const db = await getDB();
    let sql = 'SELECT COUNT(*) AS cnt FROM photos WHERE patient_id = $1';
    if (!includeDeleted) sql += ' AND is_deleted = 0';

    const rows = await db.select<{ cnt: number }[]>(sql, [patientId]);
    return rows[0]?.cnt ?? 0;
  }

  /**
   * Exports photo bytes as a base64 data URL.
   * Reads the on-disk JPEG (full or thumbnail) and base64-encodes it.
   */
  async exportPhotoAsDataUrl(id: string, useThumbnail: boolean = false): Promise<string> {
    const db = await getDB();
    const rows = await db.select<{ image_path: string; thumbnail_path: string; mime_type: string }[]>(
      'SELECT image_path, thumbnail_path, mime_type FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);

    const row = rows[0];
    const path = useThumbnail ? row.thumbnail_path : row.image_path;
    const bytes = await readFile(path);
    const base64 = uint8ToBase64(new Uint8Array(bytes));
    const mime = useThumbnail ? 'image/jpeg' : row.mime_type;
    return `data:${mime};base64,${base64}`;
  }

  /**
   * Gets photos for comparison (2-4 photos, returned in requested order).
   */
  async getPhotosForComparison(photoIds: string[]): Promise<PhotoRecord[]> {
    if (photoIds.length < 2 || photoIds.length > 4) {
      throw new ValidationError('Photo comparison requires 2-4 photos');
    }

    const db = await getDB();
    const placeholders = photoIds.map((_, i) => `$${i + 1}`).join(',');
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM photos WHERE id IN (${placeholders})`,
      photoIds
    );

    // Preserve requested order.
    return photoIds.map((id) => {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundError(`Photo not found: ${id}`);
      return rowToPhoto(row);
    });
  }
}

// Export singleton instance
export const photoService = new PhotoService();
