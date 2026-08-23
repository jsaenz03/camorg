/**
 * Auth Service Implementation (Tauri SQLite)
 *
 * PBKDF2-hashed passcodes, web-storage-backed sessions (sessionStorage by
 * default; localStorage when "Keep me signed in" is ticked so the session
 * survives app restarts), role-based admin methods, and the invitation flow
 * (token + precreated kinds).
 */

import { v4 as uuidv4 } from 'uuid';
import type { Clinician, ClinicianRow, ClinicianRole } from '@/types/clinician';
import type { Invitation, AppSettings, InvitationKind } from '@/types/invitation';
import type {
  ClinicianRegister,
  ClinicianLogin,
  InvitationCreate,
  InvitationAccept,
  SettingsUpdate,
} from '@/lib/validators/schemas';
import {
  clinicianRegisterSchema,
  clinicianLoginSchema,
  invitationCreateSchema,
  invitationAcceptSchema,
  settingsUpdateSchema,
} from '@/lib/validators/schemas';
import type { IAuthService, SessionInfo } from '@/specs/001-role-you-are/contracts/auth-service';
import { getDB, ensureBootstrapped } from '@/lib/db/database';
import { resolveRegistrationMode } from '@/lib/services/registration-policy';
import { hashPasscode, verifyPasscode, randomToken } from '@/lib/utils/crypto';
import {
  NotAuthenticatedError,
  PermissionDeniedError,
  InvalidCredentialsError,
  AlreadyExistsError,
  SessionExpiredError,
  ConfirmationError,
  ValidationError,
  NotFoundError,
} from '@/lib/validators/errors';

const SESSION_KEY = 'camog.session';
/** Remembered sign-in details (username + passcode) for the login form. */
const REMEMBERED_LOGIN_KEY = 'camog.rememberedLogin';
const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
/** Sentinel expiry for the "Never sign me out" preference (~year 287396). */
const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

interface StoredSession {
  clinicianId: string;
  expiresAt: number; // unix ms
  /** true → localStorage (survives app restarts); false/absent → sessionStorage. */
  remember?: boolean;
}

/**
 * Trust-boundary guard for the personal auto-logout preference: null means
 * "use the organisation default", 0 means "never sign me out", anything else
 * must be a finite non-negative integer (ms).
 */
function sanitiseAutoLogoutTimeout(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

/** Effective auto-logout: the user's own choice, else the org-wide default. */
function resolveSessionTimeoutMs(userMs: number | null, orgMs: number): number {
  return userMs ?? orgMs;
}

/** Absolute expiry timestamp for a timeout (0 = never → far-future sentinel). */
function expiryFromTimeout(timeoutMs: number, nowMs = Date.now()): number {
  return timeoutMs === 0 ? NEVER_EXPIRES : nowMs + timeoutMs;
}

// ----- row mappers (strip hash before returning) -----

function parsePreferences(json: string): Clinician['preferences'] {
  try {
    const parsed = JSON.parse(json) as Partial<Clinician['preferences']>;
    return {
      theme: parsed.theme ?? 'system',
      defaultBodyPart: parsed.defaultBodyPart ?? null,
      autoCompressPhotos: parsed.autoCompressPhotos ?? false,
      showDeletedPhotos: parsed.showDeletedPhotos ?? false,
      autoLogoutTimeoutMs: sanitiseAutoLogoutTimeout(parsed.autoLogoutTimeoutMs),
    };
  } catch {
    return {
      theme: 'system',
      defaultBodyPart: null,
      autoCompressPhotos: false,
      showDeletedPhotos: false,
      autoLogoutTimeoutMs: null,
    };
  }
}

function rowToClinician(row: Record<string, unknown> | ClinicianRow): Clinician {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as string,
    username: r.username as string,
    displayName: r.display_name as string,
    role: (r.role as ClinicianRole) ?? 'clinician',
    isActive: Boolean(r.is_active ?? 1),
    isPending: Boolean(r.is_pending ?? 0),
    mustChangePasscode: Boolean(r.must_change_passcode ?? 0),
    preferences: parsePreferences((r.preferences as string) || '{}'),
    createdAt: new Date(r.created_at as number),
    lastLoginAt:
      r.last_login_at != null ? new Date(r.last_login_at as number) : null,
    passcodeChangedAt:
      r.passcode_changed_at != null
        ? new Date(r.passcode_changed_at as number)
        : null,
    sessionExpiresAt:
      r.session_expires_at != null
        ? new Date(r.session_expires_at as number)
        : null,
  };
}

