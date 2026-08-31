-- Per-photo review stamps + lesion series grouping.
--
-- Reviewing a photo counts as the patient's review too: photo-service
-- stamps photos.last_reviewed_at and patients.last_reviewed_at in the
-- same action (reviewPhoto → patientService.markReviewed), so the
-- dashboard review badges stay the single source of truth.
--
-- lesion_group is a free-text series name (e.g. "Left cheek mole");
-- photos sharing a value on the same patient form a before/after series
-- that badges onto thumbnails and filters in the timeline.
-- ponytail: denormalised label rather than a lesion_groups table — renames
-- are a single UPDATE across the patient's photos and this is a
-- single-writer desktop app; upgrade path is a groups table joined by id.

ALTER TABLE photos ADD COLUMN last_reviewed_at INTEGER;
ALTER TABLE photos ADD COLUMN lesion_group TEXT;

CREATE INDEX IF NOT EXISTS idx_photos_patient_lesion_group ON photos(patient_id, lesion_group);
