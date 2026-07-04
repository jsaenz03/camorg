/**
 * Auth Service Contract
 *
 * Defines the interface for authentication, session management, user/role
 * administration, and invitations. Backed by SQLite via Tauri.
 *
 * Passcodes are hashed with PBKDF2-SHA256 (per-user salt, 210k iters).
 * Sessions are client-side only (sessionStorage) — sufficient for the Tauri
 * desktop deployment model.
 *
 * SECURITY NOTE: This is local-device auth, not network auth. The DB file is
 * not encrypted at rest; for HIPAA-grade deployments, add encryption and
 * audit logging.
 */

import { Clinician } from '@/types/clinician';
import { Invitation, AppSettings } from '@/types/invitation';
import type {
  ClinicianRegister,
  ClinicianLogin,
  InvitationCreate,
  InvitationAccept,
  SettingsUpdate,
} from '@/lib/validators/schemas';

export interface SessionInfo {
  clinicianId: string;
  username: string;
  displayName: string;
  role: Clinician['role'];
  loginAt: Date;
  expiresAt: Date;
}

export interface IAuthService {
  /**
   * Registers a new clinician.
   *
   * Public signup requires `settings.allow_public_signup === true`. Otherwise
   * an `inviteToken` MUST be supplied and validated against the invitations table.
   *
   * @param data - Registration data (validated via Zod schema)
   * @returns Promise resolving to created Clinician (passcodeHash excluded)
   * @throws ValidationError if data fails schema validation
   * @throws AlreadyExistsError if username already taken
   * @throws PermissionDeniedError if public signup is disabled and no valid token
   *
   * Side effects:
   * - Hashes passcode using PBKDF2-SHA256 (Web Crypto API)
   * - Stores clinician in the `clinicians` table
   * - Sets default preferences (theme: 'system', autoCompressPhotos: true)
   * - Marks the invitation accepted (if a token was supplied)
   * - Creates active session (auto-login after registration)
   *
   * Security:
   * - Passcode must be 8+ characters with letters and numbers
   * - Passcode is hashed before storage (never stored in plaintext)
   */
  register(data: ClinicianRegister, inviteToken?: string): Promise<Clinician>;

  /**
   * Authenticates a clinician and creates session
   *
   * @param data - Login credentials (validated via Zod schema)
   * @returns Promise resolving to session info
   * @throws ValidationError if data fails schema validation
   * @throws InvalidCredentialsError if username or passcode incorrect
   * @throws Error if IndexedDB query fails
   *
   * Side effects:
   * - Updates Clinician.lastLoginAt
   * - Sets Clinician.sessionExpiresAt to now + `settings.session_timeout_ms`
   * - Stores session token in sessionStorage
   *
   * Security:
   * - Compares PBKDF2 hash of input passcode with stored hash (constant-time)
   * - Refuses login if `is_active = 0`
   * - Generic error message for failed login (don't leak whether username exists)
   */
  login(data: ClinicianLogin): Promise<SessionInfo>;

  /**
   * Ends current session
   *
   * @returns Promise resolving to void
   *
   * Side effects:
   * - Clears session token from sessionStorage
   * - Sets Clinician.sessionExpiresAt to null
   */
  logout(): Promise<void>;

  /**
   * Gets current session info
   *
   * @returns Promise resolving to SessionInfo or null if not authenticated
   * @throws SessionExpiredError if session expired (auto-logout)
   *
   * Side effects:
   * - If session expired: calls logout() automatically
   *
   * Note: Should be called on app mount and on route changes (auth guard)
   */
  getCurrentSession(): Promise<SessionInfo | null>;

  /**
   * Checks if user is authenticated
   *
   * @returns Promise resolving to boolean
   *
   * Note: Convenience wrapper around getCurrentSession()
   */
  isAuthenticated(): Promise<boolean>;

  /**
   * Refreshes session expiry (extends by 30 minutes from now)
   *
   * @returns Promise resolving to new expiry timestamp
   * @throws NotAuthenticatedError if no active session
   *
   * Side effects:
   * - Updates Clinician.sessionExpiresAt to now + 30 minutes
   *
   * Note: Should be called on user activity (click, keypress, etc.) to prevent auto-logout
   */
  refreshSession(): Promise<Date>;

