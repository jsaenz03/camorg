/**
 * Registration policy (pure).
 *
 * Decides how a signup request is handled, based on org state. Kept free of
 * I/O so the truth table is testable in isolation (scripts/self-check-auth.mjs
 * mirrors it).
 *
 * Modes:
 * - first-admin   zero clinicians exist → this signup creates the org's
 *                 administrator (production first-run bootstrap; no invite
 *                 can exist because no admin exists to issue one).
 * - invite        an invite token is supplied → the admin pre-authorised the
 *                 account; its role comes from the invitation. Active.
 * - public-pending allow_public_signup is on → account is created PENDING;
 *                 an admin approves it in Settings → Users before it can log in.
 *
 * Anything else (signup closed, no token) is denied.
 */

import { PermissionDeniedError } from '@/lib/validators/errors';

export type RegistrationMode = 'first-admin' | 'invite' | 'public-pending';

export function resolveRegistrationMode(input: {
  userCount: number;
  allowPublicSignup: boolean;
  inviteToken?: string;
}): RegistrationMode {
  if (input.userCount === 0) return 'first-admin';
  if (input.inviteToken) return 'invite';
  if (input.allowPublicSignup) return 'public-pending';
  throw new PermissionDeniedError('Sign up is invite-only. Provide an invite code.');
}
