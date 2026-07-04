import type { ClinicianRole } from './clinician';

/**
 * Admin-issued invitation. Covers both invite-token and admin-precreated flows.
 *
 * `token` kind: admin hands the user an 8-char code; the user completes signup.
 * `precreated` kind: admin sets a temp passcode; the user logs in then changes it.
 */
export type InvitationKind = 'token' | 'precreated';

export interface Invitation {
  id: string;
  token: string; // 8-char human code; only returned to admin at creation time
  kind: InvitationKind;
  username: string;
  displayName: string;
  role: ClinicianRole;
  mustChangePasscode: boolean;
  invitedBy: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  acceptedBy: string | null;
}

export interface AppSettings {
  sessionTimeoutMs: number;
  allowPublicSignup: boolean;
  orgName: string;
  updatedAt: Date;
}
