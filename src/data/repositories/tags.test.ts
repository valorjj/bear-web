import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createTagsRepository, type TagsRepository } from './tags';

describe('tagsRepository', () => {
  let db: BearDatabase;
  let tags: TagsRepository;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    tags = createTagsRepository(db);
  });

  it('returns undefined for a tag with no stored metadata', async () => {
    expect(await tags.getMeta('work')).toBeUndefined();
  });

  it('creates a metadata row on first write with sensible defaults', async () => {
    await tags.setCollapsed('work', true);

    const meta = await tags.getMeta('work');
    expect(meta).toEqual({ tag: 'work', collapsed: true, iconKey: null, sortOrder: 0 });
  });

  it('updates one field without clobbering the others', async () => {
    await tags.setCollapsed('work', true);
    await tags.setIcon('work', 'briefcase');
    await tags.setSortOrder('work', 5);

    expect(await tags.getMeta('work')).toEqual({
      tag: 'work',
      collapsed: true,
      iconKey: 'briefcase',
      sortOrder: 5,
    });
  });

  it('clears an icon by setting it to null', async () => {
    await tags.setIcon('work', 'briefcase');
    await tags.setIcon('work', null);

    expect((await tags.getMeta('work'))?.iconKey).toBeNull();
  });

  it('lists all metadata rows ordered by sortOrder', async () => {
    await tags.setSortOrder('b', 2);
    await tags.setSortOrder('a', 1);

    expect((await tags.allMeta()).map((m) => m.tag)).toEqual(['a', 'b']);
  });

  it('removes a metadata row', async () => {
    await tags.setCollapsed('work', true);
    await tags.removeMeta('work');

    expect(await tags.getMeta('work')).toBeUndefined();
  });
});
