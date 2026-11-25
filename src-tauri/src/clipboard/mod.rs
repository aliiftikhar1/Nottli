//! Clipboard history for Nottli.
//!
//! Ownership: this module is the single owner of clipboard capture *and* persistence. The native
//! listener thread (`listener`) reads the clipboard (`formats`), classifies it (`classifier`) and
//! writes it through `store`; the frontend only calls the commands below and gets a minimal
//! `doodle://clipboard-changed` event carrying the new item's id.
//!
//! Privacy: monitoring is OFF unless the user opted in. No listener exists while it is off.
//! Clipboard contents are never logged.

pub mod classifier;
pub mod formats;
pub mod listener;
pub mod store;

use formats::{Captured, ReadOutcome};
use listener::Listener;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, AtomicI64, AtomicU32, AtomicU64, AtomicU8, Ordering},
    Arc, Mutex,
};
use store::{ItemFull, ListPage, ListQuery, NewItem, Store};
use tauri::{AppHandle, Emitter, Manager, State};

pub const EVENT_CLIPBOARD_CHANGED: &str = "doodle://clipboard-changed";

const STATE_OFF: u8 = 0;
const STATE_RUNNING: u8 = 1;
const STATE_PAUSED: u8 = 2;

const DEFAULT_RETENTION_DAYS: i64 = 30;
const DEFAULT_MAX_IMAGE_MB: i64 = 500;
const PREVIEW_CHARS: usize = 300;

pub fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"text\0");
    hasher.update(text.as_bytes());
    hex(&hasher.finalize())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------------------------
// Turning a captured clipboard into a storable item
// ---------------------------------------------------------------------------------------------

#[derive(Debug)]
pub enum Prepared {
    Item(Box<NewItem>),
    /// Looked like a credential; skipped (content is never retained or logged).
    Sensitive,
    TooLarge,
    Failed,
}

pub fn prepare(captured: Captured, detect_secrets: bool) -> Prepared {
    match captured {
        Captured::Text { text, html, rtf } => {
            if text.len() > formats::MAX_TEXT_BYTES {
                return Prepared::TooLarge;
            }
            if detect_secrets && classifier::looks_sensitive(&text) {
                return Prepared::Sensitive;
            }
            let class = classifier::classify_text(&text);
            let has_rich = html.is_some() || rtf.is_some();
            let content_type = if class.content_type == "text" && has_rich { "rich" } else { class.content_type };
            Prepared::Item(Box::new(NewItem {
                hash: hash_text(&text),
                content_type: content_type.into(),
                subtype: class.subtype.map(str::to_string),
                preview: classifier::make_preview(&text, PREVIEW_CHARS),
                text: Some(text),
                html,
                rtf,
                ..Default::default()
            }))
        }
        Captured::Image(image) => {
            let mut hasher = Sha256::new();
            hasher.update(b"image\0");
            hasher.update(image.width.to_le_bytes());
            hasher.update(image.height.to_le_bytes());
            hasher.update(&image.rgba);
            let hash = hex(&hasher.finalize());
            let Some(thumb) = formats::make_thumbnail(&image.rgba, image.width, image.height) else {
                return Prepared::Failed;
            };
            let (width, height, source, source_mime) = (image.width, image.height, image.source, image.source_mime);
            let Some(png) = formats::encode_png(image.rgba, width, height) else {
                return Prepared::Failed;
            };
            if png.len() > formats::MAX_PNG_BYTES {
                return Prepared::TooLarge;
            }
            Prepared::Item(Box::new(NewItem {
                hash,
                content_type: "image".into(),
                preview: format!("Image {width}×{height}"),
                mime_type: Some("image/png".into()),
                width: Some(width),
                height: Some(height),
                file_metadata: Some(serde_json::json!({ "source": source, "sourceMime": source_mime }).to_string()),
                image: Some((png, thumb)),
                ..Default::default()
            }))
        }
        Captured::Files(paths) => {
            let mut hasher = Sha256::new();
            hasher.update(b"files\0");
            for path in &paths {
                hasher.update(path.as_bytes());
                hasher.update(b"\n");
            }
            let entries: Vec<serde_json::Value> = paths.iter().take(200).map(|path| file_entry(path)).collect();
            let names: Vec<String> = paths.iter().map(|p| file_name(p)).collect();
            let preview = match names.len() {
                0 => String::new(),
                1 => names[0].clone(),
                n => format!("{} files: {}{}", n, names.iter().take(3).cloned().collect::<Vec<_>>().join(", "), if n > 3 { "…" } else { "" }),
            };
            Prepared::Item(Box::new(NewItem {
                hash: hex(&hasher.finalize()),
                content_type: "file".into(),
                preview,
                text: Some(paths.join("\n")),
                file_metadata: Some(serde_json::json!({ "count": paths.len(), "files": entries }).to_string()),
                ..Default::default()
            }))
        }
    }
}

