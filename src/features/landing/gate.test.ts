import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasLandingBeenSeen,
  hasSeededWelcome,
  LANDING_SEEDED_KEY,
  LANDING_SEEN_KEY,
  markLandingSeen,
  markWelcomeSeeded,
} from './gate';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('gate', () => {
  it('reports unseen when the key is absent', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    expect(hasLandingBeenSeen()).toBe(false);
  });

  it('reports seen once marked', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    markLandingSeen();
    expect(localStorage.getItem(LANDING_SEEN_KEY)).toBe('1');
    expect(hasLandingBeenSeen()).toBe(true);
  });

  it('treats any value other than "1" as unseen', () => {
    localStorage.setItem(LANDING_SEEN_KEY, 'yes');
    expect(hasLandingBeenSeen()).toBe(false);
  });

  // localStorage throws outright in some private-window and blocked-site-data
  // contexts. An unreadable gate must behave exactly like an absent one, or a
  // visitor in a private window sees a blank branch instead of the landing.
  it('treats a throwing getItem as unseen', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasLandingBeenSeen()).toBe(false);
    expect(hasSeededWelcome()).toBe(false);
  });

  it('does not throw when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markLandingSeen()).not.toThrow();
    expect(() => markWelcomeSeeded()).not.toThrow();
  });

  it('tracks the seeded flag independently of the seen flag', () => {
    localStorage.clear();
    markLandingSeen();
    expect(hasSeededWelcome()).toBe(false);
    markWelcomeSeeded();
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe('1');
    expect(hasSeededWelcome()).toBe(true);
  });
});
