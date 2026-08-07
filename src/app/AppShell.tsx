import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactElement, useState } from 'react';

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

  const [drag, setDrag] = useState<{ sidebar?: number; noteList?: number }>({});

  const sidebarWidth = clampPaneWidth(drag.sidebar ?? storedSidebar);
  const noteListWidth = clampPaneWidth(drag.noteList ?? storedNoteList);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
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
          setDrag((prev) => ({ ...prev, sidebar: undefined }));
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
          setDrag((prev) => ({ ...prev, noteList: undefined }));
          void settings.set(NOTE_LIST_WIDTH_KEY, width);
        }}
      />

      <Pane label={t('pane.editor')}>
        <EmptyState title={t('editor.empty.title')} body={t('editor.empty.body')} />
      </Pane>
    </div>
  );
}
