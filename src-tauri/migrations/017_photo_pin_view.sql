-- Photos: which face of the body the pinpoint X was marked on.
-- 'front' = anterior surfaces (palm of the hand, top of the foot, face);
-- 'back' = posterior (back of the hand, sole, back/trunk). Needed because the
-- zoomed hand/foot detail diagrams differ per face — a pin without the view
-- is ambiguous. 016 rows predate this and stay NULL; the app reads NULL as
-- 'front'.
ALTER TABLE photos ADD COLUMN pin_view TEXT CHECK (pin_view IN ('front', 'back'));
