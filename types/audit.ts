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
  | 'backup.create'
  | 'companion.start'
  | 'companion.stop';

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
  'backup.create': 'Created backup',
  'companion.start': 'Opened phone link session',
  'companion.stop': 'Closed phone link session',
};
