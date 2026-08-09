import { type ReactElement, useCallback, useRef, useState } from 'react';

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

  const discard = useCallback(() => notes.purge(note.id), [note.id]);

  const { schedule, flush, failed } = useAutosave({
    initial: initialMarkdown,
    read,
    save,
    discard,
    isEmpty: (text) => text === EMPTY_DOCUMENT_MARKDOWN,
  });

  const onChange = useCallback(() => {
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
