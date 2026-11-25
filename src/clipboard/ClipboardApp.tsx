import {
  AlertCircle,
  Check,
  ClipboardList,
  Code2,
  Copy,
  File as FileIcon,
  Files,
  Hash,
  Image as ImageIcon,
  Link2,
  Pause,
  Pin,
  PinOff,
  Play,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Type,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { Icon } from '../components/Icon';
import { clipboardApi, type ClipItem, type ClipItemFull } from './clipboardApi';
import {
  IMAGE_CAP_OPTIONS,
  RETENTION_OPTIONS,
  describeSize,
  formatBytes,
  formatClipTime,
  statusLabel,
  typeLabel
} from './clipboardView';
import { useClipboardStore } from './useClipboardStore';

// ------------------------------------------------------------------------------------------
// Lazy, cached image loading: only items scrolled into view fetch their (small) thumbnail.
// ------------------------------------------------------------------------------------------

const imageCache = new Map<string, string>();
const IMAGE_CACHE_LIMIT = 120;

function cacheImage(key: string, url: string) {
  imageCache.set(key, url);
  if (imageCache.size > IMAGE_CACHE_LIMIT) imageCache.delete(imageCache.keys().next().value as string);
}

function ClipImage({ id, thumb, alt, missing, className }: { id: string; thumb: boolean; alt: string; missing?: boolean; className?: string }) {
  const key = `${id}:${thumb ? 't' : 'f'}`;
  const [src, setSrc] = useState<string | null>(() => imageCache.get(key) ?? null);
  const [failed, setFailed] = useState(Boolean(missing));
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (src || failed) return;
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const load = () =>
      clipboardApi
        .image(id, thumb)
        .then((url) => {
          if (cancelled) return;
          cacheImage(key, url);
          setSrc(url);
        })
        .catch(() => !cancelled && setFailed(true));
    if (!thumb || typeof IntersectionObserver === 'undefined') {
      void load();
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    }, { rootMargin: '120px' });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [id, thumb, key, src, failed]);

  return (
    <span ref={ref} className={`clip-image ${className ?? ''}`}>
      {src ? <img src={src} alt={alt} draggable={false} /> : failed ? <span className="clip-image-missing"><Icon icon={ImageIcon} size={16} />Image file missing</span> : null}
    </span>
  );
}

function typeIcon(item: ClipItem) {
  switch (item.contentType) {
    case 'url': return Link2;
    case 'code': return Code2;
    case 'number': return Hash;
    case 'image': return ImageIcon;
    case 'file': return (item.fileMetadata?.count ?? 1) > 1 ? Files : FileIcon;
    default: return Type;
  }
}

// ------------------------------------------------------------------------------------------
// Main tab
// ------------------------------------------------------------------------------------------

type Props = { searchRef: RefObject<HTMLInputElement>; now: Date };

