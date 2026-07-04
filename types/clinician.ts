import { BodyPart } from './body-part';

/**
 * User role. Admin can manage users, invitations, and app settings.
 * Clinician can capture and view photos.
 */
export type ClinicianRole = 'admin' | 'clinician';

/**
 * Represents authenticated user who captures and manages photos.
 *
 * Note: `passcodeHash` is intentionally omitted from this interface — it must
 * never be returned to the UI. The service layer strips it before returning.
 */
export interface Clinician {
  id: string; // UUID v4, primary key
  username: string; // Unique username
  displayName: string; // Full name for display
  role: ClinicianRole;

  // Status
  isActive: boolean;
  mustChangePasscode: boolean;

  // Preferences
  preferences: {
    theme: 'light' | 'dark' | 'system';
    defaultBodyPart: BodyPart | null;
    autoCompressPhotos: boolean;
    showDeletedPhotos: boolean;
  };

  // Timestamps
  createdAt: Date;
  lastLoginAt: Date | null;
  passcodeChangedAt: Date | null;

  // Session (only populated for the currently-authenticated clinician)
  sessionExpiresAt: Date | null;
}

/**
 * Internal row shape — includes the hash. Never leak this to the UI.
 */
export interface ClinicianRow extends Omit<Clinician, 'preferences'> {
  passcodeHash: string;
  preferencesJson: string;
}
