-- Audit trail: attribute legacy patient rows, snapshot photo labels.
--
-- 1) patient.* rows written before migration 018 stored only entity_id, so
--    their Patient column resolved blank. For those rows entity_id IS the
--    patient id — promote it so the name can resolve and stay resolved.
UPDATE audit_log SET patient_id = entity_id
 WHERE entity_type = 'patient' AND patient_id IS NULL AND entity_id IS NOT NULL;

-- 2) Same name backfill as 018, now also covering the rows that just gained
--    a patient_id.
UPDATE audit_log SET patient_name = (SELECT name FROM patients WHERE patients.id = audit_log.patient_id)
 WHERE patient_id IS NOT NULL AND patient_name IS NULL;

-- 3) Photo labels: baked in at write time from here on (like patient_name),
--    so later body-part edits — or a patient delete removing the photo rows —
--    can't blank or rewrite what an entry showed.
ALTER TABLE audit_log ADD COLUMN photo_label TEXT;

-- One-time backfill: pin what the read-time JOIN would display today. The
-- labels mirror types/body-part.ts (BodyPartLabels / LateralityLabels) and
-- photoAuditLabel's '<label> · dd/MM/yyyy' format; SQL can't call the TS
-- maps, so they are inlined — drift would only skew this one-time pass.
UPDATE audit_log SET photo_label = (
  SELECT CASE ph.body_part
      WHEN 'head' THEN 'Head'
      WHEN 'face' THEN 'Face'
      WHEN 'scalp' THEN 'Scalp'
      WHEN 'neck' THEN 'Neck'
      WHEN 'chest' THEN 'Chest'
      WHEN 'abdomen' THEN 'Abdomen'
      WHEN 'back' THEN 'Back'
      WHEN 'upper_arm' THEN 'Upper Arm'
      WHEN 'forearm' THEN 'Forearm'
      WHEN 'hand' THEN 'Hand'
      WHEN 'thigh' THEN 'Thigh'
      WHEN 'leg' THEN 'Leg'
      WHEN 'foot' THEN 'Foot'
      WHEN 'torso' THEN 'Torso'
      ELSE ph.body_part
    END
    || CASE ph.laterality WHEN 'left' THEN ' Left' WHEN 'right' THEN ' Right' ELSE '' END
    || ' · ' || strftime('%d/%m/%Y', ph.captured_at / 1000, 'unixepoch', 'localtime')
  FROM photos ph WHERE ph.id = audit_log.entity_id
)
WHERE entity_type = 'photo' AND photo_label IS NULL AND entity_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM photos ph WHERE ph.id = audit_log.entity_id);
