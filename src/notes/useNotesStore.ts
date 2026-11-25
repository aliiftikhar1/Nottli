import { create } from 'zustand';
import { emitNoteChanged, onNewStickyRequest, onNoteChanged, stickyClose, stickyOpen, type NoteChange } from '../native/desktop';
import { mergeRemote } from './noteMerge';
import { STICKY_THEMES, compareNotes, notesRepository as repository, stickyDefaults, type Note } from './notesRepository';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 600;
const UNDO_WINDOW_MS = 6000;

type NotesStore = {
  notes: Note[];
  /** The note in the editor. It may not be persisted yet (a blank or brand-new note). */
  active: Note;
  status: SaveStatus;
  error: string | null;
  loaded: boolean;
  /** Set when the notes list could not be read from storage. */
  loadError: string | null;
  query: string;
  /** The most recently deleted note, kept briefly so the deletion can be undone. */
  deleted: Note | null;
  load: () => Promise<void>;
  edit: (content: string) => void;
  /** Sets an explicit title; an empty title goes back to the first line of the note. */
  setTitle: (title: string) => void;
  togglePin: (id: string) => Promise<void>;
  /** Writes any pending edit immediately. Resolves once storage has settled. */
  flush: () => Promise<void>;
  /** Returns false when the current note could not be saved, so nothing is discarded. */
  newNote: () => Promise<boolean>;
  openNote: (id: string) => Promise<boolean>;
  deleteNote: (id: string) => Promise<void>;
  undoDelete: () => Promise<void>;
  setQuery: (query: string) => void;
  /** Renames any note (empty title falls back to the first line). Never touches the body. */
  renameNote: (id: string, title: string) => Promise<void>;
  /** Creates the sticky window for a note, or focuses it if it is already on the desktop. */
  showOnDesktop: (id: string) => Promise<void>;
  /** Closes the sticky window; the note and its content are kept. */
  hideFromDesktop: (id: string) => Promise<void>;
  /** Creates a note that is immediately shown as a desktop sticky. Returns its id. */
  newSticky: () => Promise<string | null>;
  /** Re-reads a note another window changed and merges it without losing unsaved edits. */
  applyRemote: (change: NoteChange) => Promise<void>;
  /** Subscribes to cross-window events; returns the unsubscribe function. */
  initSync: () => Promise<() => void>;
};

export function deriveTitle(content: string) {
  const firstLine = content.split('\n').find((line) => line.trim()) ?? '';
  return firstLine.trim().slice(0, 120);
}

/** True when the title was typed by the user rather than derived from the first line. */
export function hasCustomTitle(note: Note) {
  return note.title !== '' && note.title !== deriveTitle(note.content);
}

function blankNote(): Note {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '', content: '', pinned: false, createdAt: now, updatedAt: now, ...stickyDefaults() };
}

