mod clipboard;
mod sticky;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Runtime, WebviewWindow,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

const PET: &str = "pet";
const NOTES: &str = "notes";
/// Pet window size used only if the config has no "pet" window entry.
const PET_FALLBACK_SIZE: f64 = 120.0;
/// Logical size of the notes window (includes a transparent margin for the panel shadow).
const NOTES_SIZE: (f64, f64) = (420.0, 600.0);
const SCREEN_MARGIN: f64 = 16.0;
const NOTES_GAP: f64 = 2.0;
const TOGGLE_SHORTCUT: &str = "CommandOrControl+Alt+N";
const WINDOW_STATE_FILE: &str = "window-state.json";
const STARTUP_VALUE_NAME: &str = "Nottli";
#[cfg(windows)]
const LEGACY_STARTUP_VALUE_NAME: &str = "DesktopDoodleCompanion";
pub const DATABASE_URL: &str = "sqlite:doodle.db";

const EVENT_NOTES_VISIBILITY: &str = "doodle://notes-visibility";
const EVENT_BEFORE_QUIT: &str = "doodle://before-quit";
const EVENT_NEW_STICKY: &str = "doodle://new-sticky";
const EVENT_STICKY_CLOSE: &str = "doodle://sticky-close-requested";
const NEW_STICKY_SHORTCUT: &str = "CommandOrControl+Alt+S";

/// Asks the workspace (which owns note creation) to create a note and open it as a sticky.
fn request_new_sticky<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_to(NOTES, EVENT_NEW_STICKY, ());
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct WindowState {
    x: Option<i32>,
    y: Option<i32>,
    #[serde(default)]
    launch_at_startup: bool,
}

// ---------------------------------------------------------------------------
// Persisted window state
// ---------------------------------------------------------------------------

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join(WINDOW_STATE_FILE))
}

