-- Result files: documents (PDF, RTF, …) attached to a photo, and through it
-- to the patient. Bytes live on disk under {photosDir}/results/{stored_name};
-- this table holds metadata only, mirroring how photos store just filenames.
--
-- Photos are only ever soft-deleted and their bytes stay on disk, so result
-- files follow the same rule: remove = soft-delete here, bytes kept for the
-- audit trail (a clinician can always be shown what was on record).

CREATE TABLE IF NOT EXISTS result_files (
  id              TEXT    PRIMARY KEY,           -- UUID v4
  photo_id        TEXT    NOT NULL,
  patient_id      TEXT    NOT NULL,              -- denormalised from the photo
  original_name   TEXT    NOT NULL,              -- name as picked by the clinician
  stored_name     TEXT    NOT NULL,              -- filename inside the results dir
  mime_type       TEXT    NOT NULL,              -- derived from the extension
  file_size_bytes INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,              -- unix ms
  updated_at      INTEGER NOT NULL,
  clinician_id    TEXT    NOT NULL DEFAULT '',
  is_deleted      INTEGER NOT NULL DEFAULT 0,    -- 0/1
  deleted_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_result_files_photo   ON result_files(photo_id);
CREATE INDEX IF NOT EXISTS idx_result_files_patient ON result_files(patient_id);
CREATE INDEX IF NOT EXISTS idx_result_files_is_deleted ON result_files(is_deleted);
