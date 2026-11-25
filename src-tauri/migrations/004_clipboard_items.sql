-- Clipboard history. Purely additive and idempotent: it is applied both by the SQL plugin
-- (registered migration 4) and by the Rust clipboard service at startup, whichever runs first.
CREATE TABLE IF NOT EXISTS clipboard_items (
  id TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,
  subtype TEXT,
  text_content TEXT,
  rich_html TEXT,
  rich_rtf TEXT,
  image_path TEXT,
  thumb_path TEXT,
  preview TEXT NOT NULL DEFAULT '',
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  byte_size INTEGER NOT NULL DEFAULT 0,
  file_metadata TEXT,
  copied_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  content_hash TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS clipboard_items_hash_idx ON clipboard_items(content_hash);
CREATE INDEX IF NOT EXISTS clipboard_items_order_idx ON clipboard_items(is_pinned DESC, copied_at DESC);
CREATE INDEX IF NOT EXISTS clipboard_items_type_idx ON clipboard_items(content_type, copied_at DESC);

CREATE TABLE IF NOT EXISTS clipboard_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
