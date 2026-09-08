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
