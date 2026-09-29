-- Close-to-tray: keep running in the system tray when the window is closed
-- so review/consent alerts and the tray counters stay live.
--
-- Stored on the singleton settings row (admin-controlled, like the other
-- app settings). The webview owns the stored value and pushes it to the
-- Rust shell (set_close_to_tray) on every settings load/change; the Rust
-- close handler reads its cached flag, not this table, because the close
-- event must be answered synchronously.

ALTER TABLE settings ADD COLUMN close_to_tray INTEGER NOT NULL DEFAULT 1;