function rowToClinicianWithHash(row: Record<string, unknown>): ClinicianRow {
  const base = rowToClinician(row);
  return {
    ...base,
    passcodeHash: row.passcode_hash as string,
    preferencesJson: (row.preferences as string) || '{}',
  };
}

/**
 * Maps an already-mapped ClinicianRow back to the public Clinician shape.
 * Passing a ClinicianRow through rowToClinician instead would feed
 * parsePreferences an object (its JSON.parse throws) and silently fall back
 * to default preferences — the bug that made saved settings toggles never
 * appear to change.
 */
function clinicianRowToPublic(row: ClinicianRow): Clinician {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    isActive: row.isActive,
    isPending: row.isPending,
    mustChangePasscode: row.mustChangePasscode,
    preferences: parsePreferences(row.preferencesJson),
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    passcodeChangedAt: row.passcodeChangedAt,
    sessionExpiresAt: row.sessionExpiresAt,
  };
}

function rowToInvitation(row: Record<string, unknown>): Invitation {
  return {
    id: row.id as string,
    token: row.token as string,
    kind: (row.kind as InvitationKind) ?? 'token',
    username: row.username as string,
    displayName: row.display_name as string,
    role: (row.role as ClinicianRole) ?? 'clinician',
    mustChangePasscode: Boolean(row.must_change_passcode ?? 0),
    invitedBy: row.invited_by as string,
    createdAt: new Date(row.created_at as number),
    expiresAt: new Date(row.expires_at as number),
    acceptedAt:
      row.accepted_at != null ? new Date(row.accepted_at as number) : null,
    acceptedBy: (row.accepted_by as string) ?? null,
  };
}

function rowToSettings(row: Record<string, unknown>): AppSettings {
  return {
    sessionTimeoutMs: row.session_timeout_ms as number,
    allowPublicSignup: Boolean(row.allow_public_signup),
    orgName: row.org_name as string,
    idleLockTimeoutMs: (row.idle_lock_timeout_ms as number) ?? 300_000,
    updatedAt: new Date(row.updated_at as number),
  };
}

// ----- session helpers -----

function readSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    // sessionStorage first (this-run sessions), then a remembered
    // localStorage session from a previous app run.
    const raw =
      sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.clinicianId || typeof parsed.expiresAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  if (typeof window === 'undefined') return;
  // Always clear both storages so a stale copy in the other one can't
  // resurrect a session that was replaced or ended.
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  if (session) {
    const target = session.remember ? localStorage : sessionStorage;
    target.setItem(SESSION_KEY, JSON.stringify(session));
  }
}

// ----- remembered sign-in details (login-form prefill) -----

interface RememberedLogin {
  username: string;
  passcode: string;
}

/**
 * SECURITY: this stores the passcode client-side by design — the user
 * explicitly opted in so the login form prefills. Within this app's
 * local-device threat model (unencrypted DB at rest, desktop login as the
 * boundary) it unlocks nothing the device itself doesn't already expose.
 */
function readRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RememberedLogin>;
    if (typeof parsed?.username !== 'string' || typeof parsed?.passcode !== 'string') {
      return null;
    }
    return { username: parsed.username, passcode: parsed.passcode };
  } catch {
    return null;
  }
}

function writeRememberedLogin(details: RememberedLogin): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(REMEMBERED_LOGIN_KEY, JSON.stringify(details));
}

function clearRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(REMEMBERED_LOGIN_KEY);
}

