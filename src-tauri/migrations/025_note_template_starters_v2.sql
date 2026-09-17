-- One-off starter-set replacement (v1 → v2).
--
-- The v1 starters seeded with random row ids and nothing unique to conflict
-- on, so two components listing concurrently on first use could insert the
-- whole set twice; the set itself also overlapped in content. This removes
-- exactly the v1 (title, body) pairs — anything a clinician edited or renamed
-- no longer matches and survives — and the v2 set (deterministic ids, unique
-- samples, {date}/{patient}/{bodypart} demos) reseeds on the next list.
DELETE FROM note_templates WHERE title = 'No change'
  AND body = 'No change since the previous photo — lesion stable in size, shape and colour.';
DELETE FROM note_templates WHERE title = 'Increased in size'
  AND body = 'Lesion has increased in size since the previous photo.';
DELETE FROM note_templates WHERE title = 'Border/colour change'
  AND body = 'Change in colour or border noted — monitor closely; consider earlier review.';
DELETE FROM note_templates WHERE title = 'Benign, no intervention'
  AND body = 'Benign-appearing lesion; no intervention required at this time.';
DELETE FROM note_templates WHERE title = 'Symptoms: none'
  AND body = 'Patient reports no pain, itching or bleeding at the site.';
DELETE FROM note_templates WHERE title = 'Wound healing'
  AND body = 'Wound healing well; no signs of infection.';
DELETE FROM note_templates WHERE title = 'Baseline photo'
  AND body = 'Baseline photo taken for comparison; follow-up recommended in 3 months.';
DELETE FROM note_templates WHERE title = 'Reviewed'
  AND body = 'Reviewed {date} against the previous photo — continue current management.';
