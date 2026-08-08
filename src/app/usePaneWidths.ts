import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { settings } from '@/data';

import {
  clampPaneWidth,
  DEFAULT_NOTE_LIST_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  NOTE_LIST_WIDTH_KEY,
  SIDEBAR_WIDTH_KEY,
} from './paneWidths';

export interface PaneWidths {
  sidebarWidth: number;
  noteListWidth: number;
  onSidebarResize: (width: number) => void;
  onSidebarCommit: (width: number) => void;
  onNoteListResize: (width: number) => void;
  onNoteListCommit: (width: number) => void;
}

/**
 * Pane widths are durable, not ephemeral: they live in the `settings` table so
 * they survive a reload like any other preference.
 */
export function usePaneWidths(): PaneWidths {
  // Persisted widths arrive asynchronously. Render at the defaults immediately
  // rather than blocking on IndexedDB — one frame at the default width beats a
  // blank screen.
  const storedSidebar = useLiveQuery(
    () => settings.get(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH),
    [],
    DEFAULT_SIDEBAR_WIDTH,
  );
  const storedNoteList = useLiveQuery(
    () => settings.get(NOTE_LIST_WIDTH_KEY, DEFAULT_NOTE_LIST_WIDTH),
    [],
    DEFAULT_NOTE_LIST_WIDTH,
  );

  // `drag` holds an optimistic width during and immediately after a pointer
  // drag or keypress ends. It must NOT be cleared the instant onCommit fires:
  // the committed width only becomes visible through `storedSidebar` /
  // `storedNoteList` once the async settings write completes and the live
  // query re-runs. Clearing eagerly would flash the pane back to the
  // still-stale stored width for a frame (see Finding 3). Instead we track
  // what we last committed in `pendingCommit` and only drop the override once
  // the live query reports that exact value.
  const [drag, setDrag] = useState<{ sidebar?: number; noteList?: number }>({});
  const [pendingCommit, setPendingCommit] = useState<{ sidebar?: number; noteList?: number }>({});

  useEffect(() => {
    if (pendingCommit.sidebar === undefined || storedSidebar !== pendingCommit.sidebar) return;
    setDrag((prev) => ({ ...prev, sidebar: undefined }));
    setPendingCommit((prev) => ({ ...prev, sidebar: undefined }));
  }, [storedSidebar, pendingCommit.sidebar]);

  useEffect(() => {
    if (pendingCommit.noteList === undefined || storedNoteList !== pendingCommit.noteList) return;
    setDrag((prev) => ({ ...prev, noteList: undefined }));
    setPendingCommit((prev) => ({ ...prev, noteList: undefined }));
  }, [storedNoteList, pendingCommit.noteList]);

  return {
    sidebarWidth: clampPaneWidth(drag.sidebar ?? storedSidebar, DEFAULT_SIDEBAR_WIDTH),
    noteListWidth: clampPaneWidth(drag.noteList ?? storedNoteList, DEFAULT_NOTE_LIST_WIDTH),

    onSidebarResize: (width) => setDrag((prev) => ({ ...prev, sidebar: width })),
    onSidebarCommit: (width) => {
      setDrag((prev) => ({ ...prev, sidebar: width }));
      setPendingCommit((prev) => ({ ...prev, sidebar: width }));
      void settings.set(SIDEBAR_WIDTH_KEY, width);
    },

    onNoteListResize: (width) => setDrag((prev) => ({ ...prev, noteList: width })),
    onNoteListCommit: (width) => {
      setDrag((prev) => ({ ...prev, noteList: width }));
      setPendingCommit((prev) => ({ ...prev, noteList: width }));
      void settings.set(NOTE_LIST_WIDTH_KEY, width);
    },
  };
}