export function ClipboardApp({ searchRef, now }: Props) {
  const store = useClipboardStore();
  const { status, items, total, loaded, loadError, query, previewId, toast, consentOpen } = store;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(query);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void useClipboardStore.getState().init().then((cleanup) => (disposed ? cleanup() : (off = cleanup)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  // Debounce typing so every keystroke does not hit the database.
  useEffect(() => {
    if (draft === query) return;
    const timer = window.setTimeout(() => store.setQuery(draft), 160);
    return () => window.clearTimeout(timer);
  }, [draft, query, store]);

  // Keep the privacy state fresh while the tab is on screen (listener errors, skipped counters).
  useEffect(() => {
    const refresh = () => void useClipboardStore.getState().refreshStatus();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const state = status?.state ?? 'off';
  const searching = query.trim() !== '';
  const overlayOpen = Boolean(previewId) || settingsOpen || consentOpen;

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape' && overlayOpen) {
      event.preventDefault();
      event.stopPropagation(); // do not let the workspace close
      if (consentOpen) store.dismissConsent();
      else if (previewId) store.closePreview();
      else setSettingsOpen(false);
    }
  };

  const onListKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('.clip-row'));
    const index = rows.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
    } else if (event.key === 'Delete' && index >= 0) {
      event.preventDefault();
      const id = rows[index].dataset.id;
      if (id) void store.remove(id);
    }
  };

  let body;
  if (!loaded) {
    body = (
      <ul className="skeleton-list clip-skeleton" aria-busy="true" aria-label="Loading clipboard history">
        {[0, 1, 2, 3].map((i) => <li key={i} className="skeleton-row" />)}
      </ul>
    );
  } else if (loadError) {
    body = (
      <div className="state-block clip-state" role="alert">
        <Icon icon={AlertCircle} size={20} />
        <p>{loadError}</p>
        <button type="button" className="text-button" onClick={() => void store.refresh()}>Try again</button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="state-block clip-state">
        <Icon icon={searching ? Search : ClipboardList} size={20} />
        {searching ? (
          <p>No clipboard items match “{query.trim()}”.</p>
        ) : state === 'off' ? (
          <p><strong>No clipboard history yet.</strong><br />Turn monitoring on and Nottli will keep what you copy, on this PC only.</p>
        ) : (
          <p><strong>Nothing captured yet.</strong><br />Copy some text, an image or a file and it will appear here.</p>
        )}
      </div>
    );
  } else {
    body = (
      <ul className="clip-list" ref={listRef} onKeyDown={onListKeyDown} aria-label="Clipboard history">
        {items.map((item) => (
          <ClipRow key={item.id} item={item} now={now} />
        ))}
        {items.length < total ? (
          <li className="more-row">
            <button type="button" className="text-button" onClick={store.loadMore}>Show more ({total - items.length})</button>
          </li>
        ) : null}
      </ul>
    );
  }

  return (
    <div className="clipboard" onKeyDown={onKeyDown}>
      <div className="clip-head">
        <div className={`clip-status is-${state}`} role="status" aria-live="polite">
          <span className="clip-dot" aria-hidden="true" />
          <span className="clip-status-text">
            <strong>{statusLabel(state)}</strong>
            <small>
              {state === 'off'
                ? 'Nottli is not reading your clipboard'
                : state === 'paused'
                  ? 'Copies are being ignored'
                  : state === 'error'
                    ? 'Saved as on, but not running. Not capturing.'
                    : 'Runs in the background while Nottli is open'}
            </small>
          </span>
          <span className="clip-status-actions">
            {state === 'off' || state === 'error' ? (
              <>
                <button type="button" className="text-button" onClick={() => void store.requestStart()}>
                  <Icon icon={state === 'error' ? RefreshCw : Power} size={13} /> {state === 'error' ? 'Retry' : 'Turn on'}
                </button>
                {state === 'error' ? (
                  <button type="button" className="icon-button glass-btn small-glass" onClick={() => void store.stop()} title="Turn monitoring off" aria-label="Turn monitoring off">
                    <Icon icon={Power} size={14} />
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <button type="button" className="text-button" onClick={() => void (state === 'running' ? store.pause() : store.resume())}>
                  <Icon icon={state === 'running' ? Pause : Play} size={13} /> {state === 'running' ? 'Pause' : 'Resume'}
                </button>
                <button type="button" className="icon-button glass-btn small-glass" onClick={() => void store.stop()} title="Turn monitoring off" aria-label="Turn monitoring off">
                  <Icon icon={Power} size={14} />
                </button>
              </>
            )}
            <button type="button" className="icon-button glass-btn small-glass" onClick={() => setSettingsOpen(true)} title="Privacy and retention settings" aria-label="Clipboard settings">
              <Icon icon={SlidersHorizontal} size={14} />
            </button>
          </span>
        </div>
        {status?.lastError ? <p className="clip-warning" role="alert"><Icon icon={AlertCircle} size={12} /> {status.lastError}</p> : null}

        <label className="search clip-search">
          <Icon icon={Search} size={14} />
          <input
            ref={searchRef}
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Search clipboard history"
            aria-label="Search clipboard history"
          />
        </label>
      </div>

      {body}

      {previewId ? <PreviewDialog id={previewId} now={now} /> : null}
      {settingsOpen ? <SettingsSheet onClose={() => setSettingsOpen(false)} /> : null}
      {consentOpen ? <ConsentDialog /> : null}

      {toast ? (
        <div className={`toast clip-toast${toast.kind === 'error' ? ' is-error' : ''}`} role="status">
          <span>{toast.message}</span>
          {toast.kind === 'undo' ? <button type="button" className="link-button" onClick={() => void store.undoRemove()}>Undo</button> : null}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Item row
// ------------------------------------------------------------------------------------------

function ClipRow({ item, now }: { item: ClipItem; now: Date }) {
  const { copy, togglePin, remove, openPreview } = useClipboardStore.getState();
  const label = typeLabel(item);
  const IconType = typeIcon(item);
  const fileCount = item.fileMetadata?.count ?? 1;

  return (
    <li className={`clip-item${item.isPinned ? ' is-pinned' : ''}`}>
      <button type="button" className="clip-row" data-id={item.id} onClick={() => openPreview(item.id)} aria-label={`${label}: ${item.preview || 'open'}`}>
        {item.contentType === 'image' ? (
          <ClipImage id={item.id} thumb alt="" missing={item.imageMissing} className="clip-thumb" />
        ) : (
          <span className={`clip-glyph kind-${item.contentType}`}><Icon icon={IconType} size={16} /></span>
        )}
        <span className="clip-main">
          <span className={`clip-preview${item.contentType === 'code' || item.contentType === 'number' ? ' is-mono' : ''}`}>
            {item.contentType === 'image' ? describeSize(item) || item.preview : item.preview || '(blank)'}
          </span>
          <span className="clip-meta">
            {item.isPinned ? <span className="pin-mark" title="Pinned"><Icon icon={Pin} size={10} /></span> : null}
            <span className="clip-tag">{label}</span>
            {item.contentType === 'file' && fileCount > 1 ? <span>{fileCount} files</span> : null}
            {item.contentType === 'image' && item.imageMissing ? <span className="clip-bad">file missing</span> : null}
            <time dateTime={new Date(item.copiedAt).toISOString()}>{formatClipTime(item.copiedAt, now)}</time>
          </span>
        </span>
      </button>
      <span className="clip-actions">
        <button type="button" className="icon-button small" onClick={() => void copy(item.id)} title="Copy again" aria-label={`Copy again: ${item.preview || label}`} disabled={item.imageMissing}>
          <Icon icon={Copy} size={14} />
        </button>
        <button type="button" className={`icon-button small${item.isPinned ? ' is-on' : ''}`} onClick={() => void togglePin(item.id)} title={item.isPinned ? 'Unpin' : 'Pin'} aria-label={item.isPinned ? 'Unpin item' : 'Pin item'} aria-pressed={item.isPinned}>
          <Icon icon={item.isPinned ? PinOff : Pin} size={14} />
        </button>
        <button type="button" className="icon-button small danger" onClick={() => void remove(item.id)} title="Delete" aria-label="Delete item">
          <Icon icon={Trash2} size={14} />
        </button>
      </span>
    </li>
  );
}

// ------------------------------------------------------------------------------------------
// Preview
// ------------------------------------------------------------------------------------------

function PreviewDialog({ id, now }: { id: string; now: Date }) {
  const { closePreview, copy, copyMetadata, togglePin, remove } = useClipboardStore.getState();
  const listed = useClipboardStore((state) => state.items.find((item) => item.id === id));
  const [full, setFull] = useState<ClipItemFull | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFull(null);
    setError(null);
    clipboardApi
      .get(id)
      .then((value) => !cancelled && (value ? setFull(value) : setError('This item no longer exists.')))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load this item.'));
    return () => { cancelled = true; };
  }, [id]);

  const item = listed ?? full;
  if (!item) {
    return (
      <div className="clip-overlay" role="dialog" aria-label="Clipboard item">
        <div className="clip-dialog">
          {error ? <p className="clip-error">{error}</p> : <p className="clip-muted">Loading…</p>}
          <div className="dialog-actions"><button type="button" className="text-button" onClick={closePreview} autoFocus>Close</button></div>
        </div>
      </div>
    );
  }
  const label = typeLabel(item);
  const files = item.fileMetadata?.files ?? [];

  return (
    <div className="clip-overlay" role="dialog" aria-modal="true" aria-label={`${label} preview`}>
      <div className="clip-dialog">
        <header className="dialog-head">
          <div>
            <h2>{label}</h2>
            <p>
              {formatClipTime(item.copiedAt, now)}
              {item.contentType === 'image' ? ` · ${describeSize(item)} · ${formatBytes(item.byteSize)}` : item.textLength ? ` · ${item.textLength.toLocaleString()} characters` : ''}
            </p>
          </div>
          <button type="button" className="icon-button glass-btn" onClick={closePreview} aria-label="Close preview" title="Close (Esc)" autoFocus>
            <Icon icon={X} size={16} />
          </button>
        </header>

        <div className="dialog-body">
          {error ? <p className="clip-error">{error}</p> : null}
          {item.contentType === 'image' ? (
            <ClipImage id={item.id} thumb={false} alt="Clipboard image" missing={item.imageMissing} className="clip-full" />
          ) : item.contentType === 'file' ? (
            <>
              <p className="clip-note">
                <Icon icon={ShieldCheck} size={13} /> File reference only. Nottli saved the path{files.length === 1 ? '' : 's'}, not the file contents.
              </p>
              <ul className="clip-files">
                {files.map((file) => (
                  <li key={file.path}>
                    <strong>{file.name}{file.ext ? '' : file.isDir ? ' (folder)' : ''}</strong>
                    <span>{file.path}</span>
                    <small>{file.ext ? `.${file.ext}` : file.isDir ? 'Folder' : 'No extension'}{file.exists ? '' : ' · not accessible now'}</small>
                  </li>
                ))}
                {files.length < (item.fileMetadata?.count ?? 0) ? <li><small>…and {(item.fileMetadata?.count ?? 0) - files.length} more</small></li> : null}
              </ul>
            </>
          ) : (
            <>
              {item.hasRich ? <p className="clip-note">Rich formatting is kept and restored when you copy it again. Shown here as plain text.</p> : null}
              <pre className={`clip-text${item.contentType === 'code' || item.contentType === 'number' ? ' is-mono' : ''}`}>{full ? full.text ?? '' : item.preview}</pre>
            </>
          )}
        </div>

        <footer className="dialog-actions">
          <button type="button" className="text-button" onClick={() => void copy(item.id)} disabled={item.imageMissing}><Icon icon={Copy} size={14} /> Copy again</button>
          {item.contentType === 'image' || item.contentType === 'file' ? (
            <button type="button" className="text-button" onClick={() => void copyMetadata(item.id)}>Copy details</button>
          ) : null}
          <button type="button" className="text-button" onClick={() => void togglePin(item.id)} aria-pressed={item.isPinned}>
            <Icon icon={item.isPinned ? PinOff : Pin} size={14} /> {item.isPinned ? 'Unpin' : 'Pin'}
          </button>
          <button type="button" className="text-button danger" onClick={() => void remove(item.id)}><Icon icon={Trash2} size={14} /> Delete</button>
        </footer>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// Settings / privacy
// ------------------------------------------------------------------------------------------

function SettingsSheet({ onClose }: { onClose: () => void }) {
  const store = useClipboardStore.getState();
  const status = useClipboardStore((state) => state.status);
  const [confirm, setConfirm] = useState<'unpinned' | 'all' | null>(null);
  const capOptions = useMemo(
    () => (status && !IMAGE_CAP_OPTIONS.some((o) => o.mb === status.maxImageMb) ? [...IMAGE_CAP_OPTIONS, { mb: status.maxImageMb, label: `${status.maxImageMb} MB` }] : IMAGE_CAP_OPTIONS),
    [status]
  );
  if (!status) return null;

  const skipped = status.skippedSensitive + status.skippedExcluded + status.skippedLarge;
  return (
    <div className="clip-overlay" role="dialog" aria-modal="true" aria-label="Clipboard settings">
      <div className="clip-dialog">
        <header className="dialog-head">
          <div><h2>Privacy & retention</h2><p>Clipboard history stays on this PC.</p></div>
          <button type="button" className="icon-button glass-btn" onClick={onClose} aria-label="Close settings" title="Close (Esc)" autoFocus><Icon icon={X} size={16} /></button>
        </header>
        <div className="dialog-body settings">
          <label className="setting-row">
            <span><strong>Keep history for</strong><small>Pinned items never expire.</small></span>
            <select value={status.retentionDays} onChange={(event) => void store.setRetention(Number(event.target.value))}>
              {RETENTION_OPTIONS.map((o) => <option key={o.days} value={o.days}>{o.label}</option>)}
            </select>
          </label>
          <label className="setting-row">
            <span><strong>Skip likely secrets</strong><small>Best effort: API keys, tokens, private keys, password-like text. It can miss things and can skip harmless items.</small></span>
            <input type="checkbox" role="switch" className="switch" checked={status.secretDetection} onChange={(event) => void store.setSecretDetection(event.target.checked)} />
          </label>
          <label className="setting-row">
            <span><strong>Image storage limit</strong><small>Oldest unpinned images are removed first. Using {formatBytes(status.imageBytes)}.</small></span>
            <select value={status.maxImageMb} onChange={(event) => void store.setMaxImageMb(Number(event.target.value))}>
              {capOptions.map((o) => <option key={o.mb} value={o.mb}>{o.label}</option>)}
            </select>
          </label>
          <p className="clip-note">
            <ShieldCheck size={13} aria-hidden="true" /> Nottli also honours the “exclude from clipboard history” flag that password managers set.
            {skipped > 0 ? ` Skipped so far this session: ${status.skippedSensitive} likely secrets, ${status.skippedExcluded} excluded by the source app, ${status.skippedLarge} too large.` : ''}
          </p>
          <div className="danger-zone">
            <strong>{status.totalItems} saved item{status.totalItems === 1 ? '' : 's'}</strong>
            {confirm ? (
              <span className="confirm-row">
                <span>{confirm === 'all' ? 'Delete everything, including pinned?' : 'Delete all unpinned items?'}</span>
                <button type="button" className="text-button danger" onClick={() => { void store.clear(confirm === 'unpinned'); setConfirm(null); }}><Check size={13} aria-hidden="true" /> Yes, clear</button>
                <button type="button" className="text-button" onClick={() => setConfirm(null)}>Cancel</button>
              </span>
            ) : (
              <span className="confirm-row">
                <button type="button" className="text-button" onClick={() => setConfirm('unpinned')}>Clear unpinned</button>
                <button type="button" className="text-button danger" onClick={() => setConfirm('all')}>Clear all history</button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------
// First-run consent
// ------------------------------------------------------------------------------------------

function ConsentDialog() {
  const { confirmStart, dismissConsent } = useClipboardStore.getState();
  return (
    <div className="clip-overlay" role="alertdialog" aria-modal="true" aria-labelledby="consent-title">
      <div className="clip-dialog">
        <header className="dialog-head">
          <div><h2 id="consent-title">Turn on clipboard history?</h2><p>Please read before you start.</p></div>
        </header>
        <div className="dialog-body">
          <ul className="consent-list">
            <li>While monitoring is on, Nottli reads what you copy: text, images and file paths.</li>
            <li>Everything is stored locally on this PC. Clipboard content is never sent over the network.</li>
            <li>You can pause or turn monitoring off at any time, and clear your history from settings.</li>
            <li>Some sensitive content may still be captured. Nottli skips likely secrets on a best-effort basis only.</li>
            <li>Monitoring is remembered, so it resumes when Nottli next starts, until you turn it off.</li>
          </ul>
        </div>
        <footer className="dialog-actions">
          <button type="button" className="text-button" onClick={dismissConsent}>Not now</button>
          <button type="button" className="text-button primary" onClick={() => void confirmStart()} autoFocus>Turn on monitoring</button>
        </footer>
      </div>
    </div>
  );
}