fn file_name(path: &str) -> String {
    path.rsplit(['\\', '/']).find(|part| !part.is_empty()).unwrap_or(path).to_string()
}

fn file_entry(path: &str) -> serde_json::Value {
    let name = file_name(path);
    let ext = std::path::Path::new(&name).extension().map(|e| e.to_string_lossy().to_lowercase());
    // Inaccessible or vanished paths are fine: we only record what we can see.
    let meta = std::fs::metadata(path).ok();
    serde_json::json!({
        "path": path,
        "name": name,
        "ext": ext,
        "exists": meta.is_some(),
        "isDir": meta.as_ref().map(|m| m.is_dir()).unwrap_or(false),
    })
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (chunk[0] as u32) << 16 | (*chunk.get(1).unwrap_or(&0) as u32) << 8 | *chunk.get(2).unwrap_or(&0) as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------------------------

struct Shared {
    state: AtomicU8,
    last_seq: AtomicU32,
    /// Sequence number produced by our own clipboard write; its notification is ignored.
    ignore_seq: AtomicU32,
    /// Serialises capture against our own writes so `ignore_seq` is set before the listener looks.
    write_lock: Mutex<()>,
    secret_detection: AtomicBool,
    retention_days: AtomicI64,
    max_image_bytes: AtomicI64,
    skipped_sensitive: AtomicU64,
    skipped_excluded: AtomicU64,
    skipped_large: AtomicU64,
    last_error: Mutex<Option<String>>,
    /// The persisted user preference (`clipboard_monitoring_enabled`), distinct from whether the
    /// native listener is actually running.
    enabled: AtomicBool,
    /// Set during application shutdown so recovery never restarts the listener.
    closing: AtomicBool,
}

const SETTING_ENABLED: &str = "clipboard_monitoring_enabled";

pub struct ClipboardService {
    store: Store,
    app: AppHandle,
    shared: Arc<Shared>,
    listener: Mutex<Option<Listener>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Runtime listener state: "off" | "running" | "paused" | "error" (wanted but not running).
    pub state: &'static str,
    /// The persisted preference: does the user want monitoring on?
    pub enabled: bool,
    pub consent_given: bool,
    pub listener_alive: bool,
    pub retention_days: i64,
    pub secret_detection: bool,
    pub max_image_mb: i64,
    pub skipped_sensitive: u64,
    pub skipped_excluded: u64,
    pub skipped_large: u64,
    pub last_error: Option<String>,
    pub total_items: i64,
    pub image_bytes: i64,
}

fn state_name(state: u8) -> &'static str {
    match state {
        STATE_RUNNING => "running",
        STATE_PAUSED => "paused",
        _ => "off",
    }
}

fn run<F: std::future::Future>(future: F) -> F::Output {
    tauri::async_runtime::block_on(future)
}

