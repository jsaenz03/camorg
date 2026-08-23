-- Licence: offline Ed25519-signed licence key, first-launch trial stamp, and
-- a per-install ID (support + future seat-activation endpoint). The licence
-- key string is stored raw and re-verified on every read; no derived columns.

ALTER TABLE settings ADD COLUMN licence_key TEXT;
ALTER TABLE settings ADD COLUMN trial_started_at INTEGER;
ALTER TABLE settings ADD COLUMN install_id TEXT;
