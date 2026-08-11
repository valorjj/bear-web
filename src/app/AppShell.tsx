import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import { notes } from '@/data';
import {
  ACTIVE_SCOPE,
  acceptsNewNote,
  NoteEditor,
  NoteList,
  type NoteScope,
  seedTagFor,
  SmartListSidebar,
  useNotes,
  useSmartListCounts,
} from '@/features/notes';
import { TagSidebar, type TagNode, useTagTree } from '@/features/tags';
import { useT } from '@/i18n';
import { EmptyState } from '@/ui/EmptyState';
import { Pane } from '@/ui/Pane';
import { Resizer } from '@/ui/Resizer';

import { MAX_PANE_WIDTH, MIN_PANE_WIDTH } from './paneWidths';
import { usePaneWidths } from './usePaneWidths';

export function AppShell(): ReactElement {
  const t = useT();
  const widths = usePaneWidths();

  const [scope, setScope] = useState<NoteScope>(ACTIVE_SCOPE);
  const { items, selectedNoteId, selectedNote, select } = useNotes(scope);
  const tree = useTagTree();
  const counts = useSmartListCounts();

  // The text the just-created note was seeded with, so `NoteEditor` can treat
  // it as disposable. Cleared as soon as the selection moves elsewhere.
  const [seed, setSeed] = useState<{ id: string; text: string } | null>(null);

  // Actually clears the seed once selection moves elsewhere — the state above
  // only sets it. Without this, a seed set for note A survives every later
  // selection change for the rest of the session: reopening A after editing
  // it down to exactly its tag would pass `seedText` again, `isEmpty` would
  // treat it as disposable, and the truncation guard (which only fires when
  // `editedRef` is false) would not stop the purge. `setSeed` in `handleCreate`
  // and `select(created.id)` run in the same continuation and batch together,
  // so a freshly created seed is never cleared by its own creation.
  useEffect(() => {
    if (seed !== null && selectedNoteId !== seed.id) setSeed(null);
  }, [seed, selectedNoteId]);

  // Guards against a double-click (or any other double-fire) on "New note":
  // `create` is async, and without this a second click before the first
  // `await` resolves creates a second note that never gets an editor mounted
  // to flush-and-purge it on unmount — a permanent blank `Untitled` row.
  const creatingRef = useRef(false);

  const handleCreate = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    try {
      // A note created inside a tag scope carries that tag, so it belongs to
      // the list the user is looking at. The leading newline puts the caret on
      // the title line with the tag below it.
      const tag = seedTagFor(scope);
      const seedText = tag === null ? '' : `\n#${tag}`;
      if (!acceptsNewNote(scope)) setScope(ACTIVE_SCOPE);

      const created = await notes.create(seedText);
      setSeed(seedText === '' ? null : { id: created.id, text: seedText });
      select(created.id);
    } finally {
      creatingRef.current = false;
    }
  }, [scope, select]);

  // Falls back to all notes when the selected tag stops existing — otherwise a
  // row that is no longer rendered stays selected.
  //
  // `tree.nodes === undefined` is unreachable today: `scope` starts at
  // `ACTIVE_SCOPE` and is not persisted, and the only way to select a tag
  // scope is a `TagSidebar` row, which does not render until the tree has
  // already resolved. Kept as defence in depth — persisting the selected
  // scope across reloads would make a mount-time tag scope coincide with a
  // still-loading tree, and treating that as "no tags" would eject the user
  // from their own filter. Not falsifiable by an app-level test today; see
  // the "selecting a tag does not bounce back to Notes" test in
  // `AppShell.test.tsx`, which documents why.
  useEffect(() => {
    if (scope.kind !== 'tag' || tree.nodes === undefined) return;

    const exists = (nodes: TagNode[]): boolean =>
      nodes.some((node) => node.tag === scope.tag || exists(node.children));

    if (!exists(tree.nodes)) setScope(ACTIVE_SCOPE);
  }, [scope, tree.nodes]);

  const handleTrash = useCallback(async (id: string) => {
    await notes.trash(id);
  }, []);

  const handleRestore = useCallback(async (id: string) => {
    await notes.restore(id);
  }, []);

  return (
    <main className="flex h-full w-full overflow-hidden bg-bg text-text">
      <Pane label={t('pane.sidebar')} width={widths.sidebarWidth} className="bg-sidebar">
        <div className="flex h-full flex-col overflow-y-auto">
          <SmartListSidebar scope={scope} onScopeChange={setScope} counts={counts} />
          <TagSidebar
            nodes={tree.nodes}
            scope={scope}
            onScopeChange={setScope}
            isCollapsed={tree.isCollapsed}
            onToggle={tree.toggle}
          />
        </div>
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
        {selectedNote === undefined ? null : selectedNote === null ? (
          <EmptyState title={t('editor.empty.title')} body={t('editor.empty.body')} />
        ) : (
          // `key` is load-bearing, not an optimisation: it remounts the editor
          // on every switch, so an instance only ever writes to one note and
          // its unmount cleanup is the flush-on-switch.
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            seedText={seed?.id === selectedNote.id ? seed.text : undefined}
          />
        )}
      </Pane>
    </main>
  );
}
