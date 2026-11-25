//! Desktop sticky notes: native windows for notes that live in the one `notes` table.
//!
//! SQLite stays the single source of truth. This module only (a) makes sure the additive sticky
//! columns exist, (b) reads a note's saved geometry to create its window, and (c) restores the
//! windows of notes marked `desktop_visible` at startup. All note edits and sticky preference
//! writes (title, body, theme, position...) are done by the frontend repository.

use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::time::Duration;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, State, WebviewUrl, WebviewWindowBuilder,
};

use super::{area_for_point, Area};

pub const LABEL_PREFIX: &str = "sticky-";

/// Default sticky size in logical pixels (includes the 8px transparent shadow margin per side).
const DEFAULT_SIZE: (f64, f64) = (300.0, 330.0);
const MIN_SIZE: (f64, f64) = (200.0, 170.0);

/// Additive columns on `notes` (see migrations/005_sticky_notes.sql). Applied by `ensure_schema`
/// because Rust needs them at startup, before the frontend loads the SQL plugin.
const COLUMNS: [(&str, &str); 8] = [
    ("desktop_visible", "INTEGER NOT NULL DEFAULT 0"),
    ("sticky_x", "INTEGER"),
    ("sticky_y", "INTEGER"),
    ("sticky_width", "INTEGER"),
    ("sticky_height", "INTEGER"),
    ("sticky_theme", "TEXT NOT NULL DEFAULT 'yellow'"),
    ("sticky_always_on_top", "INTEGER NOT NULL DEFAULT 0"),
    ("sticky_list", "TEXT"),
];

pub struct StickyDb {
    pool: SqlitePool,
}

fn db_err(error: sqlx::Error) -> String {
    format!("database error: {error}")
}

impl StickyDb {
    pub fn open(db_path: &std::path::Path) -> Result<StickyDb, String> {
        let options = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(Duration::from_secs(8));
        let pool = tauri::async_runtime::block_on(SqlitePoolOptions::new().max_connections(2).connect_with(options)).map_err(db_err)?;
        Ok(StickyDb { pool })
    }

    /// Adds any missing sticky columns. Returns false if the `notes` table does not exist yet.
    /// Idempotent and additive: existing notes and data are never touched.
    pub async fn ensure_schema(&self) -> Result<bool, String> {
        let columns = sqlx::query("SELECT name FROM pragma_table_info('notes')").fetch_all(&self.pool).await.map_err(db_err)?;
        if columns.is_empty() {
            return Ok(false);
        }
        let existing: Vec<String> = columns.iter().map(|row| row.get::<String, _>(0)).collect();
        if COLUMNS.iter().all(|(name, _)| existing.iter().any(|e| e == name)) {
            return Ok(true);
        }
        // Startup and the frontend can race to get here; a "duplicate column" error just means the
        // other side won, so it is ignored below.
        for (name, ddl) in COLUMNS {
            if existing.iter().any(|e| e == name) {
                continue;
            }
            if let Err(error) = sqlx::query(&format!("ALTER TABLE notes ADD COLUMN {name} {ddl}")).execute(&self.pool).await {
                if !error.to_string().contains("duplicate column") {
                    return Err(db_err(error));
                }
            }
        }
        sqlx::query("CREATE INDEX IF NOT EXISTS notes_desktop_idx ON notes(desktop_visible)").execute(&self.pool).await.map_err(db_err)?;
        Ok(true)
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }
}

