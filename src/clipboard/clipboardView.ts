// Pure presentation helpers for the clipboard tab. No imports on purpose: these are unit tested
// with Node's built-in runner (tests/clipboardView.test.ts).

export type ClipboardFilter = 'all' | 'text' | 'images' | 'numbers' | 'files' | 'urls' | 'code';

export const FILTERS: ReadonlyArray<{ id: ClipboardFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text' },
  { id: 'images', label: 'Images' },
  { id: 'numbers', label: 'Numbers' },
  { id: 'files', label: 'Files' },
  { id: 'urls', label: 'URLs' },
  { id: 'code', label: 'Code' }
];

export const RETENTION_OPTIONS: ReadonlyArray<{ days: number; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 0, label: 'Forever' }
];

export const IMAGE_CAP_OPTIONS: ReadonlyArray<{ mb: number; label: string }> = [
  { mb: 100, label: '100 MB' },
  { mb: 250, label: '250 MB' },
  { mb: 500, label: '500 MB' },
  { mb: 1000, label: '1 GB' },
  { mb: 2000, label: '2 GB' }
];

type Sortable = { isPinned: boolean; copiedAt: number };

/** Same order the backend uses: pinned first, then newest. */
export function compareItems(a: Sortable, b: Sortable) {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.copiedAt - a.copiedAt;
}

const SUBTYPE_LABELS: Record<string, string> = {
  integer: 'Integer',
  decimal: 'Decimal',
  price: 'Price',
  phone: 'Phone number',
  id: 'ID',
  reference: 'Reference number'
};

type Labelled = { contentType: string; subtype: string | null; fileMetadata?: { count?: number } | null };

export function typeLabel(item: Labelled): string {
  switch (item.contentType) {
    case 'number':
      return `Number · ${SUBTYPE_LABELS[item.subtype ?? ''] ?? 'Numeric'}`;
    case 'url':
      return 'URL';
    case 'code':
      return 'Code';
    case 'image':
      return 'Image';
    case 'rich':
      return 'Rich text';
    case 'file':
      return (item.fileMetadata?.count ?? 1) > 1 ? 'File references' : 'File reference';
    default:
      return 'Text';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatClipTime(epochMs: number, now: Date): string {
  const diff = now.getTime() - epochMs;
  if (diff < 45_000) return 'Just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(diff / 3_600_000);
  if (hours < 24 && new Date(epochMs).toDateString() === now.toDateString()) return `${hours}h ago`;
  const date = new Date(epochMs);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + (date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`);
}

export function retentionLabel(days: number): string {
  return RETENTION_OPTIONS.find((option) => option.days === days)?.label ?? `${days} days`;
}

export function statusLabel(state: 'off' | 'running' | 'paused' | 'error'): string {
  return state === 'running'
    ? 'Monitoring on'
    : state === 'paused'
      ? 'Monitoring paused'
      : state === 'error'
        ? 'Monitoring problem'
        : 'Monitoring off';
}

/** A short, accessible description of what an image or file entry holds. */
export function describeSize(item: { width: number | null; height: number | null; mimeType: string | null }): string {
  if (!item.width || !item.height) return '';
  return `${item.width} × ${item.height} · ${(item.mimeType ?? 'image/png').replace('image/', '').toUpperCase()}`;
}
