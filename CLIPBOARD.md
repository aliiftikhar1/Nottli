# Clipboard history

Native Windows clipboard history for Nottli. **Off by default.** Nothing is read until the user turns it on and accepts the privacy notice.

## Architecture

Rust owns capture *and* persistence (`src-tauri/src/clipboard/`); the React tab only calls Tauri commands.

| File | Role |
| --- | --- |
| `listener.rs` | Dedicated thread + message-only window (`HWND_MESSAGE`), `AddClipboardFormatListener` / `WM_CLIPBOARDUPDATE`. No polling. Stop = `RemoveClipboardFormatListener`, destroy window, join thread. |
| `formats.rs` | Reads/writes clipboard formats (`windows-sys`), parsers/encoders for CF_HTML, CF_HDROP, DIB, PNG/JPEG, thumbnails. |
| `classifier.rs` | Text classification (text/url/code/number + number subtype) and best-effort secret detection. |
| `store.rs` | SQLite repository (sqlx, same `doodle.db`), image files, retention, caps, orphan cleanup. Only writer of the clipboard tables. |
| `mod.rs` | Service (status, start/stop/pause/resume, dedupe, self-write suppression) and `clipboard_*` commands. |

Flow: clipboard change → (200 ms settle) → sequence-number dedupe → read formats → classify → hash → upsert → emit `doodle://clipboard-changed` `{ id }` → UI re-queries.

Self-writes ("copy again") store the post-write clipboard sequence number under a lock, so the resulting notification is ignored (no duplicate). The existing entry's timestamp is refreshed instead.

## Supported formats

- Text (`CF_UNICODETEXT`): plain text, URLs, code, numbers. Numbers are classified (integer, decimal, price, phone, id, reference) but the **exact original string is stored**.
- Rich text: HTML (`HTML Format`, bare HTML tolerated) and RTF, kept up to 512 KB each, with plain-text fallback. Restored on copy-again.
- Images: registered `PNG`, `JFIF` (JPEG), `CF_DIBV5`, `CF_DIB` (1/4/8/16/24/32-bit, BI_RGB/BI_BITFIELDS). Stored as PNG + 192 px thumbnail. Copy-again writes `PNG` and `CF_DIB`.
- Files: `CF_HDROP`. Stores **paths and metadata only** (name, extension, exists, is-folder), never contents. Labelled "File reference".

## Storage

- Metadata: SQLite `doodle.db` (`%APPDATA%\com.nottli.app\`), tables `clipboard_items`, `clipboard_settings` (migration `004_clipboard_items.sql`, additive and idempotent; applied by the SQL plugin and by the Rust service).
- Images: `%LOCALAPPDATA%\com.nottli.app\clipboard-images\<uuid>.png` and `<uuid>.thumb.png`.
- Limits: text 5 MB, images 8192 px / 20 MP / 32 MB PNG, storage cap 500 MB (setting; oldest unpinned images evicted first).

## Privacy and retention

- Monitoring OFF by default; the first start requires explicit consent. Three separate concepts: the **persisted preference** (`clipboard_monitoring_enabled` in `clipboard_settings`, written only by Turn on / Turn off), the **runtime listener status** (is the native thread alive), and the app itself. The listener is owned by the Tauri-managed service, started once at app startup when the preference is on (also when Nottli starts with Windows), and stopped only by an explicit Turn off or real app exit; workspace hide/close, tab switches and pet visibility never touch it.
- If the preference is on but the listener can't run, the tab shows "Monitoring problem" with the reason and a Retry button; startup also retries in the background (2/5/15/30/60 s). The UI never shows "on" from the preference alone.
- Databases from earlier builds (consent given, no explicit off) are treated as enabled and migrated to the new setting.
- While off there is no listener thread. While paused the clipboard is not read, and copies made during a pause are never captured retroactively. Content already on the clipboard when monitoring starts is not captured.
- Honoured source flags: `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` = 0.
- Best-effort secret skipping (toggle in settings): known token formats, private keys, `password=`-style assignments, JWTs, credentialed URLs, opaque high-entropy strings. It can miss secrets and can skip harmless text.
- Content is never logged; skip counters are shown without content.
- Retention 7 / 30 (default) / 90 days / forever; pinned items never expire. Pruned at startup, after each capture, and when settings change.
- Delete is soft for 60 s (Undo), then purged. Clear unpinned / Clear all are immediate.
- Exit stops the listener, finishes deletions, checkpoints and closes the database.

## Known limitations

- Text wins over images when both are present (e.g. Excel ranges); images are captured when there is no non-blank text.
- Not captured: RLE/compressed DIBs, GIF/other image formats, audio, custom app formats, file contents.
- Clipboard owners that hold the clipboard open for more than ~300 ms can cause a missed capture (shown as a warning).
- Secret detection is heuristic.
- Rich HTML is stored and restored but only previewed as plain text.

## How to test

```
pnpm build && pnpm test:unit          # TypeScript, Vite, UI helper tests
cd src-tauri && cargo test --lib      # 44 tests: classifier, formats, store, retention, dedupe, migration
```

Real-app checks (done with a throw-away copy of the app under a different bundle identifier so the real database was never touched): start with `TAURI_CONFIG='{"identifier":"com.nottli.app.test"}' cargo build --features custom-protocol`, run with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, drive the webviews over the DevTools protocol, and set the clipboard from PowerShell (`Set-Clipboard`, `System.Windows.Forms.Clipboard`, `DataObject` with `PNG` / `JFIF` / HTML / RTF / `FileDropList` / exclusion formats).
