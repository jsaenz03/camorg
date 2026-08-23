-- Camog signup-approval schema.
--
-- Production first-run bootstrap: env-driven admin creation only works when
-- the credentials are baked in at build time (NEXT_PUBLIC_* is inlined by
-- Next at build, not read from .env at runtime). Instead, when zero clinicians
-- exist, the signup screen offers to create the first admin (organisation
-- setup). See lib/services/registration-policy.ts.
--
-- Public signup (allow_public_signup=1) creates PENDING accounts: the admin
-- decides who gets access by approving them in Settings → Users.

-- 1. Pending flag: signed up but not yet approved by an admin.
--    pending + is_active=0  → awaiting approval (cannot log in)
--    is_pending=0 + is_active=0 → deactivated/rejected
ALTER TABLE clinicians ADD COLUMN is_pending INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_clinicians_is_pending ON clinicians(is_pending);

-- 2. Flip allow_public_signup to enabled (was seeded 0). New signups are
--    pending until an admin approves them, so this is safe by default.
--    An admin can still turn it off in Settings → App settings.
UPDATE settings SET allow_public_signup = 1, updated_at = strftime('%s','now') * 1000 WHERE id = 'app';