fn read_window_state<R: Runtime>(app: &AppHandle<R>) -> WindowState {
    state_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn write_window_state<R: Runtime>(app: &AppHandle<R>, state: &WindowState) -> Result<(), String> {
    let path = state_path(app)?;
    let contents = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, contents).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Geometry helpers (all in physical pixels)
// ---------------------------------------------------------------------------

struct Area {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    scale: f64,
}

impl Area {
    fn from_monitor(monitor: &tauri::Monitor) -> Self {
        let rect = monitor.work_area();
        Self {
            x: rect.position.x,
            y: rect.position.y,
            width: rect.size.width as i32,
            height: rect.size.height as i32,
            scale: monitor.scale_factor(),
        }
    }

    fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.x && x < self.x + self.width && y >= self.y && y < self.y + self.height
    }

    fn clamp(&self, x: i32, y: i32, width: i32, height: i32) -> (i32, i32) {
        let margin = (SCREEN_MARGIN * self.scale).round() as i32;
        let min_x = self.x + margin;
        let min_y = self.y + margin;
        let max_x = (self.x + self.width - width - margin).max(min_x);
        let max_y = (self.y + self.height - height - margin).max(min_y);
        (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
    }
}

/// Finds the work area of the monitor containing the given point, falling back
/// to the primary monitor (e.g. when a saved monitor has been disconnected).
fn area_for_point<R: Runtime>(app: &AppHandle<R>, x: i32, y: i32) -> Option<Area> {
    let monitors = app.available_monitors().ok()?;
    monitors
        .iter()
        .map(Area::from_monitor)
        .find(|area| area.contains(x, y))
        .or_else(|| app.primary_monitor().ok().flatten().map(|m| Area::from_monitor(&m)))
        .or_else(|| monitors.first().map(Area::from_monitor))
}

fn restore_pet_position<R: Runtime>(app: &AppHandle<R>, pet: &WebviewWindow<R>) -> Result<(), String> {
    let state = read_window_state(app);
    let size = pet.outer_size().map_err(|e| e.to_string())?;
    let (w, h) = (size.width as i32, size.height as i32);

    let target = match (state.x, state.y) {
        (Some(x), Some(y)) => {
            // Use the pet's centre so a partially off-screen pet still maps to a monitor.
            area_for_point(app, x + w / 2, y + h / 2).map(|area| area.clamp(x, y, w, h))
        }
        _ => app.primary_monitor().ok().flatten().map(|monitor| {
            // First launch: bottom-right corner of the primary work area.
            let area = Area::from_monitor(&monitor);
            area.clamp(area.x + area.width, area.y + area.height, w, h)
        }),
    };

    if let Some((x, y)) = target {
        pet.set_position(Position::Physical(PhysicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Places the notes window beside the pet, on the pet's monitor, facing the
/// side of the screen with more room.
fn place_notes<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let (Some(pet), Some(notes)) = (app.get_webview_window(PET), app.get_webview_window(NOTES)) else {
        return Ok(());
    };
    let pet_pos = pet.outer_position().map_err(|e| e.to_string())?;
    let pet_size = pet.outer_size().map_err(|e| e.to_string())?;
    let (pw, ph) = (pet_size.width as i32, pet_size.height as i32);
    let Some(area) = area_for_point(app, pet_pos.x + pw / 2, pet_pos.y + ph / 2) else {
        return Ok(());
    };

    let w = (NOTES_SIZE.0 * area.scale).round() as i32;
    let h = (NOTES_SIZE.1 * area.scale).round() as i32;
    let gap = (NOTES_GAP * area.scale).round() as i32;

    let pet_cx = pet_pos.x + pw / 2;
    let pet_cy = pet_pos.y + ph / 2;
    let x = if pet_cx > area.x + area.width / 2 { pet_pos.x - w - gap } else { pet_pos.x + pw + gap };
    let y = if pet_cy > area.y + area.height / 2 { pet_pos.y + ph - h } else { pet_pos.y };
    let (x, y) = area.clamp(x, y, w, h);

    notes
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|e| e.to_string())?;
    // Re-apply the logical size after moving so DPI changes across monitors are respected.
    notes
        .set_size(LogicalSize::new(NOTES_SIZE.0, NOTES_SIZE.1))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Notes window visibility
// ---------------------------------------------------------------------------

fn notes_visible<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.get_webview_window(NOTES)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

fn open_notes<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let Some(notes) = app.get_webview_window(NOTES) else {
        return Err("Notes window is unavailable".into());
    };
    if let Some(pet) = app.get_webview_window(PET) {
        let _ = pet.show();
    }
    place_notes(app)?;
    NOTES_OPENED_AT.store(now_millis(), Ordering::SeqCst);
    notes.show().map_err(|e| e.to_string())?;
    let _ = notes.unminimize();
    let _ = notes.set_focus();
    let _ = app.emit(EVENT_NOTES_VISIBILITY, true);
    Ok(())
}

fn close_notes<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(notes) = app.get_webview_window(NOTES) {
        notes.hide().map_err(|e| e.to_string())?;
    }
    let _ = app.emit(EVENT_NOTES_VISIBILITY, false);
    Ok(())
}

static NOTES_OPENED_AT: AtomicU64 = AtomicU64::new(0);
static NOTES_BLUR_CLOSED_AT: AtomicU64 = AtomicU64::new(0);

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Clicking anywhere outside the workspace (including the pet, even to drag it) hides it.
fn close_notes_on_blur<R: Runtime>(app: &AppHandle<R>) {
    // Ignore the transient focus churn while the window is still being shown.
    if notes_visible(app) && now_millis().saturating_sub(NOTES_OPENED_AT.load(Ordering::SeqCst)) > 500 {
        NOTES_BLUR_CLOSED_AT.store(now_millis(), Ordering::SeqCst);
        let _ = close_notes(app);
    }
}

fn toggle_notes_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if notes_visible(app) {
        close_notes(app)
    } else if now_millis().saturating_sub(NOTES_BLUR_CLOSED_AT.load(Ordering::SeqCst)) < 400 {
        // The same click that took focus away (e.g. on the pet) must not reopen the panel.
        Ok(())
    } else {
        open_notes(app)
    }
}

/// Asks the notes window to flush pending edits, then exits. A fallback timer
/// guarantees the app still exits if the webview never answers.
fn request_quit<R: Runtime>(app: &AppHandle<R>) {
    let _ = app.emit_to(NOTES, EVENT_BEFORE_QUIT, ());
    // Let every open sticky flush its pending edit too.
    for label in app.webview_windows().keys().filter(|l| l.starts_with(sticky::LABEL_PREFIX)) {
        let _ = app.emit_to(label.as_str(), EVENT_BEFORE_QUIT, ());
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1500));
        handle.exit(0);
    });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn toggle_notes(app: AppHandle) -> Result<(), String> {
    toggle_notes_window(&app)
}

#[tauri::command]
fn show_notes(app: AppHandle) -> Result<(), String> {
    open_notes(&app)
}

#[tauri::command]
fn hide_notes(app: AppHandle) -> Result<(), String> {
    close_notes(&app)
}

#[tauri::command]
fn is_notes_visible(app: AppHandle) -> bool {
    notes_visible(&app)
}

/// Called (debounced) by the pet after it has been dragged.
#[tauri::command]
fn pet_moved(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let mut state = read_window_state(&app);
    state.x = Some(x);
    state.y = Some(y);
    write_window_state(&app, &state)?;
    if notes_visible(&app) {
        place_notes(&app)?;
    }
    Ok(())
}

