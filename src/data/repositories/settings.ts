import type { BearDatabase } from '../db';

export interface SettingsRepository {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  all(): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
}

export function createSettingsRepository(db: BearDatabase): SettingsRepository {
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const row = await db.settings.get(key);
      // Absence is the only trigger for the fallback. A stored 0 or false wins.
      return row === undefined ? fallback : (row.value as T);
    },
    async set(key, value) {
      await db.settings.put({ key, value });
    },
    async all() {
      const rows = await db.settings.toArray();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async remove(key) {
      await db.settings.delete(key);
    },
  };
}
