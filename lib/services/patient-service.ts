/**
 * Patient Service Implementation (Tauri SQLite)
 *
 * Handles patient CRUD + search + denormalised photo counts.
 * Drop-in replacement for the IndexedDB version.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Patient } from '@/types/patient';
import type { PatientCreate, PatientUpdate } from '@/lib/validators/schemas';
import type { IPatientService } from '@/specs/001-role-you-are/contracts/patient-service';
import { patientCreateSchema, patientUpdateSchema } from '@/lib/validators/schemas';
import { getDB } from '@/lib/db/database';
import {
  NotFoundError,
} from '@/lib/validators/errors';

function rowToPatient(row: Record<string, unknown>): Patient {
  return {
    id: row.id as string,
    name: row.name as string,
    normalizedName: row.normalized_name as string,
    photoCount: row.photo_count as number,
    deletedPhotoCount: row.deleted_photo_count as number,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
    lastPhotoAt: row.last_photo_at != null ? new Date(row.last_photo_at as number) : null,
    clinicianId: (row.clinician_id as string) || '',
    isArchived: Boolean(row.is_archived),
    archivedAt: row.archived_at != null ? new Date(row.archived_at as number) : null,
  };
}

export class PatientService implements IPatientService {
  async createPatient(data: PatientCreate): Promise<Patient> {
    const validated = patientCreateSchema.parse(data);

    const isDuplicate = await this.isDuplicateName(validated.name);
    if (isDuplicate) {
      console.warn(`Duplicate patient name: ${validated.name}`);
    }

    const id = uuidv4();
    const nowMs = Date.now();
    const normalizedName = validated.name.trim().toLowerCase();

    const db = await getDB();
    await db.execute(
      `INSERT INTO patients
         (id, name, normalized_name, photo_count, deleted_photo_count,
          created_at, updated_at, last_photo_at, clinician_id, is_archived, archived_at)
       VALUES ($1, $2, $3, 0, 0, $4, $4, NULL, '', 0, NULL)`,
      [id, validated.name, normalizedName, nowMs]
    );

    return {
      id,
      name: validated.name,
      normalizedName,
      photoCount: 0,
      deletedPhotoCount: 0,
      createdAt: new Date(nowMs),
      updatedAt: new Date(nowMs),
      lastPhotoAt: null,
      clinicianId: '',
      isArchived: false,
      archivedAt: null,
    };
  }

  async getPatientById(id: string): Promise<Patient | null> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    return rows.length ? rowToPatient(rows[0]) : null;
  }

  async getAllPatients(options: { includeArchived?: boolean } = {}): Promise<Patient[]> {
    const { includeArchived = false } = options;
    const db = await getDB();
    const sql = includeArchived
      ? 'SELECT * FROM patients ORDER BY last_photo_at DESC NULLS LAST, created_at DESC'
      : 'SELECT * FROM patients WHERE is_archived = 0 ORDER BY last_photo_at DESC NULLS LAST, created_at DESC';
    const rows = await db.select<Record<string, unknown>[]>(sql);
    return rows.map(rowToPatient);
  }

  async searchPatients(
    searchTerm: string,
    options: { includeArchived?: boolean } = {}
  ): Promise<Patient[]> {
    const { includeArchived = false } = options;
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const db = await getDB();
    let sql = 'SELECT * FROM patients WHERE normalized_name LIKE $1';
    if (!includeArchived) sql += ' AND is_archived = 0';

    // ponytail: SQL can't easily express the "exact match first, then prefix,
    // then lastPhotoAt" tiebreak. Apply it client-side on the small result set.
    const rows = await db.select<Record<string, unknown>[]>(sql, [`%${normalizedSearch}%`]);
    const patients = rows.map(rowToPatient);

    patients.sort((a, b) => {
      const aExact = a.normalizedName === normalizedSearch;
      const bExact = b.normalizedName === normalizedSearch;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;

      const aStarts = a.normalizedName.startsWith(normalizedSearch);
      const bStarts = b.normalizedName.startsWith(normalizedSearch);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;

      if (a.lastPhotoAt && b.lastPhotoAt) {
        return b.lastPhotoAt.getTime() - a.lastPhotoAt.getTime();
      }
      if (a.lastPhotoAt) return -1;
      if (b.lastPhotoAt) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return patients;
  }

  async updatePatient(id: string, data: PatientUpdate): Promise<Patient> {
    const validated = patientUpdateSchema.parse(data);

    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);

    const isDuplicate = await this.isDuplicateName(validated.name, id);
    if (isDuplicate) {
      console.warn(`Duplicate patient name: ${validated.name}`);
    }

    const normalizedName = validated.name.trim().toLowerCase();
    const nowMs = Date.now();

    await db.execute(
      `UPDATE patients SET name = $1, normalized_name = $2, updated_at = $3 WHERE id = $4`,
      [validated.name, normalizedName, nowMs, id]
    );

    const prior = rowToPatient(rows[0]);
    return { ...prior, name: validated.name, normalizedName, updatedAt: new Date(nowMs) };
  }

  async archivePatient(id: string): Promise<void> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);

    const nowMs = Date.now();
    await db.execute(
      `UPDATE patients SET is_archived = 1, archived_at = $1, updated_at = $2 WHERE id = $3`,
      [nowMs, nowMs, id]
    );
  }

  async unarchivePatient(id: string): Promise<Patient> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);
    const patient = rowToPatient(rows[0]);

    if (!patient.isArchived) {
      throw new NotFoundError(`Patient is not archived: ${id}`);
    }

    const nowMs = Date.now();
    await db.execute(
      `UPDATE patients SET is_archived = 0, archived_at = NULL, updated_at = $1 WHERE id = $2`,
      [nowMs, id]
    );

    return { ...patient, isArchived: false, archivedAt: null, updatedAt: new Date(nowMs) };
  }

  async getPatientWithAccurateCount(id: string): Promise<Patient> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);
    const patient = rowToPatient(rows[0]);

    const counts = await db.select<{ active: number; deleted: number }[]>(
      `SELECT
         SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END) AS deleted
       FROM photos WHERE patient_id = $1`,
      [id]
    );
    const active = counts[0]?.active ?? 0;
    const deleted = counts[0]?.deleted ?? 0;

    if (patient.photoCount !== active || patient.deletedPhotoCount !== deleted) {
      const nowMs = Date.now();
      await db.execute(
        `UPDATE patients SET photo_count = $1, deleted_photo_count = $2, updated_at = $3 WHERE id = $4`,
        [active, deleted, nowMs, id]
      );
      return { ...patient, photoCount: active, deletedPhotoCount: deleted, updatedAt: new Date(nowMs) };
    }

    return patient;
  }

  async isDuplicateName(name: string, excludeId?: string): Promise<boolean> {
    const normalizedName = name.trim().toLowerCase();
    const db = await getDB();

    if (excludeId) {
      const rows = await db.select<{ id: string }[]>(
        'SELECT id FROM patients WHERE normalized_name = $1 AND id != $2',
        [normalizedName, excludeId]
      );
      return rows.length > 0;
    }

    const rows = await db.select<{ id: string }[]>(
      'SELECT id FROM patients WHERE normalized_name = $1',
      [normalizedName]
    );
    return rows.length > 0;
  }

  async updatePhotoCount(id: string, delta: number, isDeleted: boolean): Promise<void> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id]
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);
    const patient = rowToPatient(rows[0]);

    const nowMs = Date.now();
    const newPhotoCount = isDeleted
      ? patient.photoCount
      : Math.max(0, patient.photoCount + delta);
    const newDeletedCount = isDeleted
      ? Math.max(0, patient.deletedPhotoCount + delta)
      : patient.deletedPhotoCount;
    const newLastPhotoAt =
      delta > 0 && !isDeleted ? nowMs : patient.lastPhotoAt?.getTime() ?? null;

    await db.execute(
      `UPDATE patients
         SET photo_count = $1, deleted_photo_count = $2, last_photo_at = $3, updated_at = $4
       WHERE id = $5`,
      [newPhotoCount, newDeletedCount, newLastPhotoAt, nowMs, id]
    );
  }
}

// Export singleton instance
export const patientService = new PatientService();
