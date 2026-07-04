-- Camog auth schema (multi-user, roles, invitations, app settings).
--
-- Extends the v1 `clinicians` table and adds two new tables. All ALTERs are
-- additive so a v1 DB upgrades in place. Photo/patient/subpart tables are
-- untouched.

-- 1. Extend clinicians: role, active flag, passcode-change tracking.
ALTER TABLE clinicians ADD COLUMN role                  TEXT    NOT NULL DEFAULT 'clinician';
ALTER TABLE clinicians ADD COLUMN is_active             INTEGER NOT NULL DEFAULT 1;
ALTER TABLE clinicians ADD COLUMN must_change_passcode  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clinicians ADD COLUMN passcode_changed_at   INTEGER;

-- 2. Invitations: covers both invite-token and admin-precreated flows.
--    `token` kind: admin hands the user an 8-char code; user completes signup.
--    `precreated` kind: admin sets a temp passcode; user logs in then changes it.
CREATE TABLE IF NOT EXISTS invitations (
  id                   TEXT    PRIMARY KEY,           -- UUID v4
  token                TEXT    NOT NULL UNIQUE,        -- 8-char human code (upper alnum)
  token_hash           TEXT    NOT NULL,               -- PBKDF2 of token (defense in depth)
  kind                 TEXT    NOT NULL,               -- 'token' | 'precreated'
  username             TEXT    NOT NULL,               -- reserved/preferred username
  display_name         TEXT    NOT NULL,
  role                 TEXT    NOT NULL DEFAULT 'clinician',
  temp_passcode_hash   TEXT,                           -- set for 'precreated' kind only
  must_change_passcode INTEGER NOT NULL DEFAULT 0,
  invited_by           TEXT    NOT NULL,               -- admin clinician id
  created_at           INTEGER NOT NULL,               -- unix ms
  expires_at           INTEGER NOT NULL,               -- unix ms, default +7d
  accepted_at          INTEGER,                        -- null until claimed
  accepted_by          TEXT                            -- resulting clinician.id
);

CREATE INDEX IF NOT EXISTS idx_invitations_token  ON invitations(token);
CREATE INDEX IF NOT EXISTS idx_invitations_active ON invitations(kind, accepted_at);

-- 3. App settings: singleton row seeded below.
CREATE TABLE IF NOT EXISTS settings (
  id                   TEXT    PRIMARY KEY DEFAULT 'app',
  session_timeout_ms   INTEGER NOT NULL DEFAULT 1800000,  -- 30 min
  allow_public_signup  INTEGER NOT NULL DEFAULT 0,
  org_name             TEXT    NOT NULL DEFAULT 'Camog',
  updated_at           INTEGER NOT NULL
);

-- Seed the singleton settings row idempotently.
INSERT OR IGNORE INTO settings (id, session_timeout_ms, allow_public_signup, org_name, updated_at)
VALUES ('app', 1800000, 0, 'Camog', strftime('%s','now') * 1000);
