-- Desktop sticky notes: additive columns on the existing `notes` table (no new table, no data copied).
--
-- NOT registered with the SQL plugin. Rust (src/sticky.rs `ensure_schema`) applies these columns,
-- skipping any that already exist, because it needs them at startup (to restore sticky windows)
-- before the frontend has loaded the plugin, and because SQLite has no ADD COLUMN IF NOT EXISTS.
-- This file is the reference for the schema; keep it in sync with COLUMNS in sticky.rs.

ALTER TABLE notes ADD COLUMN desktop_visible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notes ADD COLUMN sticky_x INTEGER;
ALTER TABLE notes ADD COLUMN sticky_y INTEGER;
ALTER TABLE notes ADD COLUMN sticky_width INTEGER;
ALTER TABLE notes ADD COLUMN sticky_height INTEGER;
ALTER TABLE notes ADD COLUMN sticky_theme TEXT NOT NULL DEFAULT 'yellow';
ALTER TABLE notes ADD COLUMN sticky_always_on_top INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notes_desktop_idx ON notes(desktop_visible);
