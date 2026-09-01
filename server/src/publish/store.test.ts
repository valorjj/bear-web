import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pagePath, readPage, removePage, removeUserPages, writePage } from './store.ts';

let root: string;

async function makeRoot(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'publish-store-'));
  return root;
}

describe('publish store', () => {
  it('writes and reads a page back', async () => {
    const root = await makeRoot();
    await writePage(root, 'user-1', 'abc', '<!doctype html><p>hi</p>');

    expect(await readPage(root, 'user-1', 'abc')).toBe('<!doctype html><p>hi</p>');
  });

  it('returns null for a page that is not on disk', async () => {
    const root = await makeRoot();
    expect(await readPage(root, 'user-1', 'missing')).toBeNull();
  });

  it('keeps one account out of another account directory', async () => {
    const root = await makeRoot();
    await writePage(root, 'user-1', 'abc', 'mine');

    // Same id, different owner: a different file, not a collision.
    expect(await readPage(root, 'user-2', 'abc')).toBeNull();
  });

  it.each([
    ['..', 'abc'],
    ['user-1', '..'],
    ['user-1', 'a/b'],
    ['user-1', 'a.b'],
    ['', 'abc'],
  ])('refuses an unsafe path (%s, %s)', async (userId, id) => {
    const root = await makeRoot();
    // Refusal, not sanitisation: a sanitised path is a guess about what the
    // caller meant, and every caller of this already has a 400 to return.
    expect(() => pagePath(root, userId, id)).toThrow();
  });

  it('overwrites in place on republish', async () => {
    const root = await makeRoot();
    await writePage(root, 'user-1', 'abc', 'first');
    await writePage(root, 'user-1', 'abc', 'second');

    expect(await readPage(root, 'user-1', 'abc')).toBe('second');
  });

  it('removes one page without touching its sibling', async () => {
    const root = await makeRoot();
    await writePage(root, 'user-1', 'abc', 'one');
    await writePage(root, 'user-1', 'def', 'two');
    await removePage(root, 'user-1', 'abc');

    expect(await readPage(root, 'user-1', 'abc')).toBeNull();
    expect(await readPage(root, 'user-1', 'def')).toBe('two');
  });

  it('removing a page that is already gone is not an error', async () => {
    const root = await makeRoot();
    await expect(removePage(root, 'user-1', 'gone')).resolves.toBeUndefined();
  });

  it('removes every page an account owns', async () => {
    const root = await makeRoot();
    await writePage(root, 'user-1', 'abc', 'one');
    await writePage(root, 'user-1', 'def', 'two');
    await removeUserPages(root, 'user-1');

    expect(await readPage(root, 'user-1', 'abc')).toBeNull();
    expect(await readPage(root, 'user-1', 'def')).toBeNull();
  });

  it('removing pages for an account that never published is a no-op', async () => {
    const root = await makeRoot();
    await expect(removeUserPages(root, 'never')).resolves.toBeUndefined();
  });

  it('stores UTF-8 faithfully', async () => {
    const root = await makeRoot();
    // The app's notes are frequently Korean; a latin-1 write would mojibake
    // every published page and nothing else in this repo would notice.
    await writePage(root, 'user-1', 'abc', '<p>자산화 디자인</p>');

    expect(await readPage(root, 'user-1', 'abc')).toBe('<p>자산화 디자인</p>');
  });
});
