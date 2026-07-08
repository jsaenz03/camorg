-- Camog access-control schema (organisation-scoped, by-doctor visibility).
--
-- Adds an owner to each patient, a per-patient org-wide share flag, and a
-- per-patient doctor-grant table. All ALTERs are additive — a v2 DB upgrades
-- in place. The photos/subparts/clinicians tables are structurally unchanged;
-- photos inherit the visibility of their parent patient.
--
-- Visibility rule (see lib/services/access-service.ts):
--   a clinician D can see a patient P if D is an admin, OR D owns P,
--   OR P.is_org_shared = 1, OR a row exists in patient_shares for (P, D).

-- 1. Owner + per-patient org-share flag on patients.
ALTER TABLE patients ADD COLUMN owner_clinician_id TEXT;
ALTER TABLE patients ADD COLUMN is_org_shared    INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_patients_owner       ON patients(owner_clinician_id);
CREATE INDEX IF NOT EXISTS idx_patients_org_shared ON patients(is_org_shared);

-- 2. Per-patient doctor grants (the "specific doctors" sharing mode).
CREATE TABLE IF NOT EXISTS patient_shares (
  id           TEXT    PRIMARY KEY,             -- UUID v4
  patient_id   TEXT    NOT NULL,
  clinician_id TEXT    NOT NULL,
  granted_by   TEXT    NOT NULL,                -- admin who granted
  granted_at   INTEGER NOT NULL,                -- unix ms
  UNIQUE(patient_id, clinician_id)
);

CREATE INDEX IF NOT EXISTS idx_patient_shares_patient    ON patient_shares(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_shares_clinician  ON patient_shares(clinician_id);

-- 3. Backfill owner_clinician_id for legacy rows. patients.clinician_id was
--    already populated by the v1 createPatient flow (the creator), so legacy
--    data maps to its original capturer with no manual migration.
UPDATE patients SET owner_clinician_id = clinician_id WHERE owner_clinician_id IS NULL;
