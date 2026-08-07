import { beforeEach, describe, expect, it } from 'vitest';

import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, exportDatabase, importDatabase } from './backup';
import type { BearDatabase } from './db';
import { createTestDatabase } from './testing';

async function seed(db: BearDatabase): Promise<void> {
  await db.notes.add({
    id: 'n1',
    title: 'Groceries',
    text: '# Groceries\n\n- [ ] milk #food',
    createdAt: 1000,
    updatedAt: 2000,
    pinned: true,
    trashedAt: null,
    archivedAt: null,
  });
  await db.noteTags.add({ noteId: 'n1', tag: 'food' });
  await db.tags.add({ tag: 'food', collapsed: true, iconKey: 'apple', sortOrder: 3 });
  await db.files.add({
    id: 'f1',
    noteId: 'n1',
    blob: new Blob([new Uint8Array([0, 1, 2, 253, 254, 255])], { type: 'image/png' }),
    mime: 'image/png',
  });
  await db.settings.add({ key: 'theme', value: 'dark' });
}

describe('exportDatabase', () => {
  let db: BearDatabase;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    await seed(db);
  });

  it('stamps the format and schema version', async () => {
    const bundle = await exportDatabase(db);

    expect(bundle.format).toBe(BACKUP_FORMAT);
    expect(bundle.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(typeof bundle.exportedAt).toBe('number');
  });

  it('includes every table', async () => {
    const bundle = await exportDatabase(db);

    expect(bundle.notes).toHaveLength(1);
    expect(bundle.noteTags).toHaveLength(1);
    expect(bundle.tags).toHaveLength(1);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.settings).toHaveLength(1);
  });

  it('survives JSON serialization without losing the file blob', async () => {
    const bundle = await exportDatabase(db);
    const reparsed = JSON.parse(JSON.stringify(bundle)) as typeof bundle;

    // JSON.stringify turns a raw Blob into {} silently. Base64 is why this passes.
    expect(reparsed.files[0].data).toBe(bundle.files[0].data);
    expect(reparsed.files[0].data.length).toBeGreaterThan(0);
  });
});

describe('importDatabase', () => {
  let source: BearDatabase;
  let target: BearDatabase;

  beforeEach(async () => {
    source = createTestDatabase();
    target = createTestDatabase();
    await source.open();
    await target.open();
    await seed(source);
  });

  it('restores every record through a full JSON round trip', async () => {
    const json = JSON.stringify(await exportDatabase(source));

    const result = await importDatabase(target, JSON.parse(json));

    expect(result).toEqual({ notes: 1, noteTags: 1, tags: 1, files: 1, settings: 1 });

    const note = await target.notes.get('n1');
    expect(note?.text).toBe('# Groceries\n\n- [ ] milk #food');
    expect(note?.pinned).toBe(true);
    expect(note?.trashedAt).toBeNull();
    expect(await target.settings.get('theme')).toEqual({ key: 'theme', value: 'dark' });
  });

  it('restores file blobs byte for byte', async () => {
    const json = JSON.stringify(await exportDatabase(source));
    await importDatabase(target, JSON.parse(json));

    const file = await target.files.get('f1');
    const bytes = new Uint8Array(await file!.blob.arrayBuffer());

    expect([...bytes]).toEqual([0, 1, 2, 253, 254, 255]);
    expect(file?.mime).toBe('image/png');
  });

  it('replaces existing data rather than merging', async () => {
    await target.notes.add({
      id: 'pre-existing',
      title: 'Old',
      text: 'Old',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    await importDatabase(target, JSON.parse(JSON.stringify(await exportDatabase(source))));

    expect(await target.notes.get('pre-existing')).toBeUndefined();
    expect(await target.notes.count()).toBe(1);
  });

  it('rejects a bundle with the wrong format marker', async () => {
    await expect(importDatabase(target, { format: 'something-else' })).rejects.toThrow(
      /not a bear-web backup/i,
    );
  });

  it('rejects a bundle from a newer schema version', async () => {
    const bundle = await exportDatabase(source);

    await expect(
      importDatabase(target, { ...bundle, schemaVersion: BACKUP_SCHEMA_VERSION + 1 }),
    ).rejects.toThrow(/newer version/i);
  });

  it('rejects a non-object payload', async () => {
    await expect(importDatabase(target, 'not a bundle')).rejects.toThrow();
    await expect(importDatabase(target, null)).rejects.toThrow();
  });

  it('leaves the target untouched when validation fails', async () => {
    await target.notes.add({
      id: 'keep',
      title: 'Keep',
      text: 'Keep',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    await expect(importDatabase(target, { format: 'wrong' })).rejects.toThrow();

    expect(await target.notes.get('keep')).toBeDefined();
  });
});
