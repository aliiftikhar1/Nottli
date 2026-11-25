# Desktop sticky notes

Stickies are native windows for notes that live in the one `notes` table. There is no second store.

## Model

- Columns added to `notes` (additive; reference in `src-tauri/migrations/005_sticky_notes.sql`): `desktop_visible`, `sticky_x`, `sticky_y`, `sticky_width`, `sticky_height` (physical px), `sticky_theme`, `sticky_always_on_top`. `id`, `title`, `body`, `created_at`, `updated_at`, `pinned` are unchanged.
- The columns are applied by Rust (`sticky.rs` `ensure_schema`, skipping existing ones) at startup and again by the frontend repository after it opens the DB. They are deliberately not a plugin migration: Rust needs them before the plugin loads, and SQLite has no `ADD COLUMN IF NOT EXISTS`.
- Window label: `sticky-{noteId}`. `sticky_open` creates it or focuses the existing one, so there are never duplicates. Saved positions are clamped onto a connected monitor.

## Who writes what

All note writes go through `notesRepository` in the frontend (title/body via `updateText`, which writes only the fields given; theme, geometry, visibility, pin via their own statements). `save()` never overwrites sticky fields on an existing row. Rust only creates/closes windows and reads geometry.

## Synchronisation

After a write, a window emits `doodle://note-changed {id, kind, origin}`. Other windows re-read the row from SQLite and merge it (`notes/noteMerge.ts`): a field the user has not touched since the last load/save takes the remote value; a field with unsaved local edits is kept and written by that window's autosave. A window ignores its own events, so there are no loops. Deleting emits `deleted` with a snapshot (the workspace offers Undo, which restores the note and reopens its sticky).

## Behaviour

- Hide (eye icon, Alt+F4, Notes tab) closes the window and clears `desktop_visible`; the note stays. Delete removes the row and closes the window.
- Create: Notes tab (New sticky), Create tab (Sticky), a sticky's "+", tray "New sticky note", global Ctrl+Alt+S. Tray and shortcut ask the workspace webview (which owns note creation) via `doodle://new-sticky`.
- Titles: empty title falls back to the first line, as in the Create tab. Renaming never touches the body.
- Startup: stickies of `desktop_visible` notes are reopened with saved geometry, theme and always-on-top; none steal focus.
- Stickies load a small React view only (no workspace UI, no three.js).

## Tests

`pnpm test:unit` (merge rules), `cargo test --lib`, and real-app runs driven over the WebView2 DevTools protocol against a throw-away profile (see CLIPBOARD.md for the setup).
