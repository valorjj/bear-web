import { BearDatabase } from './db';

let counter = 0;

/**
 * A fresh, uniquely named database per call, so tests never share state.
 * Requires `fake-indexeddb/auto`, which `vitest.setup.ts` imports.
 */
export function createTestDatabase(): BearDatabase {
  counter += 1;
  return new BearDatabase(`bear-web-test-${counter}`);
}
