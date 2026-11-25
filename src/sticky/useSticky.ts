import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emitNoteChanged,
  isTauriRuntime,
  onBeforeQuit,
  onNoteChanged,
  onStickyCloseRequested,
  stickyClose,
  stickySetOnTop
} from '../native/desktop';
import { mergeRemote } from '../notes/noteMerge';
import { notesRepository as repository, type Note, type StickyListItem, type StickyTheme } from '../notes/notesRepository';

export type StickySave = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

const SAVE_DELAY_MS = 500;
const GEOMETRY_DELAY_MS = 500;

/**
 * State for one sticky window. SQLite is the source of truth: the window edits a local copy,
 * writes only the fields the user changed, and merges rows other windows changed.
 */
export function useSticky(id: string) {
  const [note, setNote] = useState<Note | null>(null);
  const [status, setStatus] = useState<StickySave>('idle');
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  const noteRef = useRef<Note | null>(null);
  const base = useRef<{ title: string; content: string; listItems: StickyListItem[] | null }>({ title: '', content: '', listItems: null });
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const edits = useRef(0);
  const saved = useRef(0);

  const commit = useCallback((next: Note) => {
    noteRef.current = next;
    setNote(next);
  }, []);

  /** Writes the unsaved text fields. Serialised so writes never reorder. */
  const flush = useCallback((): Promise<void> => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    queue.current = queue.current.then(async () => {
      const current = noteRef.current;
      const version = edits.current;
      if (!current || version === saved.current) return;
      const fields: { title?: string; content?: string } = {};
      if (current.title !== base.current.title) fields.title = current.title;
      if (current.content !== base.current.content) fields.content = current.content;
      const listChanged = JSON.stringify(current.listItems) !== JSON.stringify(base.current.listItems);
      setStatus('saving');
      try {
        if (Object.keys(fields).length) await repository.updateText(id, fields, current.updatedAt);
        if (listChanged) await repository.updateList(id, current.listItems, current.updatedAt);
        base.current = { title: current.title, content: current.content, listItems: current.listItems };
        saved.current = version;
        setStatus(edits.current === version ? 'saved' : 'pending');
        setError(null);
        void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
      } catch (e) {
        setStatus('error');
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return queue.current;
  }, [id]);

  const schedule = useCallback(() => {
    edits.current += 1;
    setStatus('pending');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  const editBody = useCallback(
    (content: string) => {
      const current = noteRef.current;
      if (!current) return;
      commit({
        ...current,
        content,
        listItems: null,
        updatedAt: new Date().toISOString()
      });
      schedule();
    },
    [commit, schedule]
  );

  const editList = useCallback((items: StickyListItem[]) => {
    const current = noteRef.current;
    if (!current) return;
    const content = items.map((item) => item.text).join('\n');
    commit({ ...current, listItems: items, content, updatedAt: new Date().toISOString() });
    schedule();
  }, [commit, schedule]);

  const toggleList = useCallback(() => {
    const current = noteRef.current;
    if (!current) return;
    if (current.listItems !== null) {
      const content = current.listItems.map((item) => item.text).join('\n');
      commit({ ...current, listItems: null, content, updatedAt: new Date().toISOString() });
    } else {
      const text = current.content.trim();
      const listItems = text ? [{ id: crypto.randomUUID(), text: current.content, done: false }] : [];
      commit({ ...current, listItems, updatedAt: new Date().toISOString() });
    }
    schedule();
  }, [commit, schedule]);

  /** Renames only the title. An empty title stays empty; the body is never touched. */
  const rename = useCallback(
    (title: string) => {
      const current = noteRef.current;
      if (!current) return;
      commit({ ...current, title: title.slice(0, 120), updatedAt: new Date().toISOString() });
      schedule();
    },
    [commit, schedule]
  );

  const reload = useCallback(async () => {
    const row = await repository.get(id);
    if (!row) {
      setGone(true);
      return;
    }
    if (!row.desktopVisible) {
      // Hidden from the workspace: this window is no longer wanted.
      setGone(true);
      return;
    }
    const local = noteRef.current;
    if (!local) {
      base.current = { title: row.title, content: row.content, listItems: row.listItems };
      commit(row);
      return;
    }
    const merged = mergeRemote(local, base.current, row);
    base.current = { title: row.title, content: row.content, listItems: row.listItems };
    commit(merged);
  }, [commit, id]);

  // Initial load and cross-window sync.
  useEffect(() => {
    let disposed = false;
    const offs: Array<() => void> = [];
    const keep = (off: () => void) => (disposed ? off() : offs.push(off));
    void reload().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void onNoteChanged((change) => {
      if (change.id !== id) return;
      if (change.kind === 'deleted') setGone(true);
      else void reload();
    }).then(keep);
    void onBeforeQuit(() => void flush()).then(keep);
    const onBlur = () => void flush();
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onBlur);
    return () => {
      disposed = true;
      offs.forEach((off) => off());
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onBlur);
    };
  }, [id, reload, flush]);

  // Persist geometry after a move or resize settles (physical pixels, so it round-trips with Rust).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let geometryTimer: number | undefined;
    const win = getCurrentWindow();
    const save = () => {
      window.clearTimeout(geometryTimer);
      geometryTimer = window.setTimeout(async () => {
        try {
          const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
          await repository.setGeometry(id, { x: pos.x, y: pos.y, width: size.width, height: size.height });
        } catch {
          // Geometry is best effort; the next move will try again.
        }
      }, GEOMETRY_DELAY_MS);
    };
    const offs: Array<() => void> = [];
    let disposed = false;
    void win.onMoved(save).then((off) => (disposed ? off() : offs.push(off)));
    void win.onResized(save).then((off) => (disposed ? off() : offs.push(off)));
    return () => {
      disposed = true;
      window.clearTimeout(geometryTimer);
      offs.forEach((off) => off());
    };
  }, [id]);

  const hide = useCallback(async () => {
    await flush();
    await repository.setDesktop(id, false);
    await emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
    await stickyClose(id);
  }, [flush, id]);

  // Alt+F4 / OS close: same as Hide, never a delete.
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void onStickyCloseRequested(() => void hide()).then((fn) => (disposed ? fn() : (off = fn)));
    return () => {
      disposed = true;
      off?.();
    };
  }, [hide]);

  const remove = useCallback(async () => {
    const current = noteRef.current;
    window.clearTimeout(timer.current);
    edits.current = saved.current; // drop any pending autosave for a note that is going away
    await repository.remove(id);
    await emitNoteChanged({ id, kind: 'deleted', note: current ?? undefined }).catch(() => undefined);
    await stickyClose(id);
  }, [id]);

  const setTheme = useCallback(
    async (theme: StickyTheme) => {
      const current = noteRef.current;
      if (!current) return;
      commit({ ...current, stickyTheme: theme });
      await repository.setTheme(id, theme);
      void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
    },
    [commit, id]
  );

  const toggleOnTop = useCallback(async () => {
    const current = noteRef.current;
    if (!current) return;
    const next = !current.stickyOnTop;
    commit({ ...current, stickyOnTop: next });
    await repository.setOnTop(id, next);
    await stickySetOnTop(id, next);
  }, [commit, id]);

  const togglePinned = useCallback(async () => {
    const current = noteRef.current;
    if (!current) return;
    commit({ ...current, pinned: !current.pinned });
    await repository.setPinned(id, !current.pinned);
    void emitNoteChanged({ id, kind: 'changed' }).catch(() => undefined);
  }, [commit, id]);

  return { note, status, error, gone, editBody, editList, toggleList, rename, flush, hide, remove, setTheme, toggleOnTop, togglePinned };
}
