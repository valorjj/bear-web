import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import { notes } from '@/data';
import type { Note } from '@/data';
import {
  EMPTY_DOCUMENT_MARKDOWN,
  normalizeMarkdown,
  RichEditor,
  type RichEditorHandle,
} from '@/features/editor';
import { useT } from '@/i18n';

import { useAutosave } from './useAutosave';

export interface NoteEditorProps {
  note: Note;
  /**
   * The text this note was created with, set ONLY for a note the app just
   * created. A note created inside a tag scope is seeded with that tag, which
   * makes it non-empty and therefore immune to the blank-note purge — so tag
   * scopes would silently fill with notes nobody ever wrote in.
   *
   * Widening `isEmpty` globally to "contains only tags" was rejected: it would
   * delete a note in which the user deliberately wrote nothing but tags.
   * Scoping the rule to the just-created note leaves every existing note
   * untouched, and the truncation guard below keeps its full strength.
   */
  seedText?: string;
  /**
   * Called with a tag name when the user Mod-clicks its pill. Returns whether
   * the app acted on it; `false` makes the gesture behave like a plain click.
   */
  onActivateTag?: (tag: string) => boolean;
}

/**
 * Must be rendered with `key={note.id}` so React remounts it on every switch.
 * The instance then knows exactly one note for its whole lifetime, which is
 * what makes `useAutosave`'s unmount flush a correct flush-on-switch.
 *
 * The editor is the sole writer of this note's text while it is open. Live
 * query updates for the open note are deliberately ignored, so nothing moves
 * the caret except the user.
 */
/**
 * Discards scheduled but not yet executed, keyed by note id.
 *
 * Lives at module scope because a remount is a new component instance: a ref
 * would start empty and cancel nothing. See `discard` below for why a
 * destructive cleanup must be cancellable at all.
 */
const pendingDiscards = new Map<string, ReturnType<typeof setTimeout>>();

