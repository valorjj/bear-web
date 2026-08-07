import { describe, expect, it, vi } from 'vitest';

import { resolveDatabase } from './open';

describe('resolveDatabase', () => {
  it('reports ready when the database opens', async () => {
    const open = vi.fn().mockResolvedValue(undefined);
    const installFallback = vi.fn().mockResolvedValue(undefined);

    const status = await resolveDatabase({ open, installFallback });

    expect(status).toBe('ready');
    expect(open).toHaveBeenCalledTimes(1);
    expect(installFallback).not.toHaveBeenCalled();
  });

  it('installs the in-memory fallback and retries when the first open fails', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(undefined);
    const installFallback = vi.fn().mockResolvedValue(undefined);

    const status = await resolveDatabase({ open, installFallback });

    expect(status).toBe('memory');
    expect(installFallback).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('still reports memory when the retry also fails', async () => {
    const open = vi.fn().mockRejectedValue(new Error('denied'));
    const installFallback = vi.fn().mockResolvedValue(undefined);

    const status = await resolveDatabase({ open, installFallback });

    // Degraded, not crashed. The banner tells the user; the app still runs.
    expect(status).toBe('memory');
  });

  it('reports memory when installing the fallback itself fails', async () => {
    const open = vi.fn().mockRejectedValue(new Error('denied'));
    const installFallback = vi.fn().mockRejectedValue(new Error('no module'));

    await expect(resolveDatabase({ open, installFallback })).resolves.toBe('memory');
  });

  it('never rejects, whatever happens', async () => {
    const open = vi.fn().mockRejectedValue('not even an Error');
    const installFallback = vi.fn().mockRejectedValue('also not an Error');

    await expect(resolveDatabase({ open, installFallback })).resolves.toBe('memory');
  });
});
