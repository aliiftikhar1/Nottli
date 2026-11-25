import { AlertCircle, Check, EyeOff, Layers, ListChecks, Palette, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { startStickyDrag, startStickyResize, stickyClose, stickyNoteId } from '../native/desktop';
import { STICKY_THEMES, type StickyListItem, type StickyTheme } from '../notes/notesRepository';
import { createStickyNote } from './stickyActions';
import { useSticky } from './useSticky';
import './sticky.css';

const THEME_LABELS: Record<StickyTheme, string> = { yellow: 'Warm yellow', pink: 'Soft pink', coral: 'Muted coral', teal: 'Soft teal', orange: 'Warm orange', cream: 'Cream', lavender: 'Lavender', green: 'Muted green' };

export function StickyApp() {
  const id = stickyNoteId();
  return id ? <Sticky id={id} /> : null;
}

function Sticky({ id }: { id: string }) {
  const { note, status, error, gone, editBody, editList, toggleList, rename, flush, hide, remove, setTheme, toggleOnTop, togglePinned } = useSticky(id);
  const [palette, setPalette] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState<'title' | 'body' | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  const drag = useRef<{ pointerId: number; x: number; y: number; started: boolean } | null>(null);
  const stickyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (gone) void stickyClose(id).catch(() => undefined); }, [gone, id]);
  useEffect(() => {
    if (!note || focused.current) return;
    focused.current = true;
    if (!note.content && note.listItems === null) setEditing('body');
  }, [note]);
  useEffect(() => { if (editing === 'title') titleRef.current?.focus(); if (editing === 'body') bodyRef.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = window.setTimeout(() => setConfirmDelete(false), 3000);
    return () => window.clearTimeout(timer);
  }, [confirmDelete]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPalette(false); setEditing(null); (document.activeElement as HTMLElement | null)?.blur(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void flush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flush]);

  if (!note) return <div className="sticky" data-theme="yellow" aria-busy="true" />;

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest('button, input, textarea, select, .grip')) return;
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, started: false };
    stickyRef.current?.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.started && Math.hypot(event.clientX - state.x, event.clientY - state.y) >= 6) {
      state.started = true;
      event.preventDefault();
      void startStickyDrag();
    }
    if (state.started) event.preventDefault();
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) { drag.current = null; if (stickyRef.current?.hasPointerCapture(event.pointerId)) stickyRef.current.releasePointerCapture(event.pointerId); }
  };
  const doubleClick = (field: 'title' | 'body') => { setPalette(false); setEditing(field); };
  // Tauri's pointer capture used for native dragging can swallow the browser dblclick event.
  // MouseEvent.detail still reports the second click, while single clicks remain inert.
  const editOnSecondClick = (field: 'title' | 'body', event: React.MouseEvent<HTMLDivElement>) => {
    if (event.detail === 2) {
      event.preventDefault();
      doubleClick(field);
    }
  };

  return (
    <div ref={stickyRef} className={`sticky${drag.current?.started ? ' is-dragging' : ''}`} data-theme={note.stickyTheme} role="group" aria-label="Sticky note"
      onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="sticky-content">
        {editing === 'title' ? (
          <input ref={titleRef} className="sticky-title-editor" value={note.title} onChange={(event) => rename(event.target.value)} onBlur={() => setEditing(null)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setEditing(null); } }} maxLength={120} aria-label="Sticky title" spellCheck />
        ) : (
          <div className="sticky-title-view" onMouseDown={(event) => editOnSecondClick('title', event)} onDoubleClick={(event) => { event.preventDefault(); doubleClick('title'); }} title="Double-click to edit title">{note.title || 'Title'}</div>
        )}
        {note.listItems !== null ? <Checklist items={note.listItems} onChange={editList} /> : editing === 'body' ? (
          <textarea ref={bodyRef} className="sticky-body-editor" value={note.content} onChange={(event) => editBody(event.target.value)} onBlur={() => setEditing(null)} placeholder="Write something…" aria-label="Sticky note text" spellCheck />
        ) : (
          <div className="sticky-body-view" onMouseDown={(event) => editOnSecondClick('body', event)} onDoubleClick={(event) => { event.preventDefault(); doubleClick('body'); }} title="Double-click to edit note">{note.content || 'Double-click to add a thought…'}</div>
        )}
      </div>

      <footer className="sticky-foot">
        <span className={`sticky-status${status === 'error' ? ' is-error' : ''}`} role="status" title={error ?? undefined}>
          {status === 'pending' || status === 'saving' ? 'Saving…' : status === 'error' ? <><Icon icon={AlertCircle} size={12} /> Couldn’t save <button type="button" className="sticky-retry" onClick={() => void flush()}>Retry</button></> : status === 'saved' ? <><Icon icon={Check} size={12} strokeWidth={2.2} /> Saved</> : ''}
        </span>
        <span className="sticky-tools">
          <button type="button" className="sticky-btn" onClick={() => void createStickyNote()} title="New sticky" aria-label="New sticky"><Icon icon={Plus} size={15} /></button>
          <button type="button" className={`sticky-btn${note.listItems !== null ? ' is-on' : ''}`} onClick={() => { toggleList(); setEditing(null); }} title={note.listItems !== null ? 'Switch to text note' : 'Turn into checklist'} aria-label="List"><Icon icon={ListChecks} size={14} /></button>
          <button type="button" className={`sticky-btn${palette ? ' is-on' : ''}`} onClick={() => setPalette((v) => !v)} title="Color" aria-label="Change color" aria-expanded={palette}><Icon icon={Palette} size={14} /></button>
          <button type="button" className={`sticky-btn${note.stickyOnTop ? ' is-on' : ''}`} onClick={() => void toggleOnTop()} title={note.stickyOnTop ? 'Back to the desktop only' : 'Float above other windows'} aria-label="Keep above other windows" aria-pressed={note.stickyOnTop}><Icon icon={Layers} size={14} /></button>
          <button type="button" className={`sticky-btn${note.pinned ? ' is-on' : ''}`} onClick={() => void togglePinned()} title={note.pinned ? 'Unpin from Notes' : 'Pin in Notes'} aria-label={note.pinned ? 'Unpin note' : 'Pin note'} aria-pressed={note.pinned}><Icon icon={note.pinned ? PinOff : Pin} size={14} /></button>
          <button type="button" className="sticky-btn" onClick={() => void hide()} title="Hide from desktop (keeps the note)" aria-label="Hide from desktop"><Icon icon={EyeOff} size={14} /></button>
          <button type="button" className={`sticky-btn danger${confirmDelete ? ' is-armed' : ''}`} onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))} title={confirmDelete ? 'Click again to delete this note' : 'Delete note'} aria-label={confirmDelete ? 'Confirm delete' : 'Delete note'}><Icon icon={Trash2} size={14} />{confirmDelete ? <span>Delete?</span> : null}</button>
        </span>
      </footer>

      {palette ? <div className="sticky-palette" role="listbox" aria-label="Sticky color">
        {STICKY_THEMES.map((theme) => <button key={theme} type="button" role="option" aria-selected={note.stickyTheme === theme} className={`swatch swatch-${theme}${note.stickyTheme === theme ? ' is-current' : ''}`} title={THEME_LABELS[theme]} aria-label={THEME_LABELS[theme]} onClick={() => { void setTheme(theme); setPalette(false); }} />)}
      </div> : null}
      <span className="grip grip-e" onMouseDown={() => void startStickyResize('East')} aria-hidden="true" />
      <span className="grip grip-s" onMouseDown={() => void startStickyResize('South')} aria-hidden="true" />
      <span className="grip grip-se" onMouseDown={() => void startStickyResize('SouthEast')} aria-hidden="true" />
    </div>
  );
}

function Checklist({ items, onChange }: { items: StickyListItem[]; onChange: (items: StickyListItem[]) => void }) {
  const update = (id: string, change: Partial<StickyListItem>) => onChange(items.map((item) => item.id === id ? { ...item, ...change } : item));
  return <div className="sticky-list" aria-label="Checklist">
    {items.map((item) => <div className="sticky-list-row" key={item.id}>
      <input type="checkbox" checked={item.done} onChange={(event) => update(item.id, { done: event.target.checked })} aria-label={`Complete ${item.text || 'item'}`} />
      <input className={`sticky-list-input${item.done ? ' is-done' : ''}`} value={item.text} onChange={(event) => update(item.id, { text: event.target.value })} placeholder="List item" aria-label="List item" />
      <button type="button" className="sticky-list-delete" onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))} aria-label="Delete list item">×</button>
    </div>)}
    <button type="button" className="sticky-list-add" onClick={() => onChange([...items, { id: crypto.randomUUID(), text: '', done: false }])}><Icon icon={Plus} size={13} /> Add item</button>
  </div>;
}
