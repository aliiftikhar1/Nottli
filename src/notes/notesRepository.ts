import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '../native/desktop';

export const STICKY_THEMES = ['yellow', 'pink', 'coral', 'teal', 'orange', 'cream', 'lavender', 'green'] as const;
export type StickyTheme = (typeof STICKY_THEMES)[number];
export type StickyListItem = { id: string; text: string; done: boolean };

export type Note = {
  id: string;
  title: string;
  content: string;
  /** Null for an ordinary text note; an array (including empty) means checklist mode. */
  listItems: StickyListItem[] | null;
  pinned: boolean;
  /** ISO-8601 timestamps */
  createdAt: string;
  updatedAt: string;
  /** Whether the note currently has a sticky window on the desktop. */
  desktopVisible: boolean;
  /** Last sticky geometry in physical pixels (null until the sticky has been placed). */
  stickyX: number | null;
  stickyY: number | null;
  stickyWidth: number | null;
  stickyHeight: number | null;
  stickyTheme: StickyTheme;
  stickyOnTop: boolean;
};

export type StickyGeometry = { x: number; y: number; width: number; height: number };

/** Defaults for the desktop-only fields of a brand-new note. */
export const stickyDefaults = (): Pick<
  Note,
  'desktopVisible' | 'stickyX' | 'stickyY' | 'stickyWidth' | 'stickyHeight' | 'stickyTheme' | 'stickyOnTop'
> & Pick<Note, 'listItems'> => ({ desktopVisible: false, stickyX: null, stickyY: null, stickyWidth: null, stickyHeight: null, stickyTheme: 'yellow', stickyOnTop: false, listItems: null });

export interface NotesRepository {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | null>;
  save(note: Note): Promise<void>;
  /** Writes only the fields given (title and/or body) and the new updated_at. Never touches other fields. */
  updateText(id: string, fields: { title?: string; content?: string }, updatedAt: string): Promise<void>;
  updateList(id: string, items: StickyListItem[] | null, updatedAt: string): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  setDesktop(id: string, visible: boolean): Promise<void>;
  setGeometry(id: string, geometry: StickyGeometry): Promise<void>;
  setTheme(id: string, theme: StickyTheme): Promise<void>;
  setOnTop(id: string, onTop: boolean): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Must match `DATABASE_URL` in src-tauri/src/lib.rs so the registered migrations run. */
const DATABASE_URL = 'sqlite:doodle.db';

type NoteRow = {
  id: string;
  title: string;
  body: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  desktop_visible: number;
  sticky_x: number | null;
  sticky_y: number | null;
  sticky_width: number | null;
  sticky_height: number | null;
  sticky_theme: string;
  sticky_always_on_top: number;
  sticky_list: string | null;
};

const COLUMNS =
  'id, title, body, pinned, created_at, updated_at, desktop_visible, sticky_x, sticky_y, sticky_width, sticky_height, sticky_theme, sticky_always_on_top, sticky_list';

/** Pinned notes first, then most recently updated. */
export function compareNotes(a: Note, b: Note) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

const asTheme = (value: string): StickyTheme => ((STICKY_THEMES as readonly string[]).includes(value) ? (value as StickyTheme) : 'yellow');

function asListItems(value: string | null | undefined): StickyListItem[] | null {
  if (value == null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const items = parsed.filter((item): item is { id?: unknown; text?: unknown; done?: unknown } => !!item && typeof item === 'object');
    if (items.some((item) => typeof item.text !== 'string' || typeof item.done !== 'boolean')) return null;
    return items.map((item) => ({ id: typeof item.id === 'string' ? item.id : crypto.randomUUID(), text: item.text as string, done: item.done as boolean }));
  } catch {
    return null;
  }
}

const encodeListItems = (items: StickyListItem[] | null) => (items == null ? null : JSON.stringify(items));

function fromRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.body,
    listItems: asListItems(row.sticky_list),
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    desktopVisible: row.desktop_visible === 1,
    stickyX: row.sticky_x,
    stickyY: row.sticky_y,
    stickyWidth: row.sticky_width,
    stickyHeight: row.sticky_height,
    stickyTheme: asTheme(row.sticky_theme),
    stickyOnTop: row.sticky_always_on_top === 1
  };
}

