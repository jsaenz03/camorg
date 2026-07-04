-- Camog initial schema
-- Mirrors the prior IndexedDB stores. Photos store file paths to JPEGs on disk;
-- all binary data lives in {appDataDir}/camog/photos/.

-- Photos: one row per captured clinical photo
CREATE TABLE IF NOT EXISTS photos (
  id              TEXT    PRIMARY KEY,           -- UUID v4
  patient_id      TEXT    NOT NULL,
  image_path      TEXT    NOT NULL,              -- full JPEG path on disk
  thumbnail_path  TEXT    NOT NULL,              -- 200x200 thumbnail path
  original_file_name TEXT NOT NULL DEFAULT '',
  mime_type       TEXT    NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  body_part       TEXT    NOT NULL,              -- BodyPart string enum ('head','face',...)
  subpart         TEXT,
  clinical_notes  TEXT,
  captured_at     INTEGER NOT NULL,              -- unix ms
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  clinician_id    TEXT    NOT NULL DEFAULT '',
  is_deleted      INTEGER NOT NULL DEFAULT 0,    -- 0/1
  deleted_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_photos_patient_id             ON photos(patient_id);
CREATE INDEX IF NOT EXISTS idx_photos_patient_captured_at    ON photos(patient_id, captured_at);
CREATE INDEX IF NOT EXISTS idx_photos_patient_body_part      ON photos(patient_id, body_part);
CREATE INDEX IF NOT EXISTS idx_photos_clinician_id           ON photos(clinician_id);
CREATE INDEX IF NOT EXISTS idx_photos_is_deleted             ON photos(is_deleted);

-- Patients: organizational container for photos
CREATE TABLE IF NOT EXISTS patients (
  id                   TEXT    PRIMARY KEY,       -- UUID v4
  name                 TEXT    NOT NULL,
  normalized_name      TEXT    NOT NULL,
  photo_count          INTEGER NOT NULL DEFAULT 0,
  deleted_photo_count  INTEGER NOT NULL DEFAULT 0,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL,
  last_photo_at        INTEGER,                   -- unix ms, nullable
  clinician_id         TEXT    NOT NULL DEFAULT '',
  is_archived          INTEGER NOT NULL DEFAULT 0,
  archived_at          INTEGER
);

CREATE INDEX IF NOT EXISTS idx_patients_normalized_name ON patients(normalized_name);
CREATE INDEX IF NOT EXISTS idx_patients_clinician_id    ON patients(clinician_id);
CREATE INDEX IF NOT EXISTS idx_patients_is_archived     ON patients(is_archived);

-- Subparts: autocomplete cache
CREATE TABLE IF NOT EXISTS subparts (
  id            TEXT    PRIMARY KEY,             -- UUID v4
  body_part     TEXT    NOT NULL,
  subpart       TEXT    NOT NULL,                -- normalized: lowercase, trimmed
  display_text  TEXT    NOT NULL,
  usage_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at  INTEGER NOT NULL,                -- unix ms
  clinician_id  TEXT    NOT NULL DEFAULT '',
  UNIQUE(body_part, subpart)
);

CREATE INDEX IF NOT EXISTS idx_subparts_body_part ON subparts(body_part);

-- Clinicians: authenticated users (schema only; auth not yet implemented)
CREATE TABLE IF NOT EXISTS clinicians (
  id                  TEXT    PRIMARY KEY,
  username            TEXT    NOT NULL UNIQUE,
  passcode_hash       TEXT    NOT NULL,
  display_name        TEXT    NOT NULL,
  preferences         TEXT    NOT NULL DEFAULT '{}',  -- JSON blob
  created_at          INTEGER NOT NULL,
  last_login_at       INTEGER,
  session_expires_at  INTEGER,
  UNIQUE(username)
);
