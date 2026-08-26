import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../db';
import { files } from '../repositories';
import { SyncUnavailableError } from '../sync/transport';
import { loadImageBlob } from './fetchMissing';

const blob = (): Blob => new Blob([new Uint8Array([7])], { type: 'image/webp' });

describe('loadImageBlob', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.files.clear(), db.syncState.clear()]);
  });

  it('returns the local blob without touching the network', async () => {
    const downloadImage = vi.fn(async () => null);
    const record = await files.add('n1', blob(), { mime: 'image/webp', width: 1, height: 1 });

    expect(
      await loadImageBlob(record.id, { transport: { downloadImage }, signedIn: () => true }),
    ).toBeDefined();
    expect(downloadImage).not.toHaveBeenCalled();
  });

  it('makes NO request at all when signed out', async () => {
    // A visitor who never signed in must produce no cross-origin call — the
    // same rule the boot `GET /me` gate exists for.
    const downloadImage = vi.fn(async () => null);

    expect(
      await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => false }),
    ).toBeNull();
    expect(downloadImage).not.toHaveBeenCalled();
  });

  it('fetches a miss and STORES it, so the next read is local', async () => {
    const downloadImage = vi.fn(async () => blob());

    await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => true });
    await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => true });

    expect(downloadImage).toHaveBeenCalledTimes(1);
    expect(await files.get('remote')).toBeDefined();
  });

  it('does not queue a downloaded image for re-upload', async () => {
    // It came FROM the server. Marking it dirty would send it straight back.
    const downloadImage = vi.fn(async () => blob());

    await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => true });

    expect(await db.syncState.get(['image', 'remote'])).toBeUndefined();
  });

  it('returns null for a 404 without storing anything', async () => {
    const downloadImage = vi.fn(async () => null);

    expect(
      await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => true }),
    ).toBeNull();
    expect(await files.get('remote')).toBeUndefined();
  });

  it('returns null when the network fails, WITHOUT remembering the failure', async () => {
    // The bytes may arrive later. A remembered failure strands the placeholder
    // for the life of the tab — the same reason `acquireObjectUrl` does not
    // cache a miss.
    const downloadImage = vi
      .fn<() => Promise<Blob | null>>()
      .mockRejectedValueOnce(new SyncUnavailableError('offline'))
      .mockResolvedValueOnce(blob());

    expect(
      await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => true }),
    ).toBeNull();
    expect(
      await loadImageBlob('remote', { transport: { downloadImage }, signedIn: () => true }),
    ).toBeDefined();
  });
});
