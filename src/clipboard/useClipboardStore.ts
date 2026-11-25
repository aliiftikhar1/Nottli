import { create } from 'zustand';
import { clipboardApi, clipboardAvailable, onClipboardChanged, type ClipItem, type ClipStatus } from './clipboardApi';
import type { ClipboardFilter } from './clipboardView';

const PAGE_SIZE = 60;
const UNDO_WINDOW_MS = 6000;
const NOTICE_MS = 2200;

type Toast = { kind: 'info' | 'error' | 'undo'; message: string; itemId?: string };

type ClipboardStore = {
  status: ClipStatus | null;
  items: ClipItem[];
  total: number;
  limit: number;
  query: string;
  filter: ClipboardFilter;
  loaded: boolean;
  /** Set when the history could not be read. */
  loadError: string | null;
  previewId: string | null;
  toast: Toast | null;
  /** Shows the first-run privacy explanation before monitoring starts. */
  consentOpen: boolean;
  init: () => Promise<() => void>;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setQuery: (query: string) => void;
  setFilter: (filter: ClipboardFilter) => void;
  loadMore: () => void;
  requestStart: () => Promise<void>;
  confirmStart: () => Promise<void>;
  dismissConsent: () => void;
  stop: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  copy: (id: string) => Promise<void>;
  copyMetadata: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  undoRemove: () => Promise<void>;
  clear: (unpinnedOnly: boolean) => Promise<void>;
  setRetention: (days: number) => Promise<void>;
  setSecretDetection: (enabled: boolean) => Promise<void>;
  setMaxImageMb: (megabytes: number) => Promise<void>;
  openPreview: (id: string) => void;
  closePreview: () => void;
  dismissToast: () => void;
};

let toastTimer: number | undefined;
let requestCounter = 0;

export const useClipboardStore = create<ClipboardStore>((set, get) => {
  const message = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong');

  const showToast = (toast: Toast, ms = NOTICE_MS) => {
    window.clearTimeout(toastTimer);
    set({ toast });
    toastTimer = window.setTimeout(() => set({ toast: null }), ms);
  };

  const guard = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      showToast({ kind: 'error', message: message(error) }, 4000);
    }
  };

  const applyStatus = (status: ClipStatus) => set({ status });

  return {
    status: null,
    items: [],
    total: 0,
    limit: PAGE_SIZE,
    query: '',
    filter: 'all',
    loaded: false,
    loadError: null,
    previewId: null,
    toast: null,
    consentOpen: false,

    async init() {
      if (!clipboardAvailable()) {
        set({ loaded: true, loadError: 'Clipboard history needs the Nottli desktop app.' });
        return () => undefined;
      }
      await Promise.all([get().refreshStatus(), get().refresh()]);
      let timer: number | undefined;
      const unlisten = await onClipboardChanged(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          void get().refresh();
          void get().refreshStatus();
        }, 120);
      });
      return () => {
        window.clearTimeout(timer);
        unlisten();
      };
    },

    async refresh() {
      const { query, filter, limit } = get();
      const request = ++requestCounter;
      try {
        const page = await clipboardApi.list(query, filter, limit);
        if (request !== requestCounter) return; // a newer request superseded this one
        set({ items: page.items, total: page.total, loaded: true, loadError: null });
      } catch (error) {
        if (request !== requestCounter) return;
        set({ loaded: true, loadError: message(error) });
      }
    },

    async refreshStatus() {
      try {
        applyStatus(await clipboardApi.status());
      } catch {
        // The list's own error state covers an unavailable service.
      }
    },

    setQuery(query) {
      set({ query, limit: PAGE_SIZE });
      void get().refresh();
    },

    setFilter(filter) {
      set({ filter, limit: PAGE_SIZE });
      void get().refresh();
    },

    loadMore() {
      set({ limit: get().limit + PAGE_SIZE });
      void get().refresh();
    },

    async requestStart() {
      const status = get().status;
      if (status && !status.consentGiven) {
        set({ consentOpen: true });
        return;
      }
      await guard(async () => applyStatus(await clipboardApi.start(false)));
    },

    async confirmStart() {
      set({ consentOpen: false });
      await guard(async () => {
        applyStatus(await clipboardApi.start(true));
        showToast({ kind: 'info', message: 'Monitoring is on' });
      });
    },

    dismissConsent() {
      set({ consentOpen: false });
    },

    async stop() {
      await guard(async () => {
        applyStatus(await clipboardApi.stop());
        showToast({ kind: 'info', message: 'Monitoring is off' });
      });
    },
    async pause() {
      await guard(async () => applyStatus(await clipboardApi.pause()));
    },
    async resume() {
      await guard(async () => applyStatus(await clipboardApi.resume()));
    },

    async copy(id) {
      await guard(async () => {
        await clipboardApi.copy(id);
        showToast({ kind: 'info', message: 'Copied to clipboard' });
        await get().refresh();
      });
    },

    async copyMetadata(id) {
      await guard(async () => {
        await clipboardApi.copyMetadata(id);
        showToast({ kind: 'info', message: 'Details copied' });
      });
    },

    async togglePin(id) {
      const item = get().items.find((entry) => entry.id === id);
      if (!item) return;
      await guard(async () => {
        await clipboardApi.setPinned(id, !item.isPinned);
        await get().refresh();
      });
    },

    async remove(id) {
      await guard(async () => {
        await clipboardApi.remove(id);
        if (get().previewId === id) set({ previewId: null });
        showToast({ kind: 'undo', message: 'Item deleted', itemId: id }, UNDO_WINDOW_MS);
        await get().refresh();
        void get().refreshStatus();
      });
    },

    async undoRemove() {
      const toast = get().toast;
      if (toast?.kind !== 'undo' || !toast.itemId) return;
      window.clearTimeout(toastTimer);
      set({ toast: null });
      await guard(async () => {
        await clipboardApi.restore(toast.itemId!);
        await get().refresh();
        void get().refreshStatus();
      });
    },

    async clear(unpinnedOnly) {
      await guard(async () => {
        const removed = await clipboardApi.clear(unpinnedOnly);
        set({ previewId: null });
        showToast({ kind: 'info', message: removed === 1 ? 'Cleared 1 item' : `Cleared ${removed} items` });
        await get().refresh();
        void get().refreshStatus();
      });
    },

    async setRetention(days) {
      await guard(async () => {
        applyStatus(await clipboardApi.setRetention(days));
        await get().refresh();
      });
    },
    async setSecretDetection(enabled) {
      await guard(async () => applyStatus(await clipboardApi.setSecretDetection(enabled)));
    },
    async setMaxImageMb(megabytes) {
      await guard(async () => {
        applyStatus(await clipboardApi.setMaxImageMb(megabytes));
        await get().refresh();
      });
    },

    openPreview: (id) => set({ previewId: id }),
    closePreview: () => set({ previewId: null }),
    dismissToast() {
      window.clearTimeout(toastTimer);
      set({ toast: null });
    }
  };
});