impl ClipboardService {
    pub fn open(app: &AppHandle) -> Result<Arc<ClipboardService>, String> {
        let db_path = app.path().app_config_dir().map_err(|e| e.to_string())?.join("doodle.db");
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let images_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("clipboard-images");
        let store = run(Store::open(&db_path, images_dir))?;

        let reader = store.clone();
        let setting = move |key: &str| run(reader.get_setting(key)).ok().flatten();
        let retention = setting("retention_days").and_then(|v| v.parse().ok()).filter(|d| [0, 7, 30, 90].contains(d)).unwrap_or(DEFAULT_RETENTION_DAYS);
        let max_mb = setting("max_image_mb").and_then(|v| v.parse().ok()).filter(|mb| *mb > 0).unwrap_or(DEFAULT_MAX_IMAGE_MB);
        let shared = Arc::new(Shared {
            state: AtomicU8::new(STATE_OFF),
            last_seq: AtomicU32::new(0),
            ignore_seq: AtomicU32::new(0),
            write_lock: Mutex::new(()),
            secret_detection: AtomicBool::new(setting("secret_detection").as_deref() != Some("0")),
            retention_days: AtomicI64::new(retention),
            max_image_bytes: AtomicI64::new(max_mb * 1024 * 1024),
            skipped_sensitive: AtomicU64::new(0),
            skipped_excluded: AtomicU64::new(0),
            skipped_large: AtomicU64::new(0),
            last_error: Mutex::new(None),
            enabled: AtomicBool::new(false),
            closing: AtomicBool::new(false),
        });
        let service = Arc::new(ClipboardService { store, app: app.clone(), shared, listener: Mutex::new(None) });

        // Startup housekeeping: finish pending deletions, apply retention, drop orphaned images.
        let _ = run(service.store.purge_deleted(0));
        service.prune();
        let _ = run(service.store.remove_orphans());

        // Restore the persisted preference. Monitoring starts only if the user explicitly opted in.
        let consent = setting("consent").as_deref() == Some("1");
        let legacy = setting("monitoring_state");
        let enabled = match setting(SETTING_ENABLED).as_deref() {
            Some(value) => value == "true",
            // Older builds only stored `monitoring_state` (and sometimes failed to). Consent without
            // an explicit "off" means the user turned it on and never turned it off.
            None => consent && legacy.as_deref() != Some("off"),
        };
        if setting(SETTING_ENABLED).is_none() && enabled {
            let _ = run(service.store.set_setting(SETTING_ENABLED, "true"));
        }
        service.shared.enabled.store(enabled && consent, Ordering::SeqCst);
        if enabled && consent {
            let initial = if legacy.as_deref() == Some("paused") { STATE_PAUSED } else { STATE_RUNNING };
            if service.start_listener(initial).is_err() {
                service.spawn_recovery();
            }
        }
        Ok(service)
    }

    /// Retries a failed listener start in the background (the preference stays enabled).
    fn spawn_recovery(self: &Arc<Self>) {
        let service = Arc::clone(self);
        let _ = std::thread::Builder::new().name("doodle-clipboard-recovery".into()).spawn(move || {
            for delay in [2u64, 5, 15, 30, 60] {
                std::thread::sleep(std::time::Duration::from_secs(delay));
                let s = &service.shared;
                if s.closing.load(Ordering::SeqCst) || !s.enabled.load(Ordering::SeqCst) {
                    return;
                }
                let alive = service.listener.lock().map(|slot| slot.as_ref().map(Listener::is_alive).unwrap_or(false)).unwrap_or(false);
                if alive || service.start_listener(STATE_RUNNING).is_ok() {
                    return;
                }
            }
        });
    }

    async fn persist_enabled(&self, enabled: bool) {
        self.shared.enabled.store(enabled, Ordering::SeqCst);
        let _ = self.store.set_setting(SETTING_ENABLED, if enabled { "true" } else { "false" }).await;
    }

    fn prune(&self) {
        let days = self.shared.retention_days.load(Ordering::Relaxed);
        let cap = self.shared.max_image_bytes.load(Ordering::Relaxed);
        let _ = run(self.store.prune(days, cap));
    }

    fn set_error(&self, message: Option<String>) {
        if let Ok(mut slot) = self.shared.last_error.lock() {
            *slot = message;
        }
    }

    async fn persist_state(&self, state: u8) {
        let _ = self.store.set_setting("monitoring_state", state_name(state)).await;
    }

    fn start_listener(self: &Arc<Self>, initial_state: u8) -> Result<(), String> {
        let mut slot = self.listener.lock().map_err(|_| "listener lock poisoned".to_string())?;
        if slot.as_ref().map(Listener::is_alive).unwrap_or(false) {
            self.shared.state.store(initial_state, Ordering::SeqCst);
            return Ok(());
        }
        // Whatever is on the clipboard right now predates monitoring and is never captured.
        self.shared.last_seq.store(formats::sequence_number(), Ordering::SeqCst);
        self.shared.state.store(initial_state, Ordering::SeqCst);
        let service = Arc::clone(self);
        match Listener::start(move || service.on_clipboard_update()) {
            Ok(listener) => {
                *slot = Some(listener);
                self.set_error(None);
                Ok(())
            }
            Err(error) => {
                self.shared.state.store(STATE_OFF, Ordering::SeqCst);
                self.set_error(Some(error.clone()));
                Err(error)
            }
        }
    }

