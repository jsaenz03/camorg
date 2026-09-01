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
import { auditService } from '@/lib/services/audit-service';
import { NotFoundError } from '@/lib/validators/errors';
import { dateFromMs, dateToMs, dobFromMs, dobToMs, parseDobInput } from '@/lib/utils/date-formatting';
import { ensureWritable } from '@/lib/licence/guard';
// Every mutating method below ends with notifyAttentionChanged() so the
// sidebar/dashboard alert counters refetch the moment a change lands.
import { notifyAttentionChanged } from '@/lib/services/attention-events';

// Column list used everywhere we SELECT patients, so the row mapper always
// gets every field it expects. Aliased as `p` so the access filter's correlated
// subqueries (which reference `p.`) resolve correctly.
const PATIENT_COLUMNS = `
  p.id, p.name, p.normalized_name, p.dob, p.photo_count, p.deleted_photo_count,
  p.created_at, p.updated_at, p.last_photo_at, p.clinician_id,
  p.is_archived, p.archived_at,
  p.owner_clinician_id, p.is_org_shared,
  p.consent_given_at, p.consent_scope, p.consent_expires_at,
  p.review_due_at, p.last_reviewed_at,
  owner.display_name AS owner_name
`;

function rowToPatient(row: Record<string, unknown>): Patient {
  return {
    id: row.id as string,
    name: row.name as string,
    normalizedName: row.normalized_name as string,
    dateOfBirth: row.dob != null ? dobFromMs(row.dob as number) : null,
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
    consentGivenAt: row.consent_given_at != null ? new Date(row.consent_given_at as number) : null,
    consentScope: (row.consent_scope as Patient['consentScope']) ?? null,
    consentExpiresAt: row.consent_expires_at != null ? new Date(row.consent_expires_at as number) : null,
    reviewDueAt: row.review_due_at != null ? dateFromMs(row.review_due_at as number) : null,
    lastReviewedAt: row.last_reviewed_at != null ? new Date(row.last_reviewed_at as number) : null,
  };
}

// The owner LEFT JOIN used by every read query.
const OWNER_JOIN = `LEFT JOIN clinicians owner ON owner.id = p.owner_clinician_id`;

