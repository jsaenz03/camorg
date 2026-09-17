-- Note templates: per-clinician quick-text phrases for clinical notes.
-- Each clinician keeps their own list (seeded with a starter set on first
-- use) — deliberately not shared, so one clinician's phrasing never lands
-- in a colleague's picker. Optional `shortcut` powers type-to-expand:
-- typing the code then Space in a notes field inserts the body.
CREATE TABLE IF NOT EXISTS note_templates (
  id TEXT PRIMARY KEY,
  clinician_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  shortcut TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Shortcuts are unique per clinician; rows without one (NULL) are exempt,
-- which is what the partial index gives us.
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_templates_shortcut
  ON note_templates(clinician_id, shortcut)
  WHERE shortcut IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_note_templates_clinician
  ON note_templates(clinician_id, is_deleted, usage_count DESC);