    fn stop_listener(&self) {
        let listener = self.listener.lock().ok().and_then(|mut slot| slot.take());
        if let Some(mut listener) = listener {
            listener.stop();
        }
    }

    /// Runs on the listener thread for every clipboard change.
    fn on_clipboard_update(self: &Arc<Self>) {
        let shared = &self.shared;
        if shared.state.load(Ordering::SeqCst) != STATE_RUNNING {
            return; // paused: the clipboard is not even read
        }
        // Let the source app finish publishing (OLE delayed rendering / flush) before we open the
        // clipboard, otherwise our read can race its render and make its own copy fail.
        std::thread::sleep(std::time::Duration::from_millis(200));
        if shared.state.load(Ordering::SeqCst) != STATE_RUNNING {
            return;
        }
        let Ok(_guard) = shared.write_lock.lock() else { return };
        let seq = formats::sequence_number();
        if seq == shared.ignore_seq.load(Ordering::SeqCst) || seq == shared.last_seq.load(Ordering::SeqCst) {
            return;
        }

        match formats::read_current() {
            ReadOutcome::Busy => {
                // Leave last_seq alone so a later notification can retry.
                self.set_error(Some("The clipboard was locked by another app; one change was missed.".into()));
            }
            ReadOutcome::Excluded => {
                shared.last_seq.store(seq, Ordering::SeqCst);
                shared.skipped_excluded.fetch_add(1, Ordering::Relaxed);
            }
            ReadOutcome::TooLarge => {
                shared.last_seq.store(seq, Ordering::SeqCst);
                shared.skipped_large.fetch_add(1, Ordering::Relaxed);
            }
            ReadOutcome::Empty | ReadOutcome::Unsupported => {
                shared.last_seq.store(seq, Ordering::SeqCst);
            }
            ReadOutcome::Captured(captured) => {
                shared.last_seq.store(seq, Ordering::SeqCst);
                match prepare(captured, shared.secret_detection.load(Ordering::Relaxed)) {
                    Prepared::Sensitive => {
                        shared.skipped_sensitive.fetch_add(1, Ordering::Relaxed);
                    }
                    Prepared::TooLarge => {
                        shared.skipped_large.fetch_add(1, Ordering::Relaxed);
                    }
                    Prepared::Failed => {}
                    Prepared::Item(item) => match run(self.store.upsert(*item)) {
                        Ok((id, _)) => {
                            self.set_error(None);
                            let _ = self.app.emit(EVENT_CLIPBOARD_CHANGED, serde_json::json!({ "id": id }));
                            self.prune();
                        }
                        // Error text from the store never contains clipboard content.
                        Err(error) => self.set_error(Some(error)),
                    },
                }
            }
        }
    }

    pub async fn status(&self) -> Result<Status, String> {
        let (total, image_bytes) = self.store.counts().await?;
        let consent = self.store.get_setting("consent").await?.as_deref() == Some("1");
        let alive = self.listener.lock().map(|slot| slot.as_ref().map(Listener::is_alive).unwrap_or(false)).unwrap_or(false);
        let s = &self.shared;
        let enabled = s.enabled.load(Ordering::SeqCst);
        // Never report "on" from the preference alone: the native listener must actually be alive.
        let state = if !enabled {
            "off"
        } else if !alive {
            "error"
        } else {
            state_name(s.state.load(Ordering::SeqCst))
        };
        let last_error = s.last_error.lock().ok().and_then(|e| e.clone());
        let last_error = if state == "error" && last_error.is_none() {
            Some("The clipboard listener is not running.".to_string())
        } else {
            last_error
        };
        Ok(Status {
            state,
            enabled,
            consent_given: consent,
            listener_alive: alive,
            retention_days: s.retention_days.load(Ordering::Relaxed),
            secret_detection: s.secret_detection.load(Ordering::Relaxed),
            max_image_mb: s.max_image_bytes.load(Ordering::Relaxed) / (1024 * 1024),
            skipped_sensitive: s.skipped_sensitive.load(Ordering::Relaxed),
            skipped_excluded: s.skipped_excluded.load(Ordering::Relaxed),
            skipped_large: s.skipped_large.load(Ordering::Relaxed),
            last_error,
            total_items: total,
            image_bytes,
        })
    }

