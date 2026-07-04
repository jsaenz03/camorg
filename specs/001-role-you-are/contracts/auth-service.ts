/**
 * Auth Service Contract
 *
 * Defines the interface for authentication and session management.
 * v1 implementation uses simple PIN/passcode stored in localStorage.
 *
 * SECURITY NOTE: This is NOT production-grade authentication. It's sufficient
 * for v1 single-user deployments but should NOT be used for multi-user or
 * HIPAA-compliant scenarios.
 */

import { Clinician } from '@/types/clinician';
import type { ClinicianRegister, ClinicianLogin } from '@/lib/validators/schemas';

export interface SessionInfo {
  clinicianId: string;
  username: string;
  displayName: string;
  loginAt: Date;
  expiresAt: Date;
}

export interface IAuthService {
  /**
   * Registers a new clinician (first-time setup)
   *
   * @param data - Registration data (validated via Zod schema)
   * @returns Promise resolving to created Clinician (passcodeHash excluded)
   * @throws ValidationError if data fails schema validation
   * @throws AlreadyExistsError if username already taken
   * @throws Error if IndexedDB transaction fails
   *
   * Side effects:
   * - Hashes passcode using SHA-256 (Web Crypto API)
   * - Stores clinician in IndexedDB 'clinicians' store
   * - Sets default preferences (theme: 'system', autoCompressPhotos: true)
   * - Creates active session (auto-login after registration)
   *
   * Security:
   * - Passcode must be 6+ characters with letters and numbers
   * - Passcode is hashed before storage (never stored in plaintext)
   */
  register(data: ClinicianRegister): Promise<Clinician>;

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
   * - Sets Clinician.sessionExpiresAt to now + 30 minutes
   * - Stores session token in sessionStorage
   *
   * Security:
   * - Compares SHA-256 hash of input passcode with stored hash
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
   * - Updates Clinician.passcodeHash with new hash
   * - Clears all other sessions (if multi-device in future)
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
