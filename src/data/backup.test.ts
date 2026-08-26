import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, exportDatabase, importDatabase } from './backup';
import type { BearDatabase } from './db';
import { createNotesRepository } from './repositories/notes';
import { parseTags } from './tags';
import { LAST_PULLED_REV_KEY, SYNCED_ACCOUNT_KEY } from './sync/engine';
import { createTestDatabase } from './testing';

const noRebuild = { rebuildTagIndex: vi.fn(async () => 0) };

// `noRebuild` is declared once at module scope and shared across every test in
// this file. Call-count assertions against it are inert today (nothing here
// asserts a count against it directly), but a future test that does would
// silently inherit calls from every earlier test in the run order. Clear it
// before each test so it is always live, not a trap waiting for the next
// assertion added against it.
beforeEach(() => {
  noRebuild.rebuildTagIndex.mockClear();
});

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
    width: 40,
    height: 20,
    bytes: 6,
    createdAt: 1000,
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

  it('never puts sync bookkeeping in the bundle', async () => {
    const bundle = await exportDatabase(db);
    expect(Object.keys(bundle)).not.toContain('syncState');
  });

  it('strips the sync cursor from the exported settings', async () => {
    await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 500 });
    await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: 'user-1' });

    const bundle = await exportDatabase(db);
    const keys = bundle.settings.map((row) => row.key);

    // These live in `settings` only because that is the app's key-value
    // table; they describe THIS device's relationship with THIS account's
    // server copy. Exported at rev 500 and restored on a device sitting at
    // 12, they make that device skip revisions 13-500 forever.
    expect(keys).not.toContain(LAST_PULLED_REV_KEY);
    expect(keys).not.toContain(SYNCED_ACCOUNT_KEY);
    expect(keys).toContain('theme');
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

    const result = await importDatabase(target, JSON.parse(json), noRebuild);

    // noteTags now reports the rebuilt row count, not the bundle's; noRebuild
    // is a no-op fake, so it is 0 here regardless of the seeded bundle.
    expect(result).toEqual({ notes: 1, noteTags: 0, tags: 1, files: 1, settings: 1 });

    const note = await target.notes.get('n1');
    expect(note?.text).toBe('# Groceries\n\n- [ ] milk #food');
    expect(note?.pinned).toBe(true);
    expect(note?.trashedAt).toBeNull();
    expect(await target.settings.get('theme')).toEqual({ key: 'theme', value: 'dark' });
  });

  it('restores file blobs byte for byte', async () => {
    const json = JSON.stringify(await exportDatabase(source));
    await importDatabase(target, JSON.parse(json), noRebuild);

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

    await importDatabase(
      target,
      JSON.parse(JSON.stringify(await exportDatabase(source))),
      noRebuild,
    );

    expect(await target.notes.get('pre-existing')).toBeUndefined();
    expect(await target.notes.count()).toBe(1);
  });

  it('marks every imported note and tag dirty, since the server has never seen this database', async () => {
    await importDatabase(
      target,
      JSON.parse(JSON.stringify(await exportDatabase(source))),
      noRebuild,
    );

    expect(await target.syncState.get(['note', 'n1'])).toMatchObject({ dirty: 1, deleted: 0 });
    expect(await target.syncState.get(['tag', 'food'])).toMatchObject({ dirty: 1, deleted: 0 });
  });

  it('preserves syncedRev for a note id that survives the import, so it pushes at the right base', async () => {
    // The seeded source note is 'n1', so the target already has a synced
    // row for the SAME id the import will re-add — the ordinary case of a
    // signed-in user re-importing their own backup.
    await target.syncState.put({
      kind: 'note',
      key: 'n1',
      syncedRev: 3,
      dirty: 0,
      deleted: 0,
      markedAt: 1,
    });

    await importDatabase(
      target,
      JSON.parse(JSON.stringify(await exportDatabase(source))),
      noRebuild,
    );

    // Losing syncedRev here is how an import always loses to the server: the
    // next push would go out with baseRev 0 against a server row already at
    // rev 3, the server rejects it as stale, and the just-imported text
    // comes back as a (conflict) copy instead of replacing the server copy.
    const state = await target.syncState.get(['note', 'n1']);
    expect(state?.syncedRev).toBe(3);
    expect(state?.dirty).toBe(1);
  });

  it('drops sync bookkeeping carried by an older bundle', async () => {
    // Bundles written before the export filter existed are already in the
    // wild, so the import must not trust what it is handed.
    const bundle = await exportDatabase(source);
    bundle.settings.push({ key: LAST_PULLED_REV_KEY, value: 500 });
    bundle.settings.push({ key: SYNCED_ACCOUNT_KEY, value: 'a-stranger' });

    const result = await importDatabase(target, JSON.parse(JSON.stringify(bundle)), noRebuild);

    expect(await target.settings.get(LAST_PULLED_REV_KEY)).toBeUndefined();
    // A restored `sync:accountId` also silently suppresses the adoption
    // dialog, which gates on exactly that key.
    expect(await target.settings.get(SYNCED_ACCOUNT_KEY)).toBeUndefined();
    expect(await target.settings.get('theme')).toMatchObject({ value: 'dark' });
    expect(result.settings).toBe(1);
  });

  it('rejects a bundle with the wrong format marker', async () => {
    await expect(importDatabase(target, { format: 'something-else' }, noRebuild)).rejects.toThrow(
      /not a bear-web backup/i,
    );
  });

  it('rejects a bundle from a newer schema version', async () => {
    const bundle = await exportDatabase(source);

    await expect(
      importDatabase(target, { ...bundle, schemaVersion: BACKUP_SCHEMA_VERSION + 1 }, noRebuild),
    ).rejects.toThrow(/newer version/i);
  });

  it('rejects a non-object payload', async () => {
    await expect(importDatabase(target, 'not a bundle', noRebuild)).rejects.toThrow();
    await expect(importDatabase(target, null, noRebuild)).rejects.toThrow();
  });

  it('recomputes a note title from its text rather than trusting the bundle', async () => {
    const bundle = await exportDatabase(source);
    bundle.notes[0].title = 'Stale Wrong Title';

    await importDatabase(target, JSON.parse(JSON.stringify(bundle)), noRebuild);

    const note = await target.notes.get('n1');
    expect(note?.title).toBe('Groceries');
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

    await expect(importDatabase(target, { format: 'wrong' }, noRebuild)).rejects.toThrow();

    expect(await target.notes.get('keep')).toBeDefined();
  });
});

