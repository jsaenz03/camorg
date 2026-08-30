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
import { getDB } from '@/lib/db/database';

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
}

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

  /** Newest-first audit history. 'all' is admin-only; 'mine' is per-user. */
  async list(options: AuditListOptions = {}): Promise<AuditEntry[]> {
    const { limit = 100, patientId, scope = 'all' } = options;
    const { accessService } = await import('@/lib/services/access-service');
    if (scope === 'all') {
      await accessService.requireAdmin();
    }

    const db = await getDB();
    let rows: Record<string, unknown>[];
    if (patientId) {
      // Patient-scoped history must stay behind the same access rule as the
      // patient itself: admins see everything, others only patients they can
      // open (inaccessible reads as empty, like the patient/photo services).
      const admin = await accessService.isAdmin().catch(() => false);
      if (!admin && !(await accessService.canAccessPatient(patientId))) {
        return [];
      }
      rows = await db.select<Record<string, unknown>[]>(
        `SELECT * FROM audit_log WHERE patient_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [patientId, limit],
      );
    } else if (scope === 'mine') {
      const me = await accessService.getCurrentClinician();
      if (!me) return [];
      rows = await db.select<Record<string, unknown>[]>(
        `SELECT * FROM audit_log WHERE clinician_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [me.id, limit],
      );
    } else {
      rows = await db.select<Record<string, unknown>[]>(
        `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1`,
        [limit],
      );
    }

    return rows.map((row) => ({
      id: row.id as string,
      clinicianId: row.clinician_id as string,
      clinicianName: row.clinician_name as string,
      action: row.action as AuditAction,
      entityType: (row.entity_type as string | null) ?? null,
      entityId: (row.entity_id as string | null) ?? null,
      patientId: (row.patient_id as string | null) ?? null,
      detail: (row.detail as string | null) ?? null,
      createdAt: new Date(row.created_at as number),
    }));
  }
}

// Export singleton instance
export const auditService = new AuditService();
