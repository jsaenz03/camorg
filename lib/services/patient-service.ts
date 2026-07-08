/**
 * Patient Service Implementation (Tauri SQLite)
 *
 * Patient CRUD + search + denormalised photo counts, scoped by the org-wide
 * access-control rule (see lib/services/access-service.ts). Admins see every
 * patient; non-admins see owned, org-shared, and explicitly-granted patients.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Patient } from '@/types/patient';
import type { PatientCreate, PatientUpdate } from '@/lib/validators/schemas';
import type { IPatientService } from '@/specs/001-role-you-are/contracts/patient-service';
import { patientCreateSchema, patientUpdateSchema } from '@/lib/validators/schemas';
import { getDB } from '@/lib/db/database';
import { accessService } from '@/lib/services/access-service';
import { NotFoundError } from '@/lib/validators/errors';

// Column list used everywhere we SELECT patients, so the row mapper always
// gets every field it expects. Aliased as `p` so the access filter's correlated
// subqueries (which reference `p.`) resolve correctly.
const PATIENT_COLUMNS = `
  p.id, p.name, p.normalized_name, p.photo_count, p.deleted_photo_count,
  p.created_at, p.updated_at, p.last_photo_at, p.clinician_id,
  p.is_archived, p.archived_at,
  p.owner_clinician_id, p.is_org_shared,
  owner.display_name AS owner_name
`;

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
    ownerClinicianId: (row.owner_clinician_id as string) ?? null,
    isOrgShared: Boolean(row.is_org_shared),
    ownerName: (row.owner_name as string) ?? null,
  };
}

// The owner LEFT JOIN used by every read query.
const OWNER_JOIN = `LEFT JOIN clinicians owner ON owner.id = p.owner_clinician_id`;

export class PatientService implements IPatientService {
  async createPatient(data: PatientCreate): Promise<Patient> {
    const validated = patientCreateSchema.parse(data);
    const clinician = await accessService.getCurrentClinician();

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
          created_at, updated_at, last_photo_at, clinician_id,
          is_archived, archived_at, owner_clinician_id, is_org_shared)
       VALUES ($1, $2, $3, 0, 0, $4, $4, NULL, $5, 0, NULL, $5, 0)`,
      [id, validated.name, normalizedName, nowMs, clinician.id],
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
      clinicianId: clinician.id,
      isArchived: false,
      archivedAt: null,
      ownerClinicianId: clinician.id,
      isOrgShared: false,
      ownerName: clinician.displayName,
    };
  }

  async getPatientById(id: string): Promise<Patient | null> {
    // Defense-in-depth: even direct-by-id reads respect the access filter.
    // The id is bound at $1, so the filter must start at $2.
    const filter = await accessService.getAccessiblePatientFilter(2);
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS}
         FROM patients p
         ${OWNER_JOIN}
        WHERE p.id = $1 ${filter.sql}`,
      [id, ...filter.binds],
    );
    return rows.length ? rowToPatient(rows[0]) : null;
  }

  async getAllPatients(options: { includeArchived?: boolean } = {}): Promise<Patient[]> {
    const { includeArchived = false } = options;
    const filter = await accessService.getAccessiblePatientFilter();
    const db = await getDB();

    const archiveClause = includeArchived ? '' : 'AND p.is_archived = 0';
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS}
         FROM patients p
         ${OWNER_JOIN}
        WHERE 1=1 ${archiveClause} ${filter.sql}
        ORDER BY p.last_photo_at DESC NULLS LAST, p.created_at DESC`,
      filter.binds,
    );
    return rows.map(rowToPatient);
  }

  async searchPatients(
    searchTerm: string,
    options: { includeArchived?: boolean } = {}
  ): Promise<Patient[]> {
    const { includeArchived = false } = options;
    const normalizedSearch = searchTerm.trim().toLowerCase();
    // The search term is bound at $1, so the filter must start at $2.
    const filter = await accessService.getAccessiblePatientFilter(2);
    const db = await getDB();

    const archiveClause = includeArchived ? '' : 'AND p.is_archived = 0';
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS}
         FROM patients p
         ${OWNER_JOIN}
        WHERE p.normalized_name LIKE $1 ${archiveClause} ${filter.sql}`,
      [`%${normalizedSearch}%`, ...filter.binds],
    );
    const patients = rows.map(rowToPatient);

    // Client-side tiebreak: exact match first, then prefix, then recency.
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
    await accessService.assertCanManagePatient(id);
    const validated = patientUpdateSchema.parse(data);

    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS} FROM patients p ${OWNER_JOIN} WHERE p.id = $1`,
      [id],
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
      [validated.name, normalizedName, nowMs, id],
    );

    const prior = rowToPatient(rows[0]);
    return { ...prior, name: validated.name, normalizedName, updatedAt: new Date(nowMs) };
  }

  async archivePatient(id: string): Promise<void> {
    await accessService.assertCanManagePatient(id);
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);

    const nowMs = Date.now();
    await db.execute(
      `UPDATE patients SET is_archived = 1, archived_at = $1, updated_at = $2 WHERE id = $3`,
      [nowMs, nowMs, id],
    );
  }

  async unarchivePatient(id: string): Promise<Patient> {
    await accessService.assertCanManagePatient(id);
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS} FROM patients p ${OWNER_JOIN} WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);
    const patient = rowToPatient(rows[0]);

    if (!patient.isArchived) {
      throw new NotFoundError(`Patient is not archived: ${id}`);
    }

    const nowMs = Date.now();
    await db.execute(
      `UPDATE patients SET is_archived = 0, archived_at = NULL, updated_at = $1 WHERE id = $2`,
      [nowMs, id],
    );

    return { ...patient, isArchived: false, archivedAt: null, updatedAt: new Date(nowMs) };
  }

  async getPatientWithAccurateCount(id: string): Promise<Patient> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS} FROM patients p ${OWNER_JOIN} WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);
    const patient = rowToPatient(rows[0]);

    const counts = await db.select<{ active: number; deleted: number }[]>(
      `SELECT
         SUM(CASE WHEN is_deleted = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_deleted = 1 THEN 1 ELSE 0 END) AS deleted
       FROM photos WHERE patient_id = $1`,
      [id],
    );
    const active = counts[0]?.active ?? 0;
    const deleted = counts[0]?.deleted ?? 0;

    if (patient.photoCount !== active || patient.deletedPhotoCount !== deleted) {
      const nowMs = Date.now();
      await db.execute(
        `UPDATE patients SET photo_count = $1, deleted_photo_count = $2, updated_at = $3 WHERE id = $4`,
        [active, deleted, nowMs, id],
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
        [normalizedName, excludeId],
      );
      return rows.length > 0;
    }

    const rows = await db.select<{ id: string }[]>(
      'SELECT id FROM patients WHERE normalized_name = $1',
      [normalizedName],
    );
    return rows.length > 0;
  }

  async updatePhotoCount(id: string, delta: number, isDeleted: boolean): Promise<void> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM patients WHERE id = $1',
      [id],
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
      [newPhotoCount, newDeletedCount, newLastPhotoAt, nowMs, id],
    );
  }

  // ---------------------------------------------------------------
  // Sharing (admin-only). Two mutually exclusive modes are surfaced
  // by the UI, but both can technically be true at once — the OR
  // visibility rule tolerates it. setSharedDoctors replaces the grant
  // set so toggling modes is clean.
  // ---------------------------------------------------------------

  /** Toggle the per-patient org-wide visibility flag. Admin-only. */
  async setOrgShared(id: string, enabled: boolean): Promise<Patient> {
    await accessService.requireAdmin();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS} FROM patients p ${OWNER_JOIN} WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);

    const nowMs = Date.now();
    await db.execute(
      `UPDATE patients SET is_org_shared = $1, updated_at = $2 WHERE id = $3`,
      [enabled ? 1 : 0, nowMs, id],
    );

    const prior = rowToPatient(rows[0]);
    return { ...prior, isOrgShared: enabled, updatedAt: new Date(nowMs) };
  }

  /**
   * Replace the patient's per-doctor grants with the given set. Admin-only.
   * Existing grants not in the new list are removed.
   */
  async setSharedDoctors(id: string, clinicianIds: string[]): Promise<void> {
    const admin = await accessService.requireAdmin();
    const db = await getDB();
    const rows = await db.select<{ id: string }[]>(
      'SELECT id FROM patients WHERE id = $1',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);

    const nowMs = Date.now();
    // Replace strategy: wipe then insert. Cheap for the small per-patient set.
    await db.execute('DELETE FROM patient_shares WHERE patient_id = $1', [id]);
    for (const cid of clinicianIds) {
      await db.execute(
        `INSERT OR IGNORE INTO patient_shares (id, patient_id, clinician_id, granted_by, granted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), id, cid, admin.id, nowMs],
      );
    }
  }

  /** Returns the list of clinician IDs granted access to this patient. */
  async getSharedDoctorIds(id: string): Promise<string[]> {
    await accessService.requireAdmin();
    const db = await getDB();
    const rows = await db.select<{ clinician_id: string }[]>(
      'SELECT clinician_id FROM patient_shares WHERE patient_id = $1',
      [id],
    );
    return rows.map((r) => r.clinician_id);
  }
}

// Export singleton instance
export const patientService = new PatientService();
