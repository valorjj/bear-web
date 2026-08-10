import { describe, expect, it, vi } from 'vitest';

import { requestPersistentStorage } from './persist';

function deps(overrides: Partial<Parameters<typeof requestPersistentStorage>[0]> = {}) {
  return {
    supported: true,
    persisted: vi.fn(async () => false),
    persist: vi.fn(async () => true),
    hasContent: vi.fn(async () => true),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('requestPersistentStorage', () => {
  it('grants when the user has notes and the browser agrees', async () => {
    const d = deps();

    await expect(requestPersistentStorage(d)).resolves.toBe('granted');
    expect(d.persist).toHaveBeenCalledTimes(1);
  });

  it('reports denial without treating it as an error', async () => {
    const d = deps({ persist: vi.fn(async () => false) });

    await expect(requestPersistentStorage(d)).resolves.toBe('denied');
    expect(d.onError).not.toHaveBeenCalled();
  });

  it('never asks twice once storage is already persistent', async () => {
    const d = deps({ persisted: vi.fn(async () => true) });

    await expect(requestPersistentStorage(d)).resolves.toBe('already');
    expect(d.persist).not.toHaveBeenCalled();
    // Not even worth reading: the answer cannot change the outcome.
    expect(d.hasContent).not.toHaveBeenCalled();
  });

  it('does not prompt a visitor who has written nothing', async () => {
    const d = deps({ hasContent: vi.fn(async () => false) });

    await expect(requestPersistentStorage(d)).resolves.toBe('skipped');
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('checks for existing persistence BEFORE checking for content', async () => {
    // Ordering is the whole design: `persisted()` never prompts, `persist()`
    // does. Reading content first would be harmless but pointless work; calling
    // `persist()` before either check is the actual defect this pins.
    const calls: string[] = [];
    const d = deps({
      persisted: vi.fn(async () => {
        calls.push('persisted');
        return false;
      }),
      hasContent: vi.fn(async () => {
        calls.push('hasContent');
        return true;
      }),
      persist: vi.fn(async () => {
        calls.push('persist');
        return true;
      }),
    });

    await requestPersistentStorage(d);
    expect(calls).toEqual(['persisted', 'hasContent', 'persist']);
  });

  it('reports unsupported without calling anything', async () => {
    const d = deps({ supported: false });

    await expect(requestPersistentStorage(d)).resolves.toBe('unsupported');
    expect(d.persisted).not.toHaveBeenCalled();
    expect(d.persist).not.toHaveBeenCalled();
    expect(d.onError).not.toHaveBeenCalled();
  });

  it('never rejects when the browser throws', async () => {
    const boom = new Error('SecurityError');
    const d = deps({
      persist: vi.fn(async () => {
        throw boom;
      }),
    });

    await expect(requestPersistentStorage(d)).resolves.toBe('denied');
    expect(d.onError).toHaveBeenCalledWith(boom);
  });

  it('never rejects when reading the current state throws', async () => {
    const d = deps({
      persisted: vi.fn(async () => {
        throw new Error('nope');
      }),
    });

    await expect(requestPersistentStorage(d)).resolves.toBe('denied');
    expect(d.persist).not.toHaveBeenCalled();
  });

  it('never rejects when onError itself throws', async () => {
    const d = deps({
      persist: vi.fn(async () => {
        throw new Error('SecurityError');
      }),
      onError: vi.fn(() => {
        throw new Error('logger exploded');
      }),
    });

    await expect(requestPersistentStorage(d)).resolves.toBe('denied');
  });
});
