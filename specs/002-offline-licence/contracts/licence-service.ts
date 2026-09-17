/**
 * Licence Service Contract
 *
 * Offline, per-install licence for Camog. A licence key is an Ed25519-signed
 * payload ({practice, tier, seats, issuedAt, expiresAt}) encoded as
 * base64url(payloadJSON).base64url(signature) and verified against the vendor
 * public key embedded in lib/licence/public-key.ts. Seats are enforced by the
 * activation server at activation time (specs/003-licence-activation); every
 * other check stays on-device.
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
  /**
   * Device identity the seat is bound to (specs/003-licence-activation) —
   * read from the home-directory device file, falling back to the per-install
   * UUID. Surfaced in Settings → Licence as "Device ID" (support desk).
   */
  installId: string;
  /**
   * Auto-renew (specs/005-licence-auto-renew): when on, the daily seat
   * re-check silently installs a paid successor key — the licence extends
   * itself after each successful subscription payment. Settings toggle,
   * default on.
   */
  autoRenew: boolean;
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
   * - Re-verifies the stored activation token against the activation
   *   server's public key every call; 'valid' additionally requires a token
   *   matching this device (specs/003-licence-activation).
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
   * @throws ActivationNetworkError if the activation server is unreachable
   *   (the app's one outbound call — needs internet once)
   * @throws LicenceSeatLimitError if every device seat on the licence is in use
   *
   * Side effects:
   * - Round-trips the key + device ID through the activation server, then
   *   persists the raw key to `settings.licence_key` and the server-signed
   *   token to `settings.licence_token` (only after the token verifies
   *   against the embedded activation public key and names this device)
   *
   * Security:
   * - Requires no session (activation may happen from the banner before login
   *   flows complete); the key's own signature is the authorisation.
   * - The server's response is never trusted: the token is verified locally
   *   against lib/licence/activation-public-key.ts before anything persists.
   */
  activate(key: string): Promise<LicenceStatus>;

  /**
   * Seat re-check against the licence server (specs/003 revocation
   * propagation). Called on app open; internally debounced to at most one
   * server call per day and only when a licence key + activation token are
   * stored.
   *
   * @returns Promise resolving to true when the install's state may have
   *   changed (a definitive revocation was applied, or auto-renew installed
   *   a paid successor key) and the caller should re-read getStatus()
   *
   * Side effects:
   * - A definitive server verdict "revoked"/"not activated" clears the
   *   stored activation token (the next getStatus() lands read-only;
   *   re-activating the same key restores the seat — the support seat-move
   *   flow) and stamps `licence_validated_at`.
   * - Any other answer (valid, expired, unreachable, malformed) at most
   *   stamps `licence_validated_at` — it never changes licence state.
   *
   * Security:
   * - Fail-open by design: an unreachable licence server must not degrade
   *   an offline clinic; only the server's explicit verdict bites.
   */
  validateWithServer(): Promise<boolean>;

  /**
   * Auto-renew toggle (specs/005-licence-auto-renew). Persists the choice
   * in the settings row and records it in the audit trail. Works in every
   * licence state (activation itself also runs while read-only).
   *
   * @param on - true: the daily seat re-check auto-installs paid successor
   *   keys; false: renewal keys are only delivered by email and must be
   *   activated manually.
   */
  setAutoRenew(on: boolean): Promise<void>;

  /**
   * Convenience check: can this install capture/edit?
   * True for 'trial' and 'valid'; false for 'read-only'.
   */
  isWritable(): Promise<boolean>;
}
