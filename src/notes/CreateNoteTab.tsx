import { AlertCircle, Check, Pin, PinOff, Plus, StickyNote, Trash2 } from 'lucide-react';
import { useLayoutEffect, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { formatFullTime, formatNoteTime } from './formatTime';
import { hasCustomTitle, useNotesStore, type SaveStatus } from './useNotesStore';

type Props = {
  editorRef: RefObject<HTMLTextAreaElement>;
  now: Date;
  onNewNote: () => void;
};

function SaveIndicator({ status, error, savedAt, now, onRetry }: {
  status: SaveStatus;
  error: string | null;
  savedAt: string | null;
  now: Date;
  onRetry: () => void;
}) {
  if (status === 'pending' || status === 'saving') {
    return <span className="save-state" role="status"><span className="save-dot" /> Saving…</span>;
  }
  if (status === 'error') {
    return (
      <span className="save-state is-error" role="alert" title={error ?? undefined}>
        <Icon icon={AlertCircle} size={13} /> Couldn’t save
        <button type="button" className="link-button" onClick={onRetry}>Retry</button>
      </span>
    );
  }
  if (savedAt) {
    return (
      <span className="save-state is-saved" role="status" title={formatFullTime(savedAt)}>
        <Icon icon={Check} size={13} strokeWidth={2.2} /> Saved · {formatNoteTime(savedAt, now)}
      </span>
    );
  }
  return <span className="save-state" aria-hidden="true" />;
}

export function CreateNoteTab({ editorRef, now, onNewNote }: Props) {
  const active = useNotesStore((state) => state.active);
  const status = useNotesStore((state) => state.status);
  const error = useNotesStore((state) => state.error);
  const stored = useNotesStore((state) => state.notes.some((note) => note.id === state.active.id));
  const { edit, setTitle, flush, togglePin, deleteNote, showOnDesktop } = useNotesStore.getState();

  // Fit the textarea to its text; the surrounding card scrolls instead of a nested scrollbox.
  useLayoutEffect(() => {
    const area = editorRef.current;
    if (!area) return;
    area.style.height = 'auto';
    area.style.height = `${Math.max(area.scrollHeight, area.parentElement?.clientHeight ?? 0)}px`;
  }, [active.content, active.id, editorRef]);

  const hasContent = active.content.trim() !== '';
  const savedAt = hasContent && stored ? active.updatedAt : null;

  return (
    <div className="create">
      <input
        className="title-input"
        value={hasCustomTitle(active) ? active.title : ''}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            editorRef.current?.focus();
          }
        }}
        placeholder={active.title || 'Title (optional)'}
        aria-label="Note title"
        maxLength={120}
        spellCheck
      />
      <div className="editor">
        <textarea
          ref={editorRef}
          value={active.content}
          onChange={(event) => edit(event.target.value)}
          placeholder="Write something you don’t want to forget…"
          aria-label="Note"
          spellCheck
          autoFocus
        />
      </div>
      <div className="editor-footer">
        <SaveIndicator status={status} error={error} savedAt={savedAt} now={now} onRetry={() => void flush()} />
        <div className="footer-actions">
          {hasContent ? (
            <>
              <button
                type="button"
                className={`icon-button small${active.pinned ? ' is-on' : ''}`}
                onClick={() => void togglePin(active.id)}
                title={active.pinned ? 'Unpin note' : 'Pin note'}
                aria-label={active.pinned ? 'Unpin note' : 'Pin note'}
                aria-pressed={active.pinned}
              >
                <Icon icon={active.pinned ? PinOff : Pin} size={14} />
              </button>
              <button
                type="button"
                className="icon-button small"
                onClick={() => void deleteNote(active.id)}
                title="Delete this note"
                aria-label="Delete this note"
              >
                <Icon icon={Trash2} size={14} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="text-button"
            onClick={() => void showOnDesktop(active.id)}
            title={active.desktopVisible ? 'Focus this note’s desktop sticky' : 'Show this note as a sticky on the desktop'}
          >
            <Icon icon={StickyNote} size={14} /> {active.desktopVisible ? 'On desktop' : 'Sticky'}
          </button>
          <button type="button" className="text-button" onClick={onNewNote} title="New note (Ctrl+N)">
            <Icon icon={Plus} size={14} /> New note
          </button>
        </div>
      </div>
    </div>
  );
}
