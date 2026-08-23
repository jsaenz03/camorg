-- Patient photo consent, audit log, idle privacy lock.
--
-- Consent lives on the patient row as three nullable columns; status is
-- derived at read time (none / valid / expired) rather than stored, so an
-- expiry never needs a background job to take effect.
ALTER TABLE patients ADD COLUMN consent_given_at INTEGER;
ALTER TABLE patients ADD COLUMN consent_scope TEXT;    -- 'care' | 'education' | 'research'
ALTER TABLE patients ADD COLUMN consent_expires_at INTEGER;

-- Append-only audit trail. clinician_name is denormalised so entries stay
-- readable after the clinician row is deleted.
CREATE TABLE IF NOT EXISTS audit_log (
  id             TEXT    PRIMARY KEY,
  clinician_id   TEXT    NOT NULL DEFAULT '',
  clinician_name TEXT    NOT NULL DEFAULT '',
  action         TEXT    NOT NULL,             -- dotted path, e.g. 'photo.create'
  entity_type    TEXT,
  entity_id      TEXT,
  patient_id     TEXT,
  detail         TEXT,
  created_at     INTEGER NOT NULL              -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_patient_id ON audit_log(patient_id);

-- Idle privacy lock (seconds of inactivity before the screen locks; 0 = off).
ALTER TABLE settings ADD COLUMN idle_lock_timeout_ms INTEGER NOT NULL DEFAULT 300000;
