import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauriRuntime } from '../native/desktop';
import type { ClipboardFilter } from './clipboardView';

/** Mirrors `ItemSummary` in src-tauri/src/clipboard/store.rs. */
export type ClipItem = {
  id: string;
  contentType: 'text' | 'rich' | 'url' | 'code' | 'number' | 'image' | 'file';
  subtype: string | null;
  preview: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  byteSize: number;
  fileMetadata: ClipFileMetadata | null;
  copiedAt: number;
  isPinned: boolean;
  hasRich: boolean;
  textLength: number;
  imageMissing: boolean;
};

export type ClipFileMetadata = {
  count?: number;
  files?: Array<{ path: string; name: string; ext: string | null; exists: boolean; isDir: boolean }>;
  source?: string;
  sourceMime?: string;
};

export type ClipItemFull = ClipItem & { text: string | null; richHtml: string | null };

export type ClipPage = { items: ClipItem[]; total: number };

/** Runtime listener state. "error" = the user wants monitoring but the native listener is not running. */
export type MonitoringState = 'off' | 'running' | 'paused' | 'error';

/** Mirrors `Status` in src-tauri/src/clipboard/mod.rs. */
export type ClipStatus = {
  state: MonitoringState;
  /** The persisted preference (clipboard_monitoring_enabled), independent of the listener. */
  enabled: boolean;
  consentGiven: boolean;
  listenerAlive: boolean;
  retentionDays: number;
  secretDetection: boolean;
  maxImageMb: number;
  skippedSensitive: number;
  skippedExcluded: number;
  skippedLarge: number;
  lastError: string | null;
  totalItems: number;
  imageBytes: number;
};

const EVENT_CLIPBOARD_CHANGED = 'doodle://clipboard-changed';

export const clipboardAvailable = () => isTauriRuntime();

function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauriRuntime()) return Promise.reject(new Error('Clipboard history needs the Nottli desktop app.'));
  return invoke<T>(command, args).catch((error: unknown) => {
    throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Clipboard request failed');
  });
}

export const clipboardApi = {
  status: () => call<ClipStatus>('clipboard_status'),
  start: (consent: boolean) => call<ClipStatus>('clipboard_start', { consent }),
  stop: () => call<ClipStatus>('clipboard_stop'),
  pause: () => call<ClipStatus>('clipboard_pause'),
  resume: () => call<ClipStatus>('clipboard_resume'),
  list: (query: string, filter: ClipboardFilter, limit: number, offset = 0) =>
    call<ClipPage>('clipboard_list', { query: query.trim() || null, filter, limit, offset }),
  get: (id: string) => call<ClipItemFull | null>('clipboard_get', { id }),
  image: (id: string, thumb: boolean) => call<string>('clipboard_image', { id, thumb }),
  copy: (id: string) => call<void>('clipboard_copy', { id }),
  copyMetadata: (id: string) => call<void>('clipboard_copy_metadata', { id }),
  setPinned: (id: string, pinned: boolean) => call<void>('clipboard_set_pinned', { id, pinned }),
  remove: (id: string) => call<void>('clipboard_delete', { id }),
  restore: (id: string) => call<void>('clipboard_restore', { id }),
  clear: (unpinnedOnly: boolean) => call<number>('clipboard_clear', { unpinnedOnly }),
  setRetention: (days: number) => call<ClipStatus>('clipboard_set_retention', { days }),
  setSecretDetection: (enabled: boolean) => call<ClipStatus>('clipboard_set_secret_detection', { enabled }),
  setMaxImageMb: (megabytes: number) => call<ClipStatus>('clipboard_set_max_image_mb', { megabytes })
};

/** Fires when a capture (or copy-again) changes history. The payload is only the item id. */
export async function onClipboardChanged(handler: (id: string) => void): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<{ id: string }>(EVENT_CLIPBOARD_CHANGED, ({ payload }) => handler(payload.id));
}