export function NoteEditor({ note, seedText, onActivateTag }: NoteEditorProps): ReactElement {
  const t = useT();

  const handleRef = useRef<RichEditorHandle | null>(null);

  // Seeded from the SERIALIZED document, not from `note.text`. Opening a note
  // must never produce a write: a non-canonical note would otherwise differ
  // from its own serialization immediately and be rewritten just for being
  // looked at.
  //
  // Wrapped in try/catch for the same reason as `read`, below: serialization
  // can fail, and a failure here must degrade to the raw stored text plus a
  // visible message rather than crash the component outright.
  //
  // `seedText` is normalized the same way, once, here — but in its OWN
  // try/catch, separate from `initialMarkdown`'s. `isEmpty` below compares
  // against the MOUNTED EDITOR's serialized reading (`read()`), never against
  // raw stored text — `normalizeMarkdown` can itself change the text (for
  // instance, stripping a leading newline), so comparing a normalized reading
  // against a raw `seedText` would silently never match and the seeded-empty
  // check would never fire. A throw from normalizing the SEED is not evidence
  // the note's own text fails to serialize; sharing one try/catch would show
  // the user the serialization-failure banner, and fall back to mounting on
  // raw `note.text`, for a note that serializes perfectly well. A bad seed
  // should only cost the seed check, never the editor's confidence in itself.
  const [{ initialMarkdown, initialSerializeFailed }] = useState(() => {
    try {
      return { initialMarkdown: normalizeMarkdown(note.text), initialSerializeFailed: false };
    } catch {
      return { initialMarkdown: note.text, initialSerializeFailed: true };
    }
  });
  const [normalizedSeedText] = useState(() => {
    if (seedText === undefined) return undefined;
    try {
      return normalizeMarkdown(seedText);
    } catch {
      return seedText;
    }
  });
  const [serializeFailed, setSerializeFailed] = useState(initialSerializeFailed);

  const read = useCallback((): string => {
    try {
      return handleRef.current?.getMarkdown() ?? initialMarkdown;
    } catch {
      return initialMarkdown;
    }
  }, [initialMarkdown]);

  const save = useCallback(
    async (next: string) => {
      // Serialization already happened in `read`. If it threw, `read` reported
      // the last good value and there is nothing new to write.
      await notes.save(note.id, next);
    },
    [note.id],
  );

  // Guard (c) of three against the "opening a note deletes it" class of bug.
  //
  // Purging is only ever right for a note the USER emptied. A note that held
  // text when it was opened and was never touched must survive, whatever the
  // editor pipeline reports at unmount — a truncation bug upstream must cost a
  // stale render, never the note. Tracked explicitly rather than inferred from
  // comparing text, because a text comparison is exactly what a truncation bug
  // corrupts.
  const editedRef = useRef(false);
  const hadTextAtMountRef = useRef(note.text !== '' && note.text !== seedText);

  // Cancels a discard this note scheduled a moment ago. React ran a cleanup
  // and then mounted us again, so the unmount was a remount, not the user
  // leaving. Module-scope state, not a ref, because the remount is a NEW
  // component instance whose refs start empty.
  useEffect(() => {
    const pending = pendingDiscards.get(note.id);
    if (pending === undefined) return;

    clearTimeout(pending);
    pendingDiscards.delete(note.id);
  }, [note.id]);

  const discard = useCallback(async () => {
    if (hadTextAtMountRef.current && !editedRef.current) return;

    const id = note.id;

    // Deferred by a macrotask rather than run here, so a remount can cancel
    // it. React's effect cleanup is NOT a reliable "this component is going
    // away" signal — StrictMode runs mount/cleanup/mount on every mount in
    // development, `useNotes` routes every selection change through a
    // transient `undefined` that unmounts this editor, and Offscreen may do
    // the same in production. Purging straight from the cleanup meant a
    // just-created note was destroyed milliseconds after `notes.create`
    // returned it: no note could be created at all under `npm run dev`.
    //
    // React runs the remount's effects before this macrotask fires, so the
    // cancel above always wins the race when there is a remount at all. When
    // there is not, the timer fires and the note is reclaimed as before.
    clearTimeout(pendingDiscards.get(id));
    pendingDiscards.set(
      id,
      setTimeout(() => {
        pendingDiscards.delete(id);

        void (async () => {
          // A trashed note lives in the user's Trash and stays there. Without
          // this, the Delete button purged a blank note outright while
          // trashing every other note — one button, two irreversibilities,
          // decided by state the user cannot see. M6 ruled that Delete always
          // trashes; this is that ruling. The reclaim path for a blank note
          // the user simply navigates away from is untouched.
          const current = await notes.get(id);
          if (current === undefined || current.trashedAt !== null) return;

          await notes.purge(id);
        })();
      }, 0),
    );
  }, [note.id]);

  const { schedule, flush, seed, failed } = useAutosave({
    initial: initialMarkdown,
    read,
    save,
    discard,
    isEmpty: (text) =>
      text === EMPTY_DOCUMENT_MARKDOWN ||
      (normalizedSeedText !== undefined && text === normalizedSeedText),
  });

  // Guard (b). `initialMarkdown` above is what the MANAGER produces from the
  // stored text; what matters for "opening a note writes nothing" is what the
  // MOUNTED EDITOR produces, and the two agreeing is an assumption, not a fact.
  // Adopting the editor's own reading as the baseline makes the rule hold by
  // construction instead of by two components happening to match.
  //
  // Safe to do in an effect: React runs a child's effects before its parent's,
  // so `RichEditor` has already published its handle by the time this runs, and
  // nothing can have flushed yet — every flush trigger (blur, debounce,
  // visibility, unmount) is strictly later.
  useEffect(() => {
    let atMount: string;
    try {
      const handle = handleRef.current;
      if (handle === null) return;
      atMount = handle.getMarkdown();
    } catch {
      // Keep the parse-time baseline; `initialSerializeFailed` already covers
      // the user-visible half of this.
      return;
    }
    seed(atMount);
  }, [seed]);

  const onChange = useCallback(() => {
    editedRef.current = true;
    try {
      handleRef.current?.getMarkdown();
      setSerializeFailed(false);
      schedule();
    } catch {
      // A serialization failure happens BEFORE any write. `notes.save` is never
      // called, so the stored Markdown is untouched by construction rather than
      // by discipline. The document stays in memory and the next edit retries.
      setSerializeFailed(true);
    }
  }, [schedule]);

  return (
    <div className="flex h-full flex-col">
      <RichEditor
        initialMarkdown={initialMarkdown}
        onChange={onChange}
        onBlur={flush}
        ariaLabel={t('editor.textarea')}
        handleRef={handleRef}
        createdAt={note.createdAt}
        updatedAt={note.updatedAt}
        onActivateTag={onActivateTag}
      />

      {(failed || serializeFailed) && (
        // `status`, not `alert`: `alert` is the degraded-storage banner's role
        // and the e2e suite asserts there is exactly one of those.
        <p role="status" className="shrink-0 border-t border-border px-6 py-2 text-xs text-muted">
          {serializeFailed ? t('editor.serializeFailed') : t('editor.saveFailed')}
        </p>
      )}
    </div>
  );
}
