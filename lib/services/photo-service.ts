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
import { BILATERAL_BODY_PARTS, type BodyPart, type BodyView, type Laterality, type PinpointSpace } from '@/types/body-part';

/** Lightweight photo row for aggregates (KPIs, charts, calendars). */
export interface PhotoSummary {
  id: string;
  patientId: string;
  patientName: string;
  bodyPart: BodyPart;
  capturedAt: Date;
  isDeleted: boolean;
}

/** Photo with a scheduled review date, for the dashboard alert list. */
export interface PhotoReviewSummary {
  id: string;
  patientId: string;
  patientName: string;
  bodyPart: BodyPart;
  laterality: Laterality | null;
  subpart: string | null;
  reviewDueAt: Date;
}

import type { IPhotoService } from '@/specs/001-role-you-are/contracts/photo-service';
import { photoRecordCreateSchema, photoRecordUpdateSchema } from '@/lib/validators/schemas';
import { getDB, photoPath, getPhotosDir } from '@/lib/db/database';
import { ensureWritable } from '@/lib/licence/guard';
// Every mutating method below ends with notifyAttentionChanged() so the
// sidebar/dashboard alert counters refetch the moment a change lands.
import { notifyAttentionChanged } from '@/lib/services/attention-events';
import { join } from '@tauri-apps/api/path';
import { compressImage, generateThumbnail } from '@/lib/utils/image-processing';
import { patientService } from '@/lib/services/patient-service';
import { subpartService } from '@/lib/services/subpart-service';
import { accessService } from '@/lib/services/access-service';
import { auditService } from '@/lib/services/audit-service';
import { normalizeLesionGroup } from '@/lib/utils/lesion-group';
import { writeFile, readFile } from '@tauri-apps/plugin-fs';
import {
  NotFoundError,
  ValidationError,
  StorageQuotaError,
  PermissionDeniedError,
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
    laterality: (row.laterality as Laterality | null) ?? null,
    subpart: (row.subpart as string | null) ?? null,
    clinicalNotes: (row.clinical_notes as string | null) ?? null,
    pinX: (row.pin_x as number | null) ?? null,
    pinY: (row.pin_y as number | null) ?? null,
    pinSpace: (row.pin_space as PinpointSpace | null) ?? null,
    pinView: (row.pin_view as BodyView | null) ?? null,
    reviewDueAt:
      row.review_due_at != null ? new Date(row.review_due_at as number) : null,
    lastReviewedAt:
      row.last_reviewed_at != null ? new Date(row.last_reviewed_at as number) : null,
    lesionGroup: (row.lesion_group as string | null) ?? null,
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
   * Assemble a WHERE clause from condition fragments plus the access filter.
   * Emits NOTHING when both are empty (admin + no filters) — a dangling
   * `WHERE` before ORDER BY is a syntax error, which is exactly what the
   * "near ORDER" dashboard failure was.
   */
  private static whereSql(conditions: string[], accessSql: string): string {
    const parts = [...conditions, accessSql.replace(/^AND\s+/i, '').trim()].filter(
      (p) => p.length > 0,
    );
    return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
  }
  /**
   * Creates a new photo record with metadata.
   * Compresses the source blob when the clinician's auto-compress preference
   * is on (otherwise stores original bytes), generates a thumbnail, writes
   * the images to disk, then inserts the row and updates denormalised
   * patient counts.
   */
  async createPhoto(data: PhotoRecordCreate): Promise<PhotoRecord> {
    await ensureWritable();
    const validated = photoRecordCreateSchema.parse(data);

    // Enforce by-doctor access: a clinician may only attach photos to a patient
    // they own (or are an admin). Throws PermissionDeniedError otherwise.
    await accessService.assertCanManagePatient(validated.patientId);

    try {
      // Honour the clinician's auto-compress preference: off stores the
      // original bytes untouched (local storage, full quality); on downscales
      // to a 1920px JPEG. A thumbnail is always generated for grid rendering —
      // it never affects the stored full-size image.
      const clinician = await accessService.getCurrentClinician();
      const compress = clinician.preferences.autoCompressPhotos;
      const storedBlob = compress
        ? await compressImage(validated.imageBlob, 1920, 0.85)
        : validated.imageBlob;
      const thumbnailBlob = await generateThumbnail(storedBlob, 200);

      const id = uuidv4();
      // ponytail: store only the filename in DB so paths are portable across
      // machines/OSes. Resolved against photosDir at read time.
      const imageFilename = `${id}.jpg`;
      const thumbFilename = `${id}.thumb.jpg`;
      const imagePath = await photoPath(imageFilename);
      const thumbPath = await photoPath(thumbFilename);

      // Write JPEGs to disk (binary-safe via Uint8Array).
      await writeFile(imagePath, new Uint8Array(await storedBlob.arrayBuffer()));
      await writeFile(thumbPath, new Uint8Array(await thumbnailBlob.arrayBuffer()));

      const now = new Date();
      const nowMs = now.getTime();
      const capturedMs = validated.capturedAt.getTime();

      const db = await getDB();

      // ponytail: no explicit BEGIN/COMMIT — tauri-plugin-sql (sqlx) doesn't
      // reliably honour raw transaction control via execute(), and the only
      // writers are this single-user desktop app. If counts drift, recompute
      // via patientService.getPatientWithAccurateCount, or wire the plugin's
      // db.transaction() API.
      await db.execute(
        `INSERT INTO photos
           (id, patient_id, image_path, thumbnail_path, original_file_name,
            mime_type, file_size_bytes, body_part, laterality, subpart, clinical_notes,
            pin_x, pin_y, pin_space, pin_view,
            captured_at, created_at, updated_at, clinician_id, is_deleted, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, 0, NULL)`,
        [
          id,
          validated.patientId,
          imageFilename,
          thumbFilename,
          '', // originalFileName: not in the create DTO
          validated.mimeType,
          storedBlob.size,
          validated.bodyPart,
          validated.laterality ?? null,
          validated.subpart ?? null,
          validated.clinicalNotes ?? null,
          validated.pinX ?? null,
          validated.pinY ?? null,
          validated.pinSpace ?? null,
          validated.pinView ?? null,
          capturedMs,
          nowMs,
          nowMs,
          clinician.id,
        ]
      );

      // Update patient denormalised counts.
      await patientService.recountPhotos(validated.patientId);

      void auditService.record('photo.create', {
        entityType: 'photo',
        entityId: id,
        patientId: validated.patientId,
        detail: `${validated.bodyPart}${validated.subpart ? ` · ${validated.subpart}` : ''}`,
      });

      // Record subpart usage if provided.
      if (validated.subpart) {
        await subpartService.recordUsage(validated.bodyPart, validated.subpart);
      }

      notifyAttentionChanged();

      return {
        id,
        patientId: validated.patientId,
        imageBlob: PLACEHOLDER_BLOB,
        imageThumbnail: PLACEHOLDER_BLOB,
        originalFileName: '',
        mimeType: validated.mimeType,
        fileSizeBytes: storedBlob.size,
        bodyPart: validated.bodyPart,
        laterality: validated.laterality ?? null,
        subpart: validated.subpart || null,
        clinicalNotes: validated.clinicalNotes || null,
        pinX: validated.pinX ?? null,
        pinY: validated.pinY ?? null,
        pinSpace: validated.pinSpace ?? null,
        pinView: validated.pinView ?? null,
        reviewDueAt: null,
        lastReviewedAt: null,
        lesionGroup: null,
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
   * Retrieves a single photo by ID. Returns null if the photo does not exist
   * OR the current clinician cannot access its parent patient (treat
   * inaccessible as not-found to avoid leaking existence).
   */
  async getPhotoById(id: string): Promise<PhotoRecord | null> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) return null;
    const photo = rowToPhoto(rows[0]);
    if (!(await accessService.canAccessPatient(photo.patientId))) return null;
    return photo;
  }

  /**
   * Retrieves all photos for a specific patient, newest first.
   * Returns an empty list if the clinician lacks access to the patient.
   */
  async getPhotosByPatient(
    patientId: string,
    options: { includeDeleted?: boolean; bodyPart?: BodyPart } = {}
  ): Promise<PhotoRecord[]> {
    const { includeDeleted = false, bodyPart } = options;

    // Defense-in-depth: invisible patients yield no photos.
    if (!(await accessService.canAccessPatient(patientId))) return [];

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
   * Updates photo metadata (body part, side, notes, subpart, series, schedule,
   * and the body-map pinpoint X).
   */
  async updatePhoto(id: string, data: PhotoRecordUpdate): Promise<PhotoRecord> {
    await ensureWritable();
    const validated = photoRecordUpdateSchema.parse(data);

    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);
    await accessService.assertCanManagePatient(photo.patientId);

    const updatedBodyPart = validated.bodyPart ?? photo.bodyPart;
    const bodyPartChanged = updatedBodyPart !== photo.bodyPart;
    // A side only makes sense on paired regions — moving the photo to a
    // central part (or leaving it on one) never keeps a stale laterality.
    const updatedLaterality = BILATERAL_BODY_PARTS.has(updatedBodyPart)
      ? validated.laterality !== undefined ? validated.laterality : photo.laterality
      : null;
    const updatedSubpart =
      validated.subpart !== undefined ? validated.subpart : photo.subpart;
    const updatedNotes =
      validated.clinicalNotes !== undefined ? validated.clinicalNotes : photo.clinicalNotes;
    // Series names go through the shared normaliser so a stray space can't
    // fragment "Left cheek mole" into two groups.
    const updatedLesionGroup =
      validated.lesionGroup !== undefined
        ? normalizeLesionGroup(validated.lesionGroup)
        : photo.lesionGroup;
    const updatedReviewDueAt =
      validated.reviewDueAt !== undefined ? validated.reviewDueAt : photo.reviewDueAt;
    // The X belongs to the diagram it was marked on: an explicit pin wins
    // (including explicit null = clear), moving the photo to a different part
    // clears the old mark (its coordinates mean nothing on the new diagram),
    // otherwise keep it.
    const updatedPinX = validated.pinX !== undefined ? validated.pinX : bodyPartChanged ? null : photo.pinX;
    const updatedPinY = validated.pinY !== undefined ? validated.pinY : bodyPartChanged ? null : photo.pinY;
    const updatedPinSpace = validated.pinSpace !== undefined ? validated.pinSpace : bodyPartChanged ? null : photo.pinSpace;
    const updatedPinView = validated.pinView !== undefined ? validated.pinView : bodyPartChanged ? null : photo.pinView;
    const nowMs = Date.now();

    await db.execute(
      `UPDATE photos
         SET body_part = $1, laterality = $2, subpart = $3, clinical_notes = $4, lesion_group = $5,
             review_due_at = $6, pin_x = $7, pin_y = $8, pin_space = $9, pin_view = $10, updated_at = $11
       WHERE id = $12`,
      [
        updatedBodyPart,
        updatedLaterality,
        updatedSubpart ?? null,
        updatedNotes ?? null,
        updatedLesionGroup,
        updatedReviewDueAt?.getTime() ?? null,
        updatedPinX,
        updatedPinY,
        updatedPinSpace,
        updatedPinView,
        nowMs,
        id,
      ]
    );

    const auditParts = [
      `${updatedBodyPart}${updatedLaterality ? ` (${updatedLaterality})` : ''}`,
      ...(updatedSubpart ? [updatedSubpart] : []),
      ...(updatedLesionGroup ? [`series: ${updatedLesionGroup}`] : []),
    ];
    void auditService.record('photo.update', {
      entityType: 'photo',
      entityId: id,
      patientId: photo.patientId,
      detail: auditParts.join(' · '),
    });

    // Schedule changes get their own review entry (mirrors the patient flow).
    if (updatedReviewDueAt?.getTime() !== (photo.reviewDueAt?.getTime() ?? null)) {
      void auditService.record('photo.review', {
        entityType: 'photo',
        entityId: id,
        patientId: photo.patientId,
        detail: updatedReviewDueAt
          ? `review scheduled for ${updatedReviewDueAt.toISOString().slice(0, 10)}`
          : 'review date cleared',
      });
    }

    // Record subpart usage if changed and provided.
    if (validated.subpart && validated.subpart !== photo.subpart) {
      await subpartService.recordUsage(updatedBodyPart, validated.subpart);
    }

    notifyAttentionChanged();

    return {
      ...photo,
      bodyPart: updatedBodyPart,
      laterality: updatedLaterality,
      subpart: updatedSubpart,
      clinicalNotes: updatedNotes,
      lesionGroup: updatedLesionGroup,
      reviewDueAt: updatedReviewDueAt,
      pinX: updatedPinX,
      pinY: updatedPinY,
      pinSpace: updatedPinSpace,
      pinView: updatedPinView,
      updatedAt: new Date(nowMs),
    };
  }

  /**
   * One-click "review done" for a single photo: stamps the photo's own
   * last_reviewed_at, clears its scheduled review date, AND counts as the
   * patient's review (stamps patients.last_reviewed_at and clears the due
   * date via patientService.markReviewed, which keeps its audit entry).
   * Mirrors the patient timeline header button so both flows land in the
   * same state.
   */
  async reviewPhoto(id: string): Promise<PhotoRecord> {
    await ensureWritable();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);
    await accessService.assertCanManagePatient(photo.patientId);
    if (photo.isDeleted) {
      throw new PermissionDeniedError('Restore this photo before reviewing it.');
    }

    const nowMs = Date.now();
    await db.execute(
      `UPDATE photos SET last_reviewed_at = $1, review_due_at = NULL, updated_at = $2 WHERE id = $3`,
      [nowMs, nowMs, id]
    );

    await patientService.markReviewed(photo.patientId);

    void auditService.record('photo.review', {
      entityType: 'photo',
      entityId: id,
      patientId: photo.patientId,
      detail: `reviewed photo${photo.lesionGroup ? ` (${photo.lesionGroup})` : ''}`,
    });

    notifyAttentionChanged();

    return {
      ...photo,
      lastReviewedAt: new Date(nowMs),
      reviewDueAt: null,
      updatedAt: new Date(nowMs),
    };
  }

  /**
   * Every accessible photo with a scheduled review date, soonest first.
   * Feeds the dashboard alert list (due-soon / overdue derivation happens
   * at read time in lib/utils/photo-review.ts). Archived patients and
   * soft-deleted photos are excluded, matching the patient alert flow.
   */
  async getPhotosWithReviewDue(): Promise<PhotoReviewSummary[]> {
    const db = await getDB();
    // Bind 1: the access filter's clinician id (no condition binds here).
    const access = await accessService.getAccessiblePatientFilter(1);
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ph.id, ph.patient_id, ph.body_part, ph.laterality, ph.subpart,
              ph.review_due_at, p.name AS patient_name
         FROM photos ph
         JOIN patients p ON p.id = ph.patient_id
        WHERE ph.is_deleted = 0 AND ph.review_due_at IS NOT NULL AND p.is_archived = 0
        ${access.sql}
        ORDER BY ph.review_due_at ASC`,
      access.binds,
    );
    return rows.map((row) => ({
      id: row.id as string,
      patientId: row.patient_id as string,
      patientName: (row.patient_name as string) ?? 'Unknown patient',
      bodyPart: row.body_part as BodyPart,
      laterality: (row.laterality as Laterality | null) ?? null,
      subpart: (row.subpart as string | null) ?? null,
      reviewDueAt: new Date(row.review_due_at as number),
    }));
  }

  /**
   * Distinct lesion series names in use for a patient (label order).
   * Includes series whose photos are soft-deleted so a series survives a
   * restore-heavy workflow; empty series can't exist (labels live on photos).
   */
  async getLesionGroups(patientId: string): Promise<string[]> {
    if (!(await accessService.canAccessPatient(patientId))) return [];
    const db = await getDB();
    const rows = await db.select<{ lesion_group: string | null }[]>(
      `SELECT DISTINCT lesion_group FROM photos
        WHERE patient_id = $1 AND lesion_group IS NOT NULL`,
      [patientId]
    );
    return rows
      .map((r) => r.lesion_group)
      .filter((g): g is string => g != null && g.length > 0)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * A patient's photos in one lesion series, oldest capture first — the
   * before→after order the series exists to show.
   */
  async getPhotosInGroup(patientId: string, group: string): Promise<PhotoRecord[]> {
    if (!(await accessService.canAccessPatient(patientId))) return [];
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT * FROM photos
        WHERE patient_id = $1 AND lesion_group = $2 AND is_deleted = 0
        ORDER BY captured_at ASC`,
      [patientId, group]
    );
    return rows.map(rowToPhoto);
  }

  /**
   * Saves an annotated (flattened) copy as a NEW photo, leaving the original
   * untouched. Copies patient/body-part/subpart/notes/capture time from the
   * source photo, regenerates the thumbnail, and bumps patient photo counts.
   */
  async saveAnnotatedImageAsNewPhoto(id: string, annotated: Blob): Promise<PhotoRecord> {
    await ensureWritable();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);
    await accessService.assertCanManagePatient(photo.patientId);
    if (photo.isDeleted) {
      throw new PermissionDeniedError('Restore this photo before annotating it.');
    }

    const newId = uuidv4();
    // The annotated copy is a new capture by the annotating clinician.
    const annotator = await accessService.getCurrentClinician();
    const thumbnailBlob = await generateThumbnail(annotated, 200);
    const imagePath = await photoPath(`${newId}.jpg`);
    const thumbPath = await photoPath(`${newId}.thumb.jpg`);
    await writeFile(imagePath, new Uint8Array(await annotated.arrayBuffer()));
    await writeFile(thumbPath, new Uint8Array(await thumbnailBlob.arrayBuffer()));

    const mimeType = annotated.type || 'image/jpeg';
    const nowMs = Date.now();
    await db.execute(
      `INSERT INTO photos
         (id, patient_id, image_path, thumbnail_path, original_file_name,
          mime_type, file_size_bytes, body_part, laterality, subpart, clinical_notes,
          lesion_group, pin_x, pin_y, pin_space, pin_view,
          captured_at, created_at, updated_at, clinician_id, is_deleted, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 0, NULL)`,
      [
        newId,
        photo.patientId,
        `${newId}.jpg`,
        `${newId}.thumb.jpg`,
        photo.originalFileName,
        mimeType,
        annotated.size,
        photo.bodyPart,
        photo.laterality,
        photo.subpart,
        photo.clinicalNotes,
        photo.lesionGroup,
        photo.pinX,
        photo.pinY,
        photo.pinSpace,
        photo.pinView,
        photo.capturedAt.getTime(),
        nowMs,
        nowMs,
        annotator.id,
      ]
    );

    await patientService.recountPhotos(photo.patientId);
    void auditService.record('photo.annotate', {
      entityType: 'photo',
      entityId: id,
      patientId: photo.patientId,
      detail: `annotated copy ${newId}`,
    });

    notifyAttentionChanged();

    return {
      ...photo,
      id: newId,
      mimeType,
      fileSizeBytes: annotated.size,
      // A fresh copy is unreviewed and unscheduled even if the source was.
      lastReviewedAt: null,
      reviewDueAt: null,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
      isDeleted: false,
      deletedAt: null,
    };
  }

  /**
   * Soft deletes a photo.
   */
  async deletePhoto(id: string): Promise<void> {
    await ensureWritable();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);
    await accessService.assertCanManagePatient(photo.patientId);

    const nowMs = Date.now();

    await db.execute(
      `UPDATE photos SET is_deleted = 1, deleted_at = $1, updated_at = $2 WHERE id = $3`,
      [nowMs, nowMs, id]
    );

    // Maintain denormalised counts (single atomic recompute).
    await patientService.recountPhotos(photo.patientId);
    void auditService.record('photo.delete', {
      entityType: 'photo',
      entityId: id,
      patientId: photo.patientId,
    });
    notifyAttentionChanged();
  }

  /**
   * Restores a soft-deleted photo.
   */
  async restorePhoto(id: string): Promise<PhotoRecord> {
    await ensureWritable();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);
    const photo = rowToPhoto(rows[0]);
    await accessService.assertCanManagePatient(photo.patientId);

    if (!photo.isDeleted) throw new NotFoundError(`Photo is not deleted: ${id}`);

    const nowMs = Date.now();

    await db.execute(
      `UPDATE photos SET is_deleted = 0, deleted_at = NULL, updated_at = $1 WHERE id = $2`,
      [nowMs, id]
    );

    await patientService.recountPhotos(photo.patientId);
    void auditService.record('photo.restore', {
      entityType: 'photo',
      entityId: id,
      patientId: photo.patientId,
    });

    notifyAttentionChanged();

    return { ...photo, isDeleted: false, deletedAt: null, updatedAt: new Date(nowMs) };
  }

  /**
   * Searches photos by clinical notes keyword. Only returns photos the current
   * clinician can see (parent patient is owned / shared / org-wide, or admin).
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
    // Escape LIKE wildcards so % and _ in the note text match literally
    // (same rule as the patient search).
    binds.push(`%${normalizedKeyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    sql += ` AND LOWER(COALESCE(clinical_notes, '')) LIKE $${binds.length} ESCAPE '\\'`;

    sql += ' ORDER BY captured_at DESC';

    const rows = await db.select<Record<string, unknown>[]>(sql, binds);
    return this.filterAccessible(rows.map(rowToPhoto));
  }

  /**
   * Gets count of photos for a patient. Returns 0 if the clinician lacks
   * access to the patient.
   */
  async getPhotoCount(patientId: string, includeDeleted: boolean = false): Promise<number> {
    if (!(await accessService.canAccessPatient(patientId))) return 0;
    const db = await getDB();
    let sql = 'SELECT COUNT(*) AS cnt FROM photos WHERE patient_id = $1';
    if (!includeDeleted) sql += ' AND is_deleted = 0';

    const rows = await db.select<{ cnt: number }[]>(sql, [patientId]);
    return rows[0]?.cnt ?? 0;
  }

  /**
   * Exports photo bytes as a base64 data URL.
   * Reads the on-disk JPEG (full or thumbnail) and base64-encodes it.
   * Throws PermissionDeniedError if the clinician cannot access the patient.
   */
  async exportPhotoAsDataUrl(id: string, useThumbnail: boolean = false): Promise<string> {
    const db = await getDB();
    const rows = await db.select<{ patient_id: string; image_path: string; thumbnail_path: string; mime_type: string }[]>(
      'SELECT patient_id, image_path, thumbnail_path, mime_type FROM photos WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Photo not found: ${id}`);

    const row = rows[0];
    if (!(await accessService.canAccessPatient(row.patient_id))) {
      throw new PermissionDeniedError("You don't have access to this photo.");
    }

    // ponytail: image_path/thumbnail_path are stored relative to photos dir
    // (just the filename) so the DB is portable across machines/OSes. Resolve
    // against the live appDataDir at read time.
    const relPath = useThumbnail ? row.thumbnail_path : row.image_path;
    const dir = await getPhotosDir();
    const path = await join(dir, relPath);
    const bytes = await readFile(path);
    const base64 = uint8ToBase64(new Uint8Array(bytes));
    const mime = useThumbnail ? 'image/jpeg' : row.mime_type;
    return `data:${mime};base64,${base64}`;
  }

  /**
   * Absolute on-disk JPEG paths for a patient's active photos (id → path).
   * Same access rule as getPhotosByPatient. Used by report generation, which
   * streams the bytes straight into the PDF from the Rust side.
   */
  async getActivePhotoFilePaths(patientId: string): Promise<Map<string, string>> {
    if (!(await accessService.canAccessPatient(patientId))) return new Map();
    const db = await getDB();
    const rows = await db.select<{ id: string; image_path: string }[]>(
      'SELECT id, image_path FROM photos WHERE patient_id = $1 AND is_deleted = 0',
      [patientId]
    );
    const dir = await getPhotosDir();
    const map = new Map<string, string>();
    for (const r of rows) {
      // ponytail: image_path stores just the filename; resolve against the
      // live photos dir (see exportPhotoAsDataUrl).
      map.set(r.id, await join(dir, r.image_path));
    }
    return map;
  }

  /**
   * Retrieves photos across all patients, newest first. Restricted to patients
   * the current clinician can see. Optional filters by date range (capturedAt),
   * body part, and a limit.
   */
  /**
   * Lightweight rows for dashboard KPIs/charts — every accessible photo, no
   * per-row file fields. Small enough to stay unlimited where a full
   * PhotoRecord load would truncate.
   */
  async getAllPhotoSummaries(
    options: { includeDeleted?: boolean } = {},
  ): Promise<PhotoSummary[]> {
    const db = await getDB();
    // Bind 1: the access filter's clinician id (no condition binds here).
    const access = await accessService.getAccessiblePatientFilter(1);
    const where = PhotoService.whereSql(
      options.includeDeleted ? [] : ['ph.is_deleted = 0'],
      access.sql,
    );
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ph.id, ph.patient_id, ph.body_part, ph.captured_at, ph.is_deleted,
              p.name AS patient_name
         FROM photos ph
         JOIN patients p ON p.id = ph.patient_id
         ${where}
        ORDER BY ph.captured_at DESC`,
      access.binds,
    );
    return rows.map((row) => ({
      id: row.id as string,
      patientId: row.patient_id as string,
      patientName: (row.patient_name as string) ?? 'Unknown patient',
      bodyPart: row.body_part as BodyPart,
      capturedAt: new Date(row.captured_at as number),
      isDeleted: Boolean(row.is_deleted),
    }));
  }

  /**
   * Access-scoped WHERE shared by getAllPhotos/getPhotosPage. Filtering in
   * SQL (JOIN + the patient access filter) matters: LIMIT applied before a
   * JS-side filter would silently under-return for non-admin clinicians.
   */
  private async buildPhotoQueryWhere(options: {
    from?: Date;
    to?: Date;
    bodyPart?: BodyPart;
    patientId?: string;
    includeDeleted?: boolean;
  }): Promise<{ where: string; binds: unknown[] }> {
    const { from, to, bodyPart, patientId, includeDeleted = false } = options;
    const binds: unknown[] = [];
    const clauses: string[] = [];
    if (!includeDeleted) clauses.push('ph.is_deleted = 0');
    if (patientId) {
      binds.push(patientId);
      clauses.push(`ph.patient_id = $${binds.length}`);
    }
    if (bodyPart) {
      binds.push(bodyPart);
      clauses.push(`ph.body_part = $${binds.length}`);
    }
    if (from) {
      binds.push(from.getTime());
      clauses.push(`ph.captured_at >= $${binds.length}`);
    }
    if (to) {
      binds.push(to.getTime());
      clauses.push(`ph.captured_at <= $${binds.length}`);
    }
    const access = await accessService.getAccessiblePatientFilter(binds.length + 1);
    binds.push(...access.binds);
    return { where: PhotoService.whereSql(clauses, access.sql), binds };
  }

  async getAllPhotos(
    options: { from?: Date; to?: Date; bodyPart?: BodyPart; patientId?: string; includeDeleted?: boolean; limit?: number; offset?: number } = {}
  ): Promise<PhotoRecord[]> {
    const { from, to, bodyPart, patientId, includeDeleted = false, limit, offset } = options;
    const db = await getDB();
    const { where, binds } = await this.buildPhotoQueryWhere({ from, to, bodyPart, patientId, includeDeleted });

    let sql = `SELECT ph.* FROM photos ph JOIN patients p ON p.id = ph.patient_id ${where} ORDER BY ph.captured_at DESC`;
    if (limit && limit > 0) {
      binds.push(limit);
      sql += ` LIMIT $${binds.length}`;
    }
    if (offset && offset > 0) {
      // OFFSET without LIMIT is invalid in SQLite — always bind both.
      binds.push(offset);
      sql += ` OFFSET $${binds.length}`;
    }

    const rows = await db.select<Record<string, unknown>[]>(sql, binds);
    return rows.map(rowToPhoto);
  }

  /**
   * One page of the photos browser plus the total under the same filter, so
   * the UI can page without ever silently truncating the library.
   */
  async getPhotosPage(
    options: { from?: Date; to?: Date; bodyPart?: BodyPart; patientId?: string; includeDeleted?: boolean; limit?: number; offset?: number } = {},
  ): Promise<{ photos: PhotoRecord[]; total: number }> {
    const { limit = 200, offset = 0, ...filters } = options;
    const db = await getDB();
    const { where, binds } = await this.buildPhotoQueryWhere(filters);

    const countRows = await db.select<{ total: number }[]>(
      `SELECT COUNT(*) AS total FROM photos ph JOIN patients p ON p.id = ph.patient_id ${where}`,
      binds,
    );
    const total = countRows[0]?.total ?? 0;

    const pageBinds = [...binds, Math.max(1, Math.floor(limit)), Math.max(0, Math.floor(offset))];
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ph.* FROM photos ph JOIN patients p ON p.id = ph.patient_id ${where}
        ORDER BY ph.captured_at DESC
        LIMIT $${pageBinds.length - 1} OFFSET $${pageBinds.length}`,
      pageBinds,
    );
    return { photos: rows.map(rowToPhoto), total };
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

    const accessible = await this.filterAccessible(rows.map(rowToPhoto));
    const accessibleIds = new Set(accessible.map((p) => p.id));

    // Preserve requested order; treat inaccessible photos as not-found.
    return photoIds.map((id) => {
      if (!accessibleIds.has(id)) throw new NotFoundError(`Photo not found: ${id}`);
      const row = rows.find((r) => r.id === id);
      if (!row) throw new NotFoundError(`Photo not found: ${id}`);
      return rowToPhoto(row);
    });
  }

  /**
   * Filters a list of photos down to those whose parent patient the current
   * clinician can see. Admins pass through unchanged.
   */
  private async filterAccessible(photos: PhotoRecord[]): Promise<PhotoRecord[]> {
    if (photos.length === 0) return photos;
    const admin = await accessService.isAdmin().catch(() => false);
    if (admin) return photos;

    // Cache per-patient access decisions to avoid re-querying for repeats.
    const cache = new Map<string, boolean>();
    const result: PhotoRecord[] = [];
    for (const photo of photos) {
      let ok = cache.get(photo.patientId);
      if (ok === undefined) {
        ok = await accessService.canAccessPatient(photo.patientId);
        cache.set(photo.patientId, ok);
      }
      if (ok) result.push(photo);
    }
    return result;
  }
}

// Export singleton instance
export const photoService = new PhotoService();
