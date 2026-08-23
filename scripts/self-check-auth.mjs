// Self-check for the registration policy (lib/services/registration-policy.ts).
// Run: node scripts/self-check-auth.mjs
// ponytail: mirrors the policy in lib/services/registration-policy.ts because
// Node cannot import the TS module graph directly; if you change the policy,
// update the mirror here. Upgrade path: run via tsx/ts-node in CI.

import assert from 'node:assert/strict';

class PermissionDeniedError extends Error {}

function resolveRegistrationMode({ userCount, allowPublicSignup, inviteToken }) {
  if (userCount === 0) return 'first-admin';
  if (inviteToken) return 'invite';
  if (allowPublicSignup) return 'public-pending';
  throw new PermissionDeniedError('Sign up is invite-only. Provide an invite code.');
}

// First run: zero users → first signup bootstraps the org admin, regardless
// of the signup flag or a stray token (no admin exists to issue invites).
assert.equal(resolveRegistrationMode({ userCount: 0, allowPublicSignup: false }), 'first-admin');
assert.equal(
  resolveRegistrationMode({ userCount: 0, allowPublicSignup: false, inviteToken: 'ABCD1234' }),
  'first-admin',
);

// Invite token wins over the public-signup flag (admin pre-authorised role).
assert.equal(
  resolveRegistrationMode({ userCount: 3, allowPublicSignup: true, inviteToken: 'ABCD1234' }),
  'invite',
);
assert.equal(
  resolveRegistrationMode({ userCount: 3, allowPublicSignup: false, inviteToken: 'ABCD1234' }),
  'invite',
);

// Public signup → pending account awaiting admin approval.
assert.equal(resolveRegistrationMode({ userCount: 3, allowPublicSignup: true }), 'public-pending');

// Invite-only and no token → denied.
assert.throws(
  () => resolveRegistrationMode({ userCount: 3, allowPublicSignup: false }),
  PermissionDeniedError,
);

console.log('self-check-auth: all registration policy assertions passed');
