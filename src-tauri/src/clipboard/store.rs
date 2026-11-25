//! SQLite persistence for clipboard history. This module is the only writer of the
//! `clipboard_items` / `clipboard_settings` tables; the frontend reads through Tauri commands.
//!
//! Image bytes never go into SQLite: they live as UUID-named PNG files in a directory under the
//! app's local data folder, and the table stores only the relative file names.

use serde::Serialize;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub type Result<T> = std::result::Result<T, String>;

pub const MIGRATION_SQL: &str = include_str!("../../migrations/004_clipboard_items.sql");

/// Soft-deleted rows (awaiting a possible undo) are purged after this long.
pub const UNDO_WINDOW_MS: i64 = 60_000;

fn db_err(error: sqlx::Error) -> String {
    format!("database error: {error}")
}

fn io_err(error: std::io::Error) -> String {
    format!("file error: {error}")
}

pub fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// A fully prepared item, ready to persist.
#[derive(Debug, Clone, Default)]
pub struct NewItem {
    pub hash: String,
    pub content_type: String,
    pub subtype: Option<String>,
    pub text: Option<String>,
    pub html: Option<String>,
    pub rtf: Option<String>,
    pub preview: String,
    pub mime_type: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub file_metadata: Option<String>,
    /// (png bytes, thumbnail png bytes)
    pub image: Option<(Vec<u8>, Vec<u8>)>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemSummary {
    pub id: String,
    pub content_type: String,
    pub subtype: Option<String>,
    pub preview: String,
    pub mime_type: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub byte_size: i64,
    pub file_metadata: Option<serde_json::Value>,
    pub copied_at: i64,
    pub is_pinned: bool,
    pub has_rich: bool,
    pub text_length: i64,
    /// True when an image row's PNG file has gone missing from disk.
    pub image_missing: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemFull {
    #[serde(flatten)]
    pub summary: ItemSummary,
    pub text: Option<String>,
    pub rich_html: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListPage {
    pub items: Vec<ItemSummary>,
    pub total: i64,
}

/// Everything needed to put an item back on the clipboard.
#[derive(Debug, Clone)]
pub struct CopyPayload {
    pub content_type: String,
    pub text: Option<String>,
    pub html: Option<String>,
    pub rtf: Option<String>,
    pub png: Option<Vec<u8>>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ListQuery {
    pub query: Option<String>,
    pub filter: String,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Clone)]
pub struct Store {
    pool: SqlitePool,
    images_dir: PathBuf,
}

impl Store {
    /// Opens (never recreates) the shared application database and applies the additive migration.
    pub async fn open(db_path: &Path, images_dir: PathBuf) -> Result<Store> {
        let options = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(8))
            .foreign_keys(false);
        let pool = SqlitePoolOptions::new().max_connections(2).connect_with(options).await.map_err(db_err)?;
        Store::with_pool(pool, images_dir).await
    }

    pub async fn with_pool(pool: SqlitePool, images_dir: PathBuf) -> Result<Store> {
        std::fs::create_dir_all(&images_dir).map_err(io_err)?;
        let store = Store { pool, images_dir };
        store.migrate().await?;
        Ok(store)
    }

    async fn migrate(&self) -> Result<()> {
        // `execute` on a raw multi-statement string runs every statement; all are IF NOT EXISTS.
        sqlx::raw_sql(MIGRATION_SQL).execute(&self.pool).await.map_err(db_err)?;
        Ok(())
    }

    pub async fn close(&self) {
        // Fold the WAL back so a clean exit leaves a self-contained database file.
        let _ = sqlx::query("PRAGMA wal_checkpoint(PASSIVE)").execute(&self.pool).await;
        self.pool.close().await;
    }

    // ------------------------------------------------------------------ settings

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM clipboard_settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(row.map(|r| r.get::<String, _>(0)))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query("INSERT INTO clipboard_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(key)
            .bind(value)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    // ------------------------------------------------------------------ writes

    /// Inserts a new item, or refreshes the timestamp of an identical existing one (restoring it
    /// if it was soft-deleted). Returns `(id, is_new)`.
    pub async fn upsert(&self, item: NewItem) -> Result<(String, bool)> {
        let now = now_ms();
        let existing = sqlx::query("SELECT id, image_path, thumb_path FROM clipboard_items WHERE content_hash = ?")
            .bind(&item.hash)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;

        if let Some(row) = existing {
            let id: String = row.get(0);
            let image_path: Option<String> = row.get(1);
            // Rewrite image files if they were cleaned up while the row survived.
            if let (Some(name), Some((png, thumb))) = (image_path, item.image.as_ref()) {
                let path = self.images_dir.join(&name);
                if !path.exists() {
                    let _ = std::fs::write(&path, png);
                    if let Some(thumb_name) = row.get::<Option<String>, _>(2) {
                        let _ = std::fs::write(self.images_dir.join(thumb_name), thumb);
                    }
                }
            }
            sqlx::query("UPDATE clipboard_items SET copied_at = ?, deleted_at = NULL WHERE id = ?")
                .bind(now)
                .bind(&id)
                .execute(&self.pool)
                .await
                .map_err(db_err)?;
            return Ok((id, false));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let mut image_path = None;
        let mut thumb_path = None;
        let mut byte_size = item.text.as_ref().map(|t| t.len()).unwrap_or(0) as i64;
        if let Some((png, thumb)) = &item.image {
            let (full_name, thumb_name) = (format!("{id}.png"), format!("{id}.thumb.png"));
            std::fs::write(self.images_dir.join(&full_name), png).map_err(io_err)?;
            if let Err(error) = std::fs::write(self.images_dir.join(&thumb_name), thumb) {
                let _ = std::fs::remove_file(self.images_dir.join(&full_name));
                return Err(io_err(error));
            }
            byte_size = (png.len() + thumb.len()) as i64;
            image_path = Some(full_name);
            thumb_path = Some(thumb_name);
        }

        let inserted = sqlx::query(
            "INSERT INTO clipboard_items (id, content_type, subtype, text_content, rich_html, rich_rtf, image_path, thumb_path,
                preview, mime_type, width, height, byte_size, file_metadata, copied_at, created_at, is_pinned, content_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
        )
        .bind(&id)
        .bind(&item.content_type)
        .bind(&item.subtype)
        .bind(&item.text)
        .bind(&item.html)
        .bind(&item.rtf)
        .bind(&image_path)
        .bind(&thumb_path)
        .bind(&item.preview)
        .bind(&item.mime_type)
        .bind(item.width.map(i64::from))
        .bind(item.height.map(i64::from))
        .bind(byte_size)
        .bind(&item.file_metadata)
        .bind(now)
        .bind(now)
        .bind(&item.hash)
        .execute(&self.pool)
        .await;

        if let Err(error) = inserted {
            for name in [image_path, thumb_path].into_iter().flatten() {
                let _ = std::fs::remove_file(self.images_dir.join(name));
            }
            return Err(db_err(error));
        }
        Ok((id, true))
    }

    /// Moves an item to the top by refreshing its timestamp.
    pub async fn touch(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE clipboard_items SET copied_at = ? WHERE id = ? AND deleted_at IS NULL")
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub async fn set_pinned(&self, id: &str, pinned: bool) -> Result<()> {
        sqlx::query("UPDATE clipboard_items SET is_pinned = ? WHERE id = ?")
            .bind(pinned as i64)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    /// Soft delete: hidden immediately, purged for good after the undo window.
    pub async fn soft_delete(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE clipboard_items SET deleted_at = ? WHERE id = ?")
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    pub async fn restore(&self, id: &str) -> Result<()> {
        sqlx::query("UPDATE clipboard_items SET deleted_at = NULL WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(db_err)?;
        Ok(())
    }

    /// Permanently removes rows (and their image files) matching a WHERE clause. Returns the count.
    async fn delete_where(&self, clause: &str, bind: Option<i64>) -> Result<u64> {
        let select = format!("SELECT id, image_path, thumb_path FROM clipboard_items WHERE {clause}");
        let mut query = sqlx::query(&select);
        if let Some(value) = bind {
            query = query.bind(value);
        }
        let rows = query.fetch_all(&self.pool).await.map_err(db_err)?;
        if rows.is_empty() {
            return Ok(0);
        }
        let mut tx = self.pool.begin().await.map_err(db_err)?;
        for row in &rows {
            sqlx::query("DELETE FROM clipboard_items WHERE id = ?")
                .bind(row.get::<String, _>(0))
                .execute(&mut *tx)
                .await
                .map_err(db_err)?;
        }
        tx.commit().await.map_err(db_err)?;
        // Files go only after the rows are gone, so a failed transaction never orphans a row.
        for row in &rows {
            for column in [1usize, 2] {
                if let Some(name) = row.get::<Option<String>, _>(column) {
                    self.remove_image_file(&name);
                }
            }
        }
        Ok(rows.len() as u64)
    }

    fn remove_image_file(&self, name: &str) {
        if is_plain_file_name(name) {
            let _ = std::fs::remove_file(self.images_dir.join(name));
        }
    }

    /// Deletes everything (or everything unpinned), including items awaiting undo.
    pub async fn clear(&self, unpinned_only: bool) -> Result<u64> {
        self.delete_where(if unpinned_only { "is_pinned = 0" } else { "1 = 1" }, None).await
    }

    /// Permanently removes soft-deleted rows older than `older_than_ms` (0 = purge all of them).
    pub async fn purge_deleted(&self, older_than_ms: i64) -> Result<u64> {
        let cutoff = if older_than_ms <= 0 { i64::MAX } else { now_ms() - older_than_ms };
        self.delete_where("deleted_at IS NOT NULL AND deleted_at < ?", Some(cutoff)).await
    }

    /// Applies retention and the image-storage cap. Pinned items are never removed.
    pub async fn prune(&self, retention_days: i64, max_image_bytes: i64) -> Result<u64> {
        let mut removed = self.purge_deleted(UNDO_WINDOW_MS).await?;
        if retention_days > 0 {
            let cutoff = now_ms() - retention_days.saturating_mul(86_400_000);
            removed += self.delete_where("is_pinned = 0 AND copied_at < ?", Some(cutoff)).await?;
        }
        if max_image_bytes > 0 {
            removed += self.enforce_image_cap(max_image_bytes).await?;
        }
        Ok(removed)
    }

    async fn enforce_image_cap(&self, max_bytes: i64) -> Result<u64> {
        let total: i64 = sqlx::query("SELECT COALESCE(SUM(byte_size), 0) FROM clipboard_items WHERE image_path IS NOT NULL")
            .fetch_one(&self.pool)
            .await
            .map_err(db_err)?
            .get(0);
        if total <= max_bytes {
            return Ok(0);
        }
        let candidates = sqlx::query(
            "SELECT id, byte_size FROM clipboard_items WHERE image_path IS NOT NULL AND is_pinned = 0 ORDER BY copied_at ASC",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(db_err)?;
        let mut excess = total - max_bytes;
        let mut removed = 0;
        for row in candidates {
            if excess <= 0 {
                break;
            }
            let id: String = row.get(0);
            let size: i64 = row.get(1);
            removed += self.delete_by_id(&id).await?;
            excess -= size;
        }
        Ok(removed)
    }

    async fn delete_by_id(&self, id: &str) -> Result<u64> {
        let rows = sqlx::query("SELECT image_path, thumb_path FROM clipboard_items WHERE id = ?")
            .bind(id)
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        sqlx::query("DELETE FROM clipboard_items WHERE id = ?").bind(id).execute(&self.pool).await.map_err(db_err)?;
        for row in &rows {
            for column in [0usize, 1] {
                if let Some(name) = row.get::<Option<String>, _>(column) {
                    self.remove_image_file(&name);
                }
            }
        }
        Ok(rows.len() as u64)
    }

    /// Removes image files that no row references (left by crashes or manual edits).
    pub async fn remove_orphans(&self) -> Result<u64> {
        let rows = sqlx::query("SELECT image_path, thumb_path FROM clipboard_items")
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        let mut referenced = HashSet::new();
        for row in &rows {
            for column in [0usize, 1] {
                if let Some(name) = row.get::<Option<String>, _>(column) {
                    referenced.insert(name);
                }
            }
        }
        let mut removed = 0;
        let Ok(entries) = std::fs::read_dir(&self.images_dir) else {
            return Ok(0);
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".png") && !referenced.contains(&name) && std::fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
        Ok(removed)
    }

    // ------------------------------------------------------------------ reads

    fn where_clause(query: &ListQuery) -> (String, Option<String>) {
        let mut clause = String::from("deleted_at IS NULL");
        clause.push_str(match query.filter.as_str() {
            "text" => " AND content_type IN ('text', 'rich')",
            "images" => " AND content_type = 'image'",
            "numbers" => " AND content_type = 'number'",
            "files" => " AND content_type = 'file'",
            "urls" => " AND content_type = 'url'",
            "code" => " AND content_type = 'code'",
            _ => "",
        });
        let pattern = query.query.as_deref().map(str::trim).filter(|q| !q.is_empty()).map(|q| {
            let escaped = q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
            format!("%{escaped}%")
        });
        if pattern.is_some() {
            clause.push_str(" AND (text_content LIKE ? ESCAPE '\\' OR preview LIKE ? ESCAPE '\\')");
        }
        (clause, pattern)
    }

    pub async fn list(&self, query: &ListQuery) -> Result<ListPage> {
        let (clause, pattern) = Self::where_clause(query);

        let count_sql = format!("SELECT COUNT(*) FROM clipboard_items WHERE {clause}");
        let mut count = sqlx::query(&count_sql);
        if let Some(p) = &pattern {
            count = count.bind(p).bind(p);
        }
        let total: i64 = count.fetch_one(&self.pool).await.map_err(db_err)?.get(0);

        let sql = format!(
            "SELECT id, content_type, subtype, preview, mime_type, width, height, byte_size, file_metadata, copied_at, is_pinned,
                    (rich_html IS NOT NULL OR rich_rtf IS NOT NULL) AS has_rich, COALESCE(length(text_content), 0) AS text_len, image_path
             FROM clipboard_items WHERE {clause}
             ORDER BY is_pinned DESC, copied_at DESC, rowid DESC LIMIT ? OFFSET ?"
        );
        let mut select = sqlx::query(&sql);
        if let Some(p) = &pattern {
            select = select.bind(p).bind(p);
        }
        let rows = select
            .bind(query.limit.clamp(1, 500))
            .bind(query.offset.max(0))
            .fetch_all(&self.pool)
            .await
            .map_err(db_err)?;
        let items = rows.iter().map(|row| self.summary_from_row(row)).collect();
        Ok(ListPage { items, total })
    }

    fn summary_from_row(&self, row: &sqlx::sqlite::SqliteRow) -> ItemSummary {
        let image_path: Option<String> = row.get("image_path");
        let image_missing = image_path
            .as_deref()
            .map(|name| !is_plain_file_name(name) || !self.images_dir.join(name).exists())
            .unwrap_or(false);
        let metadata: Option<String> = row.get("file_metadata");
        ItemSummary {
            id: row.get("id"),
            content_type: row.get("content_type"),
            subtype: row.get("subtype"),
            preview: row.get("preview"),
            mime_type: row.get("mime_type"),
            width: row.get("width"),
            height: row.get("height"),
            byte_size: row.get("byte_size"),
            file_metadata: metadata.and_then(|json| serde_json::from_str(&json).ok()),
            copied_at: row.get("copied_at"),
            is_pinned: row.get::<i64, _>("is_pinned") != 0,
            has_rich: row.get::<i64, _>("has_rich") != 0,
            text_length: row.get("text_len"),
            image_missing,
        }
    }

    pub async fn get(&self, id: &str) -> Result<Option<ItemFull>> {
        let row = sqlx::query(
            "SELECT id, content_type, subtype, preview, mime_type, width, height, byte_size, file_metadata, copied_at, is_pinned,
                    (rich_html IS NOT NULL OR rich_rtf IS NOT NULL) AS has_rich, COALESCE(length(text_content), 0) AS text_len,
                    image_path, text_content, rich_html
             FROM clipboard_items WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;
        Ok(row.map(|row| ItemFull {
            summary: self.summary_from_row(&row),
            text: row.get("text_content"),
            rich_html: row.get("rich_html"),
        }))
    }

    pub async fn copy_payload(&self, id: &str) -> Result<Option<CopyPayload>> {
        let row = sqlx::query(
            "SELECT content_type, text_content, rich_html, rich_rtf, image_path FROM clipboard_items WHERE id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(db_err)?;
        let Some(row) = row else { return Ok(None) };
        let content_type: String = row.get(0);
        let text: Option<String> = row.get(1);
        let png = match row.get::<Option<String>, _>(4) {
            Some(name) if is_plain_file_name(&name) => {
                Some(std::fs::read(self.images_dir.join(name)).map_err(|_| "The saved image file is missing".to_string())?)
            }
            _ => None,
        };
        let files = if content_type == "file" {
            text.as_deref().map(|t| t.lines().map(str::to_string).collect()).unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(Some(CopyPayload { content_type, text, html: row.get(2), rtf: row.get(3), png, files }))
    }

    pub async fn read_image(&self, id: &str, thumb: bool) -> Result<Vec<u8>> {
        let column = if thumb { "thumb_path" } else { "image_path" };
        let row = sqlx::query(&format!("SELECT {column} FROM clipboard_items WHERE id = ? AND deleted_at IS NULL"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(db_err)?;
        let name: Option<String> = row.and_then(|r| r.get(0));
        let name = name.filter(|n| is_plain_file_name(n)).ok_or("This item has no image")?;
        std::fs::read(self.images_dir.join(name)).map_err(|_| "The saved image file is missing".to_string())
    }

    pub async fn counts(&self) -> Result<(i64, i64)> {
        let row = sqlx::query(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN image_path IS NOT NULL THEN byte_size ELSE 0 END), 0)
             FROM clipboard_items WHERE deleted_at IS NULL",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(db_err)?;
        Ok((row.get(0), row.get(1)))
    }
}

/// Image names come from our own DB, but never let one escape the images directory.
fn is_plain_file_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && name != "." && name != ".."
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("doodle-clip-test-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn run<F: std::future::Future>(future: F) -> F::Output {
        tauri::async_runtime::block_on(future)
    }

    async fn memory_store(tag: &str) -> (Store, PathBuf) {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        let dir = temp_dir(tag);
        (Store::with_pool(pool, dir.clone()).await.unwrap(), dir)
    }

    fn text_item(text: &str, kind: &str) -> NewItem {
        NewItem {
            hash: super::super::hash_text(text),
            content_type: kind.into(),
            text: Some(text.into()),
            preview: super::super::classifier::make_preview(text, 300),
            ..Default::default()
        }
    }

    fn image_item(seed: u8, size: usize) -> NewItem {
        NewItem {
            hash: format!("img-{seed}"),
            content_type: "image".into(),
            preview: "Image".into(),
            mime_type: Some("image/png".into()),
            width: Some(2),
            height: Some(2),
            image: Some((vec![seed; size], vec![seed; 4])),
            ..Default::default()
        }
    }

    fn query(filter: &str, q: Option<&str>) -> ListQuery {
        ListQuery { query: q.map(str::to_string), filter: filter.into(), limit: 100, offset: 0 }
    }

    #[test]
    fn migration_is_idempotent_and_additive() {
        run(async {
            let (store, dir) = memory_store("migrate").await;
            store.migrate().await.unwrap();
            store.migrate().await.unwrap();
            sqlx::query("CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT)").execute(&store.pool).await.unwrap();
            sqlx::query("INSERT INTO notes VALUES ('a', 'keep me')").execute(&store.pool).await.unwrap();
            store.migrate().await.unwrap();
            let body: String = sqlx::query("SELECT body FROM notes").fetch_one(&store.pool).await.unwrap().get(0);
            assert_eq!(body, "keep me");
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn dedupes_by_hash_and_refreshes_timestamp() {
        run(async {
            let (store, dir) = memory_store("dedupe").await;
            let (first, is_new) = store.upsert(text_item("hello", "text")).await.unwrap();
            assert!(is_new);
            let (_, _) = store.upsert(text_item("other", "text")).await.unwrap();
            tokio_sleep(5).await;
            let (again, is_new_again) = store.upsert(text_item("hello", "text")).await.unwrap();
            assert_eq!(first, again);
            assert!(!is_new_again);
            let page = store.list(&query("all", None)).await.unwrap();
            assert_eq!(page.total, 2);
            assert_eq!(page.items[0].id, first, "refreshed item moves to the top");
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    async fn tokio_sleep(ms: u64) {
        let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(Duration::from_millis(ms))).await;
    }

    #[test]
    fn pinned_first_and_filters_and_search() {
        run(async {
            let (store, dir) = memory_store("filters").await;
            let (a, _) = store.upsert(text_item("alpha note", "text")).await.unwrap();
            tokio_sleep(3).await;
            store.upsert(text_item("https://example.com", "url")).await.unwrap();
            tokio_sleep(3).await;
            let mut number = text_item("007.50", "number");
            number.subtype = Some("decimal".into());
            store.upsert(number).await.unwrap();
            tokio_sleep(3).await;
            store.upsert(text_item("fn main() {}", "code")).await.unwrap();
            store.upsert(image_item(1, 10)).await.unwrap();

            store.set_pinned(&a, true).await.unwrap();
            let all = store.list(&query("all", None)).await.unwrap();
            assert_eq!(all.total, 5);
            assert_eq!(all.items[0].id, a, "pinned items stay on top");

            assert_eq!(store.list(&query("urls", None)).await.unwrap().total, 1);
            assert_eq!(store.list(&query("numbers", None)).await.unwrap().total, 1);
            assert_eq!(store.list(&query("code", None)).await.unwrap().total, 1);
            assert_eq!(store.list(&query("images", None)).await.unwrap().total, 1);
            assert_eq!(store.list(&query("text", None)).await.unwrap().total, 1);
            assert_eq!(store.list(&query("files", None)).await.unwrap().total, 0);

            assert_eq!(store.list(&query("all", Some("ALPHA"))).await.unwrap().total, 1);
            assert_eq!(store.list(&query("all", Some("007.50"))).await.unwrap().items[0].preview, "007.50");
            // LIKE wildcards in the query are literal.
            assert_eq!(store.list(&query("all", Some("%"))).await.unwrap().total, 0);
            assert_eq!(store.list(&query("all", Some("_"))).await.unwrap().total, 0);
            assert_eq!(store.list(&query("urls", Some("alpha"))).await.unwrap().total, 0);
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn exact_text_round_trips() {
        run(async {
            let (store, dir) = memory_store("exact").await;
            let weird = "  007.50 \r\n\tünïcode ✓ 日本語  ";
            let (id, _) = store.upsert(text_item(weird, "text")).await.unwrap();
            let full = store.get(&id).await.unwrap().unwrap();
            assert_eq!(full.text.as_deref(), Some(weird));
            let payload = store.copy_payload(&id).await.unwrap().unwrap();
            assert_eq!(payload.text.as_deref(), Some(weird));
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn soft_delete_undo_and_purge() {
        run(async {
            let (store, dir) = memory_store("delete").await;
            let (id, _) = store.upsert(image_item(2, 100)).await.unwrap();
            let png = dir.join(format!("{id}.png"));
            assert!(png.exists());
            store.soft_delete(&id).await.unwrap();
            assert_eq!(store.list(&query("all", None)).await.unwrap().total, 0);
            assert!(png.exists(), "files stay during the undo window");
            store.restore(&id).await.unwrap();
            assert_eq!(store.list(&query("all", None)).await.unwrap().total, 1);
            store.soft_delete(&id).await.unwrap();
            store.purge_deleted(0).await.unwrap();
            assert!(!png.exists(), "purging removes the image files");
            assert_eq!(store.counts().await.unwrap().0, 0);
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn copying_a_deleted_hash_resurrects_it() {
        run(async {
            let (store, dir) = memory_store("resurrect").await;
            let (id, _) = store.upsert(text_item("again", "text")).await.unwrap();
            store.soft_delete(&id).await.unwrap();
            let (id2, is_new) = store.upsert(text_item("again", "text")).await.unwrap();
            assert_eq!(id, id2);
            assert!(!is_new);
            assert_eq!(store.list(&query("all", None)).await.unwrap().total, 1);
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn retention_prunes_unpinned_only() {
        run(async {
            let (store, dir) = memory_store("retention").await;
            let (old, _) = store.upsert(text_item("old", "text")).await.unwrap();
            let (old_pinned, _) = store.upsert(text_item("old pinned", "text")).await.unwrap();
            let (fresh, _) = store.upsert(text_item("fresh", "text")).await.unwrap();
            let forty_days = now_ms() - 40 * 86_400_000;
            for id in [&old, &old_pinned] {
                sqlx::query("UPDATE clipboard_items SET copied_at = ? WHERE id = ?").bind(forty_days).bind(id).execute(&store.pool).await.unwrap();
            }
            store.set_pinned(&old_pinned, true).await.unwrap();

            assert_eq!(store.prune(0, 0).await.unwrap(), 0, "forever keeps everything");
            assert_eq!(store.prune(30, 0).await.unwrap(), 1);
            let ids: Vec<String> = store.list(&query("all", None)).await.unwrap().items.into_iter().map(|i| i.id).collect();
            assert!(ids.contains(&old_pinned) && ids.contains(&fresh) && !ids.contains(&old));
            assert_eq!(store.prune(7, 0).await.unwrap(), 0);
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn image_cap_evicts_oldest_unpinned() {
        run(async {
            let (store, dir) = memory_store("cap").await;
            let (a, _) = store.upsert(image_item(1, 1000)).await.unwrap();
            tokio_sleep(3).await;
            let (b, _) = store.upsert(image_item(2, 1000)).await.unwrap();
            tokio_sleep(3).await;
            let (c, _) = store.upsert(image_item(3, 1000)).await.unwrap();
            store.set_pinned(&a, true).await.unwrap();
            // Each image costs 1004 bytes; allow two.
            assert_eq!(store.prune(0, 2100).await.unwrap(), 1);
            let ids: Vec<String> = store.list(&query("all", None)).await.unwrap().items.into_iter().map(|i| i.id).collect();
            assert!(ids.contains(&a) && ids.contains(&c) && !ids.contains(&b));
            assert!(!dir.join(format!("{b}.png")).exists());
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn clear_and_orphans() {
        run(async {
            let (store, dir) = memory_store("clear").await;
            let (keep, _) = store.upsert(image_item(1, 50)).await.unwrap();
            store.upsert(image_item(2, 50)).await.unwrap();
            store.upsert(text_item("t", "text")).await.unwrap();
            store.set_pinned(&keep, true).await.unwrap();
            std::fs::write(dir.join("stray.png"), b"x").unwrap();
            assert_eq!(store.remove_orphans().await.unwrap(), 1);
            assert!(!dir.join("stray.png").exists());
            assert!(dir.join(format!("{keep}.png")).exists());

            assert_eq!(store.clear(true).await.unwrap(), 2);
            assert_eq!(store.counts().await.unwrap().0, 1);
            assert_eq!(store.clear(false).await.unwrap(), 1);
            assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "no image files remain");
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn missing_image_file_is_reported_not_fatal() {
        run(async {
            let (store, dir) = memory_store("missing").await;
            let (id, _) = store.upsert(image_item(9, 20)).await.unwrap();
            std::fs::remove_file(dir.join(format!("{id}.png"))).unwrap();
            let page = store.list(&query("images", None)).await.unwrap();
            assert!(page.items[0].image_missing);
            assert!(store.read_image(&id, false).await.is_err());
            assert!(store.copy_payload(&id).await.is_err());
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn settings_round_trip() {
        run(async {
            let (store, dir) = memory_store("settings").await;
            assert_eq!(store.get_setting("k").await.unwrap(), None);
            store.set_setting("k", "1").await.unwrap();
            store.set_setting("k", "2").await.unwrap();
            assert_eq!(store.get_setting("k").await.unwrap().as_deref(), Some("2"));
            let _ = std::fs::remove_dir_all(dir);
        });
    }

    #[test]
    fn rejects_path_traversal_names() {
        assert!(!is_plain_file_name("../x.png"));
        assert!(!is_plain_file_name("a\\b.png"));
        assert!(is_plain_file_name("abc.png"));
    }
}
