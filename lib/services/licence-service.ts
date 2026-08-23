/**
 * Offline licence service — backs the ILicenceService contract.
 *
 * State lives in the settings singleton row (migration 008): the raw licence
 * key string, the first-launch trial stamp, and a per-install UUID. Reads are
 * raw SQL (like getPhotosDirOverride) because activation happens outside the
 * admin-session gate that authService.getSettings() enforces.
 */

import { format } from 'date-fns';
import { getDB } from '@/lib/db/database';
import { verifyLicenceKey } from '@/lib/licence/verify';
import { LicenceExpiredError } from '@/lib/validators/errors';
import type {
  ILicenceService,
  LicenceInfo,
  LicenceStatus,
} from '@/specs/002-offline-licence/contracts/licence-service';

const TRIAL_DAYS = 14;
const MS_PER_DAY = 86_400_000;

interface LicenceSettingsRow {
  licence_key: string | null;
  trial_started_at: number | null;
  install_id: string | null;
}

export class LicenceService implements ILicenceService {
  // ponytail: trusts the local clock (Date.now(), like sessions) and deters
  // honest users only — the key and DB are machine-local. Upgrade path: an
  // online activation endpoint that counts installs per licence (see
  // specs/002-offline-licence/spec.md).
  async getStatus(): Promise<LicenceStatus> {
    const db = await getDB();
    const rows = await db.select<LicenceSettingsRow[]>(
      "SELECT licence_key, trial_started_at, install_id FROM settings WHERE id = 'app'"
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

    const now = Date.now();
    if (licence && licence.expiresAt.getTime() > now) {
      return { state: 'valid', licence, trialEndsAt: null, installId };
    }
    const trialEndsAtMs = trialStartedAt + TRIAL_DAYS * MS_PER_DAY;
    if (!licence && now < trialEndsAtMs) {
      return { state: 'trial', licence: null, trialEndsAt: new Date(trialEndsAtMs), installId };
    }
    return { state: 'read-only', licence, trialEndsAt: null, installId };
  }

  async activate(key: string): Promise<LicenceStatus> {
    // Throws LicenceKeyError on malformed/forged keys.
    const licence = await verifyLicenceKey(key);
    if (licence.expiresAt.getTime() <= Date.now()) {
      throw new LicenceExpiredError(
        `This licence expired on ${format(licence.expiresAt, 'd/MM/yyyy')}. Contact your vendor to renew.`
      );
    }
    const db = await getDB();
    await db.execute("UPDATE settings SET licence_key = $1 WHERE id = 'app'", [
      key.replace(/\s+/g, ''),
    ]);
    return this.getStatus();
  }

  async isWritable(): Promise<boolean> {
    return (await this.getStatus()).state !== 'read-only';
  }
}

export const licenceService = new LicenceService();
