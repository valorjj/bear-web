import { db } from './db';
import { notes } from './repositories';
import type { Note } from './types';

export interface SweepDeps {
  listCandidates: () => Promise<Note[]>;
  purge: (id: string) => Promise<void>;
  /**
   * Only notes created strictly before this instant are eligible.
   *
   * The sweep is unawaited and React mounts before it runs, so the app is
   * interactive while it is pending — and on a tag-index rebuild that window
   * is seconds long. A note the user creates in that window has empty text,
   * no trashedAt, and createdAt === updatedAt, so all three gates pass
   * legitimately and the sweep would destroy work in progress. The other
   * gates guard against mis-detecting a note; this one guards against
   * sweeping a note that did not exist when the sweep was decided on.
   */
  createdBefore: number;
  onError?: (error: unknown) => void;
}

/**
 * Reclaims notes left blank across a reload.
 *
 * `NoteEditor` discards a blank note when it unmounts, but `beforeunload` only
 * flushes — it never unmounts — so a blank note open when the tab closes
 * survives as a permanent `Untitled` row.
 *
 * **All three content gates are load-bearing, but they are not sufficient on
 * their own — see `createdBefore`.** This runs before any editor has
 * mounted, over notes it has never read: the same shape as the M4 defect
 * where a truncated document reached `notes.purge`. `save` always writes a
 * fresh `updatedAt`, so `createdAt === updatedAt` means the note has never
 * been saved even once. A note the user has typed into is unreachable here
 * even if the emptiness check is wrong. But the three content gates alone are
 * a time-of-check/time-of-use bug: the sweep is unawaited and runs after React
 * has already mounted and made the app interactive, so a note created in that
 * window has empty text, no trashedAt, and createdAt === updatedAt — it passes
 * all three legitimately. `createdBefore` is the gate that closes that window,
 * by excluding any note that did not exist when the sweep was decided on.
 *
 * Never rejects, including when `onError` itself throws. A failed sweep costs a
 * stray row and retries next launch. A single note's purge throwing does not
 * abort the rest of the sweep either — it is caught, reported, and the loop
 * continues, so the returned count reflects every note actually purged.
 */
export async function sweepBlankNotes(deps: SweepDeps): Promise<number> {
  try {
    const candidates = await deps.listCandidates();

    let purged = 0;
    for (const note of candidates) {
      if (note.createdAt >= deps.createdBefore) continue;
      if (note.text !== '') continue;
      if (note.trashedAt !== null) continue;
      if (note.createdAt !== note.updatedAt) continue;

      try {
        await deps.purge(note.id);
        purged += 1;
      } catch (error) {
        try {
          deps.onError?.(error);
        } catch {
          // Nothing useful left to do: the reporter is the thing that broke.
        }
      }
    }
    return purged;
  } catch (error) {
    try {
      deps.onError?.(error);
    } catch {
      // Nothing useful left to do: the reporter is the thing that broke.
    }
    return 0;
  }
}

export function runStartupSweep(createdBefore: number): Promise<number> {
  return sweepBlankNotes({
    listCandidates: () => db.notes.toArray(),
    purge: (id) => notes.purge(id),
    createdBefore,
    onError: (error) => {
      console.error('bear-web: blank-note sweep failed', error);
    },
  });
}
