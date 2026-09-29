-- Scaling indexes. The global photo listings (dashboard summaries, photos
-- browser pages, the phone-link manifest) order by captured_at across ALL
-- patients, but every existing captured_at index leads with patient_id —
-- each of those reads was a full scan plus an in-memory sort. Same story
-- for getAllPatients' ORDER BY last_photo_at, which the attention poll
-- runs every 60 s. Both indexes are pure additions (no rebuild, no data
-- change); SQLite scans a b-tree backwards for DESC ordering.
CREATE INDEX IF NOT EXISTS idx_photos_captured_at ON photos(captured_at);
CREATE INDEX IF NOT EXISTS idx_patients_last_photo_at ON patients(last_photo_at);