/// Seconds since the last keyboard/mouse input anywhere on the system, so the
/// pet can fall asleep when the user is away. Read-only; no hooks are installed.
#[tauri::command]
fn get_idle_seconds() -> u64 {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct LastInputInfo {
            cb_size: u32,
            dw_time: u32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn GetLastInputInfo(plii: *mut LastInputInfo) -> i32;
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn GetTickCount() -> u32;
        }
        let mut info = LastInputInfo { cb_size: std::mem::size_of::<LastInputInfo>() as u32, dw_time: 0 };
        // SAFETY: `info` is a correctly sized, initialised LASTINPUTINFO.
        if unsafe { GetLastInputInfo(&mut info) } != 0 {
            // Both values are 32-bit tick counts; wrapping_sub handles the ~49-day rollover.
            return (unsafe { GetTickCount() }.wrapping_sub(info.dw_time) / 1000) as u64;
        }
    }
    0
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Windows startup registration (preserved from the original app, now in the tray)
// ---------------------------------------------------------------------------

/// True when running inside an MSIX package (Microsoft Store build).
#[cfg(windows)]
fn is_packaged() -> bool {
    use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
    let mut len: u32 = 0;
    // APPMODEL_ERROR_NO_PACKAGE (15700) means a plain desktop install; any other
    // result (e.g. ERROR_INSUFFICIENT_BUFFER) means a package identity exists.
    unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) != 15700 }
}

