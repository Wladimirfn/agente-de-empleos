-- Migration 0007: scan settings for user-configurable auto-scan interval
-- Stores how often the worker enqueues automatic platform scans,
-- editable from the /ofertas page.
CREATE TABLE IF NOT EXISTS scan_settings (
  id INTEGER PRIMARY KEY NOT NULL DEFAULT 1,
  scan_interval_minutes INTEGER NOT NULL DEFAULT 30,
  auto_scan_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT scan_settings_singleton CHECK (id = 1)
);
