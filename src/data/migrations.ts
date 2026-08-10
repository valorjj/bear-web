import { notes, settings } from './repositories';

/**
 * Bumped whenever the tag parser changes in a way that alters its output.
 * M5b and M6 will both change it; each change bumps this and the rebuild
 * re-runs on the user's next launch.
 */
export const TAG_INDEX_VERSION = 1;
export const TAG_INDEX_VERSION_KEY = 'tagIndexVersion';

export interface MigrationDeps {
  getVersion: () => Promise<number>;
  setVersion: (version: number) => Promise<void>;
  rebuildTagIndex: () => Promise<number>;
  onError?: (error: unknown) => void;
}

/**
 * A settings marker rather than a Dexie `version(2).upgrade()` hook. A throw
 * inside a versioning transaction means the database never opens: the app is
 * bricked with the user's notes on disk and unreachable. Here a throw costs an
 * empty tag index and nothing else, and the version is deliberately not
 * recorded so the next launch retries.
 *
 * Resolves `true` only when a rebuild ran AND the new version was recorded.
 * Never rejects.
 */
export async function runMigrations(deps: MigrationDeps): Promise<boolean> {
  try {
    const current = await deps.getVersion();
    if (current >= TAG_INDEX_VERSION) return false;

    await deps.rebuildTagIndex();
    await deps.setVersion(TAG_INDEX_VERSION);
    return true;
  } catch (error) {
    // A caller-supplied callback must never be able to turn a failed rebuild
    // into an unhandled rejection — the never-rejects contract is the entire
    // reason this is a settings marker and not a Dexie upgrade hook.
    try {
      deps.onError?.(error);
    } catch {
      // Nothing useful left to do: the reporter is the thing that broke.
    }
    return false;
  }
}

export function runStartupMigrations(): Promise<boolean> {
  return runMigrations({
    getVersion: () => settings.get(TAG_INDEX_VERSION_KEY, 0),
    setVersion: (version) => settings.set(TAG_INDEX_VERSION_KEY, version),
    rebuildTagIndex: () => notes.rebuildTagIndex(),
    onError: (error) => {
      // Reported, not swallowed: an empty tag index with no trace is worse
      // than an empty tag index with one.
      console.error('bear-web: tag index rebuild failed', error);
    },
  });
}
