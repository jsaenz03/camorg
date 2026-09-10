-- Photos: body part becomes optional (migration 021). A photo can be saved
-- in the heat of capture without its anatomical region; linking it into a
-- lesion series later inherits the other photo's body part
-- (lib/utils/photo-link.ts resolveLinkInheritance), and display surfaces
-- read NULL as "Unspecified". SQLite cannot relax a column constraint in
-- place, so the table is rebuilt with the same columns and indexes.

CREATE TABLE photos_v21 (
  id              TEXT    PRIMARY KEY,           -- UUID v4
  patient_id      TEXT    NOT NULL,
  image_path      TEXT    NOT NULL,              -- JPEG filename inside the photos dir
  thumbnail_path  TEXT    NOT NULL,              -- 200x200 thumbnail filename
  original_file_name TEXT NOT NULL DEFAULT '',
  mime_type       TEXT    NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  body_part       TEXT,                          -- BodyPart enum key; NULL = not set yet
  subpart         TEXT,
  clinical_notes  TEXT,
  captured_at     INTEGER NOT NULL,              -- unix ms
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  clinician_id    TEXT    NOT NULL DEFAULT '',
  is_deleted      INTEGER NOT NULL DEFAULT 0,    -- 0/1
  deleted_at      INTEGER,
  laterality      TEXT,                          -- 'left' | 'right'; bilateral regions only
  last_reviewed_at INTEGER,
  lesion_group    TEXT,
  review_due_at   INTEGER,
  pin_x           REAL,
  pin_y           REAL,
  pin_space       TEXT CHECK (pin_space IN ('body', 'part')),
  pin_view        TEXT CHECK (pin_view IN ('front', 'back'))
);

INSERT INTO photos_v21
  SELECT id, patient_id, image_path, thumbnail_path, original_file_name, mime_type,
         file_size_bytes, body_part, subpart, clinical_notes, captured_at, created_at,
         updated_at, clinician_id, is_deleted, deleted_at, laterality, last_reviewed_at,
         lesion_group, review_due_at, pin_x, pin_y, pin_space, pin_view
    FROM photos;

DROP TABLE photos;
ALTER TABLE photos_v21 RENAME TO photos;

CREATE INDEX IF NOT EXISTS idx_photos_patient_id           ON photos(patient_id);
CREATE INDEX IF NOT EXISTS idx_photos_patient_captured_at  ON photos(patient_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_photos_patient_body_part    ON photos(patient_id, body_part);
CREATE INDEX IF NOT EXISTS idx_photos_clinician_id         ON photos(clinician_id);
CREATE INDEX IF NOT EXISTS idx_photos_is_deleted           ON photos(is_deleted);
CREATE INDEX IF NOT EXISTS idx_photos_patient_lesion_group ON photos(patient_id, lesion_group);
CREATE INDEX IF NOT EXISTS idx_photos_review_due_at        ON photos(review_due_at);
