-- Storage configuration: user-selectable photo directory (local or a
-- cloud-synced folder). NULL keeps the default {appDataDir}/photos.
ALTER TABLE settings ADD COLUMN photos_dir TEXT;
