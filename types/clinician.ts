import { BodyPart } from './body-part';

/**
 * Represents authenticated user who captures and manages photos
 */
export interface Clinician {
  id: string; // UUID v4, primary key
  username: string; // Unique username or email
  passcodeHash: string; // SHA-256 hash of passcode (v1 simple auth)
  displayName: string; // Full name for display

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

  // Session
  sessionExpiresAt: Date | null; // Auto-logout timestamp
}
