import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireObjectUrl, releaseObjectUrl } from './objectUrls';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('object URL cache', () => {
  it('creates ONE url for a file however many consumers ask', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:one');
    const load = vi.fn(async () => new Blob(['x']));

    const first = await acquireObjectUrl('a', load);
    const second = await acquireObjectUrl('a', load);

    expect(first).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    // Not just the URL: the BLOB is read once too. Two views of the same image
    // must not each hit IndexedDB.
    expect(load).toHaveBeenCalledTimes(1);

    releaseObjectUrl('a');
    releaseObjectUrl('a');
  });

  it('reads the blob once when two consumers race in the same tick', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:race');
    const load = vi.fn(async () => new Blob(['x']));

    const [first, second] = await Promise.all([
      acquireObjectUrl('r', load),
      acquireObjectUrl('r', load),
    ]);

    expect(first).toBe('blob:race');
    expect(second).toBe('blob:race');
    expect(load).toHaveBeenCalledTimes(1);

    releaseObjectUrl('r');
    releaseObjectUrl('r');
  });

  it('revokes only when the LAST consumer releases', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:two');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const load = async () => new Blob(['x']);

    await acquireObjectUrl('b', load);
    await acquireObjectUrl('b', load);

    releaseObjectUrl('b');
    expect(revoke).not.toHaveBeenCalled();

    releaseObjectUrl('b');
    expect(revoke).toHaveBeenCalledWith('blob:two');
  });

  it('is null for a file that is not stored, and does not cache the miss', async () => {
    const load = vi.fn(async () => null);

    expect(await acquireObjectUrl('missing', load)).toBeNull();
    // The bytes may arrive later — that is what K2's sync does. A cached miss
    // would leave the placeholder on screen for the life of the tab.
    expect(await acquireObjectUrl('missing', load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores a release for a file it never held', () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    releaseObjectUrl('never');

    expect(revoke).not.toHaveBeenCalled();
  });
});
