import { ClipboardList, PenLine, StickyNote, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { ClipboardApp } from '../clipboard/ClipboardApp';
import { Icon } from '../components/Icon';
import { emitPetActivity, hideNotes, isTauriRuntime, onBeforeQuit, onNotesVisibility, quitApp } from '../native/desktop';
import { CreateNoteTab } from '../notes/CreateNoteTab';
import { NotesTab } from '../notes/NotesTab';
import { useNotesStore } from '../notes/useNotesStore';
import { PanelMark } from './PanelMark';
import './workspace.css';

type TabId = 'create' | 'notes' | 'clipboard';

const TABS: Array<{ id: TabId; label: string; title: string; icon: typeof PenLine }> = [
  { id: 'create', label: 'Create', title: 'Create Note', icon: PenLine },
  { id: 'notes', label: 'Notes', title: 'Notes', icon: StickyNote },
  { id: 'clipboard', label: 'Clipboard', title: 'Clipboard', icon: ClipboardList }
];

/** One floating window with three internal tabs. Panes stay mounted so switching is instant. */
export function Workspace() {
  const deleted = useNotesStore((state) => state.deleted);
  const { load, flush, newNote, openNote, undoDelete, setQuery } = useNotesStore.getState();
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const clipboardSearchRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<TabId>('create');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [now, setNow] = useState(() => new Date());
  const [visible, setVisible] = useState(!isTauriRuntime());

  const focusEditor = useCallback(() => {
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
  }, []);

  const focusSearch = useCallback((target: RefObject<HTMLInputElement> = searchRef) => {
    requestAnimationFrame(() => {
      target.current?.focus();
      target.current?.select();
    });
  }, []);

  const showTab = useCallback(
    (next: TabId) => {
      setTab(next);
      if (next === 'create') focusEditor();
      else if (next === 'notes') focusSearch();
    },
    [focusEditor, focusSearch]
  );

  const close = useCallback(async () => {
    await flush();
    await hideNotes();
  }, [flush]);

  // Load notes once, and wire window lifecycle events (unchanged behaviour from the old notes popup).
  useEffect(() => {
    void load();
    let disposed = false;
    const cleanups: Array<() => void> = [];
    const keep = (off: () => void) => (disposed ? off() : cleanups.push(off));
    // Cross-window sync: sticky windows, the tray and the shortcut talk to this store through events.
    void useNotesStore.getState().initSync().then(keep);

    void onNotesVisibility((isVisible) => {
      setVisible(isVisible);
      if (isVisible) {
        setNow(new Date());
        if (tabRef.current === 'create') focusEditor();
      } else {
        void flush();
      }
    }).then(keep);
    void onBeforeQuit(async () => {
      await flush();
      await quitApp();
    }).then(keep);

    const onBlur = () => void flush();
    const onUnload = () => void flush();
    window.addEventListener('blur', onBlur);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      disposed = true;
      cleanups.forEach((off) => off());
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [load, flush, focusEditor]);

  // Tell the pet what is happening: "editing" at most once a second, "saved" on each successful save.
  useEffect(() => {
    let lastEditSignal = 0;
    return useNotesStore.subscribe((state, previous) => {
      if (state.active.id === previous.active.id && state.active.content !== previous.active.content) {
        const stamp = Date.now();
        if (stamp - lastEditSignal > 1000) {
          lastEditSignal = stamp;
          void emitPetActivity('editing').catch(() => undefined);
        }
      }
      if (state.status === 'saved' && previous.status !== 'saved') {
        void emitPetActivity('saved').catch(() => undefined);
      }
    });
  }, []);

  // Keep relative timestamps fresh, but only while the panel is on screen.
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [visible]);

  const handleNewNote = useCallback(async () => {
    setQuery('');
    if (await newNote()) showTab('create');
  }, [newNote, setQuery, showTab]);

  const handleOpen = useCallback(
    async (id: string) => {
      if (await openNote(id)) showTab('create');
    },
    [openNote, showTab]
  );

  // Panel shortcuts. The global toggle (Ctrl+Alt+N) is registered natively.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && !event.altKey && key === 'n') {
        event.preventDefault();
        void handleNewNote();
      } else if (mod && key === 's') {
        event.preventDefault();
        void flush();
      } else if (mod && key === 'f') {
        event.preventDefault();
        if (tabRef.current === 'clipboard') focusSearch(clipboardSearchRef);
        else showTab('notes');
      } else if (mod && key === 'e') {
        event.preventDefault();
        showTab('create');
      } else if (mod && ['1', '2', '3'].includes(key)) {
        event.preventDefault();
        showTab(TABS[Number(key) - 1].id);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (document.activeElement === searchRef.current && searchRef.current?.value) setQuery('');
        else void close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNewNote, flush, close, setQuery, showTab, focusSearch]);

  const onTabKeyDown = (event: ReactKeyboardEvent, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    showTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  return (
    <div className="panel" role="dialog" aria-label="Nottli workspace">
      <header className="panel-header" data-tauri-drag-region>
        <span className="panel-mark"><PanelMark size={32} /></span>
        <div
          className="tabs"
          role="tablist"
          aria-label="Workspace sections"
          style={{ '--i': TABS.findIndex((item) => item.id === tab) } as CSSProperties}
        >
          <span className="tab-thumb" aria-hidden="true" />
          {TABS.map((item, index) => (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              className="tab"
              aria-selected={tab === item.id}
              aria-controls={`pane-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              title={`${item.title} (Ctrl+${index + 1})`}
              onClick={() => showTab(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              <Icon icon={item.icon} size={14} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="icon-button glass-btn close-button" onClick={() => void close()} title="Close (Esc)" aria-label="Close workspace">
          <Icon icon={X} size={16} />
        </button>
      </header>

      <main className="panes">
        <section id="pane-create" role="tabpanel" aria-labelledby="tab-create" hidden={tab !== 'create'}>
          <CreateNoteTab editorRef={editorRef} now={now} onNewNote={() => void handleNewNote()} />
        </section>
        <section id="pane-notes" role="tabpanel" aria-labelledby="tab-notes" hidden={tab !== 'notes'}>
          <NotesTab searchRef={searchRef} now={now} onOpen={(id) => void handleOpen(id)} onNewNote={() => void handleNewNote()} />
        </section>
        <section id="pane-clipboard" role="tabpanel" aria-labelledby="tab-clipboard" hidden={tab !== 'clipboard'}>
          <ClipboardApp searchRef={clipboardSearchRef} now={now} />
        </section>
      </main>

      {deleted ? (
        <div className="toast" role="status">
          <span>Note deleted</span>
          <button type="button" className="link-button" onClick={() => void undoDelete()}>Undo</button>
        </div>
      ) : null}
    </div>
  );
}
