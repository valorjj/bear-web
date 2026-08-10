import { describe, expect, it, vi } from 'vitest';

import { runMigrations, TAG_INDEX_VERSION } from './migrations';

function deps(overrides: Partial<Parameters<typeof runMigrations>[0]> = {}) {
  return {
    getVersion: vi.fn(async () => 0),
    setVersion: vi.fn(async () => {}),
    rebuildTagIndex: vi.fn(async () => 7),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('runMigrations', () => {
  it('rebuilds and records the version when the marker is behind', async () => {
    const d = deps();

    await expect(runMigrations(d)).resolves.toBe(true);
    expect(d.rebuildTagIndex).toHaveBeenCalledTimes(1);
    expect(d.setVersion).toHaveBeenCalledWith(TAG_INDEX_VERSION);
  });

  it('does nothing when the marker is current', async () => {
    const d = deps({ getVersion: vi.fn(async () => TAG_INDEX_VERSION) });

    await expect(runMigrations(d)).resolves.toBe(false);
    expect(d.rebuildTagIndex).not.toHaveBeenCalled();
    expect(d.setVersion).not.toHaveBeenCalled();
  });

  it('does nothing when the marker is ahead', async () => {
    const d = deps({ getVersion: vi.fn(async () => TAG_INDEX_VERSION + 1) });

    await expect(runMigrations(d)).resolves.toBe(false);
    expect(d.rebuildTagIndex).not.toHaveBeenCalled();
    expect(d.setVersion).not.toHaveBeenCalled();
  });

  it('re-runs once the version constant moves ahead of the marker', async () => {
    const d = deps({ getVersion: vi.fn(async () => TAG_INDEX_VERSION - 1) });

    await expect(runMigrations(d)).resolves.toBe(true);
    expect(d.rebuildTagIndex).toHaveBeenCalledTimes(1);
  });

  it('never rejects when the rebuild throws, and does not record the version', async () => {
    const boom = new Error('parser exploded');
    const d = deps({
      rebuildTagIndex: vi.fn(async () => {
        throw boom;
      }),
    });

    await expect(runMigrations(d)).resolves.toBe(false);
    expect(d.setVersion).not.toHaveBeenCalled();
    expect(d.onError).toHaveBeenCalledWith(boom);
  });

  it('never rejects when reading the marker throws', async () => {
    const d = deps({
      getVersion: vi.fn(async () => {
        throw new Error('settings unavailable');
      }),
    });

    await expect(runMigrations(d)).resolves.toBe(false);
    expect(d.rebuildTagIndex).not.toHaveBeenCalled();
  });

  it('never rejects when onError itself throws', async () => {
    const d = deps({
      rebuildTagIndex: vi.fn(async () => {
        throw new Error('parser exploded');
      }),
      onError: vi.fn(() => {
        throw new Error('logger exploded');
      }),
    });

    await expect(runMigrations(d)).resolves.toBe(false);
    expect(d.setVersion).not.toHaveBeenCalled();
  });
});