/// Sends a sticky to the desktop layer: directly above the window that hosts the desktop icons
/// (Progman / WorkerW) and below every normal app window. Stickies therefore show on the desktop
/// and are covered by other apps, instead of floating over them. Called on creation and whenever
/// a sticky loses focus (clicking one to edit raises it temporarily).
#[cfg(windows)]
pub fn lower_to_desktop<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM},
        UI::WindowsAndMessaging::{EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE},
    };
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    unsafe extern "system" fn find_host(hwnd: HWND, found: LPARAM) -> i32 {
        let mut class = [0u16; 32];
        let len = GetClassNameW(hwnd, class.as_mut_ptr(), 32) as usize;
        if String::from_utf16_lossy(&class[..len]) == "WorkerW" {
            let view = wide("SHELLDLL_DefView");
            if !FindWindowExW(hwnd, ptr::null_mut(), view.as_ptr(), ptr::null()).is_null() {
                *(found as *mut HWND) = hwnd;
                return 0;
            }
        }
        1
    }
    let Ok(target) = window.hwnd() else { return };
    // SAFETY: plain Win32 queries and one SetWindowPos on a window we own; no pointers outlive the calls.
    unsafe {
        let mut host: HWND = ptr::null_mut();
        EnumWindows(Some(find_host), &mut host as *mut HWND as LPARAM);
        if host.is_null() {
            host = FindWindowW(wide("Progman").as_ptr(), ptr::null());
        }
        if !host.is_null() {
            SetWindowPos(target.0 as HWND, host, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }
}

#[cfg(not(windows))]
pub fn lower_to_desktop<R: Runtime>(_window: &tauri::WebviewWindow<R>) {}

/// Lowers a sticky unless the user chose to float it above other windows.
pub fn settle_on_desktop<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if !window.is_always_on_top().unwrap_or(false) {
        lower_to_desktop(window);
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn label_for(id: &str) -> String {
    format!("{LABEL_PREFIX}{id}")
}

/// Creates the sticky window for `id`, or focuses it if it already exists (never a duplicate).
pub async fn open_sticky<R: Runtime>(app: &AppHandle<R>, db: &StickyDb, id: &str, focus: bool) -> Result<(), String> {
    if !valid_id(id) {
        return Err("invalid note id".into());
    }
    let label = label_for(id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.unminimize();
        if focus {
            let _ = window.set_focus();
        }
        return Ok(());
    }

    db.ensure_schema().await?;
    let row = sqlx::query("SELECT sticky_x, sticky_y, sticky_width, sticky_height, sticky_always_on_top FROM notes WHERE id = ?")
        .bind(id)
        .fetch_optional(&db.pool)
        .await
        .map_err(db_err)?
        .ok_or("That note no longer exists")?;
    let saved_x: Option<i64> = row.get(0);
    let saved_y: Option<i64> = row.get(1);
    let saved_w: Option<i64> = row.get(2);
    let saved_h: Option<i64> = row.get(3);
    let on_top = row.get::<i64, _>(4) != 0;

    // Default placement: cascade from the top-left of the primary work area, in physical pixels.
    let primary = app.primary_monitor().ok().flatten().map(|m| Area::from_monitor(&m));
    let scale = primary.as_ref().map(|a| a.scale).unwrap_or(1.0);
    let existing = app.webview_windows().keys().filter(|l| l.starts_with(LABEL_PREFIX)).count() as i32;
    let step = ((existing % 10) as f64 * 32.0 * scale).round() as i32;

    let width = saved_w.map(|w| w as i32).unwrap_or((DEFAULT_SIZE.0 * scale).round() as i32).max((MIN_SIZE.0 * scale).round() as i32);
    let height = saved_h.map(|h| h as i32).unwrap_or((DEFAULT_SIZE.1 * scale).round() as i32).max((MIN_SIZE.1 * scale).round() as i32);
    let (mut x, mut y) = match (saved_x, saved_y) {
        (Some(x), Some(y)) => (x as i32, y as i32),
        _ => match &primary {
            Some(area) => (area.x + (90.0 * scale).round() as i32 + step, area.y + (90.0 * scale).round() as i32 + step),
            None => (100 + step, 100 + step),
        },
    };
    // Recover from a disconnected monitor or an off-screen position.
    if let Some(area) = area_for_point(app, x + width / 2, y + height / 2) {
        (x, y) = area.clamp(x, y, width, height);
    }

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Nottli Sticky")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(true)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(on_top)
        .min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
        .focused(focus)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    window.set_size(PhysicalSize::new(width as u32, height as u32)).map_err(|e| e.to_string())?;
    window.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    if focus {
        // Being opened to type: stay in front while focused; it drops to the desktop on blur.
        let _ = window.set_focus();
    } else {
        settle_on_desktop(&window);
    }
    Ok(())
}

/// Opens a sticky window for every note marked desktop-visible. Failures are per note and silent.
pub async fn restore_all<R: Runtime>(app: &AppHandle<R>, db: &StickyDb) {
    if !matches!(db.ensure_schema().await, Ok(true)) {
        return;
    }
    let Ok(rows) = sqlx::query("SELECT id FROM notes WHERE desktop_visible = 1 ORDER BY updated_at ASC").fetch_all(&db.pool).await else {
        return;
    };
    for row in rows {
        let id: String = row.get(0);
        let _ = open_sticky(app, db, &id, false).await;
    }
}

#[tauri::command]
pub async fn ensure_sticky_schema(db: State<'_, StickyDb>) -> Result<(), String> {
    db.ensure_schema().await.map(|_| ())
}

#[tauri::command]
pub async fn sticky_open(app: AppHandle, db: State<'_, StickyDb>, id: String) -> Result<(), String> {
    open_sticky(&app, &db, &id, true).await
}

/// Closes the window only; the note stays in SQLite.
#[tauri::command]
pub fn sticky_close(app: AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid note id".into());
    }
    if let Some(window) = app.get_webview_window(&label_for(&id)) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn sticky_set_on_top(app: AppHandle, id: String, on_top: bool) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid note id".into());
    }
    if let Some(window) = app.get_webview_window(&label_for(&id)) {
        window.set_always_on_top(on_top).map_err(|e| e.to_string())?;
        if !on_top {
            lower_to_desktop(&window);
        }
    }
    Ok(())
}
