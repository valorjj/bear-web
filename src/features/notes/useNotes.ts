import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { notes } from '@/data';
import type { Note } from '@/data';

import {
  DEFAULT_SCOPE_QUERY,
  isTrash,
  listForScope,
  type NoteScope,
  type ScopeQuery,
  scopeKey,
} from './scope';

export interface NotesState {
  /** `undefined` while the live query has not yet resolved. */
  items: Note[] | undefined;
  selectedNoteId: string | null;
  /**
   * `undefined` while the probe for `selectedNoteId` has not yet resolved
   * (nothing is known yet — render nothing); `null` once resolved and there
   * is no selection, or the selected note is confirmed gone (render the
   * empty state); the `Note` once the probe has resolved to one.
   */
  selectedNote: Note | null | undefined;
  select: (id: string | null) => void;
}

export function useNotes(scope: NoteScope, query: ScopeQuery = DEFAULT_SCOPE_QUERY): NotesState {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  // Tagged with the `scope` it was fetched for, and only trusted when that
  // tag still matches the current `scope`.
  //
  // `dexie-react-hooks`' `useObservable` keeps a single mutable ref across
  // dependency changes and only seeds a value synchronously when it has
  // never had one (`!monitor.current.hasResult`). Once any query has
  // resolved, switching `[scope]` to a new value does NOT reset that flag,
  // so the hook exposes the *previous* scope's cached result — not
  // `undefined` ("still loading") — for however long it takes the new
  // `Dexie.liveQuery` subscription to resolve in a `useEffect`. Verified by
  // isolated repro: reading the hook's result in the same tick as a deps
  // change reliably returns the old scope's value.
  //
  // Under CPU contention that passive-effect delay can outlast a test's
  // `findByRole` polling window (and, for a real user, a slow tab): the note
  // list would flash the *other* scope's contents — including "no notes" —
  // right after switching scopes. Tagging the result and falling back to
  // `undefined` on a stale tag turns that wrong-but-present value back into
  // "still loading," which is the correct state to show.
  // The view preferences join the key, not just the scope: changing the sort
  // must re-run the live query, and the tag-and-verify guard must reject a
  // result fetched under the previous sort for exactly the reason it rejects
  // one fetched under the previous scope — a stale-but-present list is worse
  // than "still loading", because it renders the very order the user just
  // asked to change.
  const key = `${scopeKey(scope)}|${query.order.field}|${query.order.newestFirst}|${query.includeDescendants}`;

  const itemsResult = useLiveQuery(
    async () => ({ key, list: await listForScope(scope, query) }),
    [key],
  );
  const items = itemsResult?.key === key ? itemsResult.list : undefined;

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
  //
  // Also tagged with `id`, for the same reason `items` is tagged with `key`
  // above: switching the selected note must not display, or reconcile
  // against, the *previous* note's cached probe result.
  const probeResult = useLiveQuery(
    async () =>
      selectedNoteId === null
        ? null
        : { id: selectedNoteId, note: await notes.get(selectedNoteId) },
    [selectedNoteId],
  );
  const probe =
    selectedNoteId === null
      ? null
      : probeResult && probeResult.id === selectedNoteId
        ? probeResult
        : undefined;

  const scopeIsTrash = isTrash(scope);

  useEffect(() => {
    if (probe === undefined || probe === null) return;

    const { note } = probe;
    if (note === undefined) {
      setSelectedNoteId(null);
      return;
    }

    // Trash state only. Tag membership deliberately does NOT deselect: a user
    // who deletes `#work` from the note they are typing in must not have the
    // editor pulled out from under them, and neither must someone typing `#wo`
    // on the way to `#work`. The note leaves the list and stays open.
    const inScope = scopeIsTrash ? note.trashedAt !== null : note.trashedAt === null;
    if (!inScope) setSelectedNoteId(null);
  }, [probe, scopeIsTrash]);

  return {
    items,
    selectedNoteId,
    selectedNote: probe === undefined ? undefined : (probe?.note ?? null),
    select: setSelectedNoteId,
  };
}
