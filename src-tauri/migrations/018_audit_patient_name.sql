-- Audit trail: bake the patient's name into each row at write time.
--
-- Until now the Patient column was resolved with a read-time JOIN to the
-- patients table, so renaming a patient silently rewrote every historical
-- entry to the new name, and patient.* actions (which stored only entity_id)
-- showed a blank Patient. patient_name is denormalised like clinician_name:
-- the name as it was when the event happened, immune to later renames and
-- to the row being hard-deleted.
ALTER TABLE audit_log ADD COLUMN patient_name TEXT;

-- Pin the current names onto existing rows so a rename after upgrading can
-- no longer rewrite history that predates this column. Rows for patients
-- already hard-deleted (none today) stay NULL and fall back to the JOIN.
UPDATE audit_log SET patient_name = (SELECT name FROM patients WHERE patients.id = audit_log.patient_id)
 WHERE patient_id IS NOT NULL AND patient_name IS NULL;
