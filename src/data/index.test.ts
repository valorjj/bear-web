import { describe, expect, it } from 'vitest';

import * as data from './index';
import { createNotesRepository } from './repositories/notes';
import { createTestDatabase } from './testing';

describe('data public surface', () => {
  it('exposes the repositories as ready-to-use singletons', () => {
    expect(typeof data.notes.create).toBe('function');
    expect(typeof data.tags.getMeta).toBe('function');
    expect(typeof data.files.add).toBe('function');
    expect(typeof data.settings.get).toBe('function');
  });

  it('exposes the backup functions and their constants', () => {
    expect(typeof data.exportDatabase).toBe('function');
    expect(typeof data.importDatabase).toBe('function');
    expect(data.BACKUP_FORMAT).toBe('bear-web-backup');
    expect(data.BACKUP_SCHEMA_VERSION).toBe(1);
  });

  it('exposes the derivation helpers', () => {
    expect(data.deriveTitle('# Title\nbody')).toBe('Title');
    expect(typeof data.newId()).toBe('string');
  });

  it('names the production database', () => {
    expect(data.DATABASE_NAME).toBe('bear-web');
  });
});

describe('tag parser seam', () => {
  it('accepts a replacement parser without touching repository code', async () => {
    const db = createTestDatabase();
    await db.open();

    const notes = createNotesRepository({
      db,
      parseTags: (text) => (text.includes('urgent') ? ['urgent'] : []),
    });

    const note = await notes.create('this is urgent');
    expect(await notes.tagsOf(note.id)).toEqual(['urgent']);

    db.close();
  });
});
