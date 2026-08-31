-- Scheduled review dates for individual photos.
--
-- Mirrors the patient-level review schedule (migration 010) but scoped to
-- one photo / body part: a clinician sets a date in the edit-photo dialog,
-- the dashboard alert list flags it as due-soon / overdue (derived at read
-- time in lib/utils/photo-review.ts — no background job), and completing
-- the review ("Mark reviewed") stamps last_reviewed_at and clears the date.
-- review_due_at is day-precision (local midnight unix ms, the patients
-- review_due_at convention).

ALTER TABLE photos ADD COLUMN review_due_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_photos_review_due_at ON photos(review_due_at);