function createSqliteRepository(): NotesRepository {
  let connection: Promise<Database> | null = null;
  const db = () => {
    // Retry the connection on the next call if loading failed.
    connection ??= Database.load(DATABASE_URL)
      .then(async (database) => {
        // Migrations 1-3 have run (SQL plugin); make sure the additive sticky columns exist too.
        await invoke('ensure_sticky_schema');
        return database;
      })
      .catch((error: unknown) => {
        connection = null;
        throw error;
      });
    return connection;
  };
  const run = async (sql: string, args: unknown[]) => {
    await (await db()).execute(sql, args);
  };

  return {
    async list() {
      const rows = await (await db()).select<NoteRow[]>(`SELECT ${COLUMNS} FROM notes ORDER BY pinned DESC, updated_at DESC`);
      return rows.map(fromRow);
    },
    async get(id) {
      const rows = await (await db()).select<NoteRow[]>(`SELECT ${COLUMNS} FROM notes WHERE id = $1`, [id]);
      return rows[0] ? fromRow(rows[0]) : null;
    },
    async save(note) {
      // Sticky fields are written on first insert only, so a stale copy of a note can never
      // overwrite a sticky's position, theme or visibility.
      await run(
        `INSERT INTO notes (id, title, body, pinned, created_at, updated_at, desktop_visible, sticky_x, sticky_y, sticky_width, sticky_height, sticky_theme, sticky_always_on_top, sticky_list)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
           pinned = excluded.pinned, updated_at = excluded.updated_at`,
        [
          note.id, note.title, note.content, note.pinned ? 1 : 0, note.createdAt, note.updatedAt,
          note.desktopVisible ? 1 : 0, note.stickyX, note.stickyY, note.stickyWidth, note.stickyHeight, note.stickyTheme, note.stickyOnTop ? 1 : 0, encodeListItems(note.listItems)
        ]
      );
    },
    async updateText(id, fields, updatedAt) {
      const sets: string[] = [];
      const args: unknown[] = [];
      if (fields.title !== undefined) {
        args.push(fields.title);
        sets.push(`title = $${args.length}`);
      }
      if (fields.content !== undefined) {
        args.push(fields.content);
        sets.push(`body = $${args.length}`);
      }
      if (!sets.length) return;
      args.push(updatedAt);
      sets.push(`updated_at = $${args.length}`);
      args.push(id);
      await run(`UPDATE notes SET ${sets.join(', ')} WHERE id = $${args.length}`, args);
    },
    async updateList(id, items, updatedAt) {
      await run('UPDATE notes SET sticky_list = $1, updated_at = $2 WHERE id = $3', [encodeListItems(items), updatedAt, id]);
    },
    async setPinned(id, pinned) {
      // Pinning is organisation, not an edit, so updated_at is left alone.
      await run('UPDATE notes SET pinned = $1 WHERE id = $2', [pinned ? 1 : 0, id]);
    },
    async setDesktop(id, visible) {
      await run('UPDATE notes SET desktop_visible = $1 WHERE id = $2', [visible ? 1 : 0, id]);
    },
    async setGeometry(id, g) {
      await run('UPDATE notes SET sticky_x = $1, sticky_y = $2, sticky_width = $3, sticky_height = $4 WHERE id = $5', [g.x, g.y, g.width, g.height, id]);
    },
    async setTheme(id, theme) {
      await run('UPDATE notes SET sticky_theme = $1 WHERE id = $2', [theme, id]);
    },
    async setOnTop(id, onTop) {
      await run('UPDATE notes SET sticky_always_on_top = $1 WHERE id = $2', [onTop ? 1 : 0, id]);
    },
    async remove(id) {
      await run('DELETE FROM notes WHERE id = $1', [id]);
    }
  };
}

/** Browser-only fallback so the UI can be developed with `pnpm dev` outside Tauri. */
function createLocalStorageRepository(): NotesRepository {
  const key = 'doodle.notes';
  const read = (): Note[] => {
    try {
      return (JSON.parse(localStorage.getItem(key) ?? '[]') as Note[]).map((note) => ({ ...stickyDefaults(), ...note, pinned: !!note.pinned }));
    } catch {
      return [];
    }
  };
  const write = (notes: Note[]) => localStorage.setItem(key, JSON.stringify(notes));
  const patch = (id: string, change: Partial<Note>) => write(read().map((note) => (note.id === id ? { ...note, ...change } : note)));
  return {
    async list() {
      return read().sort(compareNotes);
    },
    async get(id) {
      return read().find((note) => note.id === id) ?? null;
    },
    async save(note) {
      const existing = read().find((n) => n.id === note.id);
      write([existing ? { ...existing, title: note.title, content: note.content, pinned: note.pinned, updatedAt: note.updatedAt } : note, ...read().filter((n) => n.id !== note.id)]);
    },
    async updateText(id, fields, updatedAt) {
      patch(id, { ...fields, updatedAt });
    },
    async updateList(id, listItems, updatedAt) {
      patch(id, { listItems, updatedAt });
    },
    async setPinned(id, pinned) {
      patch(id, { pinned });
    },
    async setDesktop(id, desktopVisible) {
      patch(id, { desktopVisible });
    },
    async setGeometry(id, g) {
      patch(id, { stickyX: g.x, stickyY: g.y, stickyWidth: g.width, stickyHeight: g.height });
    },
    async setTheme(id, stickyTheme) {
      patch(id, { stickyTheme });
    },
    async setOnTop(id, stickyOnTop) {
      patch(id, { stickyOnTop });
    },
    async remove(id) {
      write(read().filter((note) => note.id !== id));
    }
  };
}

export const notesRepository: NotesRepository = isTauriRuntime()
  ? createSqliteRepository()
  : createLocalStorageRepository();
