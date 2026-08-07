import { db } from './db';

export type DatabaseStatus = 'ready' | 'memory';

export interface ResolveDatabaseDeps {
  open: () => Promise<unknown>;
  installFallback: () => Promise<unknown>;
}

/**
 * Resolves how the application will store data. Never rejects — a thrown error
 * here would blank the page instead of degrading it, which is the opposite of
 * what the degraded mode exists for.
 */
export async function resolveDatabase(deps: ResolveDatabaseDeps): Promise<DatabaseStatus> {
  try {
    await deps.open();
    return 'ready';
  } catch {
    // IndexedDB is unavailable — private browsing, a storage policy, or a quota
    // refusal. Swap in an in-memory implementation so the repositories work
    // unchanged, and let the caller warn the user.
  }

  try {
    await deps.installFallback();
    await deps.open();
  } catch {
    // Even the fallback failed. Still report memory: the caller shows the
    // banner and the app runs, however little it can persist.
  }

  return 'memory';
}

export function openDatabase(): Promise<DatabaseStatus> {
  return resolveDatabase({
    open: () => db.open(),
    // Dynamically imported so it is code-split and costs nothing when IndexedDB
    // works. `fake-indexeddb/auto` installs itself over the global.
    installFallback: () => import('fake-indexeddb/auto'),
  });
}
