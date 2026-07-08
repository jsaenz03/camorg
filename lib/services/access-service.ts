/**
 * Access Service — single source of truth for patient visibility.
 *
 * Visibility rule: a clinician D can see a patient P if ANY is true
 *   - D is an admin
 *   - D owns P            (patients.owner_clinician_id = D.id)
 *   - P is org-shared      (patients.is_org_shared = 1)
 *   - D has a grant        (patient_shares row (patient_id=P, clinician_id=D))
 *
 * Photos inherit their parent patient's visibility — there are no per-photo
 * grants. This service centralises the SQL fragment + the boolean check so
 * every read path (patientService, photoService) and every write guard flows
 * through one place.
 */

import type { Clinician } from '@/types/clinician';
import { authService } from '@/lib/services/auth-service';
import { getDB } from '@/lib/db/database';
import { NotAuthenticatedError, PermissionDeniedError } from '@/lib/validators/errors';

export interface AccessFilter {
  /** SQL fragment to AND into a patients query. Placeholders are numbered
   * starting at `startBind`. Empty string for admins (no restriction). */
  sql: string;
  /** Bind values for the fragment's placeholders, in order. */
  binds: unknown[];
  /** The 1-based index the first placeholder was emitted at. Callers that
   * append more placeholders after the filter must continue from here. */
  startBind: number;
}

class AccessService {
  /**
   * Returns the current clinician or throws NotAuthenticatedError.
   * Cached per-call only; callers should not hold the reference across
   * session changes.
   */
  async getCurrentClinician(): Promise<Clinician> {
    const c = await authService.getCurrentClinician();
    if (!c) throw new NotAuthenticatedError();
    return c;
  }

  /** True if the current clinician is an admin. */
  async isAdmin(): Promise<boolean> {
    const c = await this.getCurrentClinician().catch(() => null);
    return c?.role === 'admin';
  }

  /** Throws unless the current clinician is an admin. */
  async requireAdmin(): Promise<Clinician> {
    const c = await this.getCurrentClinician();
    if (c.role !== 'admin') throw new PermissionDeniedError('Admin access required');
    return c;
  }

  /**
   * Builds the SQL fragment that restricts a `patients` query to what the
   * current clinician can see. Admins get an empty fragment (no restriction).
   *
   * `startBind` lets the caller shift the placeholder numbering when the
   * query already uses earlier placeholders (e.g. a search term at $1).
   *
   * Use it like:
   *   const f = await accessService.getAccessiblePatientFilter(2); // start at $2
   *   `SELECT * FROM patients p WHERE normalized_name LIKE $1 ${f.sql}`
   */
  async getAccessiblePatientFilter(startBind: number = 1): Promise<AccessFilter> {
    const c = await this.getCurrentClinician();
    if (c.role === 'admin') return { sql: '', binds: [], startBind };

    // Non-admin: owner OR org-shared OR explicit grant.
    // Uses a correlated EXISTS for the grant so only one bind is needed.
    const n = startBind;
    return {
      sql: `AND (
        p.owner_clinician_id = $${n}
        OR p.is_org_shared = 1
        OR EXISTS (SELECT 1 FROM patient_shares ps WHERE ps.patient_id = p.id AND ps.clinician_id = $${n})
      )`,
      binds: [c.id],
      startBind,
    };
  }

  /**
   * Boolean visibility check for a single patient. Used by write guards and
   * defense-in-depth reads (e.g. exportPhotoAsDataUrl) where composing SQL is
   * awkward.
   */
  async canAccessPatient(patientId: string): Promise<boolean> {
    const c = await this.getCurrentClinician().catch(() => null);
    if (!c) return false;
    if (c.role === 'admin') return true;

    const db = await getDB();
    const rows = await db.select<{ v: number }[]>(
      `SELECT 1 AS v FROM patients p
        WHERE p.id = $1
          AND (
            p.owner_clinician_id = $2
            OR p.is_org_shared = 1
            OR EXISTS (SELECT 1 FROM patient_shares ps WHERE ps.patient_id = p.id AND ps.clinician_id = $2)
          )`,
      [patientId, c.id],
    );
    return rows.length > 0;
  }

  /**
   * Throws PermissionDeniedError unless the current clinician can manage the
   * patient (capture into it, edit, delete, manage shares). Management is
   * restricted to admins and the owner — viewing via a grant does NOT grant
   * write. (The spec is conservative here; revisit if shared editors are needed.)
   */
  async assertCanManagePatient(patientId: string): Promise<void> {
    const c = await this.getCurrentClinician();
    if (c.role === 'admin') return;

    const db = await getDB();
    const rows = await db.select<{ v: number }[]>(
      `SELECT 1 AS v FROM patients WHERE id = $1 AND owner_clinician_id = $2`,
      [patientId, c.id],
    );
    if (rows.length === 0) {
      throw new PermissionDeniedError(
        "You don't have access to that patient's record.",
      );
    }
  }
}

export const accessService = new AccessService();