function upsert(notes: Note[], note: Note) {
  return [note, ...notes.filter((existing) => existing.id !== note.id)].sort(compareNotes);
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTransientLoadError(error: unknown) {
  const message = describe(error).toLowerCase();
  return ['failed to fetch', 'database is locked', 'database table is locked', 'busy', 'no such table', 'no such column', 'not initialized'].some((part) => message.includes(part));
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

// Module-level bookkeeping: one editor per window, so a single instance is enough.
let saveTimer: number | undefined;
let undoTimer: number | undefined;
let editVersion = 0;
let savedVersion = 0;
/** Every storage write is chained here so writes never race or reorder. */
let queue: Promise<void> = Promise.resolve();
let loadRequest = 0;

const isDirty = () => editVersion !== savedVersion;

/** The text the editor last loaded or saved; lets a merge tell "untouched" from "edited". */
let base = { title: '', content: '' };

function resetVersions() {
  base = { title: '', content: '' };
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  editVersion = 0;
  savedVersion = 0;
}

export const useNotesStore = create<NotesStore>((set, get) => {
  const persistActive = () => {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    queue = queue.then(async () => {
      const version = editVersion;
      if (version === savedVersion) return;
      const note = get().active;
      const isStored = get().notes.some((existing) => existing.id === note.id);
      set({ status: 'saving' });
      try {
        // A sticky on the desktop is kept even when empty; a plain empty note is not stored.
        if (note.content.trim() || note.desktopVisible) {
          if (isStored) await repository.updateText(note.id, { title: note.title, content: note.content }, note.updatedAt);
          else await repository.save(note);
          set((state) => ({ notes: upsert(state.notes, { ...(state.notes.find((n) => n.id === note.id) ?? note), title: note.title, content: note.content, updatedAt: note.updatedAt, pinned: note.pinned }) }));
          base = { title: note.title, content: note.content };
          void emitNoteChanged({ id: note.id, kind: 'changed' }).catch(() => undefined);
        } else if (isStored) {
          // A note cleared of all text is removed rather than kept as an empty row.
          await repository.remove(note.id);
          set((state) => ({ notes: state.notes.filter((existing) => existing.id !== note.id) }));
          void emitNoteChanged({ id: note.id, kind: 'deleted' }).catch(() => undefined);
        }
        savedVersion = version;
        const settled = editVersion === version;
        set({ status: settled ? (note.content.trim() ? 'saved' : 'idle') : 'pending', error: null });
      } catch (error) {
        set({ status: 'error', error: describe(error) });
      }
    });
    return queue;
  };

  return {
    notes: [],
    active: blankNote(),
    status: 'idle',
    error: null,
    loaded: false,
    loadError: null,
    query: '',
    deleted: null,

    load: async () => {
      const request = ++loadRequest;
      set({ loaded: false, loadError: null });
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const notes = await repository.list();
          if (request === loadRequest) set({ notes, loaded: true, loadError: null });
          return;
        } catch (error) {
          lastError = error;
          if (!isTransientLoadError(error) || attempt === 2) break;
          await wait(150 * (attempt + 1));
        }
      }
      if (request === loadRequest) set({ loaded: true, loadError: describe(lastError) });
    },

    edit: (content) => {
      editVersion += 1;
      set((state) => ({
        active: {
          ...state.active,
          content,
          // A title the user typed themselves is kept; otherwise it follows the first line.
          title: hasCustomTitle(state.active) ? state.active.title : deriveTitle(content),
          updatedAt: new Date().toISOString()
        },
        status: 'pending'
      }));
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void persistActive(), SAVE_DELAY_MS);
    },

    setTitle: (title) => {
      editVersion += 1;
      set((state) => ({
        active: {
          ...state.active,
          title: title.trim() ? title.slice(0, 120) : deriveTitle(state.active.content),
          updatedAt: new Date().toISOString()
        },
        status: 'pending'
      }));
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => void persistActive(), SAVE_DELAY_MS);
    },

    togglePin: async (id) => {
      const { active, notes } = get();
      const stored = notes.find((note) => note.id === id);
      const current = id === active.id ? active : stored;
      if (!current || (!current.content.trim() && !current.desktopVisible)) return;
      const pinned = !current.pinned;
      const apply = (value: boolean) =>
        set((state) => ({
          active: state.active.id === id ? { ...state.active, pinned: value } : state.active,
          notes: state.notes.map((note) => (note.id === id ? { ...note, pinned: value } : note)).sort(compareNotes)
        }));
      apply(pinned);
      if (!stored) {
        // Not stored yet: the pin is written together with the note.
        editVersion += 1;
        set({ status: 'pending' });
        await persistActive();
        return;
      }
      queue = queue.then(async () => {
        try {
          await repository.setPinned(id, pinned);
          void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
        } catch (error) {
          apply(!pinned);
          set({ status: 'error', error: describe(error) });
        }
      });
      await queue;
    },

    flush: () => (isDirty() ? persistActive() : queue),

    newNote: async () => {
      await get().flush();
      if (isDirty()) return false;
      if (get().active.content.trim()) {
        resetVersions();
        set({ active: blankNote(), status: 'idle' });
      }
      return true;
    },

    openNote: async (id) => {
      if (id === get().active.id) return true;
      await get().flush();
      if (isDirty()) return false;
      const note = get().notes.find((existing) => existing.id === id);
      if (!note) return false;
      resetVersions();
      base = { title: note.title, content: note.content };
      set({ active: { ...note }, status: 'idle' });
      return true;
    },

    deleteNote: async (id) => {
      const { active, notes } = get();
      const isActive = id === active.id;
      const target = isActive ? active : notes.find((note) => note.id === id);
      if (!target) return;
      if (isActive) {
        // Drop any pending autosave for the note being deleted.
        resetVersions();
        set({ active: blankNote(), status: 'idle' });
      }
      queue = queue.then(async () => {
        try {
          if (get().notes.some((note) => note.id === id)) await repository.remove(id);
          // Close its sticky window (if any) and tell other windows. The note itself is gone.
          void stickyClose(id).catch(() => undefined);
          void emitNoteChanged({ id, kind: 'deleted', note: target }).catch(() => undefined);
          set((state) => ({
            notes: state.notes.filter((note) => note.id !== id),
            deleted: target.content.trim() ? target : null,
            error: null
          }));
          window.clearTimeout(undoTimer);
          undoTimer = window.setTimeout(() => set({ deleted: null }), UNDO_WINDOW_MS);
        } catch (error) {
          set({ status: 'error', error: describe(error) });
        }
      });
      await queue;
    },

    undoDelete: async () => {
      const note = get().deleted;
      if (!note) return;
      window.clearTimeout(undoTimer);
      set({ deleted: null });
      queue = queue.then(async () => {
        try {
          await repository.save(note);
          set((state) => ({ notes: upsert(state.notes, note), error: null }));
          // A restored sticky comes back on the desktop with its saved position and theme.
          if (note.desktopVisible) void stickyOpen(note.id).catch(() => undefined);
          void emitNoteChanged({ id: note.id, kind: 'changed' }).catch(() => undefined);
        } catch (error) {
          set({ status: 'error', error: describe(error) });
        }
      });
      await queue;
      // Bring the restored note back into the editor if the editor is untouched.
      if (!get().active.content && !isDirty()) {
        resetVersions();
        base = { title: note.title, content: note.content };
        set({ active: { ...note }, status: 'idle' });
      }
    },

    setQuery: (query) => set({ query }),

    renameNote: async (id, title) => {
      if (id === get().active.id) {
        get().setTitle(title);
        await get().flush();
        return;
      }
      const note = get().notes.find((existing) => existing.id === id);
      if (!note) return;
      const next = title.trim() ? title.trim().slice(0, 120) : deriveTitle(note.content);
      if (next === note.title) return;
      const updatedAt = new Date().toISOString();
      queue = queue.then(async () => {
        try {
          await repository.updateText(id, { title: next }, updatedAt);
          set((state) => ({ notes: state.notes.map((n) => (n.id === id ? { ...n, title: next, updatedAt } : n)).sort(compareNotes), error: null }));
          void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
        } catch (error) {
          set({ status: 'error', error: describe(error) });
        }
      });
      await queue;
    },

    showOnDesktop: async (id) => {
      const { active } = get();
      if (id === active.id) {
        await get().flush();
        // An empty, never-stored note still becomes a sticky: store the blank row.
        if (!get().notes.some((note) => note.id === id)) {
          try {
            await repository.save({ ...get().active, desktopVisible: true });
            set((state) => ({ notes: upsert(state.notes, { ...state.active, desktopVisible: true }) }));
          } catch (error) {
            set({ status: 'error', error: describe(error) });
            return;
          }
        }
      }
      const note = get().notes.find((existing) => existing.id === id);
      if (!note) return;
      try {
        if (!note.desktopVisible) await repository.setDesktop(id, true);
        const apply = <T extends Note>(n: T): T => (n.id === id ? { ...n, desktopVisible: true } : n);
        set((state) => ({ notes: state.notes.map(apply), active: apply(state.active) }));
        await stickyOpen(id);
        void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
      } catch (error) {
        set({ status: 'error', error: describe(error) });
      }
    },

    hideFromDesktop: async (id) => {
      try {
        await repository.setDesktop(id, false);
        const apply = <T extends Note>(n: T): T => (n.id === id ? { ...n, desktopVisible: false } : n);
        set((state) => ({ notes: state.notes.map(apply), active: apply(state.active) }));
        await stickyClose(id);
        void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
      } catch (error) {
        set({ status: 'error', error: describe(error) });
      }
    },

    newSticky: async () => {
      const note: Note = {
        ...blankNote(),
        desktopVisible: true,
        stickyTheme: STICKY_THEMES[get().notes.length % STICKY_THEMES.length]
      };
      try {
        await repository.save(note);
        set((state) => ({ notes: upsert(state.notes, note) }));
        await stickyOpen(note.id);
        void emitNoteChanged({ id: note.id, kind: 'changed' }).catch(() => undefined);
        return note.id;
      } catch (error) {
        set({ status: 'error', error: describe(error) });
        return null;
      }
    },

    applyRemote: async (change) => {
      const { id } = change;
      const gone = () => {
        const wasActive = get().active.id === id;
        if (wasActive) {
          resetVersions();
          set({ active: blankNote(), status: 'idle' });
        }
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
          deleted: change.note?.content.trim() ? change.note : state.deleted
        }));
        if (change.note?.content.trim()) {
          window.clearTimeout(undoTimer);
          undoTimer = window.setTimeout(() => set({ deleted: null }), UNDO_WINDOW_MS);
        }
      };
      if (change.kind === 'deleted') return gone();
      let row: Note | null;
      try {
        row = await repository.get(id);
      } catch {
        return;
      }
      if (!row) return gone();
      const remote = row;
      set((state) => ({ notes: upsert(state.notes, remote) }));
      const active = get().active;
      if (active.id === id) {
        const merged = mergeRemote(active, base, remote);
        base = { title: remote.title, content: remote.content };
        set({ active: merged });
      }
    },

    initSync: async () => {
      const offChange = await onNoteChanged((change) => void get().applyRemote(change));
      const offNew = await onNewStickyRequest(() => void get().newSticky());
      return () => {
        offChange();
        offNew();
      };
    }
  };
});
