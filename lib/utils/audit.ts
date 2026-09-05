/**
 * Audit row → entry mapping and the non-admin redaction rule.
 *
 * Kept free of enum-using imports (and of the app's runtime graph) so
 * scripts/self-check-audit-redact.mjs can import it straight from Node and
 * pin the redaction rule — same pattern as lib/utils/photo-review.ts.
 */

import { addDays, endOfDay, format, startOfDay } from 'date-fns';
// AuditActionLabels is a dependency-free data table and types/audit has no
// imports, so the relative .ts import keeps this module Node-importable for
// scripts/self-check-audit-redact.mjs.
import { AuditActionLabels } from '../../types/audit.ts';
import type { AuditAction, AuditEntry } from '@/types/audit';

/** One audit_log row plus the read-time JOIN columns audit-service selects.
 *  The photo columns are raw DB strings; rendering them into photo_label
 *  (enum-based label lookup) stays in audit-service, this module only
 *  formats/redacts. */
export interface AuditRow {
  id: string;
  clinician_id: string;
  clinician_name: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  patient_id: string | null;
  detail: string | null;
  created_at: number;
  patient_name?: string | null;
  photo_body_part?: string | null;
  photo_laterality?: string | null;
  photo_captured_at?: number | null;
}

/**
 * Photo descriptor for an audit row: "Left arm · 05/09/2026" (AU date), or
 * null when there is no photo body part (non-photo action, or an unmatched
 * JOIN — e.g. the photo row is gone).
 */
export function photoAuditLabel(
  bodyPartLabel: string | null | undefined,
  capturedAtMs: number | null | undefined,
): string | null {
  if (!bodyPartLabel) return null;
  return capturedAtMs ? `${bodyPartLabel} · ${format(capturedAtMs, 'dd/MM/yyyy')}` : bodyPartLabel;
}

/**
 * Identity redaction rule: patient name and photo label reach the caller only
 * when the viewer may see that patient's identity — admins everywhere, and
 * clinicians on a patient whose history they have already been access-checked
 * for (the patientId-scoped query). The dashboard 'mine' feed passes false, so
 * a clinician never receives patient identities through the audit API. Their
 * own entries' free-text detail is unchanged — pre-existing behaviour, and the
 * feed renders only what this function returns.
 */
export function mapAuditRow(row: AuditRow, resolveIdentity: boolean, photoLabel?: string | null): AuditEntry {
  return {
    id: row.id,
    clinicianId: row.clinician_id,
    clinicianName: row.clinician_name,
    action: row.action as AuditAction,
    entityType: row.entity_type,
    entityId: row.entity_id,
    patientId: row.patient_id,
    detail: row.detail,
    createdAt: new Date(row.created_at),
    patientName: resolveIdentity ? (row.patient_name ?? null) : null,
    photoLabel: resolveIdentity ? (photoLabel ?? null) : null,
  };
}

/**
 * Default window for the audit viewer: the last 30 days including today.
 * `from` is local midnight 29 days back, `to` the end of today — both
 * inclusive in the query (`created_at >= from AND created_at <= to`).
 */
export function defaultAuditRange(now: Date = new Date()): { from: Date; to: Date } {
  return { from: startOfDay(addDays(now, -29)), to: endOfDay(now) };
}

/**
 * 'yyyy-MM-dd' (what <input type="date"> yields) → local-midnight Date.
 * `new Date(value)` would parse it as UTC midnight and shift the day in
 * timezones behind UTC — same trap dobFromMs guards elsewhere.
 */
export function parseYmd(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Quote a field for CSV only when needed (RFC 4180). */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Render audit entries as a CSV report (Excel-friendly: UTF-8 BOM, CRLF
 * rows, AU date format matching the on-screen table). Null cells export
 * as empty — redacted or unresolved identities just stay blank.
 */
export function toAuditCsv(entries: AuditEntry[]): string {
  const row = (cells: string[]) => cells.map(csvField).join(',');
  const lines = entries.map((e) =>
    row([
      format(e.createdAt, 'dd/MM/yyyy HH:mm'),
      e.clinicianName,
      AuditActionLabels[e.action] ?? e.action,
      e.patientName ?? '',
      e.photoLabel ?? '',
      e.detail ?? '',
    ]),
  );
  const header = row(['When', 'Who', 'Action', 'Patient', 'Photo', 'Detail']);
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}
