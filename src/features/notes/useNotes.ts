import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { notes } from '@/data';
import type { Note } from '@/data';

import { listForScope, type NoteScope } from './scope';

export interface NotesState {
  /** `undefined` while the live query has not yet resolved. */
  items: Note[] | undefined;
  selectedNoteId: string | null;
  selectedNote: Note | null;
  select: (id: string | null) => void;
}

export function useNotes(scope: NoteScope): NotesState {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const items = useLiveQuery(() => listForScope(scope), [scope]);

  // Reconciliation probes the database for the selected note, NOT `items`.
  //
  // Probing `items` looks simpler and is wrong: `create` resolves before the
  // list query re-runs, so for one tick the newly created note is absent from
  // `items` while being present in the database. Reconciling against the list
  // would clear the selection on every single creation.
  //
  // The result is wrapped in an object so that "still loading" (`undefined`)
  // is distinguishable from "loaded, and the note is gone" (`{ note:
  // undefined }`). A bare `Note | undefined` conflates the two, and clearing
  // on the loading value deselects on every scope change.
  const probe = useLiveQuery(
    async () => (selectedNoteId === null ? null : { note: await notes.get(selectedNoteId) }),
    [selectedNoteId],
  );

  useEffect(() => {
    if (probe === undefined || probe === null) return;

    const { note } = probe;
    if (note === undefined) {
      setSelectedNoteId(null);
      return;
    }

    const inScope = scope === 'active' ? note.trashedAt === null : note.trashedAt !== null;
    if (!inScope) setSelectedNoteId(null);
  }, [probe, scope]);

  return {
    items,
    selectedNoteId,
    selectedNote: probe?.note ?? null,
    select: setSelectedNoteId,
  };
}
