import { invoke } from '@tauri-apps/api/core';
import { emit, emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type WindowView = 'pet' | 'notes' | 'sticky';

const EVENT_NOTES_VISIBILITY = 'doodle://notes-visibility';
const EVENT_BEFORE_QUIT = 'doodle://before-quit';

const EVENT_PET_ACTIVITY = 'doodle://pet-activity';

/** Signals the notes window (or the backend) sends so the pet can react. */
export type PetActivity = 'editing' | 'saved' | 'notification';

export function isTauriRuntime() {
  return '__TAURI_INTERNALS__' in window;
}

/** Which surface this webview renders. In a plain browser, use `?view=pet` to preview the pet. */
export function currentView(): WindowView {
  if (isTauriRuntime()) {
    const label = getCurrentWindow().label;
    return label === 'pet' ? 'pet' : label.startsWith('sticky-') ? 'sticky' : 'notes';
  }
  const params = new URLSearchParams(window.location.search);
  if (params.get('sticky')) return 'sticky';
  return params.get('view') === 'pet' ? 'pet' : 'notes';
}

// ---------------------------------------------------------------------------
// Sticky notes: events shared by the workspace and every sticky window
// ---------------------------------------------------------------------------

const EVENT_NOTE_CHANGED = 'doodle://note-changed';
const EVENT_NEW_STICKY = 'doodle://new-sticky';
const EVENT_STICKY_CLOSE = 'doodle://sticky-close-requested';

export type NoteChange = {
  id: string;
  kind: 'changed' | 'deleted';
  /** Label of the window that made the change, so it can ignore its own echo. */
  origin: string;
  /** Snapshot of the note on deletion, so another window can offer Undo. */
  note?: import('../notes/notesRepository').Note;
};

export const windowLabel = () => (isTauriRuntime() ? getCurrentWindow().label : 'browser');

/** Tells every other window that a note changed in SQLite; they re-read it from the database. */
export async function emitNoteChanged(change: Omit<NoteChange, 'origin'>) {
  if (isTauriRuntime()) await emit(EVENT_NOTE_CHANGED, { ...change, origin: windowLabel() } satisfies NoteChange);
}

export async function onNoteChanged(handler: (change: NoteChange) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  const own = windowLabel();
  return listen<NoteChange>(EVENT_NOTE_CHANGED, ({ payload }) => {
    if (payload.origin !== own) handler(payload);
  });
}

/** Tray / global shortcut asks the workspace (which owns note creation) to make a new sticky. */
export async function onNewStickyRequest(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen(EVENT_NEW_STICKY, handler);
}

/** The OS asked a sticky to close (Alt+F4): treat it as "hide from desktop". */
export async function onStickyCloseRequested(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen(EVENT_STICKY_CLOSE, handler);
}

export async function stickyOpen(id: string) {
  if (isTauriRuntime()) await invoke('sticky_open', { id });
}
/** Closes the sticky window only. The note is untouched. */
export async function stickyClose(id: string) {
  if (isTauriRuntime()) await invoke('sticky_close', { id });
}
export async function stickySetOnTop(id: string, onTop: boolean) {
  if (isTauriRuntime()) await invoke('sticky_set_on_top', { id, onTop });
}
export async function startStickyResize(direction: 'East' | 'South' | 'SouthEast') {
  if (isTauriRuntime()) await getCurrentWindow().startResizeDragging(direction);
}
export async function startStickyDrag() {
  if (isTauriRuntime()) await getCurrentWindow().startDragging();
}

/** Id of the note a sticky window shows (labels are `sticky-{noteId}`). */
export function stickyNoteId(): string | null {
  if (!isTauriRuntime()) return new URLSearchParams(window.location.search).get('sticky');
  const label = getCurrentWindow().label;
  return label.startsWith('sticky-') ? label.slice('sticky-'.length) : null;
}

export async function toggleNotes() {
  if (isTauriRuntime()) await invoke('toggle_notes');
}

export async function hideNotes() {
  if (isTauriRuntime()) await invoke('hide_notes');
}

export async function isNotesVisible() {
  return isTauriRuntime() ? invoke<boolean>('is_notes_visible') : true;
}

export async function quitApp() {
  if (isTauriRuntime()) await invoke('quit_app');
}

export async function startPetDrag() {
  if (isTauriRuntime()) await getCurrentWindow().startDragging();
}

export async function onNotesVisibility(handler: (visible: boolean) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<boolean>(EVENT_NOTES_VISIBILITY, ({ payload }) => handler(payload));
}

export async function onBeforeQuit(handler: () => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen(EVENT_BEFORE_QUIT, handler);
}

export async function emitPetActivity(activity: PetActivity) {
  if (isTauriRuntime()) await emitTo('pet', EVENT_PET_ACTIVITY, activity);
}

export async function onPetActivity(handler: (activity: PetActivity) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<PetActivity>(EVENT_PET_ACTIVITY, ({ payload }) => handler(payload));
}

/** Seconds since the last system-wide keyboard or mouse input (null outside Tauri). */
export async function getIdleSeconds(): Promise<number | null> {
  return isTauriRuntime() ? invoke<number>('get_idle_seconds') : null;
}

/**
 * The pet's single window-moved listener. Persists the position once a drag
 * settles (the backend also re-anchors the notes panel) and optionally reports
 * every position live, e.g. to drive the walking animation.
 */
export async function trackPetPosition(onMove?: (x: number, y: number) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  let timer: number | undefined;
  const unlisten = await getCurrentWindow().onMoved(({ payload }) => {
    onMove?.(payload.x, payload.y);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void invoke('pet_moved', { x: payload.x, y: payload.y }).catch(() => undefined);
    }, 300);
  });
  return () => {
    window.clearTimeout(timer);
    unlisten();
  };
}
