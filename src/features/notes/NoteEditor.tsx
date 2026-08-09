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
export function NoteEditor({ note }: NoteEditorProps): ReactElement {
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
  const [{ initialMarkdown, initialSerializeFailed }] = useState(() => {
    try {
      return { initialMarkdown: normalizeMarkdown(note.text), initialSerializeFailed: false };
    } catch {
      return { initialMarkdown: note.text, initialSerializeFailed: true };
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
  const hadTextAtMountRef = useRef(note.text !== '');

  const discard = useCallback(async () => {
    if (hadTextAtMountRef.current && !editedRef.current) return;
    await notes.purge(note.id);
  }, [note.id]);

  const { schedule, flush, seed, failed } = useAutosave({
    initial: initialMarkdown,
    read,
    save,
    discard,
    isEmpty: (text) => text === EMPTY_DOCUMENT_MARKDOWN,
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
