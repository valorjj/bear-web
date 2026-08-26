import { db } from './db';
import { storedImageIds } from './images';
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

export interface FileSweepDeps {
  /** Every stored file, with the note that owns it. */
  listFiles: () => Promise<Array<{ id: string; noteId: string; createdAt: number }>>;
  /** The owning note's current text, or `null` if the note is gone. */
  noteText: (noteId: string) => Promise<string | null>;
  remove: (id: string) => Promise<void>;
  /**
   * Only files stored strictly before this instant are eligible — the same
   * time-of-check gate `sweepBlankNotes` uses, and for the same reason: the
   * sweep is unawaited and the app is interactive while it runs, so an image
   * pasted in that window must be out of reach.
   */
  createdBefore: number;
  onError?: (error: unknown) => void;
}

/**
 * Reclaims stored images no note references any more.
 *
 * **At STARTUP, deliberately, and not when the note is saved.** The first
 * design swept inside `notes.save`, on the reasoning that autosave's debounce
 * left an undo window. It does not: the debounce is a few hundred
 * milliseconds and a person reaching for Cmd-Z takes seconds, so deleting an
 * image and undoing restored the reference to a blob that had already been
 * destroyed — a broken image, permanently, with no copy anywhere. The test
 * that proved it is in `NoteEditor.test.tsx` ("an image deleted and then
 * undone is still stored") and it FAILED against that design.
 *
 * Reclaiming at boot instead means the undo window is however long the tab
 * stays open, which is longer than any human undo. The cost is that an
 * orphaned blob survives until the next launch — a few hundred KB, invisible,
 * and worth far more than the alternative.
 *
 * `notes.purge` still deletes a note's files immediately; that case is
 * unambiguous, because the note itself is gone.
 *
 * Never rejects, for the same reason `sweepBlankNotes` never does: a failed
 * sweep costs a stray row and retries next launch.
 */
export async function sweepOrphanFiles(deps: FileSweepDeps): Promise<number> {
  try {
    const files = await deps.listFiles();
    const texts = new Map<string, string | null>();

    let removed = 0;
    for (const file of files) {
      if (file.createdAt >= deps.createdBefore) continue;

      if (!texts.has(file.noteId)) texts.set(file.noteId, await deps.noteText(file.noteId));
      const text = texts.get(file.noteId) ?? null;

      // The note is gone but its files were not reclaimed — `notes.purge`
      // handles that case, so this is belt and braces for a crash mid-purge.
      // Still unreferenced either way.
      const referenced = text === null ? false : storedImageIds(text).includes(file.id);
      if (referenced) continue;

      try {
        await deps.remove(file.id);
        removed += 1;
      } catch (error) {
        try {
          deps.onError?.(error);
        } catch {
          // Nothing useful left to do: the reporter is the thing that broke.
        }
      }
    }
    return removed;
  } catch (error) {
    try {
      deps.onError?.(error);
    } catch {
      // Nothing useful left to do: the reporter is the thing that broke.
    }
    return 0;
  }
}

export function runStartupFileSweep(createdBefore: number): Promise<number> {
  return sweepOrphanFiles({
    listFiles: () =>
      db.files
        .toArray()
        .then((rows) =>
          rows.map((row) => ({ id: row.id, noteId: row.noteId, createdAt: row.createdAt })),
        ),
    noteText: (noteId) => db.notes.get(noteId).then((note) => note?.text ?? null),
    remove: (id) => db.files.delete(id),
    createdBefore,
    onError: (error) => {
      console.error('bear-web: orphan-image sweep failed', error);
    },
  });
}
