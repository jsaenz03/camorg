-- Auto-renew (specs/005-licence-auto-renew): when on, the daily seat
-- re-check silently installs a renewed key minted by the licence server
-- after a successful subscription payment — no manual key entry, no
-- service disruption. On by default: renewal after payment should be
-- invisible; switching it off only means the user pastes the emailed key
-- themselves.
ALTER TABLE settings ADD COLUMN licence_auto_renew INTEGER NOT NULL DEFAULT 1;
