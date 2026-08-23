-- Patient date of birth (optional).
-- Stored as unix ms at UTC midnight of the birth date; NULL = not recorded.

ALTER TABLE patients ADD COLUMN dob INTEGER;

CREATE INDEX IF NOT EXISTS idx_patients_dob ON patients(dob);
