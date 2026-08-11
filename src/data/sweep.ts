import { db } from './db';
import { notes } from './repositories';
import type { Note } from './types';

export interface SweepDeps {
  listCandidates: () => Promise<Note[]>;
  purge: (id: string) => Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Reclaims notes left blank across a reload.
 *
 * `NoteEditor` discards a blank note when it unmounts, but `beforeunload` only
 * flushes — it never unmounts — so a blank note open when the tab closes
 * survives as a permanent `Untitled` row.
 *
 * **All three gates are load-bearing, and the third is the safety argument.**
 * This runs before any editor has mounted, over notes it has never read: the
 * same shape as the M4 defect where a truncated document reached
 * `notes.purge`. `save` always writes a fresh `updatedAt`, so
 * `createdAt === updatedAt` means the note has never been saved even once. A
 * note the user has typed into is unreachable here even if the emptiness check
 * is wrong — two independent conditions must both fail to lose data.
 *
 * Never rejects, including when `onError` itself throws. A failed sweep costs a
 * stray row and retries next launch.
 */
export async function sweepBlankNotes(deps: SweepDeps): Promise<number> {
  try {
    const candidates = await deps.listCandidates();

    let purged = 0;
    for (const note of candidates) {
      if (note.text !== '') continue;
      if (note.trashedAt !== null) continue;
      if (note.createdAt !== note.updatedAt) continue;

      await deps.purge(note.id);
      purged += 1;
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

export function runStartupSweep(): Promise<number> {
  return sweepBlankNotes({
    listCandidates: () => db.notes.toArray(),
    purge: (id) => notes.purge(id),
    onError: (error) => {
      console.error('bear-web: blank-note sweep failed', error);
    },
  });
}
