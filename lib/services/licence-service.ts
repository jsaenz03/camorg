/**
 * Licence service — backs the ILicenceService contract.
 *
 * State lives in the settings singleton row (migrations 008 + 020): the raw
 * licence key string, its server-signed activation token, the first-launch
 * trial stamp, and the install ID. Reads are raw SQL (like
 * getPhotosDirOverride) because activation happens outside the admin-session
 * gate that authService.getSettings() enforces.
 *
 * Seat enforcement (specs/003-licence-activation): a licence only counts as
 * valid when the activation token returned by the licence server verifies
 * against the server's public key AND matches this device's ID. The device
 * ID is read from the home-directory device file via the `device_id` Rust
 * command (falling back to the DB value when unavailable), so copying the
 * app data folder to another machine does not carry the seat.
 */

import { format } from 'date-fns';
import { invoke } from '@tauri-apps/api/core';
import { getDB } from '@/lib/db/database';
import { licenceFingerprint, verifyActivationToken, verifyLicenceKey } from '@/lib/licence/verify';
import {
  ActivationNetworkError,
  LicenceExpiredError,
  LicenceKeyError,
  LicenceSeatLimitError,
} from '@/lib/validators/errors';
import { auditService } from '@/lib/services/audit-service';
import { recordDiagnostic } from '@/lib/diagnostics';
import type {
  ILicenceService,
  LicenceInfo,
  LicenceStatus,
} from '@/specs/002-offline-licence/contracts/licence-service';

const TRIAL_DAYS = 14;
const MS_PER_DAY = 86_400_000;

const NETWORK_MESSAGE =
  'Could not reach the licence server. Activating a licence needs a one-time internet connection — check the network and try again.';

interface LicenceSettingsRow {
  licence_key: string | null;
  licence_token: string | null;
  trial_started_at: number | null;
  install_id: string | null;
}

/**
 * The device ID the activation token must name. Rust reads (or creates) it
 * from the home-directory device file, seeding from the DB's install ID so
 * pre-activation installs keep their identity; a non-Tauri context (browser
 * preview) falls back to the DB value.
 */
async function resolveDeviceId(seed: string): Promise<string> {
  try {
    return await invoke<string>('device_id', { seed });
  } catch {
    return seed || crypto.randomUUID();
  }
}

/**
 * Maps the Rust command's prefixed error strings (network: | invalid: |
 * expired: | seat-limit: | server:) onto typed errors with user-facing text.
 */
function activationError(err: unknown): Error {
  const message = typeof err === 'string' ? err : err instanceof Error ? err.message : '';
  const separator = message.indexOf(':');
  if (separator < 0) return new ActivationNetworkError();
  const prefix = message.slice(0, separator);
  const text = message.slice(separator + 1);
  switch (prefix) {
    case 'seat-limit':
      return new LicenceSeatLimitError(text);
    case 'invalid':
      return new LicenceKeyError(text);
    case 'expired':
      return new LicenceExpiredError(text);
    case 'server':
      return new Error(text || 'Activation server error. Try again shortly.');
    default:
      return new ActivationNetworkError(text || NETWORK_MESSAGE);
  }
}

export class LicenceService implements ILicenceService {
  // ponytail: trusts the local clock (Date.now(), like sessions) and
  // deters honest users only — the key, token and DB are machine-local.
  // Seat counting itself lives server-side (the point of spec 003).
  async getStatus(): Promise<LicenceStatus> {
    const db = await getDB();
    const rows = await db.select<LicenceSettingsRow[]>(
      "SELECT licence_key, licence_token, trial_started_at, install_id FROM settings WHERE id = 'app'"
    );
    const row = rows[0];
    if (!row) throw new Error('Settings row missing (migration 002 seeds it)');

    // Lazy one-time stamps: start the trial and assign the install ID.
    let trialStartedAt = row.trial_started_at;
    let installId = row.install_id;
    const patch: string[] = [];
    const values: unknown[] = [];
    if (!trialStartedAt) {
      trialStartedAt = Date.now();
      patch.push('trial_started_at = $1');
      values.push(trialStartedAt);
    }
    if (!installId) {
      installId = crypto.randomUUID();
      patch.push('install_id = $2');
      values.push(installId);
    }
    if (patch.length > 0) {
      await db.execute(`UPDATE settings SET ${patch.join(', ')} WHERE id = 'app'`, values);
    }
    const deviceId = await resolveDeviceId(installId);

    // Re-verify on every read; a stored key that no longer verifies (edited
    // DB row, key rotation) is treated as no licence at all.
    let licence: LicenceInfo | null = null;
    if (row.licence_key) {
      try {
        licence = await verifyLicenceKey(row.licence_key);
      } catch {
        licence = null;
      }
    }

    // The seat check: an unexpired key is only writable when the stored
    // activation token was signed by our server for THIS key on THIS device
    // and has not lapsed. A key without a valid token (licence servers
    // didn't exist before spec 003, or the DB row was copied from another
    // machine) drops through to the trial/read-only states — re-activating
    // the same key online fixes it.
    let activated = false;
    if (licence && row.licence_key && row.licence_token) {
      try {
        const token = await verifyActivationToken(row.licence_token);
        activated =
          token.deviceId === deviceId &&
          token.fp === (await licenceFingerprint(row.licence_key)) &&
          token.exp > Date.now();
      } catch {
        activated = false;
      }
    }

    const now = Date.now();
    if (licence && licence.expiresAt.getTime() > now && activated) {
      return { state: 'valid', licence, trialEndsAt: null, installId: deviceId };
    }
    const trialEndsAtMs = trialStartedAt + TRIAL_DAYS * MS_PER_DAY;
    if (!licence && now < trialEndsAtMs) {
      return { state: 'trial', licence: null, trialEndsAt: new Date(trialEndsAtMs), installId: deviceId };
    }
    return { state: 'read-only', licence, trialEndsAt: null, installId: deviceId };
  }

