import type { Query } from '../app.ts';

export interface Pool {
  query: Query;
  end: () => Promise<void>;
}

/** Replaced with the real mysql2 pool in Task 4. */
export function createPool(databaseUrl: string): Pool {
  void databaseUrl;
  throw new Error('createPool is implemented in Task 4');
}
