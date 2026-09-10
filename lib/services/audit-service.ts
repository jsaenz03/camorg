/**
 * Audit Service (Tauri SQLite)
 *
 * Append-only trail of security-relevant actions: who did what, to which
 * patient/entity, when. Entries are denormalised — clinician_name,
 * patient_name, and photo_label are baked in at write time — so history
 * survives clinician deletion, patient renames, and patient hard-deletes.
 *
 * `record()` deliberately swallows its own errors — a failed audit write
 * must never break the clinical operation it describes. It logs to console
 * instead. (Upgrade path: queue + retry, or a Rust-side write.)
 *
 * ponytail: the trail is append-only by convention, not tamper-evident —
 * the log lives in the same local SQLite file as everything else, so anyone
 * able to rewrite one row can rewrite or delete them all, which no in-file
 * hash chain could detect. Accepted risk for a single-machine install; the
 * mitigations are OS-level (disk encryption, backups, the audit CSV the
 * admin downloads after significant activity).
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
  /** The patient's name at event time. When omitted but patientId is set,
   *  it is looked up from the patients table — pass it explicitly when the
   *  row is about to disappear (patient.delete) or was just renamed. */
  patientName?: string;
  /** Attribution override for events with no signed-in actor (pre-auth
   *  account registration). Defaults to the current session's clinician;
   *  with neither, the entry is stored with an empty "who" (rendered as
   *  Unknown by the viewer). */
  clinicianId?: string;
  clinicianName?: string;
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
 *  (works for soft-deleted photos). The stored patient_name (baked in at
 *  write time, migration 018) wins over the JOIN so later renames or a hard
 *  delete can't rewrite history. Redaction of those identities happens in
 *  mapAuditRow (lib/utils/audit.ts). */
const AUDIT_SELECT = `a.*, COALESCE(a.patient_name, p.name) AS patient_name,
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
      // Pre-auth events (account registration) have no session; resolution
      // failing leaves an unattributed entry rather than dropping the event.
      const clinician = await accessService.getCurrentClinician().catch(() => null);

      const db = await getDB();

      // Denormalise the patient's name at event time (like clinician_name).
      // Callers pass it explicitly when the patients row is going away or has
      // just changed; otherwise one indexed lookup resolves it. A failed
      // lookup leaves the name unset rather than breaking the audit write.
      let patientName = ctx.patientName ?? null;
      if (patientName == null && ctx.patientId) {
        const rows = await db.select<{ name: string }[]>(
          'SELECT name FROM patients WHERE id = $1',
          [ctx.patientId],
        );
        patientName = rows[0]?.name ?? null;
      }

      // Photo actions snapshot the display label ("Left arm · 05/09/2026")
      // so later body-part edits, or a patient delete removing the photo
      // rows, can't blank or rewrite what the entry showed.
      let photoLabel: string | null = null;
      if (ctx.entityType === 'photo' && ctx.entityId) {
        const rows = await db.select<{
          body_part: string | null;
          laterality: string | null;
          captured_at: number;
        }[]>('SELECT body_part, laterality, captured_at FROM photos WHERE id = $1', [
          ctx.entityId,
        ]);
        if (rows[0]) {
          photoLabel = photoAuditLabel(
            bodyPartDisplayLabel(
              rows[0].body_part as BodyPart | null,
              (rows[0].laterality ?? null) as Laterality | null,
            ),
            rows[0].captured_at,
          );
        }
      }

      await db.execute(
        `INSERT INTO audit_log
           (id, clinician_id, clinician_name, action, entity_type, entity_id, patient_id, patient_name, photo_label, detail, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          uuidv4(),
          ctx.clinicianId ?? clinician?.id ?? '',
          ctx.clinicianName ?? clinician?.displayName ?? '',
          action,
          ctx.entityType ?? null,
          ctx.entityId ?? null,
          ctx.patientId ?? null,
          patientName,
          photoLabel,
          ctx.detail ?? null,
          Date.now(),
        ],
      );
    } catch (err) {
      // Invoke rejections can be bare strings, occasionally empty — render
      // whatever arrives so a failed audit write stays diagnosable.
      console.error(
        `[audit] failed to record "${action}":`,
        err instanceof Error ? err.message : (JSON.stringify(err) ?? String(err)),
      );
    }
  }

  /**
   * Newest-first audit history. 'all' is admin-only; 'mine' is per-user.
   * Patient name and photo label come from the row itself (stored at write
   * time; patients can be hard-deleted and photos edited) with the read-time
   * JOINs only as fallback for pre-migration rows, and are redacted unless
   * the viewer may see that identity — see mapAuditRow in lib/utils/audit.ts.
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
        // The label snapshot baked in at write time wins; the JOIN-computed
        // label is only the fallback for rows that predate migration 019
        // (and have a photo row still to join).
        row.photo_label ??
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
