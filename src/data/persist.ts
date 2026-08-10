import { db } from './db';

/**
 * `already`  — storage was persistent before we asked.
 * `granted`  — we asked and the browser agreed.
 * `denied`   — we asked and it refused, or the call threw.
 * `skipped`  — there is nothing to protect yet, so we did not ask.
 * `unsupported` — the browser has no Storage API.
 */
export type PersistOutcome = 'already' | 'granted' | 'denied' | 'skipped' | 'unsupported';

export interface PersistDeps {
  /** Whether `navigator.storage` exists at all. */
  supported: boolean;
  /** Reads the current state. Never prompts. */
  persisted: () => Promise<boolean>;
  /** Requests persistence. Prompts the user in Firefox. */
  persist: () => Promise<boolean>;
  /** Whether the database holds anything worth protecting. */
  hasContent: () => Promise<boolean>;
  onError?: (error: unknown) => void;
}

/**
 * Asks the browser not to evict this origin's IndexedDB under storage pressure.
 * Without it, a browser reclaiming space can delete every note the user has
 * written, silently and with no recovery — there is no server copy.
 *
 * **The call order is the design, not an implementation detail.** `persisted()`
 * only reads state and never prompts; `persist()` shows a permission doorhanger
 * in Firefox. Asking a first-time visitor to grant persistent storage before
 * they have written a single note is the moment they are most likely to refuse,
 * and a refusal is sticky. So we ask only once the database already holds a
 * note — on the visit *after* the one where they started writing. Notes from
 * that first session are unprotected until the next launch, which is safe
 * enough: eviction does not happen mid-session.
 *
 * Chrome and Safari never prompt; they decide from engagement and usage
 * heuristics, which the same gating happens to favour.
 *
 * Never rejects. A browser that refuses, throws, or lacks the API entirely
 * leaves the app working exactly as before.
 */
export async function requestPersistentStorage(deps: PersistDeps): Promise<PersistOutcome> {
  if (!deps.supported) return 'unsupported';

  try {
    if (await deps.persisted()) return 'already';
    if (!(await deps.hasContent())) return 'skipped';

    return (await deps.persist()) ? 'granted' : 'denied';
  } catch (error) {
    // A caller-supplied callback must never turn a refused permission into an
    // unhandled rejection, for the same reason `runMigrations` guards its own.
    try {
      deps.onError?.(error);
    } catch {
      // Nothing useful left to do: the reporter is the thing that broke.
    }
    return 'denied';
  }
}

export function persistStorage(): Promise<PersistOutcome> {
  // Feature-detected rather than assumed: older Safari and some embedded
  // webviews have no `navigator.storage`, and `persist` is absent even where
  // `storage` exists.
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  const supported = typeof storage?.persist === 'function';

  return requestPersistentStorage({
    supported,
    persisted: () => storage!.persisted(),
    persist: () => storage!.persist(),
    hasContent: async () => (await db.notes.count()) > 0,
    onError: (error) => {
      console.error('bear-web: persistent storage request failed', error);
    },
  });
}
