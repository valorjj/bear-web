import { type ReactElement, useCallback, useState } from 'react';

import { notes } from '@/data';
import { NoteEditor, NoteList, type NoteScope, ScopeSidebar, useNotes } from '@/features/notes';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Pane } from '@/ui/Pane';
import { Resizer } from '@/ui/Resizer';

import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from './paneWidths';
import { usePaneWidths } from './usePaneWidths';

export function AppShell(): ReactElement {
  const t = useT();
  const widths = usePaneWidths();

  const [scope, setScope] = useState<NoteScope>('active');
  const { items, selectedNoteId, selectedNote, select } = useNotes(scope);

  const handleCreate = useCallback(async () => {
    // Creating always lands in the notes scope: a new note is not trash.
    setScope('active');
    const created = await notes.create();
    select(created.id);
  }, [select]);

  const handleTrash = useCallback(async (id: string) => {
    await notes.trash(id);
  }, []);

  const handleRestore = useCallback(async (id: string) => {
    await notes.restore(id);
  }, []);

  return (
    <main className="flex h-full w-full overflow-hidden bg-bg text-text">
      <Pane label={t('pane.sidebar')} width={widths.sidebarWidth} className="bg-sidebar">
        <ScopeSidebar scope={scope} onScopeChange={setScope} />
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
        <NoteList
          scope={scope}
          items={items}
          selectedNoteId={selectedNoteId}
          onSelect={select}
          onCreate={() => void handleCreate()}
          onTrash={(id) => void handleTrash(id)}
          onRestore={(id) => void handleRestore(id)}
        />
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
        {selectedNote === null ? (
          <EmptyState title={t('editor.empty.title')} body={t('editor.empty.body')} />
        ) : (
          // `key` is load-bearing, not an optimisation: it remounts the editor
          // on every switch, so an instance only ever writes to one note and
          // its unmount cleanup is the flush-on-switch.
          <NoteEditor key={selectedNote.id} note={selectedNote} />
        )}
      </Pane>
    </main>
  );
}
