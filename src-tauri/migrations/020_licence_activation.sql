-- Licence activation: the server-signed token binding this install's
-- device ID to the licence key (seat enforcement, spec 003). Stored beside
-- the raw key and re-verified on every read.

ALTER TABLE settings ADD COLUMN licence_token TEXT;
