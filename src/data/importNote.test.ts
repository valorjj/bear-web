import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from './db';
import { importNote, MAX_IMPORTED_IMAGE_BYTES } from './importNote';

function blob(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)], { type: 'image/webp' });
}

const fakeBitmap = async (): Promise<{ width: number; height: number }> => ({
  width: 800,
  height: 600,
});

describe('importNote', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.notes.clear(), db.files.clear(), db.syncState.clear()]);
  });

  it('creates a note holding the imported text', async () => {
    const note = await importNote({ title: 'Shared', text: 'Shared\n\nbody\n', images: [] });

    expect(note.text).toBe('Shared\n\nbody\n');
    expect(await db.notes.get(note.id)).toBeDefined();
  });

  it('gives the note a NEW id rather than the sender’s', async () => {
    const a = await importNote({ title: 'A', text: 'A\n', images: [] });
    const b = await importNote({ title: 'A', text: 'A\n', images: [] });

    expect(a.id).not.toBe(b.id);
  });

  it('stores each image under a new id and rewrites the text to match', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: 'Shared\n\n![](files/sender-id.webp)\n',
        images: [{ path: 'files/sender-id.webp', blob: blob(4) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    // The sender's id must be gone: it is their id, and it could collide with
    // one this device already holds for entirely different bytes.
    expect(note.text).not.toContain('sender-id');

    const stored = await db.files.where('noteId').equals(note.id).toArray();
    expect(stored).toHaveLength(1);
    expect(note.text).toContain(`files/${stored[0]!.id}.webp`);
    expect(stored[0]!.width).toBe(800);
    expect(stored[0]!.height).toBe(600);
    // Duck-typed: `vitest.setup.ts` swaps the global Blob.
    expect(stored[0]!.blob.size).toBe(4);
  });

  it('rewrites every occurrence of a repeated image', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: '![](files/x.webp)\n\n![](files/x.webp)\n',
        images: [{ path: 'files/x.webp', blob: blob(4) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    expect(note.text).not.toContain('files/x.webp');
    const stored = await db.files.where('noteId').equals(note.id).toArray();
    expect(note.text.split(`files/${stored[0]!.id}.webp`)).toHaveLength(3);
  });

  it('leaves the text alone for an image it was not given', async () => {
    // The sender's device did not hold those bytes either. The reference
    // stays as written rather than being silently deleted from the note.
    const note = await importNote({
      title: 'Shared',
      text: '![](files/absent.webp)\n',
      images: [],
    });

    expect(note.text).toContain('files/absent.webp');
  });

  it('marks the note and its images dirty so a signed-in device uploads them', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: '![](files/x.webp)\n',
        images: [{ path: 'files/x.webp', blob: blob(4) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    // `SyncState` is keyed `[kind+key]` — the field is `key`, not `id`.
    const dirty = await db.syncState.toArray();
    expect(dirty.some((row) => row.kind === 'note' && row.key === note.id)).toBe(true);
    expect(dirty.filter((row) => row.kind === 'image')).toHaveLength(1);
  });

  it('skips an image over MAX_IMPORTED_IMAGE_BYTES and leaves its reference untouched', async () => {
    const note = await importNote(
      {
        title: 'Shared',
        text: '![](files/huge.webp)\n',
        images: [{ path: 'files/huge.webp', blob: blob(MAX_IMPORTED_IMAGE_BYTES + 1) }],
      },
      { createImageBitmap: fakeBitmap },
    );

    expect(note.text).toContain('files/huge.webp');
    const stored = await db.files.where('noteId').equals(note.id).toArray();
    expect(stored).toHaveLength(0);
  });

  it('skips an image whose decode throws, keeps the others, and leaves no orphaned file row', async () => {
    const flaky = async (b: Blob): Promise<{ width: number; height: number }> => {
      if (b.size === 999) throw new Error('cannot decode this blob');
      return { width: 800, height: 600 };
    };

    const note = await importNote(
      {
        title: 'Shared',
        text: '![](files/good.webp)\n\n![](files/bad.webp)\n',
        images: [
          { path: 'files/good.webp', blob: blob(4) },
          { path: 'files/bad.webp', blob: blob(999) },
        ],
      },
      { createImageBitmap: flaky },
    );

    // The failed image's reference is untouched — same handling as an
    // image never carried at all.
    expect(note.text).toContain('files/bad.webp');
    // The good image still made it in, rewritten to its new id.
    expect(note.text).not.toContain('files/good.webp');

    const stored = await db.files.where('noteId').equals(note.id).toArray();
    // Exactly one file row: the good image. No orphan left behind for the
    // one that threw partway through.
    expect(stored).toHaveLength(1);
    expect(stored[0]!.blob.size).toBe(4);
    expect(note.text).toContain(`files/${stored[0]!.id}.webp`);
  });
});