export class PatientService implements IPatientService {
  async createPatient(data: PatientCreate): Promise<Patient> {
    await ensureWritable();
    const validated = patientCreateSchema.parse(data);
    const clinician = await accessService.getCurrentClinician();

    const isDuplicate = await this.isDuplicateName(validated.name);
    if (isDuplicate) {
      console.warn(`Duplicate patient name: ${validated.name}`);
    }

    const id = uuidv4();
    const nowMs = Date.now();
    const normalizedName = validated.name.trim().toLowerCase();
    const dobMs = validated.dateOfBirth ? dobToMs(validated.dateOfBirth) : null;

    const db = await getDB();
    await db.execute(
      `INSERT INTO patients
         (id, name, normalized_name, dob, photo_count, deleted_photo_count,
          created_at, updated_at, last_photo_at, clinician_id,
          is_archived, archived_at, owner_clinician_id, is_org_shared,
          review_due_at, last_reviewed_at)
       VALUES ($1, $2, $3, $4, 0, 0, $5, $5, NULL, $6, 0, NULL, $6, 0, NULL, NULL)`,
      [id, validated.name, normalizedName, dobMs, nowMs, clinician.id],
    );

    void auditService.record('patient.create', {
      entityType: 'patient',
      entityId: id,
      detail: validated.name,
    });

    notifyAttentionChanged();

    return {
      id,
      name: validated.name,
      normalizedName,
      dateOfBirth: validated.dateOfBirth ?? null,
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
      consentGivenAt: null,
      consentScope: null,
      consentExpiresAt: null,
      reviewDueAt: null,
      lastReviewedAt: null,
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
    // A term that parses as a calendar date (e.g. 4/2/85, 04/02/1985,
    // 1985-02-04) also matches date of birth; otherwise it is a plain name
    // search. LIKE wildcards in the term are escaped so % and _ match
    // literally instead of broadening the search.
    const dobTerm = parseDobInput(searchTerm);
    const dobMs = dobTerm ? dobToMs(dobTerm) : null;
    const likePattern = `%${normalizedSearch.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

    // Binds before the access filter, so the filter must start after them.
    const leadingBinds = dobMs != null
      ? [likePattern, dobMs]
      : [likePattern];
    const filter = await accessService.getAccessiblePatientFilter(leadingBinds.length + 1);
    const db = await getDB();

    const archiveClause = includeArchived ? '' : 'AND p.is_archived = 0';
    const dobClause = dobMs != null ? 'OR p.dob = $2' : '';
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS}
         FROM patients p
         ${OWNER_JOIN}
        WHERE (p.normalized_name LIKE $1 ESCAPE '\\' ${dobClause}) ${archiveClause} ${filter.sql}`,
      [...leadingBinds, ...filter.binds],
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
    await ensureWritable();
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
    const dobMs = validated.dateOfBirth ? dobToMs(validated.dateOfBirth) : null;
    const consent = validated.consent;
    const consentGivenMs = consent.givenAt?.getTime() ?? null;
    const consentExpiryMs = consent.expiresAt?.getTime() ?? null;
    const review = validated.review;
    const reviewDueMs = review.dueAt ? dateToMs(review.dueAt) : null;
    const nowMs = Date.now();

    await db.execute(
      `UPDATE patients
         SET name = $1, normalized_name = $2, dob = $3,
             consent_given_at = $4, consent_scope = $5, consent_expires_at = $6,
             review_due_at = $7, updated_at = $8
       WHERE id = $9`,
      [
        validated.name,
        normalizedName,
        dobMs,
        consentGivenMs,
        consent.scope,
        consentExpiryMs,
        reviewDueMs,
        nowMs,
        id,
      ],
    );

    const prior = rowToPatient(rows[0]);
    void auditService.record('patient.update', {
      entityType: 'patient',
      entityId: id,
      detail: validated.name,
    });

    const consentChanged =
      consentGivenMs !== (prior.consentGivenAt?.getTime() ?? null) ||
      consent.scope !== prior.consentScope ||
      consentExpiryMs !== (prior.consentExpiresAt?.getTime() ?? null);
    if (consentChanged) {
      void auditService.record('patient.consent', {
        entityType: 'patient',
        entityId: id,
        detail: consent.givenAt
          ? `consent recorded (${consent.scope}${
              consent.expiresAt ? `, expires ${consent.expiresAt.toISOString().slice(0, 10)}` : ''
            })`
          : 'consent cleared',
      });
    }

    if (reviewDueMs !== (prior.reviewDueAt?.getTime() ?? null)) {
      void auditService.record('patient.review', {
        entityType: 'patient',
        entityId: id,
        detail: review.dueAt
          ? `review scheduled for ${review.dueAt.toISOString().slice(0, 10)}`
          : 'review date cleared',
      });
    }

    notifyAttentionChanged();

    return {
      ...prior,
      name: validated.name,
      normalizedName,
      dateOfBirth: validated.dateOfBirth,
      updatedAt: new Date(nowMs),
      consentGivenAt: consent.givenAt,
      consentScope: consent.scope,
      consentExpiresAt: consent.expiresAt,
      reviewDueAt: review.dueAt,
    };
  }
  /**
   * One-click "review done": stamp last_reviewed_at, clear (or replace) the
   * due date. Distinct from updatePatient so the timeline header button and
   * future bulk flows don't need to round-trip the whole patient form.
   */
  async markReviewed(id: string, nextDueAt: Date | null = null): Promise<Patient> {
    await ensureWritable();
    await accessService.assertCanManagePatient(id);
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      `SELECT ${PATIENT_COLUMNS} FROM patients p ${OWNER_JOIN} WHERE p.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundError(`Patient not found: ${id}`);

    const nowMs = Date.now();
    const reviewDueMs = nextDueAt ? dateToMs(nextDueAt) : null;
    await db.execute(
      `UPDATE patients SET last_reviewed_at = $1, review_due_at = $2, updated_at = $3 WHERE id = $4`,
      [nowMs, reviewDueMs, nowMs, id],
    );

    void auditService.record('patient.review', {
      entityType: 'patient',
      entityId: id,
      detail: nextDueAt
        ? `reviewed; next due ${nextDueAt.toISOString().slice(0, 10)}`
        : 'marked reviewed',
    });

    notifyAttentionChanged();

    return {
      ...rowToPatient(rows[0]),
      lastReviewedAt: new Date(nowMs),
      reviewDueAt: nextDueAt,
      updatedAt: new Date(nowMs),
    };
  }

  async archivePatient(id: string): Promise<void> {
    await ensureWritable();
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
    void auditService.record('patient.archive', { entityType: 'patient', entityId: id });
    notifyAttentionChanged();
  }

  async unarchivePatient(id: string): Promise<Patient> {
    await ensureWritable();
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
    void auditService.record('patient.unarchive', { entityType: 'patient', entityId: id });

    notifyAttentionChanged();

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

  /**
   * Recompute a patient's denormalised photo counters from the photos table
   * in one statement. The old read-modify-write drifted if a crash or
   * interleaved write landed between the SELECT and the UPDATE; a
   * correlated recompute is atomic and self-healing by construction.
   */
  async recountPhotos(id: string): Promise<void> {
    const db = await getDB();
    await db.execute(
      `UPDATE patients
          SET photo_count = (SELECT COUNT(*) FROM photos
                              WHERE patient_id = patients.id AND is_deleted = 0),
              deleted_photo_count = (SELECT COUNT(*) FROM photos
                                      WHERE patient_id = patients.id AND is_deleted = 1),
              last_photo_at = (SELECT MAX(captured_at) FROM photos
                                WHERE patient_id = patients.id AND is_deleted = 0),
              updated_at = $1
        WHERE id = $2`,
      [Date.now(), id],
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
