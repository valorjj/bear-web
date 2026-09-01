import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createDiagramsRepository, type DiagramsRepository } from './diagrams';

describe('diagramsRepository', () => {
  let db: BearDatabase;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
  });

  it('stores and reads back an SVG', async () => {
    const repo = createDiagramsRepository({ db });
    await repo.put('abc', '<svg/>');

    expect((await repo.get('abc'))?.svg).toBe('<svg/>');
  });

  it('derives bytes from the SVG rather than taking them', async () => {
    const repo = createDiagramsRepository({ db });
    await repo.put('abc', '<svg id="x"/>');

    expect((await repo.get('abc'))?.bytes).toBe('<svg id="x"/>'.length);
  });

  it('returns undefined for a miss', async () => {
    const repo = createDiagramsRepository({ db });
    expect(await repo.get('nope')).toBeUndefined();
  });

  it('updates lastUsed on touch', async () => {
    let clock = 1000;
    const repo: DiagramsRepository = createDiagramsRepository({ db, now: () => clock });
    await repo.put('abc', '<svg/>');

    clock = 5000;
    await repo.touch('abc');

    expect((await repo.get('abc'))?.lastUsed).toBe(5000);
  });

  it('evicts the least recently used entries past the byte budget', async () => {
    let clock = 0;
    const repo = createDiagramsRepository({ db, now: () => (clock += 1), maxBytes: 30 });

    await repo.put('oldest', 'a'.repeat(10));
    await repo.put('middle', 'b'.repeat(10));
    await repo.put('newest', 'c'.repeat(10));
    // Now at budget. One more must evict the oldest, and ONLY as many as needed.
    await repo.put('fourth', 'd'.repeat(10));

    // Asserted on WHICH entries survive, not on "eviction ran". A test that
    // asserts a call happened is the shape that let two defects through L4.
    expect(await repo.get('oldest')).toBeUndefined();
    expect(await repo.get('middle')).toBeDefined();
    expect(await repo.get('newest')).toBeDefined();
    expect(await repo.get('fourth')).toBeDefined();
  });

  it('keeps a touched entry and evicts an untouched one', async () => {
    let clock = 0;
    const repo = createDiagramsRepository({ db, now: () => (clock += 1), maxBytes: 20 });

    await repo.put('a', 'a'.repeat(10));
    await repo.put('b', 'b'.repeat(10));
    await repo.touch('a');
    await repo.put('c', 'c'.repeat(10));

    expect(await repo.get('a')).toBeDefined();
    expect(await repo.get('b')).toBeUndefined();
  });

  it('refuses an SVG larger than the whole budget rather than emptying the cache', async () => {
    const repo = createDiagramsRepository({ db, maxBytes: 20 });
    await repo.put('small', 'a'.repeat(10));
    await repo.put('huge', 'b'.repeat(100));

    // Storing it would evict everything and still not fit. The diagram renders
    // this session and simply is not cached.
    expect(await repo.get('huge')).toBeUndefined();
    expect(await repo.get('small')).toBeDefined();
  });
});