describe('import rebuilds the derived tag index', () => {
  let target: BearDatabase;

  beforeEach(async () => {
    target = createTestDatabase();
    await target.open();
  });

  it('ignores the bundle noteTags rows and reports the rebuilt count', async () => {
    const bundle = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 0,
      notes: [
        {
          id: 'n1',
          title: '',
          text: '#work',
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
        },
      ],
      // Deliberately wrong: a pre-M5 backup carries an empty index, and a
      // hand-edited one can carry a lie.
      noteTags: [{ noteId: 'n1', tag: 'nonsense' }],
      tags: [],
      files: [],
      settings: [],
    };

    const rebuildTagIndex = vi.fn(async () => {
      await target.noteTags.bulkPut([{ noteId: 'n1', tag: 'work' }]);
      return 1;
    });

    const result = await importDatabase(target, bundle, { rebuildTagIndex });

    expect(rebuildTagIndex).toHaveBeenCalledTimes(1);
    expect(result.noteTags).toBe(1);
    expect(await target.noteTags.toArray()).toEqual([{ noteId: 'n1', tag: 'work' }]);
  });

  it('still rejects a bundle missing its noteTags table, before clearing anything', async () => {
    await target.notes.add({
      id: 'existing',
      title: 'keep me',
      text: 'keep me',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    const bundle = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 0,
      notes: [],
      tags: [],
      files: [],
      settings: [],
    };

    const rebuildTagIndex = vi.fn(async () => 0);

    await expect(importDatabase(target, bundle, { rebuildTagIndex })).rejects.toThrow(/noteTags/);
    expect(rebuildTagIndex).not.toHaveBeenCalled();
    expect(await target.notes.count()).toBe(1);
  });

  it('rebuilds from the real repository, proving the notes are inserted before the rebuild runs', async () => {
    const targetNotes = createNotesRepository({ db: target, parseTags });

    const bundle = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: 0,
      notes: [
        {
          id: 'n1',
          title: '',
          text: '#work',
          createdAt: 1,
          updatedAt: 1,
          pinned: false,
          trashedAt: null,
          archivedAt: null,
        },
      ],
      // Deliberately wrong, same as above: proves the bundle's copy is never
      // trusted, this time against the real rebuild rather than a fake.
      noteTags: [{ noteId: 'n1', tag: 'nonsense' }],
      tags: [],
      files: [],
      settings: [],
    };

    const result = await importDatabase(target, bundle, {
      rebuildTagIndex: () => targetNotes.rebuildTagIndex(),
    });

    expect(result.noteTags).toBe(1);
    expect(await target.noteTags.toArray()).toEqual([{ noteId: 'n1', tag: 'work' }]);
  });
});
