-- Camog open-signup default.
--
-- Signup must always have a codeless path: a fresh install bootstraps through
-- "Set up your organisation" (zero users → first admin), and once an org
-- exists anyone can request access — the account stays PENDING until an
-- admin approves it in Settings → Users. Invite codes remain the lane for
-- members joining an existing org (pre-authorised role, active immediately);
-- they are a joining mechanism, not a wall.
--
-- resetApp() had been forcing allow_public_signup back to 0 — a pre-005
-- belief that invite-only was the fresh-install default — leaving a reset
-- device stricter than a brand-new one (signup became code-only). Re-flip
-- the flag to the intended default. Admins who want invite-only can still
-- turn it off in Settings → App settings.

UPDATE settings SET allow_public_signup = 1, updated_at = strftime('%s','now') * 1000 WHERE id = 'app';