/// MSIX builds cannot use the HKCU Run key (registry writes are virtualized),
/// so they use the StartupTask declared in the package manifest instead.
#[cfg(windows)]
fn set_packaged_startup(enabled: bool) -> Result<(), String> {
    use windows::{
        core::HSTRING,
        ApplicationModel::{StartupTask, StartupTaskState},
    };
    std::thread::spawn(move || -> Result<(), String> {
        let task = StartupTask::GetAsync(&HSTRING::from("NottliStartup"))
            .and_then(|op| op.get())
            .map_err(|e| e.to_string())?;
        if enabled {
            let state = task
                .RequestEnableAsync()
                .and_then(|op| op.get())
                .map_err(|e| e.to_string())?;
            if state != StartupTaskState::Enabled && state != StartupTaskState::EnabledByPolicy {
                return Err("Startup was not enabled (blocked by the user or policy)".into());
            }
        } else {
            task.Disable().map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .join()
    .map_err(|_| "startup task thread panicked".to_string())?
}

fn set_startup_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        if is_packaged() {
            set_packaged_startup(enabled)?;
        } else {
            use winreg::{enums::HKEY_CURRENT_USER, RegKey};
            let run_key = RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags(
                    "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                    winreg::enums::KEY_WRITE,
                )
                .map_err(|e| e.to_string())?;
            let _ = run_key.delete_value(LEGACY_STARTUP_VALUE_NAME);
            if enabled {
                let executable = std::env::current_exe().map_err(|e| e.to_string())?;
                let command = format!("\"{}\" --autostart", executable.display());
                run_key.set_value(STARTUP_VALUE_NAME, &command).map_err(|e| e.to_string())?;
            } else {
                let _ = run_key.delete_value(STARTUP_VALUE_NAME);
            }
        }
    }
    let mut state = read_window_state(app);
    state.launch_at_startup = enabled;
    write_window_state(app, &state)
}

// ---------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------

fn build_tray(app: &tauri::App) -> Result<(), tauri::Error> {
    let state = read_window_state(app.handle());
    let notes = MenuItem::with_id(app, "notes", "Open notes\tCtrl+Alt+N", true, None::<&str>)?;
    let sticky_item = MenuItem::with_id(app, "sticky", "New sticky note\tCtrl+Alt+S", true, None::<&str>)?;
    let pet = MenuItem::with_id(app, "pet", "Show / hide pet", true, None::<&str>)?;
    let startup = CheckMenuItem::with_id(app, "startup", "Start with Windows", true, state.launch_at_startup, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Nottli", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&notes, &sticky_item, &pet, &startup, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("doodle")
        .tooltip("Nottli")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "notes" => {
                let _ = open_notes(app);
            }
            "sticky" => request_new_sticky(app),
            "pet" => {
                if let Some(pet) = app.get_webview_window(PET) {
                    if pet.is_visible().unwrap_or(true) {
                        let _ = close_notes(app);
                        let _ = pet.hide();
                    } else {
                        let _ = pet.show();
                    }
                }
            }
            "startup" => {
                let enabled = !read_window_state(app).launch_at_startup;
                let applied = set_startup_enabled(app, enabled).is_ok();
                let _ = startup.set_checked(if applied { enabled } else { !enabled });
            }
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let _ = toggle_notes_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create notes table",
            sql: include_str!("../migrations/001_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add note titles",
            sql: include_str!("../migrations/002_note_titles.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add note pinning",
            sql: include_str!("../migrations/003_note_pinned.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "add clipboard history",
            sql: include_str!("../migrations/004_clipboard_items.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "add sticky checklist content",
            sql: include_str!("../migrations/006_sticky_lists.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be first: a second launch focuses the existing pet instead of creating new windows.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let _ = open_notes(app);
        }))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(DATABASE_URL, migrations())
                .build(),
        )
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            toggle_notes,
            show_notes,
            hide_notes,
            is_notes_visible,
            pet_moved,
            get_idle_seconds,
            quit_app,
            sticky::ensure_sticky_schema,
            sticky::sticky_open,
            sticky::sticky_close,
            sticky::sticky_set_on_top,
            clipboard::clipboard_status,
            clipboard::clipboard_start,
            clipboard::clipboard_stop,
            clipboard::clipboard_pause,
            clipboard::clipboard_resume,
            clipboard::clipboard_list,
            clipboard::clipboard_get,
            clipboard::clipboard_image,
            clipboard::clipboard_copy,
            clipboard::clipboard_copy_metadata,
            clipboard::clipboard_set_pinned,
            clipboard::clipboard_delete,
            clipboard::clipboard_restore,
            clipboard::clipboard_clear,
            clipboard::clipboard_set_retention,
            clipboard::clipboard_set_secret_detection,
            clipboard::clipboard_set_max_image_mb
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::Focused(false) = event {
                if window.label() == NOTES {
                    close_notes_on_blur(window.app_handle());
                } else if window.label().starts_with(sticky::LABEL_PREFIX) {
                    // Back to the desktop layer: behind other apps, above the wallpaper.
                    if let Some(w) = window.app_handle().get_webview_window(window.label()) {
                        sticky::settle_on_desktop(&w);
                    }
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing never destroys a window: notes hide, the pet quits gracefully.
                api.prevent_close();
                match window.label() {
                    NOTES => {
                        let _ = close_notes(window.app_handle());
                    }
                    // A sticky's close request means "hide from desktop": its page does that
                    // (clears the flag, then asks us to destroy the window). Never a delete.
                    label if label.starts_with(sticky::LABEL_PREFIX) => {
                        let _ = window.app_handle().emit_to(label, EVENT_STICKY_CLOSE, ());
                    }
                    _ => request_quit(window.app_handle()),
                }
            }
        })
        .setup(|app| {
            build_tray(app)?;

            // Clipboard history: monitoring stays off unless the user opted in earlier. A failure
            // here is recorded in the handle and never blocks the pet or the notes workspace.
            app.manage(clipboard::ClipboardHandle::init(app.handle()));

            // Desktop stickies: make sure the additive columns exist, then reopen every note that
            // was on the desktop (with its saved position, size, theme and always-on-top flag).
            match app
                .path()
                .app_config_dir()
                .map_err(|e| e.to_string())
                .and_then(|dir| sticky::StickyDb::open(&dir.join("doodle.db")))
            {
                Ok(db) => {
                    app.manage(db);
                    let handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        let db = handle.state::<sticky::StickyDb>();
                        sticky::restore_all(&handle, &db).await;
                    });
                }
                Err(error) => eprintln!("sticky notes unavailable: {error}"),
            }

            if let Some(pet) = app.get_webview_window(PET) {
                // Windows clamps a new window to SM_CXMINTRACK (~133px) during creation, before
                // tao applies our min size. Re-apply the real size now that constraints are active.
                // The size comes from tauri.conf.json (or a --config override), never a hardcoded value.
                let (width, height) = app
                    .config()
                    .app
                    .windows
                    .iter()
                    .find(|window| window.label == PET)
                    .map(|window| (window.width, window.height))
                    .unwrap_or((PET_FALLBACK_SIZE, PET_FALLBACK_SIZE));
                let _ = pet.set_size(LogicalSize::new(width, height));
                if let Err(error) = restore_pet_position(app.handle(), &pet) {
                    eprintln!("could not restore pet position: {error}");
                }
                pet.show()?;
            }

            let shortcuts = app.global_shortcut();
            if let Err(error) = shortcuts.on_shortcut(TOGGLE_SHORTCUT, |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = toggle_notes_window(app);
                }
            }) {
                // Another app may own the shortcut; the pet and tray still work.
                eprintln!("could not register {TOGGLE_SHORTCUT}: {error}");
            }
            if let Err(error) = shortcuts.on_shortcut(NEW_STICKY_SHORTCUT, |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    request_new_sticky(app);
                }
            }) {
                eprintln!("could not register {NEW_STICKY_SHORTCUT}: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Nottli")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Stop the native listener, close the database and finish pending deletions.
                if let Some(handle) = app.try_state::<clipboard::ClipboardHandle>() {
                    handle.shutdown();
                }
                if let Some(db) = app.try_state::<sticky::StickyDb>() {
                    tauri::async_runtime::block_on(db.close());
                }
            }
        });
}
