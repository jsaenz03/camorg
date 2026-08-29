-- Business branding: optional custom colours (hex strings) and logo
-- (inline data URL). NULL keeps the built-in Camog teal and mark.
ALTER TABLE settings ADD COLUMN brand_primary TEXT;
ALTER TABLE settings ADD COLUMN brand_accent TEXT;
ALTER TABLE settings ADD COLUMN logo_data_url TEXT;
