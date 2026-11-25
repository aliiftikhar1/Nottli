import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasUnsavedText, mergeRemote } from '../src/notes/noteMerge.ts';

const note = (title: string, content: string, updatedAt = '2026-01-01T00:00:00.000Z') => ({ title, content, updatedAt, theme: 'yellow' });

test('untouched fields take the remote value', () => {
  const base = { title: 'A', content: 'body' };
  const merged = mergeRemote(note('A', 'body'), base, note('Renamed', 'edited elsewhere', '2026-01-02T00:00:00.000Z'));
  assert.equal(merged.title, 'Renamed');
  assert.equal(merged.content, 'edited elsewhere');
  assert.equal(merged.updatedAt, '2026-01-02T00:00:00.000Z');
});

test('a local body edit survives a remote rename (rename never clears the body)', () => {
  const base = { title: 'A', content: 'body' };
  const merged = mergeRemote(note('A', 'body plus my typing', '2026-01-03T00:00:00.000Z'), base, note('Renamed', 'body'));
  assert.equal(merged.title, 'Renamed');
  assert.equal(merged.content, 'body plus my typing');
});

test('a local title edit survives a remote body edit', () => {
  const base = { title: 'A', content: 'body' };
  const merged = mergeRemote(note('My title', 'body'), base, note('A', 'remote body'));
  assert.equal(merged.title, 'My title');
  assert.equal(merged.content, 'remote body');
});

test('non-text fields always come from the remote row', () => {
  const remote = { ...note('A', 'b'), theme: 'teal' };
  const merged = mergeRemote({ ...note('A', 'b'), theme: 'yellow' }, { title: 'A', content: 'b' }, remote);
  assert.equal(merged.theme, 'teal');
});

test('unsaved text detection', () => {
  assert.equal(hasUnsavedText({ title: 'A', content: 'x' }, { title: 'A', content: 'x' }), false);
  assert.equal(hasUnsavedText({ title: 'A', content: 'xy' }, { title: 'A', content: 'x' }), true);
  assert.equal(hasUnsavedText({ title: 'B', content: 'x' }, { title: 'A', content: 'x' }), true);
});
