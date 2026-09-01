import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import {
  countPages,
  deletePage,
  getPageForNote,
  getPageOwner,
  listPages,
  upsertPage,
  usedPublishBytes,
} from './publish.ts';
import { findOrCreateUserByIdentity } from './users.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('publish repository', () => {
  let pool: Pool;
  let USER: string;
  let OTHER: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    USER = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'alice',
      email: 'alice@example.com',
    });
    OTHER = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'bob',
      email: 'bob@example.com',
    });
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('stores a page and reads it back by note', async () => {
    await upsertPage(pool.query, USER, {
      id: 'abc',
      noteId: 'note-1',
      title: 'T',
      bytes: 10,
      publishedAt: 1000,
    });

    const page = await getPageForNote(pool.query, USER, 'note-1');
    expect(page).toEqual({ id: 'abc', noteId: 'note-1', title: 'T', bytes: 10, publishedAt: 1000 });
  });

  it('keeps the id when the same note is republished', async () => {
    await upsertPage(pool.query, USER, {
      id: 'abc',
      noteId: 'n',
      title: 'T',
      bytes: 10,
      publishedAt: 1,
    });
    await upsertPage(pool.query, USER, {
      id: 'abc',
      noteId: 'n',
      title: 'T2',
      bytes: 20,
      publishedAt: 2,
    });

    // The URL the author already shared must keep working.
    const page = await getPageForNote(pool.query, USER, 'n');
    expect(page).toMatchObject({ id: 'abc', title: 'T2', bytes: 20, publishedAt: 2 });
    expect(await countPages(pool.query, USER)).toBe(1);
  });

  it('does not return another account page', async () => {
    await upsertPage(pool.query, USER, {
      id: 'abc',
      noteId: 'n',
      title: 'T',
      bytes: 10,
      publishedAt: 1,
    });

    expect(await getPageForNote(pool.query, OTHER, 'n')).toBeNull();
    expect(await listPages(pool.query, OTHER)).toEqual([]);
  });

  it('resolves an owner from the capability id alone', async () => {
    await upsertPage(pool.query, USER, {
      id: 'abc',
      noteId: 'n',
      title: 'T',
      bytes: 10,
      publishedAt: 1,
    });

    // The public read has no session; the id IS the authorization.
    expect(await getPageOwner(pool.query, 'abc')).toEqual({ userId: USER });
    expect(await getPageOwner(pool.query, 'nope')).toBeNull();
  });

  it('sums bytes per account', async () => {
    await upsertPage(pool.query, USER, {
      id: 'a',
      noteId: 'n1',
      title: 'T',
      bytes: 10,
      publishedAt: 1,
    });
    await upsertPage(pool.query, USER, {
      id: 'b',
      noteId: 'n2',
      title: 'T',
      bytes: 25,
      publishedAt: 1,
    });
    await upsertPage(pool.query, OTHER, {
      id: 'c',
      noteId: 'n3',
      title: 'T',
      bytes: 99,
      publishedAt: 1,
    });

    expect(await usedPublishBytes(pool.query, USER)).toBe(35);
  });

  it('reports zero used bytes for an account that never published', async () => {
    expect(await usedPublishBytes(pool.query, OTHER)).toBe(0);
  });

  it('deletes only the named page, and only for its owner', async () => {
    await upsertPage(pool.query, USER, {
      id: 'a',
      noteId: 'n1',
      title: 'T',
      bytes: 10,
      publishedAt: 1,
    });
    await upsertPage(pool.query, USER, {
      id: 'b',
      noteId: 'n2',
      title: 'T',
      bytes: 10,
      publishedAt: 1,
    });

    await deletePage(pool.query, OTHER, 'a');
    expect(await getPageOwner(pool.query, 'a')).not.toBeNull();

    await deletePage(pool.query, USER, 'a');
    expect(await getPageOwner(pool.query, 'a')).toBeNull();
    expect(await getPageOwner(pool.query, 'b')).not.toBeNull();
  });
});
