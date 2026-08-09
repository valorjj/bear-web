import { type ReactElement, useCallback, useRef } from 'react';

import { notes } from '@/data';
import type { Note } from '@/data';
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

  const save = useCallback((next: string) => notes.save(note.id, next), [note.id]);
  const discard = useCallback(() => notes.purge(note.id), [note.id]);

  // Temporary scaffolding: a rich editor (Task 10) will own its document and
  // call `schedule` directly. Until then, a plain ref stands in for that
  // ownership so the tree compiles against the new `useAutosave` interface.
  const textRef = useRef(note.text);
  const { schedule, flush, failed } = useAutosave({
    initial: note.text,
    read: () => textRef.current,
    save,
    discard,
  });

  return (
    <div className="flex h-full flex-col">
      <textarea
        aria-label={t('editor.textarea')}
        defaultValue={note.text}
        onChange={(event) => {
          textRef.current = event.target.value;
          schedule();
        }}
        onBlur={flush}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none bg-bg px-6 py-4 font-mono text-sm text-text outline-none"
      />

      {failed && (
        // `status`, not `alert`: `alert` is the degraded-storage banner's role
        // and the e2e suite asserts there is exactly one of those.
        <p role="status" className="shrink-0 border-t border-border px-6 py-2 text-xs text-muted">
          {t('editor.saveFailed')}
        </p>
      )}
    </div>
  );
}
