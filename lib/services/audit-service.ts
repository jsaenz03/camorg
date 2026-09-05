/**
 * Audit Service (Tauri SQLite)
 *
 * Append-only trail of security-relevant actions: who did what, to which
 * patient/entity, when. Entries are denormalised (clinician_name baked in)
 * so history survives clinician deletion.
 *
 * `record()` deliberately swallows its own errors — a failed audit write
 * must never break the clinical operation it describes. It logs to console
 * instead. (Upgrade path: queue + retry, or a Rust-side write.)
 */

import { v4 as uuidv4 } from 'uuid';
import type { AuditAction, AuditEntry } from '@/types/audit';
import { bodyPartDisplayLabel } from '@/types/body-part';
import type { BodyPart, Laterality } from '@/types/body-part';
import { getDB } from '@/lib/db/database';
import { mapAuditRow, photoAuditLabel, type AuditRow } from '@/lib/utils/audit';

export interface AuditContext {
  entityType?: string;
  entityId?: string;
  patientId?: string;
  detail?: string;
}

export interface AuditListOptions {
  /** Newest-first page size. Default 100. */
  limit?: number;
  /** Filter to one patient's history. */
  patientId?: string;
  /** 'all' (default, admin-only) or 'mine' — the current clinician's own
   *  entries, available to any signed-in user (dashboard activity feed). */
  scope?: 'all' | 'mine';
  /** Inclusive bounds on created_at. Null/omitted = open-ended that side. */
  from?: Date | null;
  to?: Date | null;
}

/** Audit rows joined to the human-readable identities they point at: the
 *  patient behind patient_id, and for photo actions the photos row itself
 *  (works for soft-deleted photos). Read-time JOINs rather than stored names
 *  — patients are archived, never hard-deleted, so the name always resolves.
 *  Redaction of those identities happens in mapAuditRow (lib/utils/audit.ts). */
const AUDIT_SELECT = `a.*, p.name AS patient_name,
    ph.body_part AS photo_body_part, ph.laterality AS photo_laterality,
    ph.captured_at AS photo_captured_at
  FROM audit_log a
  LEFT JOIN patients p ON p.id = a.patient_id
  LEFT JOIN photos ph ON a.entity_type = 'photo' AND ph.id = a.entity_id`;

class AuditService {
  async record(action: AuditAction, ctx: AuditContext = {}): Promise<void> {
    try {
      // Lazy import: auth-service and access-service both sit upstream in the
      // import graph; a static import here would create a load-time cycle.
      const { accessService } = await import('@/lib/services/access-service');
      const clinician = await accessService.getCurrentClinician();

      const db = await getDB();
      await db.execute(
        `INSERT INTO audit_log
           (id, clinician_id, clinician_name, action, entity_type, entity_id, patient_id, detail, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          uuidv4(),
          clinician.id,
          clinician.displayName,
          action,
          ctx.entityType ?? null,
          ctx.entityId ?? null,
          ctx.patientId ?? null,
          ctx.detail ?? null,
          Date.now(),
        ],
      );
    } catch (err) {
      console.error(`[audit] failed to record "${action}":`, err);
    }
  }

  /**
   * Newest-first audit history. 'all' is admin-only; 'mine' is per-user.
   * Patient name and photo label are resolved with read-time JOINs (patients
   * are archived, never deleted; photos soft-deleted) and redacted unless the
   * viewer may see that identity — see mapAuditRow in lib/utils/audit.ts.
   */
  async list(options: AuditListOptions = {}): Promise<AuditEntry[]> {
    const { limit = 100, patientId, scope = 'all', from, to } = options;
    const { accessService } = await import('@/lib/services/access-service');
    // True only where the viewer is admin or has been access-checked for the
    // one patient whose history they asked for.
    let resolveIdentity: boolean;
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (patientId) {
      // Patient-scoped history must stay behind the same access rule as the
      // patient itself: admins see everything, others only patients they can
      // open (inaccessible reads as empty, like the patient/photo services).
      const admin = await accessService.isAdmin().catch(() => false);
      if (!admin && !(await accessService.canAccessPatient(patientId))) {
        return [];
      }
      resolveIdentity = true;
      where.push(`a.patient_id = $${params.length + 1}`);
      params.push(patientId);
    } else if (scope === 'mine') {
      const me = await accessService.getCurrentClinician();
      if (!me) return [];
      resolveIdentity = false;
      where.push(`a.clinician_id = $${params.length + 1}`);
      params.push(me.id);
    } else {
      await accessService.requireAdmin();
      resolveIdentity = true;
    }

    if (from != null) {
      where.push(`a.created_at >= $${params.length + 1}`);
      params.push(from.getTime());
    }
    if (to != null) {
      where.push(`a.created_at <= $${params.length + 1}`);
      params.push(to.getTime());
    }

    const db = await getDB();
    // AUDIT_SELECT carries the FROM + JOINs; only WHERE/ORDER/LIMIT vary.
    const rows = await db.select<AuditRow[]>(
      `SELECT ${AUDIT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.created_at DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    return rows.map((row) =>
      mapAuditRow(
        row,
        resolveIdentity,
        photoAuditLabel(
          row.photo_body_part
            ? bodyPartDisplayLabel(row.photo_body_part as BodyPart, (row.photo_laterality ?? null) as Laterality | null)
            : null,
          row.photo_captured_at,
        ),
      ),
    );
  }
}

// Export singleton instance
export const auditService = new AuditService();
