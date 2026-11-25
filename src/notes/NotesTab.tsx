import { AlertCircle, FileText, Monitor, MonitorOff, Pencil, Pin, PinOff, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { formatFullTime, formatNoteTime } from './formatTime';
import { displayTitle, notePreview } from './notePreview';
import { useNotesStore } from './useNotesStore';

const PAGE_SIZE = 60;

type Props = {
  searchRef: RefObject<HTMLInputElement>;
  now: Date;
  onOpen: (id: string) => void;
  onNewNote: () => void;
};

/** Inline title editor: Enter saves, Esc cancels, blur saves. An empty title restores the automatic one. */
function RenameField({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onDone(commit ? value : null);
  };
  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      maxLength={120}
      placeholder={placeholder}
      aria-label="Note title"
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation(); // keep Esc / Enter local; the workspace must not close
        if (event.key === 'Enter') finish(true);
        else if (event.key === 'Escape') finish(false);
      }}
    />
  );
}

/** The central manager for every note, wherever it was created (Create tab, cat, desktop sticky, tray). */
export function NotesTab({ searchRef, now, onOpen, onNewNote }: Props) {
  const notes = useNotesStore((state) => state.notes);
  const activeId = useNotesStore((state) => state.active.id);
  const loaded = useNotesStore((state) => state.loaded);
  const loadError = useNotesStore((state) => state.loadError);
  const query = useNotesStore((state) => state.query);
  const { setQuery, deleteNote, togglePin, load, renameNote, showOnDesktop, hideFromDesktop, newSticky } = useNotesStore.getState();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return notes;
    return notes.filter((note) => note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle));
  }, [notes, query]);

  const visible = filtered.slice(0, limit);
  const searching = query.trim() !== '';
  const onDesktop = notes.filter((note) => note.desktopVisible).length;

  let body;
  if (!loaded) {
    body = (
      <ul className="skeleton-list" aria-busy="true" aria-label="Loading notes">
        {[0, 1, 2, 3].map((i) => <li key={i} className="skeleton-row" />)}
      </ul>
    );
  } else if (loadError) {
    body = (
      <div className="state-block" role="alert">
        <Icon icon={AlertCircle} size={20} />
        <p>Couldn’t read your notes.</p>
        <button type="button" className="text-button" onClick={() => void load()}>Try again</button>
      </div>
    );
  } else if (filtered.length === 0) {
    body = (
      <div className="state-block">
        <Icon icon={searching ? Search : FileText} size={20} />
        {searching ? (
          <p>No notes match “{query.trim()}”.</p>
        ) : (
          <>
            <p>No notes yet. Everything you write stays on this PC.</p>
            <span className="state-actions">
              <button type="button" className="text-button" onClick={onNewNote}><Icon icon={Plus} size={14} /> Write a note</button>
              <button type="button" className="text-button" onClick={() => void newSticky()}><Icon icon={StickyNote} size={14} /> New sticky</button>
            </span>
          </>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="note-list">
        {visible.map((note) => {
          const preview = notePreview(note);
          const title = displayTitle(note);
          return (
            <li key={note.id} className={note.id === activeId ? 'is-active' : undefined}>
              <button type="button" className="note-row" onClick={() => onOpen(note.id)} aria-current={note.id === activeId}>
                <span className="note-row-top">
                  {note.pinned ? <span className="pin-mark" title="Pinned"><Icon icon={Pin} size={11} /></span> : null}
                  {renamingId === note.id ? (
                    <span className="note-title" onClick={(event) => event.stopPropagation()}>
                      <RenameField
                        initial={note.title}
                        placeholder="Title (empty uses the first line)"
                        onDone={(next) => {
                          setRenamingId(null);
                          if (next !== null) void renameNote(note.id, next);
                        }}
                      />
                    </span>
                  ) : (
                    <span className="note-title">{title}</span>
                  )}
                  {note.desktopVisible ? <span className={`desk-chip theme-${note.stickyTheme}`} title="Shown on the desktop"><Icon icon={Monitor} size={10} /> Desktop</span> : null}
                  <time dateTime={note.updatedAt} title={formatFullTime(note.updatedAt)}>{formatNoteTime(note.updatedAt, now)}</time>
                </span>
                {preview ? <span className="note-snippet">{preview}</span> : null}
              </button>
              <span className="row-actions">
                <button type="button" className="icon-button small" onClick={() => setRenamingId(note.id)}
                  title="Rename" aria-label={`Rename “${title}”`}>
                  <Icon icon={Pencil} size={13} />
                </button>
                <button type="button" className={`icon-button small${note.desktopVisible ? ' is-on' : ''}`}
                  onClick={() => void showOnDesktop(note.id)}
                  title={note.desktopVisible ? 'Focus the desktop sticky' : 'Show on desktop'}
                  aria-label={note.desktopVisible ? `Focus the desktop sticky for “${title}”` : `Show “${title}” on the desktop`}>
                  <Icon icon={Monitor} size={13} />
                </button>
                {note.desktopVisible ? (
                  <button type="button" className="icon-button small" onClick={() => void hideFromDesktop(note.id)}
                    title="Hide from desktop (keeps the note)" aria-label={`Hide “${title}” from the desktop`}>
                    <Icon icon={MonitorOff} size={13} />
                  </button>
                ) : null}
                <button type="button" className="icon-button small" onClick={() => void togglePin(note.id)}
                  title={note.pinned ? 'Unpin' : 'Pin'} aria-label={note.pinned ? `Unpin “${title}”` : `Pin “${title}”`}>
                  <Icon icon={note.pinned ? PinOff : Pin} size={13} />
                </button>
                <button type="button" className="icon-button small danger" onClick={() => void deleteNote(note.id)}
                  title="Delete note" aria-label={`Delete “${title}”`}>
                  <Icon icon={Trash2} size={13} />
                </button>
              </span>
            </li>
          );
        })}
        {filtered.length > visible.length ? (
          <li className="more-row">
            <button type="button" className="text-button" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
              Show more ({filtered.length - visible.length})
            </button>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <div className="notes-view">
      <div className="notes-head">
        <div className="notes-bar">
          <label className="search">
            <Icon icon={Search} size={14} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
              placeholder="Search title and content"
              aria-label="Search notes"
            />
          </label>
          <button type="button" className="icon-button glass-btn" onClick={() => void newSticky()} title="New desktop sticky (Ctrl+Alt+S)" aria-label="New sticky">
            <Icon icon={StickyNote} size={16} />
          </button>
          <button type="button" className="icon-button glass-btn" onClick={onNewNote} title="New note (Ctrl+N)" aria-label="New note">
            <Icon icon={Plus} size={17} />
          </button>
        </div>
        <h2 className="section-label">
          {searching ? `Results · ${filtered.length}` : loaded && !loadError ? `All notes · ${notes.length}${onDesktop ? ` · ${onDesktop} on desktop` : ''}` : 'All notes'}
        </h2>
      </div>
      {body}
    </div>
  );
}
