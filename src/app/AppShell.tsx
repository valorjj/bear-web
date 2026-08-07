import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactElement, useEffect, useState } from 'react';

import { settings } from '@/data';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Pane } from '@/ui/Pane';
import { Resizer } from '@/ui/Resizer';

import {
  clampPaneWidth,
  DEFAULT_NOTE_LIST_WIDTH,
  DEFAULT_SIDEBAR_WIDTH,
  MAX_PANE_WIDTH,
  MIN_PANE_WIDTH,
  NOTE_LIST_WIDTH_KEY,
  SIDEBAR_WIDTH_KEY,
} from './paneWidths';

export function AppShell(): ReactElement {
  const t = useT();

  // Persisted widths arrive asynchronously. Render at the defaults immediately
  // rather than blocking on IndexedDB — one frame at the default width beats a
  // blank screen. `drag` holds the in-flight width during a pointer drag.
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

  const sidebarWidth = clampPaneWidth(drag.sidebar ?? storedSidebar, DEFAULT_SIDEBAR_WIDTH);
  const noteListWidth = clampPaneWidth(drag.noteList ?? storedNoteList, DEFAULT_NOTE_LIST_WIDTH);

  return (
    <main className="flex h-full w-full overflow-hidden bg-bg text-text">
      <Pane label={t('pane.sidebar')} width={sidebarWidth} className="bg-sidebar">
        <EmptyState title={t('sidebar.empty.title')} body={t('sidebar.empty.body')} />
      </Pane>

      <Resizer
        label={t('resizer.sidebar')}
        width={sidebarWidth}
        min={MIN_PANE_WIDTH}
        max={MAX_PANE_WIDTH}
        onResize={(width) => setDrag((prev) => ({ ...prev, sidebar: width }))}
        onCommit={(width) => {
          setDrag((prev) => ({ ...prev, sidebar: width }));
          setPendingCommit((prev) => ({ ...prev, sidebar: width }));
          void settings.set(SIDEBAR_WIDTH_KEY, width);
        }}
      />

      <Pane label={t('pane.noteList')} width={noteListWidth} className="bg-surface">
        <EmptyState title={t('noteList.empty.title')} body={t('noteList.empty.body')} />
      </Pane>

      <Resizer
        label={t('resizer.noteList')}
        width={noteListWidth}
        min={MIN_PANE_WIDTH}
        max={MAX_PANE_WIDTH}
        onResize={(width) => setDrag((prev) => ({ ...prev, noteList: width }))}
        onCommit={(width) => {
          setDrag((prev) => ({ ...prev, noteList: width }));
          setPendingCommit((prev) => ({ ...prev, noteList: width }));
          void settings.set(NOTE_LIST_WIDTH_KEY, width);
        }}
      />

      <Pane label={t('pane.editor')}>
        <EmptyState title={t('editor.empty.title')} body={t('editor.empty.body')} />
      </Pane>
    </main>
  );
}
