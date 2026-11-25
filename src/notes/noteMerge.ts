// Pure conflict handling for notes edited in more than one window. No imports on purpose
// (unit tested with Node's runner in tests/noteMerge.test.ts).

type ListItem = { id: string; text: string; done: boolean };
type Fields = { title: string; content: string; updatedAt: string; listItems?: ListItem[] | null };

const sameList = (a: ListItem[] | null | undefined, b: ListItem[] | null | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Merges a row freshly read from SQLite (`remote`) into an editor's copy (`local`).
 *
 * `base` is what the editor last loaded or saved. A field the user has not touched since then
 * (local === base) takes the remote value; a field with unsaved local edits keeps the local value
 * and will be written by the editor's own autosave. All non-text fields come from `remote`,
 * which is the source of truth for them.
 */
export function mergeRemote<T extends Fields>(local: T, base: { title: string; content: string; listItems?: ListItem[] | null }, remote: T): T {
  return {
    ...remote,
    title: local.title === base.title ? remote.title : local.title,
    content: local.content === base.content ? remote.content : local.content,
    listItems: sameList(local.listItems, base.listItems) ? remote.listItems : local.listItems,
    updatedAt: local.updatedAt > remote.updatedAt ? local.updatedAt : remote.updatedAt
  };
}

/** True when the editor holds text edits that have not reached storage yet. */
export function hasUnsavedText(local: Fields, base: { title: string; content: string; listItems?: ListItem[] | null }) {
  return local.title !== base.title || local.content !== base.content || !sameList(local.listItems, base.listItems);
}
