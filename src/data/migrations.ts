import { notes, settings } from './repositories';

/**
 * Bumped whenever the tag parser changes in a way that alters its output.
 * M5b and M6 will both change it; each change bumps this and the rebuild
 * re-runs on the user's next launch.
 */
export const TAG_INDEX_VERSION = 1;
export const TAG_INDEX_VERSION_KEY = 'tagIndexVersion';

/**
 * Bumped whenever the link parser changes in a way that alters its output.
 * Its own marker, own key, and own `runMigrations` call — deliberately not
 * folded into `TAG_INDEX_VERSION`, so a change to one parser never forces an
 * unrelated rebuild of the other index.
 */
export const LINK_INDEX_VERSION = 1;
export const LINK_INDEX_VERSION_KEY = 'linkIndexVersion';

export interface MigrationDeps {
  getVersion: () => Promise<number>;
  setVersion: (version: number) => Promise<void>;
  rebuildTagIndex: () => Promise<number>;
  onError?: (error: unknown) => void;
}

export interface LinkMigrationDeps {
  getVersion: () => Promise<number>;
  setVersion: (version: number) => Promise<void>;
  rebuildLinkIndex: () => Promise<number>;
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

/**
 * The link-index twin of `runMigrations`. A separate function rather than a
 * generalised one: the two rebuilds have different failure messages and, more
 * importantly, keeping them textually separate means a future third index
 * follows an obvious pattern instead of threading a new case through a shared
 * one.
 *
 * Same contract: a settings marker, never a Dexie `upgrade()` hook, and never
 * rejects.
 */
export async function runLinkMigrations(deps: LinkMigrationDeps): Promise<boolean> {
  try {
    const current = await deps.getVersion();
    if (current >= LINK_INDEX_VERSION) return false;

    await deps.rebuildLinkIndex();
    await deps.setVersion(LINK_INDEX_VERSION);
    return true;
  } catch (error) {
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

/**
 * Sequenced after the tag rebuild, not alongside it, for the same reason
 * `runStartupSweep` follows `runStartupMigrations` in `main.tsx`: both touch
 * `notes`-derived tables, and running them one after another removes any
 * question of what one rebuild sees mid-write from the other.
 */
export function runStartupLinkMigrations(): Promise<boolean> {
  return runLinkMigrations({
    getVersion: () => settings.get(LINK_INDEX_VERSION_KEY, 0),
    setVersion: (version) => settings.set(LINK_INDEX_VERSION_KEY, version),
    rebuildLinkIndex: () => notes.rebuildLinkIndex(),
    onError: (error) => {
      console.error('bear-web: link index rebuild failed', error);
    },
  });
}
