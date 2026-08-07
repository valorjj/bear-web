import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createSettingsRepository, type SettingsRepository } from './settings';

describe('settingsRepository', () => {
  let db: BearDatabase;
  let settings: SettingsRepository;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    settings = createSettingsRepository(db);
  });

  it('returns the fallback for an absent key', async () => {
    expect(await settings.get('theme', 'light')).toBe('light');
  });

  it('stores and retrieves a value', async () => {
    await settings.set('theme', 'dark');

    expect(await settings.get('theme', 'light')).toBe('dark');
  });

  it('overwrites an existing value', async () => {
    await settings.set('fontSize', 16);
    await settings.set('fontSize', 18);

    expect(await settings.get('fontSize', 0)).toBe(18);
  });

  it('preserves a stored value that is falsy', async () => {
    await settings.set('paraIndent', 0);
    await settings.set('sidebarOpen', false);

    expect(await settings.get('paraIndent', 99)).toBe(0);
    expect(await settings.get('sidebarOpen', true)).toBe(false);
  });

  it('distinguishes an explicitly stored null from an absent key', async () => {
    await settings.set('lastOpenedNoteId', null);

    expect(await settings.get('lastOpenedNoteId', 'fallback')).toBeNull();
  });

  it('round-trips a structured value', async () => {
    await settings.set('panes', { sidebar: 240, list: 320 });

    expect(await settings.get('panes', {})).toEqual({ sidebar: 240, list: 320 });
  });

  it('returns everything as a plain object', async () => {
    await settings.set('a', 1);
    await settings.set('b', 2);

    expect(await settings.all()).toEqual({ a: 1, b: 2 });
  });

  it('removes a key so the fallback applies again', async () => {
    await settings.set('theme', 'dark');
    await settings.remove('theme');

    expect(await settings.get('theme', 'light')).toBe('light');
  });
});
