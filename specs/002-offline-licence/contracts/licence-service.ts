/**
 * Licence Service Contract
 *
 * Offline, per-install licence for Camog. A licence key is an Ed25519-signed
 * payload ({practice, tier, seats, issuedAt, expiresAt}) encoded as
 * base64url(payloadJSON).base64url(signature) and verified against the vendor
 * public key embedded in lib/licence/public-key.ts. No server, no network —
 * the commercial model (practice, tier, seats) rides in the signed payload.
 *
 * Lifecycle: first launch starts a 14-day trial (TRIAL_DAYS). With no licence
 * after the trial, or once a stored licence expires, the app enters READ-ONLY
 * mode: existing patients and photos stay viewable, capture and editing are
 * disabled until a valid key is activated.
 *
 * SECURITY NOTE: This deters honest misuse, not determined tampering — the
 * licence key and the SQLite DB both live on the client machine, and there is
 * no trusted clock (same trust model as sessions, which also use Date.now()).
 */

export type LicenceTier = 'solo' | 'practice' | 'clinic';

export interface LicenceInfo {
  practice: string;
  tier: LicenceTier;
  seats: number;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * - 'trial': 14-day first-launch trial running; app is writable.
 * - 'valid': signed licence stored and unexpired; app is writable.
 * - 'read-only': trial over or licence expired; viewing/exporting only.
 */
export interface LicenceStatus {
  state: 'trial' | 'valid' | 'read-only';
  /** Present when a licence key is stored (even an expired one). */
  licence: LicenceInfo | null;
  /** Present while in 'trial' state. */
  trialEndsAt: Date | null;
  /** Stable per-install UUID (support desk + future seat-activation endpoint). */
  installId: string;
}

export interface ILicenceService {
  /**
   * Computes the current licence status from stored settings.
   *
   * @returns Promise resolving to LicenceStatus
   * @throws Error if the DB is unreachable
   *
   * Side effects:
   * - First call on a fresh install stamps `trial_started_at` (starts the
   *   trial) and `install_id` (generated UUID) into the settings row.
   * - Re-verifies the stored licence key's Ed25519 signature every call.
   * - A stored key that fails verification is treated as absent (read-only).
   *
   * Security:
   * - Signature is checked before any payload field is trusted.
   * - Expiry compares payload `expiresAt` against the local clock.
   */
  getStatus(): Promise<LicenceStatus>;

  /**
   * Verifies and stores a licence key.
   *
   * @param key - Licence key string (whitespace tolerated)
   * @returns Promise resolving to the new LicenceStatus
   * @throws LicenceKeyError if the key is malformed or fails signature verification
   * @throws LicenceExpiredError if the key is validly signed but already expired
   *
   * Side effects:
   * - Persists the raw key string to `settings.licence_key`
   *
   * Security:
   * - Requires no session (activation may happen from the banner before login
   *   flows complete); the key's own signature is the authorisation.
   */
  activate(key: string): Promise<LicenceStatus>;

  /**
   * Convenience check: can this install capture/edit?
   * True for 'trial' and 'valid'; false for 'read-only'.
   */
  isWritable(): Promise<boolean>;
}
