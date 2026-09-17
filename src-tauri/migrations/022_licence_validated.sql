-- Licence server re-validation (specs/003 revocation propagation): when the
-- app last got a definitive answer from POST /v1/validate (ms epoch). Only a
-- definitive server answer updates it — transport failures stay fail-open
-- and retry on the next open.

ALTER TABLE settings ADD COLUMN licence_validated_at INTEGER;
