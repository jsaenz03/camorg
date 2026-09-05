/**
 * Append-only audit trail entries (audit_log table, migration 007).
 * clinicianName is denormalised so history stays readable after deletion.
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'admin.passcode_reset'
  | 'patient.create'
  | 'patient.update'
  | 'patient.archive'
  | 'patient.unarchive'
  | 'patient.consent'
  | 'patient.review'
  | 'photo.create'
  | 'photo.update'
  | 'photo.review'
  | 'photo.delete'
  | 'photo.restore'
  | 'photo.annotate'
  | 'photo.export'
  | 'result_file.add'
  | 'result_file.delete'
  | 'backup.create'
  | 'audit.export'
  | 'companion.start'
  | 'companion.stop'
  | 'companion.new_code';

export interface AuditEntry {
  id: string;
  clinicianId: string;
  clinicianName: string;
  action: AuditAction;
  entityType: string | null;
  entityId: string | null;
  patientId: string | null;
  detail: string | null;
  createdAt: Date;
  /** Resolved from the patients table at read time (JOIN, not stored) —
   *  patients are archived rather than deleted, so the name survives.
   *  Null unless the viewer may see the patient's identity (see
   *  mapAuditRow in lib/utils/audit.ts). */
  patientName: string | null;
  /** For photo actions: "Left arm · 05/09/2026" from the photos table.
   *  Same visibility rule as patientName. */
  photoLabel: string | null;
}

/** Human labels for the settings viewer. */
export const AuditActionLabels: Record<AuditAction, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'admin.passcode_reset': 'Reset a user passcode',
  'patient.create': 'Created patient',
  'patient.update': 'Updated patient',
  'patient.archive': 'Archived patient',
  'patient.unarchive': 'Restored patient',
  'patient.consent': 'Recorded consent',
  'patient.review': 'Scheduled / completed review',
  'photo.create': 'Added photo',
  'photo.update': 'Updated photo',
  'photo.review': 'Marked photo reviewed',
  'photo.delete': 'Deleted photo',
  'photo.restore': 'Restored photo',
  'photo.annotate': 'Annotated photo',
  'photo.export': 'Exported / printed photos',
  'result_file.add': 'Attached a result file',
  'result_file.delete': 'Removed a result file',
  'backup.create': 'Created backup',
  'audit.export': 'Downloaded the audit log',
  'companion.start': 'Opened phone link session',
  'companion.stop': 'Closed phone link session',
  'companion.new_code': 'Generated a new phone link code',
};
