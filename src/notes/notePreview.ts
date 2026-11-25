import { deriveTitle, hasCustomTitle } from './useNotesStore';
import type { Note } from './notesRepository';

const PREVIEW_LENGTH = 110;

/** Title shown in lists; older notes may have an empty stored title. */
export function displayTitle(note: Note) {
  return note.title || deriveTitle(note.content) || 'Untitled';
}

/** Short preview that avoids repeating the first line when it is already the title. */
export function notePreview(note: Note) {
  const trimmed = note.content.trim();
  let rest = trimmed;
  if (!hasCustomTitle(note)) {
    const firstLine = trimmed.split('\n').find((line) => line.trim()) ?? '';
    rest = trimmed.slice(trimmed.indexOf(firstLine) + firstLine.length);
  }
  return rest.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
}
