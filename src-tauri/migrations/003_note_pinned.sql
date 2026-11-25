ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS notes_pinned_updated_idx ON notes(pinned DESC, updated_at DESC);
