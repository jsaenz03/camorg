-- Laterality (migration 011): which side of the patient a bilateral photo
-- belongs to. NULL for central regions (head, face, chest, ...) and for
-- photos captured before this migration.
ALTER TABLE photos ADD COLUMN laterality TEXT;
