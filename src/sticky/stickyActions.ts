import { emitNoteChanged, stickyOpen } from '../native/desktop';
import { STICKY_THEMES, notesRepository as repository, stickyDefaults, type Note } from '../notes/notesRepository';

/** Creates a new note in SQLite and opens its sticky window. Used by the "+" button on a sticky. */
export async function createStickyNote(): Promise<string> {
  const count = (await repository.list()).length;
  const now = new Date().toISOString();
  const note: Note = {
    id: crypto.randomUUID(),
    title: '',
    content: '',
    pinned: false,
    createdAt: now,
    updatedAt: now,
    ...stickyDefaults(),
    desktopVisible: true,
    stickyTheme: STICKY_THEMES[count % STICKY_THEMES.length]
  };
  await repository.save(note);
  await stickyOpen(note.id);
  await emitNoteChanged({ id: note.id, kind: 'changed' });
  return note.id;
}
