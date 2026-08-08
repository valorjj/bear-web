import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Pane } from '@/ui/Pane';
import { Resizer } from '@/ui/Resizer';

import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from './paneWidths';
import { usePaneWidths } from './usePaneWidths';

export function AppShell(): ReactElement {
  const t = useT();
  const widths = usePaneWidths();

  return (
    <main className="flex h-full w-full overflow-hidden bg-bg text-text">
      <Pane label={t('pane.sidebar')} width={widths.sidebarWidth} className="bg-sidebar">
        <EmptyState title={t('sidebar.empty.title')} body={t('sidebar.empty.body')} />
      </Pane>

      <Resizer
        label={t('resizer.sidebar')}
        width={widths.sidebarWidth}
        min={MIN_PANE_WIDTH}
        max={MAX_PANE_WIDTH}
        onResize={widths.onSidebarResize}
        onCommit={widths.onSidebarCommit}
      />

      <Pane label={t('pane.noteList')} width={widths.noteListWidth} className="bg-surface">
        <EmptyState title={t('noteList.empty.title')} body={t('noteList.empty.body')} />
      </Pane>

      <Resizer
        label={t('resizer.noteList')}
        width={widths.noteListWidth}
        min={MIN_PANE_WIDTH}
        max={MAX_PANE_WIDTH}
        onResize={widths.onNoteListResize}
        onCommit={widths.onNoteListCommit}
      />

      <Pane label={t('pane.editor')}>
        <EmptyState title={t('editor.empty.title')} body={t('editor.empty.body')} />
      </Pane>
    </main>
  );
}
