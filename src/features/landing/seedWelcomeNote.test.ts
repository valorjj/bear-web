import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LANDING_SEEDED_KEY, LANDING_SEEN_KEY } from './gate';
import { seedWelcomeNote } from './seedWelcomeNote';
import { WELCOME_NOTE } from './welcomeNote';

const create = vi.fn(async () => ({ id: 'n1' }));

function deps(notes: readonly unknown[], locale: 'en' | 'ko' = 'en') {
  return { listActive: async () => notes, create, locale };
}

beforeEach(() => {
  localStorage.clear();
  create.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('seedWelcomeNote', () => {
  it('seeds when the gate has been seen, nothing is seeded, and there are no notes', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    await expect(seedWelcomeNote(deps([]))).resolves.toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(WELCOME_NOTE.en);
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe('1');
  });

  it('seeds the Korean note for a Korean locale', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    await seedWelcomeNote(deps([], 'ko'));
    expect(create).toHaveBeenCalledWith(WELCOME_NOTE.ko);
  });

  // This is the assertion that stops a second device receiving a duplicate:
  // sync has settled, the account's notes have arrived, so there is nothing
  // to teach and nothing to add.
  it('does NOT seed when notes already exist', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    await expect(seedWelcomeNote(deps([{ id: 'existing' }]))).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe(null);
  });

  it('does NOT seed twice on the same device', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    localStorage.setItem(LANDING_SEEDED_KEY, '1');
    await expect(seedWelcomeNote(deps([]))).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  // Ties the seed to the landing flow rather than to every boot. Without it,
  // a user who empties their trash to zero notes gets a welcome note back.
  it('does NOT seed before a landing choice has been made', async () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    await expect(seedWelcomeNote(deps([]))).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('marks seeded only after create resolves', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const failing = {
      listActive: async () => [],
      create: async () => {
        throw new Error('quota');
      },
      locale: 'en' as const,
    };
    await expect(seedWelcomeNote(failing)).resolves.toBe(false);
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe(null);
  });

  // Cheapest checks first: a device that has already seeded must not pay for
  // a full listActive() read of a large account.
  it('does not read the note list when the seeded flag is already set', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    localStorage.setItem(LANDING_SEEDED_KEY, '1');
    const listActive = vi.fn(async () => []);
    await seedWelcomeNote({ listActive, create, locale: 'en' });
    expect(listActive).not.toHaveBeenCalled();
  });
});
