-- Clinician review scheduling + notification windows.
--
-- A clinician can put a review date on a patient (next_review_due_at);
-- status (upcoming / due / overdue / stale) is derived at read time in
-- types/patient.ts, so alerts never need a background job — same pattern
-- as consent expiry (migration 007).
--
-- review_due_at / last_reviewed_at are day-precision values stored as
-- unix ms at UTC midnight (the patients.dob convention, see dobToMs).

ALTER TABLE patients ADD COLUMN review_due_at INTEGER;
ALTER TABLE patients ADD COLUMN last_reviewed_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_patients_review_due_at ON patients(review_due_at);

-- Alert tuning (Settings → App settings):
--   review_warning_days — how far ahead an upcoming review starts alerting.
--   review_stale_days   — a patient with photos but no review scheduled is
--                         flagged "stale" after this many days of silence.
ALTER TABLE settings ADD COLUMN review_warning_days INTEGER NOT NULL DEFAULT 7;
ALTER TABLE settings ADD COLUMN review_stale_days INTEGER NOT NULL DEFAULT 90;
