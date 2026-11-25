import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FILTERS,
  RETENTION_OPTIONS,
  compareItems,
  describeSize,
  formatBytes,
  formatClipTime,
  retentionLabel,
  statusLabel,
  typeLabel
} from '../src/clipboard/clipboardView.ts';

test('filters cover every category the backend understands', () => {
  assert.deepEqual(
    FILTERS.map((f) => f.id),
    ['all', 'text', 'images', 'numbers', 'files', 'urls', 'code']
  );
});

test('items sort pinned first, then newest first', () => {
  const items = [
    { id: 'old', isPinned: false, copiedAt: 1 },
    { id: 'pinned-old', isPinned: true, copiedAt: 2 },
    { id: 'new', isPinned: false, copiedAt: 9 },
    { id: 'pinned-new', isPinned: true, copiedAt: 5 }
  ];
  assert.deepEqual(items.sort(compareItems).map((i) => i.id), ['pinned-new', 'pinned-old', 'new', 'old']);
});

test('type labels distinguish numbers, files and rich text', () => {
  assert.equal(typeLabel({ contentType: 'number', subtype: 'price' }), 'Number · Price');
  assert.equal(typeLabel({ contentType: 'number', subtype: 'phone' }), 'Number · Phone number');
  assert.equal(typeLabel({ contentType: 'file', subtype: null, fileMetadata: { count: 3 } }), 'File references');
  assert.equal(typeLabel({ contentType: 'file', subtype: null, fileMetadata: { count: 1 } }), 'File reference');
  assert.equal(typeLabel({ contentType: 'rich', subtype: null }), 'Rich text');
  assert.equal(typeLabel({ contentType: 'url', subtype: null }), 'URL');
  assert.equal(typeLabel({ contentType: 'text', subtype: null }), 'Text');
});

test('byte sizes are human readable', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2.0 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatBytes(3 * 1024 * 1024 * 1024), '3.0 GB');
});

test('relative timestamps', () => {
  const now = new Date(2026, 5, 15, 14, 0, 0);
  assert.equal(formatClipTime(now.getTime() - 5_000, now), 'Just now');
  assert.equal(formatClipTime(now.getTime() - 5 * 60_000, now), '5m ago');
  assert.equal(formatClipTime(now.getTime() - 2 * 3_600_000, now), '2h ago');
  assert.match(formatClipTime(new Date(2026, 5, 14, 9, 30).getTime(), now), /^Yesterday /);
  assert.match(formatClipTime(new Date(2026, 2, 1, 9, 30).getTime(), now), /Mar/);
});

test('retention and status labels', () => {
  assert.deepEqual(RETENTION_OPTIONS.map((o) => o.days), [7, 30, 90, 0]);
  assert.equal(retentionLabel(0), 'Forever');
  assert.equal(retentionLabel(30), '30 days');
  assert.equal(statusLabel('running'), 'Monitoring on');
  assert.equal(statusLabel('paused'), 'Monitoring paused');
  assert.equal(statusLabel('off'), 'Monitoring off');
});

test('image dimension description', () => {
  assert.equal(describeSize({ width: 1920, height: 1080, mimeType: 'image/png' }), '1920 × 1080 · PNG');
  assert.equal(describeSize({ width: null, height: null, mimeType: null }), '');
});
