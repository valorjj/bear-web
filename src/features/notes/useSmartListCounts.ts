import { useLiveQuery } from 'dexie-react-hooks';

import { notes } from '@/data';

import { SMART_LIST_IDS, type SmartListId } from './scope';
import { SMART_LIST_PREDICATES } from './smartLists';

export type SmartListCounts = Record<SmartListId, number>;

/**
 * Every sidebar count, from ONE snapshot.
 *
 * A `useLiveQuery` per row is the obvious shape and is wrong for a reason M5
 * already paid for: the tag tree's row count and its children resolve as two
 * independent queries, which is why a collapsed row can flash open for a
 * frame. Deriving all seven counts from one `listActive()` plus one
 * `allTagRows()` also makes them mutually consistent — untagged plus tagged
 * always equals all, which seven queries landing in seven frames cannot
 * promise.
 *
 * Returns `undefined` while loading, never a zero-filled object: the latter
 * renders every row as "0" on first paint, which reads as "empty" rather than
 * "not known yet".
 *
 * The deps are the constant `[]`, so the tag-and-verify pattern documented in
 * CLAUDE.md does not apply here. Adding it would be dead complexity.
 */
export function useSmartListCounts(): SmartListCounts | undefined {
  return useLiveQuery(async () => {
    const [active, trashed, rows] = await Promise.all([
      notes.listActive(),
      notes.listTrashed(),
      notes.allTagRows(),
    ]);

    const ctx = { tagged: new Set(rows.map((row) => row.noteId)), now: Date.now() };

    const counts = {} as SmartListCounts;
    for (const id of SMART_LIST_IDS) {
      counts[id] =
        id === 'trash'
          ? trashed.length
          : active.filter((note) => SMART_LIST_PREDICATES[id](note, ctx)).length;
    }
    return counts;
  }, []);
}
