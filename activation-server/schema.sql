-- Camog licence activation seats (specs/003-licence-activation/spec.md).
-- One row per (licence fingerprint, device ID). revoked = 1 frees the seat
-- without losing the activation history (support-driven seat moves).
-- Apply: wrangler d1 execute camog-licence --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS activations (
  fp TEXT NOT NULL,
  device_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  last_activated_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (fp, device_id)
);

-- Purchase fulfilment records (specs/004-licence-purchase/spec.md). One row
-- per Stripe checkout session (primary key makes webhook retries
-- idempotent). tier/seats are NULL when the Payment Link metadata was
-- missing or malformed — key_text stays NULL and support fulfils by hand.
-- emailed_at NULL means the key exists but delivery hasn't succeeded yet.
CREATE TABLE IF NOT EXISTS licences (
  session_id TEXT PRIMARY KEY,
  email TEXT,
  practice TEXT,
  tier TEXT,
  seats INTEGER,
  key_text TEXT,
  key_fp TEXT,
  expires_at INTEGER,
  issued_at INTEGER,
  emailed_at INTEGER
);
