import { storedImagePath } from './images';
import { files, notes } from './repositories';
import type { Note } from './types';

/**
 * A note received from somewhere else, ready to be copied in.
 *
 * Declared here rather than imported from `src/features/import/`: `src/data/`
 * must not import from `src/features/`, and the shape is small enough that
 * structural typing joins the two ends with no shared module. The same move
 * `parseTags` makes from the other direction.
 */
export interface ImportableNote {
  title: string;
  text: string;
  /** `path` is the `files/<id>.webp` reference as it appears in `text`. */
  images: { path: string; blob: Blob }[];
}

export interface ImportNoteDeps {
  /**
   * Injected, because **jsdom implements neither `createImageBitmap` nor
   * `OffscreenCanvas`** and the unit tests must supply a fake — the same
   * answer `downscale.ts` gives to the same problem.
   *
   * It is needed at all because `files.add` requires the image's real
   * dimensions: a node view reserves its box from them before the blob
   * resolves, and without them a long note reflows once per image as each one
   * lands.
   */
  createImageBitmap?: (
    blob: Blob,
  ) => Promise<{ width: number; height: number; close?: () => void }>;
}

/**
 * The most one imported image may weigh.
 *
 * `parseSharedPage` bounds the note's TEXT (1,000,000 characters) but not an
 * individual image's decoded byte length — a hostile or merely huge shared
 * page can carry an arbitrarily large base64 `data:` URI, and this file is
 * the code that would otherwise write those bytes to disk unbounded. 25 MiB
 * mirrors `downscale.ts`'s `MAX_SOURCE_BYTES`: the same number this app
 * already treats as "too large to be a real paste" on the write path a normal
 * paste takes, so an import is held to no looser a rule than a paste is.
 *
 * An oversized image is treated exactly like one the payload never carried at
 * all (see the module doc): it is not stored, and its `files/<id>.webp`
 * reference is left as written rather than stripped from the text.
 */
export const MAX_IMPORTED_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * Copies a shared note into this device's own notes.
 *
 * A COPY in every respect that matters: a new note id, new image ids, and
 * `createdAt` of now. Nothing here reuses an identifier the sender chose —
 * their image id could collide with one this device already holds for
 * entirely different bytes, and their note id is meaningless in this
 * database.
 *
 * The text is rewritten as each image lands, so a `files/<theirs>.webp`
 * becomes `files/<ours>.webp`. An image the payload does NOT carry is left as
 * written rather than stripped: the sender's device did not hold those bytes
 * either, and deleting the reference would edit the note on their behalf.
 *
 * A per-image failure — `measure` throws on a blob it cannot decode,
 * `files.add` throws under storage pressure, or the size cap above rejects it
 * — is handled the SAME way: caught, skipped, and its reference left
 * untouched, exactly like an image the payload never carried. This is
 * deliberate, not an oversight, and it is why the loop below can never throw.
 * The alternative — let the loop throw and leave `notes.save` unrun — would
 * leave the note holding the sender's original `files/<their-id>.webp` paths
 * while any image `files.add` DID complete on an earlier iteration sits in
 * `db.files`, marked dirty and queued to upload, with nothing in the saved
 * text pointing at it: an orphan. Catching per image means the loop always
 * finishes and `notes.save` always runs, so no such split state exists. A
 * `files.add` that itself throws is not reachable here in a half-written
 * state — Dexie's own `add` either commits the whole record or nothing — and
 * any file this function skips outright (the size cap, or a caught
 * `files.add` from an unrelated cause) leaves no row behind for
 * `runStartupFileSweep` to have to reclaim. A Dexie transaction was
 * considered and rejected for this: a transaction does not survive the
 * `await` on `measure` (`createImageBitmap`), which runs outside it.
 *
 * `notes.create` and `files.add` each call `markDirty` already, so a
 * signed-in device uploads the import on its next push with no sync work
 * here. **Nothing in this file may touch `syncedRev`** — an earlier import
 * path cleared it and manufactured a `(conflict)` note on the most ordinary
 * flow there is (`docs/rulings/sync.md`).
 *
 * The note is created FIRST and its text rewritten after, rather than the
 * text being assembled up front, because `files.add` takes the owning note's
 * id — and inventing one before `notes.create` runs would be a second source
 * of truth for it.
 */
export async function importNote(
  payload: ImportableNote,
  deps: ImportNoteDeps = {},
): Promise<Note> {
  const measure = deps.createImageBitmap ?? ((blob: Blob) => globalThis.createImageBitmap(blob));

  const note = await notes.create(payload.text);

  let text = payload.text;
  for (const image of payload.images) {
    // Oversized bytes are skipped, not stored: see MAX_IMPORTED_IMAGE_BYTES.
    // The reference stays in the text unchanged, the same as an image the
    // payload never carried at all.
    if (image.blob.size > MAX_IMPORTED_IMAGE_BYTES) continue;

    // Caught per image, not let propagate: see the module doc's failure-mode
    // paragraph. A thrown `measure` or `files.add` must not abandon the loop
    // with the note's text left unrewritten and an earlier image's file row
    // orphaned — it is handled exactly like an image never carried at all.
    try {
      const bitmap = await measure(image.blob);
      const record = await files.add(note.id, image.blob, {
        mime: image.blob.type,
        width: bitmap.width,
        height: bitmap.height,
      });
      bitmap.close?.();

      // `split`/`join` rather than a regex: the path comes from outside and
      // would need escaping, and every occurrence must move, not the first.
      text = text.split(image.path).join(storedImagePath(record.id));
    } catch {
      // Skipped, same as an image the payload never carried — see above.
    }
  }

  return text === payload.text ? note : notes.save(note.id, text);
}