  /**
   * Changes clinician's passcode
   *
   * @param currentPasscode - Current passcode for verification
   * @param newPasscode - New passcode (validated via Zod schema)
   * @returns Promise resolving to void
   * @throws InvalidCredentialsError if current passcode incorrect
   * @throws ValidationError if new passcode fails validation
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Updates Clinician.passcodeHash with new PBKDF2 hash
   * - Clears the `must_change_passcode` flag
   * - Sets `passcode_changed_at`
   */
  changePasscode(currentPasscode: string, newPasscode: string): Promise<void>;

  /**
   * Resets app to factory state (DESTRUCTIVE)
   *
   * @param confirmationPhrase - User must type "DELETE ALL DATA" to confirm
   * @returns Promise resolving to void
   * @throws ConfirmationError if phrase doesn't match
   *
   * Side effects:
   * - Deletes ALL IndexedDB data (photos, patients, clinicians, subparts)
   * - Clears localStorage and sessionStorage
   * - Logs out current session
   * - Redirects to registration page
   *
   * Use case: "Forgot passcode" flow (no recovery mechanism in v1)
   * WARNING: This is permanent and cannot be undone
   */
  resetApp(confirmationPhrase: string): Promise<void>;

  /**
   * Gets authenticated clinician profile
   *
   * @returns Promise resolving to Clinician (passcodeHash excluded)
   * @throws NotAuthenticatedError if no active session
   * @throws Error if IndexedDB query fails
   */
  getCurrentClinician(): Promise<Clinician>;

  /**
   * Updates clinician preferences
   *
   * @param preferences - Partial preferences object to update
   * @returns Promise resolving to updated Clinician
   * @throws NotAuthenticatedError if no active session
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Merges preferences with existing preferences
   * - Updates Clinician.updatedAt
   */
  updatePreferences(preferences: Partial<Clinician['preferences']>): Promise<Clinician>;

  // ----- User & invitation administration (admin only) -----

  /**
   * Lists all clinicians. Admin only.
   * @throws NotAuthenticatedError / PermissionDeniedError
   */
  listUsers(): Promise<Clinician[]>;

  /** Activate or deactivate a clinician. Admin only. */
  setUserActive(id: string, active: boolean): Promise<Clinician>;

  /** Change a clinician's role. Admin only. */
  setUserRole(id: string, role: Clinician['role']): Promise<Clinician>;

  /**
   * Create an invitation. Admin only.
   * - `kind: 'token'` returns an Invitation with a one-time code the user
   *   enters at /signup.
   * - `kind: 'precreated'` requires `tempPasscode`; the user logs in with it
   *   and is then forced to change it.
   * @throws AlreadyExistsError if username is taken or has a pending invite
   */
  createInvitation(input: InvitationCreate): Promise<Invitation>;

  /** Validate an invite token without consuming it (used by the signup screen). */
  resolveInvitation(token: string): Promise<Invitation>;

  /**
   * Consume an invitation and create the resulting clinician. Used by signup
   * for `token`-kind invites. Auto-logs in.
   */
  acceptInvitation(input: InvitationAccept): Promise<Clinician>;

  /** Revoke a pending invitation. Admin only. */
  revokeInvitation(id: string): Promise<void>;

  /** List pending/accepted invitations. Admin only. */
  listInvitations(): Promise<Invitation[]>;

  // ----- App settings (admin only) -----

  getSettings(): Promise<AppSettings>;
  updateSettings(patch: SettingsUpdate): Promise<AppSettings>;

  // ----- Dev / bootstrapping -----

  /** Count of registered clinicians (used to decide whether seeding is allowed). */
  countUsers(): Promise<number>;

  /**
   * Idempotent dev seed. Only runs when zero clinicians exist. Creates an
   * `admin` / `devpass123` account with `must_change_passcode = true`.
   * Throws if users already exist.
   */
  seedDevAdmin(): Promise<void>;
}

/**
 * Error Types
 */

export class InvalidCredentialsError extends Error {
  constructor(message: string = 'Invalid username or passcode') {
    super(message);
    this.name = 'InvalidCredentialsError';
  }
}

export class AlreadyExistsError extends Error {
  constructor(message: string = 'Username already exists') {
    super(message);
    this.name = 'AlreadyExistsError';
  }
}

export class SessionExpiredError extends Error {
  constructor(message: string = 'Session expired. Please log in again.') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class NotAuthenticatedError extends Error {
  constructor(message: string = 'Not authenticated. Please log in.') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

export class ConfirmationError extends Error {
  constructor(message: string = 'Confirmation phrase does not match') {
    super(message);
    this.name = 'ConfirmationError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