  async activate(key: string): Promise<LicenceStatus> {
    // Normalise before verifying: keys travel by email and web text fields,
    // where smart punctuation rewrites '-' as en/em dashes and quotes as
    // curly forms. Only whitespace was stripped before; a stray en-dash
    // silently broke every activation ("not valid base64").
    const normalized = key
      .replace(/\s+/g, '')
      .replace(/[–—―−]/g, '-')
      .replace(/[‘’‛`]/g, '')
      .replace(/[“”«»]/g, '')
      // '=' is base64 padding; issued keys never contain it, so a stray one
      // (clipboard/paste corruption) would otherwise fail decode opaquely.
      .replace(/=/g, '');
    // Ground truth for paste failures: record the received key's shape
    // (part layout + edge characters + anything outside the key alphabet) -
    // never enough of the key itself to matter.
    const odd = normalized.replace(/[A-Za-z0-9-_.]/g, '');
    const parts = normalized.split('.');
    void recordDiagnostic(
      'warn',
      'licence',
      `Activation input: ${key.length} raw, ${normalized.length} normalised, ` +
        `${parts.length} parts (${parts.map((x) => x.length).join('/')})` +
        `, head=${JSON.stringify(normalized.slice(0, 6))} tail=${JSON.stringify(normalized.slice(-6))}` +
        (odd ? `, unexpected chars: ${JSON.stringify(odd.slice(0, 40))}` : ', alphabet clean'),
    );
    // Throws LicenceKeyError on malformed/forged keys.
    const licence = await verifyLicenceKey(normalized);
    if (licence.expiresAt.getTime() <= Date.now()) {
      throw new LicenceExpiredError(
        `This licence expired on ${format(licence.expiresAt, 'd/MM/yyyy')}. Contact your vendor to renew.`
      );
    }
    const db = await getDB();
    const rows = await db.select<Pick<LicenceSettingsRow, 'install_id'>[]>(
      "SELECT install_id FROM settings WHERE id = 'app'"
    );
    const deviceId = await resolveDeviceId(rows[0]?.install_id ?? '');

    // The one network round-trip in the entire app: the server verifies the
    // key's signature, counts device seats, and returns a token bound to
    // this device.
    const raw = await invoke<string>('activate_licence', { key: normalized, deviceId }).catch((err) => {
      throw activationError(err);
    });

    // Never trust the network blindly: the token must verify against the
    // embedded activation public key and name this key and this device.
    const token = await verifyActivationToken(raw).catch(() => {
      throw new Error('Activation returned an invalid token. Try again shortly.');
    });
    if (token.fp !== (await licenceFingerprint(normalized)) || token.deviceId !== deviceId) {
      throw new Error('Activation token does not match this device. Try again shortly.');
    }
    if (token.exp <= Date.now()) {
      throw new LicenceExpiredError('This licence expired before activation could complete.');
    }

    await db.execute("UPDATE settings SET licence_key = $1, licence_token = $2 WHERE id = 'app'", [
      normalized,
      raw,
    ]);
    // Only the key's tail is logged — the audit trail must not become a
    // place where the full licence secret is readable.
    void auditService.record('licence.activation', {
      detail: `licence key ending ${normalized.slice(-4)} (${licence.seats} device seat${licence.seats === 1 ? '' : 's'})`,
    });
    return this.getStatus();
  }

  async isWritable(): Promise<boolean> {
    return (await this.getStatus()).state !== 'read-only';
  }
}

export const licenceService = new LicenceService();