    pub fn shutdown(&self) {
        // Only the runtime stops here; the persisted preference is untouched so it is restored.
        self.shared.closing.store(true, Ordering::SeqCst);
        self.shared.state.store(STATE_OFF, Ordering::SeqCst);
        self.stop_listener();
        let _ = run(self.store.purge_deleted(0));
        run(self.store.close());
    }
}

// ---------------------------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------------------------

/// Managed state. Holds the service, or the reason it could not be created, so a clipboard
/// failure never prevents the pet or the notes workspace from starting.
pub struct ClipboardHandle {
    inner: Mutex<Result<Arc<ClipboardService>, String>>,
}

impl ClipboardHandle {
    pub fn init(app: &AppHandle) -> ClipboardHandle {
        let result = ClipboardService::open(app);
        if let Err(error) = &result {
            eprintln!("clipboard service unavailable: {error}");
        }
        ClipboardHandle { inner: Mutex::new(result) }
    }

    fn service(&self) -> Result<Arc<ClipboardService>, String> {
        match self.inner.lock() {
            Ok(guard) => guard.clone().map_err(|e| format!("Clipboard history is unavailable: {e}")),
            Err(_) => Err("Clipboard history is unavailable".into()),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(service) = self.service() {
            service.shutdown();
        }
    }
}

type Handle<'a> = State<'a, ClipboardHandle>;

#[tauri::command]
pub async fn clipboard_status(handle: Handle<'_>) -> Result<Status, String> {
    handle.service()?.status().await
}

/// Starts monitoring. The first time, `consent` must be true (the UI shows the privacy notice).
#[tauri::command]
pub async fn clipboard_start(handle: Handle<'_>, consent: bool) -> Result<Status, String> {
    let service = handle.service()?;
    let already = service.store.get_setting("consent").await?.as_deref() == Some("1");
    if !already {
        if !consent {
            return Err("consent_required".into());
        }
        service.store.set_setting("consent", "1").await?;
    }
    // The preference is saved first: if the listener fails to start, it stays enabled, the status
    // reports "error" with the reason, and recovery / the Retry button try again.
    service.persist_enabled(true).await;
    service.persist_state(STATE_RUNNING).await;
    let worker = Arc::clone(&service);
    let started = tauri::async_runtime::spawn_blocking(move || worker.start_listener(STATE_RUNNING)).await.map_err(|e| e.to_string())?;
    if started.is_err() {
        service.spawn_recovery();
    }
    service.status().await
}

#[tauri::command]
pub async fn clipboard_stop(handle: Handle<'_>) -> Result<Status, String> {
    let service = handle.service()?;
    service.persist_enabled(false).await;
    service.shared.state.store(STATE_OFF, Ordering::SeqCst);
    let worker = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || worker.stop_listener()).await.map_err(|e| e.to_string())?;
    service.persist_state(STATE_OFF).await;
    service.set_error(None);
    service.status().await
}

#[tauri::command]
pub async fn clipboard_pause(handle: Handle<'_>) -> Result<Status, String> {
    let service = handle.service()?;
    if service.shared.state.load(Ordering::SeqCst) == STATE_RUNNING {
        service.shared.state.store(STATE_PAUSED, Ordering::SeqCst);
        service.persist_state(STATE_PAUSED).await;
    }
    service.status().await
}

#[tauri::command]
pub async fn clipboard_resume(handle: Handle<'_>) -> Result<Status, String> {
    let service = handle.service()?;
    if service.shared.state.load(Ordering::SeqCst) == STATE_PAUSED {
        // Anything copied while paused is not captured retroactively.
        let _guard = service.shared.write_lock.lock().map_err(|_| "lock poisoned".to_string())?;
        service.shared.last_seq.store(formats::sequence_number(), Ordering::SeqCst);
        service.shared.state.store(STATE_RUNNING, Ordering::SeqCst);
        drop(_guard);
        service.persist_state(STATE_RUNNING).await;
    }
    service.status().await
}

