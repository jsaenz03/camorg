-- Photos: exact pinpoint mark (the X on the body map).
-- Coordinates are normalized 0..1 within the diagram the user clicked:
--   'body' = whole-body map (200x320 viewBox), 'part' = the body part's
--   zoomed detail diagram. NULL = never pinpointed.
ALTER TABLE photos ADD COLUMN pin_x REAL;
ALTER TABLE photos ADD COLUMN pin_y REAL;
ALTER TABLE photos ADD COLUMN pin_space TEXT CHECK (pin_space IN ('body', 'part'));