/** Drop remembered details that no longer authenticate (e.g. passcode changed). */
function clearStaleRememberedLogin(attempted: ClinicianLogin): void {
  const remembered = readRememberedLogin();
  if (
    remembered &&
    remembered.username === attempted.username &&
    remembered.passcode === attempted.passcode
  ) {
    clearRememberedLogin();
  }
}

// ============================================================
// Service
// ============================================================

export class AuthService implements IAuthService {
  // ---------- session helpers ----------

  private async getCurrentRow(): Promise<ClinicianRow | null> {
    const session = readSession();
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      await this.logout();
      throw new SessionExpiredError();
    }
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM clinicians WHERE id = $1',
      [session.clinicianId],
    );
    if (!rows.length) {
      writeSession(null);
      return null;
    }
    return rowToClinicianWithHash(rows[0]);
  }

  private async requireCurrentRow(): Promise<ClinicianRow> {
    const row = await this.getCurrentRow();
    if (!row) throw new NotAuthenticatedError();
    return row;
  }

  private async requireAdmin(): Promise<ClinicianRow> {
    const row = await this.requireCurrentRow();
    if (row.role !== 'admin') throw new PermissionDeniedError('Admin access required');
    return row;
  }

  // ---------- settings ----------

  async getSettings(): Promise<AppSettings> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      "SELECT * FROM settings WHERE id = 'app'",
    );
    if (!rows.length) {
      return {
        sessionTimeoutMs: DEFAULT_SESSION_TIMEOUT_MS,
        allowPublicSignup: true,
        orgName: 'Camog',
        idleLockTimeoutMs: 300_000,
        updatedAt: new Date(),
      };
    }
    return rowToSettings(rows[0]);
  }

  async updateSettings(patch: SettingsUpdate): Promise<AppSettings> {
    await this.requireAdmin();
    const validated = settingsUpdateSchema.parse(patch);
    const current = await this.getSettings();
    const next: AppSettings = {
      sessionTimeoutMs: validated.sessionTimeoutMs ?? current.sessionTimeoutMs,
      allowPublicSignup: validated.allowPublicSignup ?? current.allowPublicSignup,
      orgName: validated.orgName ?? current.orgName,
      idleLockTimeoutMs: validated.idleLockTimeoutMs ?? current.idleLockTimeoutMs,
      updatedAt: new Date(),
    };
    const db = await getDB();
    await db.execute(
      `UPDATE settings
         SET session_timeout_ms = $1,
             allow_public_signup = $2,
             org_name = $3,
             idle_lock_timeout_ms = $4,
             updated_at = $5
       WHERE id = 'app'`,
      [
        next.sessionTimeoutMs,
        next.allowPublicSignup ? 1 : 0,
        next.orgName,
        next.idleLockTimeoutMs,
        next.updatedAt.getTime(),
      ],
    );
    return next;
  }

  // ---------- registration ----------

  async register(data: ClinicianRegister, inviteToken?: string): Promise<Clinician> {
    const validated = clinicianRegisterSchema.parse(data);
    // Fresh install: the env bootstrap may still be inserting the first admin.
    // Wait for it so the mode decision below sees the final user count.
    await ensureBootstrapped();

    const settings = await this.getSettings();
    const mode = resolveRegistrationMode({
      userCount: await this.countUsers(),
      allowPublicSignup: settings.allowPublicSignup,
      inviteToken,
    });

    let role: ClinicianRole = 'clinician';
    let mustChangePasscode = false;
    // first-admin and invite accounts are usable immediately; public signups
    // stay pending until an admin approves them (Settings → Users).
    let isActive = true;
    let isPending = false;
    let invitation: Invitation | null = null;

    if (mode === 'first-admin') {
      role = 'admin';
    } else if (mode === 'invite') {
      invitation = await this.resolveInvitation(inviteToken!);
      if (invitation.acceptedAt) {
        throw new AlreadyExistsError('This invite code has already been used.');
      }
      role = invitation.role;
      mustChangePasscode = invitation.mustChangePasscode;
    } else {
      isActive = false;
      isPending = true;
    }

    await this.assertUsernameAvailable(validated.username);

    const id = uuidv4();
    const nowMs = Date.now();
    const passcodeHash = await hashPasscode(validated.passcode);
    const preferencesJson = JSON.stringify({
      theme: 'system',
      defaultBodyPart: null,
      autoCompressPhotos: false,
      showDeletedPhotos: false,
    });

    const db = await getDB();
    await db.execute(
      `INSERT INTO clinicians
         (id, username, passcode_hash, display_name, role, is_active,
          is_pending, must_change_passcode, preferences, created_at,
          last_login_at, session_expires_at, passcode_changed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL)`,
      [
        id,
        validated.username,
        passcodeHash,
        validated.displayName,
        role,
        isActive ? 1 : 0,
        isPending ? 1 : 0,
        mustChangePasscode ? 1 : 0,
        preferencesJson,
        nowMs,
        isActive ? nowMs : null, // last_login_at only once they can actually log in
        isActive ? nowMs + settings.sessionTimeoutMs : null,
      ],
    );

    if (invitation) {
      await this.markInvitationAccepted(invitation.token, id);
    }

    if (isActive) {
      await this.startSession(id, settings.sessionTimeoutMs);
    }

    const created = await this.getClinicianById(id);
    return created!;
  }

  // ---------- login / logout ----------

  async login(data: ClinicianLogin): Promise<SessionInfo> {
    const validated = clinicianLoginSchema.parse(data);
    const db = await getDB();
    // On a fresh install the env bootstrap (first admin) is fired in the
    // background when the DB opens — the very first login can race it and
    // falsely report invalid credentials. Wait for it before checking.
    await ensureBootstrapped();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM clinicians WHERE username = $1',
      [validated.username],
    );

    // ponytail: identical error for "no such user" and "wrong passcode" —
    // don't leak which one it is.
    const row = rows[0];
    if (!row) {
      clearStaleRememberedLogin(validated);
      throw new InvalidCredentialsError('Invalid username or passcode');
    }

    const clinicianRow = rowToClinicianWithHash(row);

    // Verify the passcode before revealing any account state — pending or
    // deactivated shouldn't be confirmable without knowing the credentials.
    const ok = await verifyPasscode(validated.passcode, clinicianRow.passcodeHash);
    if (!ok) {
      clearStaleRememberedLogin(validated);
      throw new InvalidCredentialsError('Invalid username or passcode');
    }

    if (clinicianRow.isPending) {
      throw new PermissionDeniedError(
        'Your account is awaiting administrator approval.',
      );
    }
    if (!clinicianRow.isActive) {
      clearStaleRememberedLogin(validated);
      throw new InvalidCredentialsError('This account has been deactivated.');
    }

    const settings = await this.getSettings();
    const nowMs = Date.now();
    const timeoutMs = resolveSessionTimeoutMs(
      parsePreferences(clinicianRow.preferencesJson).autoLogoutTimeoutMs,
      settings.sessionTimeoutMs,
    );
    const expiresAt = expiryFromTimeout(timeoutMs, nowMs);
    await db.execute(
      'UPDATE clinicians SET last_login_at = $1, session_expires_at = $2 WHERE id = $3',
      [nowMs, expiresAt, clinicianRow.id],
    );
    await this.startSession(clinicianRow.id, timeoutMs, validated.rememberMe ?? false);

    const { auditService } = await import('@/lib/services/audit-service');
    void auditService.record('auth.login', {
      entityType: 'clinician',
      entityId: clinicianRow.id,
      detail: clinicianRow.username,
    });

    // Store or drop the login-form prefill per the tickbox. Written only
    // after a successful login so a typo never overwrites good details.
    if (validated.rememberLogin) {
      writeRememberedLogin({
        username: validated.username,
        passcode: validated.passcode,
      });
    } else {
      clearRememberedLogin();
    }

    return {
      clinicianId: clinicianRow.id,
      username: clinicianRow.username,
      displayName: clinicianRow.displayName,
      role: clinicianRow.role,
      loginAt: new Date(nowMs),
      expiresAt: new Date(expiresAt),
    };
  }

  async logout(): Promise<void> {
    const session = readSession();
    writeSession(null);
    if (session) {
      try {
        const { auditService } = await import('@/lib/services/audit-service');
        void auditService.record('auth.logout', {
          entityType: 'clinician',
          entityId: session.clinicianId,
        });
        const db = await getDB();
        await db.execute(
          'UPDATE clinicians SET session_expires_at = NULL WHERE id = $1',
          [session.clinicianId],
        );
      } catch {
        // best-effort; session is already cleared client-side
      }
    }
  }

  /** Login-form prefill for this device ("Remember my sign-in details"). */
  getRememberedLogin(): RememberedLogin | null {
    return readRememberedLogin();
  }

  async getCurrentSession(): Promise<SessionInfo | null> {
    try {
      const row = await this.getCurrentRow();
      if (!row) return null;
      return {
        clinicianId: row.id,
        username: row.username,
        displayName: row.displayName,
        role: row.role,
        loginAt: row.lastLoginAt ?? new Date(),
        expiresAt: row.sessionExpiresAt ?? new Date(0),
      };
    } catch (err) {
      if (err instanceof SessionExpiredError) return null;
      throw err;
    }
  }

  async isAuthenticated(): Promise<boolean> {
    try {
      const session = await this.getCurrentSession();
      return session !== null;
    } catch {
      return false;
    }
  }

  async refreshSession(): Promise<Date> {
    const row = await this.requireCurrentRow();
    const settings = await this.getSettings();
    const timeoutMs = resolveSessionTimeoutMs(
      parsePreferences(row.preferencesJson).autoLogoutTimeoutMs,
      settings.sessionTimeoutMs,
    );
    const expiresAt = expiryFromTimeout(timeoutMs);
    const db = await getDB();
    await db.execute(
      'UPDATE clinicians SET session_expires_at = $1 WHERE id = $2',
      [expiresAt, row.id],
    );
    // Preserve the remember flag so extending can't silently downgrade a
    // remembered session back to this-run-only storage.
    writeSession({ clinicianId: row.id, expiresAt, remember: readSession()?.remember });
    return new Date(expiresAt);
  }

  async changePasscode(currentPasscode: string, newPasscode: string): Promise<void> {
    const row = await this.requireCurrentRow();

    const ok = await verifyPasscode(currentPasscode, row.passcodeHash);
    if (!ok) throw new InvalidCredentialsError('Current passcode is incorrect');

    if (currentPasscode === newPasscode) {
      throw new ValidationError('New passcode must differ from the current one');
    }

    const newHash = await hashPasscode(newPasscode);
    const nowMs = Date.now();
    const db = await getDB();
    await db.execute(
      `UPDATE clinicians
         SET passcode_hash = $1,
             must_change_passcode = 0,
             passcode_changed_at = $2
       WHERE id = $3`,
      [newHash, nowMs, row.id],
    );

    // Keep the login-form prefill usable after a passcode change instead of
    // leaving a stale pair that fails next sign-in.
    const remembered = readRememberedLogin();
    if (remembered && remembered.username === row.username) {
      writeRememberedLogin({ username: row.username, passcode: newPasscode });
    }
  }

  /**
   * Check the signed-in clinician's passcode without starting a new session.
   * Used by the idle privacy lock to re-authenticate in place. Throws
   * NotAuthenticatedError when nobody is signed in.
   */
  async verifyCurrentPasscode(passcode: string): Promise<boolean> {
    const row = await this.requireCurrentRow();
    return verifyPasscode(passcode, row.passcodeHash);
  }

  async resetApp(confirmationPhrase: string): Promise<void> {
    if (confirmationPhrase !== 'DELETE ALL DATA') {
      throw new ConfirmationError('Type "DELETE ALL DATA" to confirm');
    }
    writeSession(null);
    clearRememberedLogin();
    const db = await getDB();
    // patient_shares must come before patients (FK-less, but logically dependent).
    for (const table of ['patient_shares', 'photos', 'patients', 'subparts', 'invitations', 'clinicians']) {
      await db.execute(`DELETE FROM ${table}`);
    }
    await db.execute(
      "UPDATE settings SET allow_public_signup = 1, org_name = 'Camog', updated_at = $1 WHERE id = 'app'",
      [Date.now()],
    );
  }

  async getCurrentClinician(): Promise<Clinician> {
    const row = await this.requireCurrentRow();
    return clinicianRowToPublic(row);
  }

  async updatePreferences(
    preferences: Partial<Clinician['preferences']>,
  ): Promise<Clinician> {
    const row = await this.requireCurrentRow();
    // Merge over the stored JSON so sibling preferences survive each save.
    const next = { ...parsePreferences(row.preferencesJson), ...preferences };
    next.autoLogoutTimeoutMs = sanitiseAutoLogoutTimeout(next.autoLogoutTimeoutMs);
    const db = await getDB();
    const result = await db.execute(
      'UPDATE clinicians SET preferences = $1 WHERE id = $2',
      [JSON.stringify(next), row.id],
    );
    if (result.rowsAffected === 0) {
      throw new Error('Failed to save preference: clinician row not found');
    }
    return { ...clinicianRowToPublic(row), preferences: next };
  }

  // ---------- user administration (admin) ----------

  async listUsers(): Promise<Clinician[]> {
    await this.requireAdmin();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM clinicians ORDER BY created_at ASC',
    );
    return rows.map(rowToClinician);
  }

  async setUserActive(id: string, active: boolean): Promise<Clinician> {
    const admin = await this.requireAdmin();
    if (id === admin.id) {
      throw new ValidationError('You cannot deactivate your own account');
    }
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM clinicians WHERE id = $1',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`User not found: ${id}`);
    // Activating (approving) or deactivating both clear the pending flag:
    // the admin has made a decision either way.
    await db.execute(
      'UPDATE clinicians SET is_active = $1, is_pending = 0 WHERE id = $2',
      [active ? 1 : 0, id],
    );
    return rowToClinician((await this.getClinicianRow(id))!);
  }

  async setUserRole(id: string, role: ClinicianRole): Promise<Clinician> {
    const admin = await this.requireAdmin();
    if (id === admin.id) {
      throw new ValidationError('Use the role switch in app settings to change your own role');
    }
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM clinicians WHERE id = $1',
      [id],
    );
    if (!rows.length) throw new NotFoundError(`User not found: ${id}`);
    await db.execute('UPDATE clinicians SET role = $1 WHERE id = $2', [role, id]);
    return rowToClinician((await this.getClinicianRow(id))!);
  }

  // ---------- invitations ----------

  async createInvitation(input: InvitationCreate): Promise<Invitation> {
    const admin = await this.requireAdmin();
    const validated = invitationCreateSchema.parse(input);

    if (validated.kind === 'precreated' && !validated.tempPasscode) {
      throw new ValidationError('A temporary passcode is required for precreated accounts');
    }

    await this.assertUsernameAvailable(validated.username);

    const id = uuidv4();
    const token = randomToken(8);
    const tokenHash = await hashPasscode(token);
    const nowMs = Date.now();
    const expiresAt = nowMs + validated.ttlDays * 24 * 60 * 60 * 1000;

    const tempHash = validated.tempPasscode
      ? await hashPasscode(validated.tempPasscode)
      : null;

    const mustChange = validated.kind === 'precreated';

    const db = await getDB();
    await db.execute(
      `INSERT INTO invitations
         (id, token, token_hash, kind, username, display_name, role,
          temp_passcode_hash, must_change_passcode, invited_by,
          created_at, expires_at, accepted_at, accepted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, NULL)`,
      [
        id,
        token,
        tokenHash,
        validated.kind,
        validated.username,
        validated.displayName,
        validated.role,
        tempHash,
        mustChange ? 1 : 0,
        admin.id,
        nowMs,
        expiresAt,
      ],
    );

    return {
      id,
      token,
      kind: validated.kind,
      username: validated.username,
      displayName: validated.displayName,
      role: validated.role,
      mustChangePasscode: mustChange,
      invitedBy: admin.id,
      createdAt: new Date(nowMs),
      expiresAt: new Date(expiresAt),
      acceptedAt: null,
      acceptedBy: null,
    };
  }

  async resolveInvitation(token: string): Promise<Invitation> {
    const db = await getDB();
    // Token is stored uppercase-normalised.
    const normalised = token.trim().toUpperCase();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM invitations WHERE token = $1',
      [normalised],
    );
    if (!rows.length) throw new NotFoundError('Invite code not found');
    const inv = rowToInvitation(rows[0]);

    if (inv.acceptedAt) {
      throw new AlreadyExistsError('This invite code has already been used');
    }
    if (Date.now() > inv.expiresAt.getTime()) {
      throw new SessionExpiredError('This invite code has expired');
    }
    return inv;
  }

  async acceptInvitation(input: InvitationAccept): Promise<Clinician> {
    const validated = invitationAcceptSchema.parse(input);
    const invitation = await this.resolveInvitation(validated.token);

    // The invitation reserves a username; if the user changed it on the form,
    // require it to still be available and not collide with another reservation.
    if (validated.username !== invitation.username) {
      await this.assertUsernameAvailable(validated.username);
    }

    const settings = await this.getSettings();
    const id = uuidv4();
    const nowMs = Date.now();
    const passcodeHash = await hashPasscode(validated.passcode);
    const preferencesJson = JSON.stringify({
      theme: 'system',
      defaultBodyPart: null,
      autoCompressPhotos: false,
      showDeletedPhotos: false,
    });

    const db = await getDB();
    await db.execute(
      `INSERT INTO clinicians
         (id, username, passcode_hash, display_name, role, is_active,
          must_change_passcode, preferences, created_at, last_login_at,
          session_expires_at, passcode_changed_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $8, $9, NULL)`,
      [
        id,
        validated.username,
        passcodeHash,
        validated.displayName,
        invitation.role,
        invitation.mustChangePasscode ? 1 : 0,
        preferencesJson,
        nowMs,
        nowMs + settings.sessionTimeoutMs,
      ],
    );

    await this.markInvitationAccepted(validated.token, id);
    await this.startSession(id, settings.sessionTimeoutMs);

    return (await this.getClinicianById(id))!;
  }

  async revokeInvitation(id: string): Promise<void> {
    await this.requireAdmin();
    const db = await getDB();
    await db.execute('DELETE FROM invitations WHERE id = $1', [id]);
  }

  async listInvitations(): Promise<Invitation[]> {
    await this.requireAdmin();
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM invitations ORDER BY created_at DESC',
    );
    return rows.map(rowToInvitation);
  }

  // ---------- dev / bootstrapping ----------

  async countUsers(): Promise<number> {
    const db = await getDB();
    const rows = await db.select<{ count: number }[]>(
      'SELECT COUNT(*) as count FROM clinicians',
    );
    return rows[0]?.count ?? 0;
  }

  /**
   * Env-driven bootstrap.
   *
   * If CAMOG_BOOTSTRAP_ADMIN_USERNAME and CAMOG_BOOTSTRAP_ADMIN_PASSCODE are set
   * (via a local, gitignored .env), and zero clinicians exist, create the first
   * admin from those credentials. Idempotent — no-op once any user exists, or
   * if the env vars aren't set.
   *
   * Designed to run on DB open so a fresh install always has a working login
   * without a UI button. Passcode is hashed with the same PBKDF2 as every other
   * account; nothing plaintext is stored.
   */
  async bootstrapFromEnv(): Promise<void> {
    const username = process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_USERNAME;
    const passcode = process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_PASSCODE;
    if (!username || !passcode) return; // bootstrap disabled — no-op

    const count = await this.countUsers();
    if (count > 0) return; // already bootstrapped

    const displayName =
      process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_DISPLAY_NAME || 'Administrator';

    await this.createClinicianRow({
      username,
      passcode,
      displayName,
      role: 'admin',
      mustChangePasscode: false,
    });
    console.info(`[bootstrap] created admin "${username}" from env`);
  }

  /**
   * Dev-only seed. Prefers env credentials (CAMOG_BOOTSTRAP_ADMIN_*) so a team
   * can share a known dev login; falls back to admin/devpass123. Refuses if any
   * user already exists. For a fresh start, call resetApp first.
   */
  async seedDevAdmin(): Promise<void> {
    const count = await this.countUsers();
    if (count > 0) {
      throw new AlreadyExistsError('Users already exist; dev seed refused');
    }

    const username = process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_USERNAME || 'admin';
    const passcode = process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_PASSCODE || 'devpass123';
    const displayName =
      process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_DISPLAY_NAME || 'Dev Admin';

    await this.createClinicianRow({
      username,
      passcode,
      displayName,
      role: 'admin',
      // In dev, force a passcode change unless the env explicitly opts out.
      mustChangePasscode:
        process.env.NEXT_PUBLIC_CAMOG_BOOTSTRAP_ADMIN_MUST_CHANGE !== 'false',
    });
  }

  /**
   * Inserts a clinician row with a PBKDF2-hashed passcode. Shared by the env
   * bootstrap, the dev seed, registration, and invitation acceptance.
   */
  private async createClinicianRow(input: {
    username: string;
    passcode: string;
    displayName: string;
    role: ClinicianRole;
    mustChangePasscode: boolean;
  }): Promise<void> {
    const id = uuidv4();
    const nowMs = Date.now();
    const passcodeHash = await hashPasscode(input.passcode);
    const preferencesJson = JSON.stringify({
      theme: 'system',
      defaultBodyPart: null,
      autoCompressPhotos: false,
      showDeletedPhotos: false,
    });
    const db = await getDB();
    await db.execute(
      `INSERT INTO clinicians
         (id, username, passcode_hash, display_name, role, is_active,
          must_change_passcode, preferences, created_at, last_login_at,
          session_expires_at, passcode_changed_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, NULL, NULL, NULL)`,
      [
        id,
        input.username,
        passcodeHash,
        input.displayName,
        input.role,
        input.mustChangePasscode ? 1 : 0,
        preferencesJson,
        nowMs,
      ],
    );
  }

  // ---------- internal helpers ----------

  private async startSession(
    clinicianId: string,
    timeoutMs: number,
    remember = false,
  ): Promise<void> {
    const expiresAt = expiryFromTimeout(timeoutMs);
    writeSession({ clinicianId, expiresAt, remember });
    const db = await getDB();
    await db.execute(
      'UPDATE clinicians SET session_expires_at = $1 WHERE id = $2',
      [expiresAt, clinicianId],
    );
  }

  private async getClinicianRow(id: string): Promise<Record<string, unknown> | null> {
    const db = await getDB();
    const rows = await db.select<Record<string, unknown>[]>(
      'SELECT * FROM clinicians WHERE id = $1',
      [id],
    );
    return rows.length ? rows[0] : null;
  }

  private async getClinicianById(id: string): Promise<Clinician | null> {
    const row = await this.getClinicianRow(id);
    return row ? rowToClinician(row) : null;
  }

  private async assertUsernameAvailable(username: string): Promise<void> {
    const db = await getDB();
    const clinicians = await db.select<{ id: string }[]>(
      'SELECT id FROM clinicians WHERE username = $1',
      [username],
    );
    if (clinicians.length) {
      throw new AlreadyExistsError(`Username "${username}" is already taken`);
    }
    const invitations = await db.select<{ id: string }[]>(
      `SELECT id FROM invitations
        WHERE username = $1 AND accepted_at IS NULL AND expires_at > $2`,
      [username, Date.now()],
    );
    if (invitations.length) {
      throw new AlreadyExistsError(`Username "${username}" is reserved by a pending invite`);
    }
  }

  private async markInvitationAccepted(token: string, clinicianId: string): Promise<void> {
    const db = await getDB();
    const nowMs = Date.now();
    await db.execute(
      `UPDATE invitations
         SET accepted_at = $1, accepted_by = $2
       WHERE token = $3`,
      [nowMs, clinicianId, token.trim().toUpperCase()],
    );
  }
}

// Export singleton instance
export const authService = new AuthService();