#[tauri::command]
pub async fn clipboard_list(
    handle: Handle<'_>,
    query: Option<String>,
    filter: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<ListPage, String> {
    handle
        .service()?
        .store
        .list(&ListQuery { query, filter: filter.unwrap_or_else(|| "all".into()), limit: limit.unwrap_or(60), offset: offset.unwrap_or(0) })
        .await
}

#[tauri::command]
pub async fn clipboard_get(handle: Handle<'_>, id: String) -> Result<Option<ItemFull>, String> {
    handle.service()?.store.get(&id).await
}

/// Returns a `data:` URL for the item's thumbnail or full-size PNG.
#[tauri::command]
pub async fn clipboard_image(handle: Handle<'_>, id: String, thumb: bool) -> Result<String, String> {
    let bytes = handle.service()?.store.read_image(&id, thumb).await?;
    Ok(format!("data:image/png;base64,{}", base64(&bytes)))
}

#[tauri::command]
pub async fn clipboard_copy(handle: Handle<'_>, id: String) -> Result<(), String> {
    let service = handle.service()?;
    let payload = service.store.copy_payload(&id).await?.ok_or("That item no longer exists")?;
    write_without_capture(&service, payload).await?;
    service.store.touch(&id).await?;
    let _ = service.app.emit(EVENT_CLIPBOARD_CHANGED, serde_json::json!({ "id": id }));
    Ok(())
}

/// Copies descriptive metadata (image size, file paths) as plain text.
#[tauri::command]
pub async fn clipboard_copy_metadata(handle: Handle<'_>, id: String) -> Result<(), String> {
    let service = handle.service()?;
    let item = service.store.get(&id).await?.ok_or("That item no longer exists")?;
    let s = &item.summary;
    let text = match s.content_type.as_str() {
        "image" => format!("{}x{} PNG", s.width.unwrap_or(0), s.height.unwrap_or(0)),
        "file" => item.text.clone().unwrap_or_default(),
        _ => item.text.clone().unwrap_or_default(),
    };
    let payload = store::CopyPayload { content_type: "text".into(), text: Some(text), html: None, rtf: None, png: None, files: vec![] };
    write_without_capture(&service, payload).await
}

async fn write_without_capture(service: &Arc<ClipboardService>, payload: store::CopyPayload) -> Result<(), String> {
    let worker = Arc::clone(service);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = worker.shared.write_lock.lock().map_err(|_| "lock poisoned".to_string())?;
        let seq = formats::write_payload(&payload)?;
        worker.shared.ignore_seq.store(seq, Ordering::SeqCst);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn clipboard_set_pinned(handle: Handle<'_>, id: String, pinned: bool) -> Result<(), String> {
    handle.service()?.store.set_pinned(&id, pinned).await
}

#[tauri::command]
pub async fn clipboard_delete(handle: Handle<'_>, id: String) -> Result<(), String> {
    handle.service()?.store.soft_delete(&id).await
}

#[tauri::command]
pub async fn clipboard_restore(handle: Handle<'_>, id: String) -> Result<(), String> {
    handle.service()?.store.restore(&id).await
}

#[tauri::command]
pub async fn clipboard_clear(handle: Handle<'_>, unpinned_only: bool) -> Result<u64, String> {
    handle.service()?.store.clear(unpinned_only).await
}

#[tauri::command]
pub async fn clipboard_set_retention(handle: Handle<'_>, days: i64) -> Result<Status, String> {
    if ![0, 7, 30, 90].contains(&days) {
        return Err("Retention must be 7, 30, 90 days or forever".into());
    }
    let service = handle.service()?;
    service.store.set_setting("retention_days", &days.to_string()).await?;
    service.shared.retention_days.store(days, Ordering::Relaxed);
    let worker = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || worker.prune()).await.map_err(|e| e.to_string())?;
    service.status().await
}

#[tauri::command]
pub async fn clipboard_set_secret_detection(handle: Handle<'_>, enabled: bool) -> Result<Status, String> {
    let service = handle.service()?;
    service.store.set_setting("secret_detection", if enabled { "1" } else { "0" }).await?;
    service.shared.secret_detection.store(enabled, Ordering::Relaxed);
    service.status().await
}

#[tauri::command]
pub async fn clipboard_set_max_image_mb(handle: Handle<'_>, megabytes: i64) -> Result<Status, String> {
    if !(10..=10_000).contains(&megabytes) {
        return Err("Image storage limit must be between 10 MB and 10 GB".into());
    }
    let service = handle.service()?;
    service.store.set_setting("max_image_mb", &megabytes.to_string()).await?;
    service.shared.max_image_bytes.store(megabytes * 1024 * 1024, Ordering::Relaxed);
    let worker = Arc::clone(&service);
    tauri::async_runtime::spawn_blocking(move || worker.prune()).await.map_err(|e| e.to_string())?;
    service.status().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use formats::DecodedImage;

    fn text(t: &str, html: Option<&str>) -> Captured {
        Captured::Text { text: t.into(), html: html.map(str::to_string), rtf: None }
    }

    fn item(prepared: Prepared) -> NewItem {
        match prepared {
            Prepared::Item(item) => *item,
            other => panic!("expected an item, got {other:?}"),
        }
    }

    #[test]
    fn text_is_preserved_exactly_and_classified() {
        let original = "  007.50 ";
        let it = item(prepare(text(original, None), true));
        assert_eq!(it.text.as_deref(), Some(original));
        assert_eq!(it.content_type, "number");
        assert_eq!(it.subtype.as_deref(), Some("decimal"));
        assert_eq!(item(prepare(text("https://example.com", None), true)).content_type, "url");
        assert_eq!(item(prepare(text("fn main() {\n    run();\n}", None), true)).content_type, "code");
    }

    #[test]
    fn rich_text_keeps_markup_and_plain_fallback() {
        let it = item(prepare(text("hello world", Some("<b>hello</b> world")), true));
        assert_eq!(it.content_type, "rich");
        assert_eq!(it.html.as_deref(), Some("<b>hello</b> world"));
        assert_eq!(it.text.as_deref(), Some("hello world"));
    }

    #[test]
    fn same_text_hashes_equal_and_different_text_differs() {
        let a = item(prepare(text("same", None), true));
        let b = item(prepare(text("same", Some("<i>same</i>")), true));
        let c = item(prepare(text("different", None), true));
        assert_eq!(a.hash, b.hash);
        assert_ne!(a.hash, c.hash);
    }

    #[test]
    fn secrets_are_skipped_only_when_detection_is_on() {
        let secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
        assert!(matches!(prepare(text(secret, None), true), Prepared::Sensitive));
        assert!(matches!(prepare(text(secret, None), false), Prepared::Item(_)));
    }

    #[test]
    fn oversized_text_is_refused() {
        let big = "a ".repeat(formats::MAX_TEXT_BYTES);
        assert!(matches!(prepare(text(&big, None), false), Prepared::TooLarge));
        let ok = "word ".repeat(100_000);
        assert!(matches!(prepare(text(&ok, None), false), Prepared::Item(_)));
    }

    #[test]
    fn image_becomes_png_with_thumbnail_and_metadata() {
        let (w, h) = (300u32, 150u32);
        let rgba: Vec<u8> = (0..w * h).flat_map(|i| [(i % 255) as u8, 80, 200, 255]).collect();
        let it = item(prepare(
            Captured::Image(DecodedImage { rgba, width: w, height: h, source: "CF_DIB", source_mime: "image/bmp" }),
            true,
        ));
        assert_eq!(it.content_type, "image");
        assert_eq!((it.width, it.height), (Some(300), Some(150)));
        assert_eq!(it.mime_type.as_deref(), Some("image/png"));
        let (png, thumb) = it.image.unwrap();
        assert_eq!(&png[1..4], b"PNG");
        let (tw, th, _) = formats::decode_encoded(&thumb, image::ImageFormat::Png).unwrap();
        assert_eq!((tw, th), (192, 96));
        assert!(it.file_metadata.unwrap().contains("CF_DIB"));
    }

    #[test]
    fn files_are_labelled_as_references_with_metadata() {
        let paths = vec!["C:\\Users\\me\\report.PDF".to_string(), "D:\\gone\\missing.txt".to_string()];
        let it = item(prepare(Captured::Files(paths.clone()), true));
        assert_eq!(it.content_type, "file");
        assert_eq!(it.preview, "2 files: report.PDF, missing.txt");
        assert_eq!(it.text.as_deref(), Some("C:\\Users\\me\\report.PDF\nD:\\gone\\missing.txt"));
        let meta: serde_json::Value = serde_json::from_str(it.file_metadata.as_deref().unwrap()).unwrap();
        assert_eq!(meta["count"], 2);
        assert_eq!(meta["files"][0]["ext"], "pdf");
        assert_eq!(meta["files"][1]["exists"], false, "inaccessible paths are handled gracefully");
        let single = item(prepare(Captured::Files(vec!["C:\\a\\b.txt".into()]), true));
        assert_eq!(single.preview, "b.txt");
    }

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
