/**
 * Append-only audit trail entries (audit_log table, migration 007).
 * clinicianName is denormalised so history stays readable after deletion.
 */

export type AuditAction =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.signup'
  | 'admin.passcode_reset'
  | 'admin.role_change'
  | 'admin.user_activation'
  | 'admin.user_created'
  | 'admin.invitation_created'
  | 'admin.invitation_revoked'
  | 'admin.settings_change'
  | 'patient.create'
  | 'patient.update'
  | 'patient.rename'
  | 'patient.archive'
  | 'patient.unarchive'
  | 'patient.consent'
  | 'patient.review'
  | 'patient.delete'
  | 'patient.sharing'
  | 'photo.create'
  | 'photo.import'
  | 'photo.update'
  | 'photo.review'
  | 'photo.delete'
  | 'photo.restore'
  | 'photo.annotate'
  | 'photo.export'
  | 'result_file.add'
  | 'result_file.delete'
  | 'backup.create'
  | 'backup.restore_copy'
  | 'backup.restore'
  | 'audit.export'
  | 'storage.photos_dir'
  | 'storage.source_cleanup'
  | 'licence.activation'
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
  /** The patient's name as it was when the event happened — denormalised
   *  into the row at write time (like clinicianName) so a later rename or
   *  hard delete can't rewrite history. Rows written before migration 018
   *  fall back to the read-time JOIN. Null unless the viewer may see the
   *  patient's identity (see mapAuditRow in lib/utils/audit.ts). */
  patientName: string | null;
  /** For photo actions: the body-part label at event time ("Left arm ·
   *  05/09/2026"), stored on the row so later edits or a patient delete
   *  can't rewrite it. Rows from before migration 019 fall back to the
   *  read-time JOIN. Same visibility rule as patientName. */
  photoLabel: string | null;
}

/** Human labels for the settings viewer. */
export const AuditActionLabels: Record<AuditAction, string> = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.signup': 'Registered an account',
  'admin.passcode_reset': 'Reset a user passcode',
  'admin.role_change': 'Changed a user’s role',
  'admin.user_activation': 'Approved / deactivated a user',
  'admin.user_created': 'Created a user account',
  'admin.invitation_created': 'Issued an invitation',
  'admin.invitation_revoked': 'Revoked an invitation',
  'admin.settings_change': 'Changed security settings',
  'patient.create': 'Created patient',
  'patient.update': 'Updated patient',
  'patient.rename': 'Renamed patient',
  'patient.archive': 'Archived patient',
  'patient.unarchive': 'Restored patient',
  'patient.consent': 'Recorded consent',
  'patient.review': 'Scheduled / completed review',
  'patient.delete': 'Deleted patient',
  'patient.sharing': 'Changed patient sharing',
  'photo.create': 'Added photo',
  'photo.import': 'Imported photos from disk',
  'photo.update': 'Updated photo',
  'photo.review': 'Marked photo reviewed',
  'photo.delete': 'Deleted photo',
  'photo.restore': 'Restored photo',
  'photo.annotate': 'Annotated photo',
  'photo.export': 'Exported / printed photos',
  'result_file.add': 'Attached a result file',
  'result_file.delete': 'Removed a result file',
  'backup.create': 'Created backup',
  'backup.restore_copy': 'Prepared a backup restore copy',
  'backup.restore': 'Restored a database backup',
  'audit.export': 'Downloaded the audit log',
  'storage.photos_dir': 'Changed the photo storage location',
  'storage.source_cleanup': 'Deleted copied files from the old photo folder',
  'licence.activation': 'Activated a licence',
  'companion.start': 'Opened phone link session',
  'companion.stop': 'Closed phone link session',
  'companion.new_code': 'Generated a new phone link code',
};
