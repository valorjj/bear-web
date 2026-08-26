import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DEFAULT_NOTE_ORDER, isNoteOrder, type NoteOrder, notes } from '@/data';
import {
  ACTIVE_SCOPE,
  acceptsNewNote,
  DEFAULT_PREVIEW_SIZE,
  isPreviewSize,
  type PreviewSize,
  filterByQuery,
  NoteEditor,
  NoteList,
  type NoteScope,
  seedTagFor,
  tagScope,
  useNotes,
  useSmartListCounts,
} from '@/features/notes';
import { hasTag, useTagTree } from '@/features/tags';
import { useT } from '@/i18n';
import { useLayoutMode } from '@/lib/useLayoutMode';
import { useOverlayHistory } from '@/lib/useOverlayHistory';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { EmptyState } from '@/ui/EmptyState';
import { ChevronLeft, Icon } from '@/ui/Icon';
import { SessionProvider } from '@/features/account';
import { ExportProgressProvider, useExportProgress } from '@/features/export';
import { Pane } from '@/ui/Pane';
import { ProgressBar } from '@/ui/ProgressBar';
import { Resizer } from '@/ui/Resizer';

import { maxPaneWidth, MIN_PANE_WIDTH } from './paneWidths';
import { SidebarContent } from './SidebarContent';
import { SidebarDrawer } from './SidebarDrawer';
import { usePaneWidths } from './usePaneWidths';
import { useScopeShortcuts } from './useScopeShortcuts';
import { useSetting } from './useSetting';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

export function AppShell(): ReactElement {
  const t = useT();
  const widths = usePaneWidths();

  const [scope, setScope] = useState<NoteScope>(ACTIVE_SCOPE);

  const [order, setOrder] = useSetting<NoteOrder>('noteOrder', DEFAULT_NOTE_ORDER, isNoteOrder);
  const [previewSize, setPreviewSize] = useSetting<PreviewSize>(
    'previewSize',
    DEFAULT_PREVIEW_SIZE,
    isPreviewSize,
  );
  const [hideSubTagNotes, setHideSubTagNotes] = useSetting<boolean>(
    'hideSubTagNotes',
    false,
    isBoolean,
  );

  // Memoised because it feeds `useNotes`' live-query dependency chain. A fresh
  // object identity per render is the same defect `ACTIVE_SCOPE` exists to
  // avoid for scopes.
  const scopeQuery = useMemo(
    () => ({ order, includeDescendants: !hideSubTagNotes }),
    [order, hideSubTagNotes],
  );

  const { items, selectedNoteId, selectedNote, select } = useNotes(scope, scopeQuery);
  const tree = useTagTree();
  const counts = useSmartListCounts();

  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  // Filtering happens HERE, outside `useNotes`, and that placement is the
  // whole design. Inside, `query` would join a `useLiveQuery` dependency
  // array, and this project has a reproduced rule that `useLiveQuery` returns
  // the previous deps' value for one tick after a deps change — so the list
  // would render the previous query's results for a frame on every keystroke.
  const visibleItems = useMemo(() => filterByQuery(items, query), [items, query]);

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

      // A new note is empty and matches no query, so it would be created
      // invisible. Same defect `acceptsNewNote` solves for scopes, same fix:
      // the action that creates the note moves the view to where it exists.
      setQuery('');

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
    if (!hasTag(tree.nodes, scope.tag)) setScope(ACTIVE_SCOPE);
  }, [scope, tree.nodes]);

  // Answers a Mod-click on a tag pill in the editor. Deliberately a plain
  // function, not `useCallback`: `useTagTree` returns a fresh `tree` object
  // every render (see its own comment on why `nodes` is memoized but the
  // returned object as a whole is not), so a `[tree]` dependency array would
  // recompute this on every render anyway — `useCallback` here would read as
  // memoization while providing none.
  //
  // Returns whether it acted. That answer is what the plugin gates
  // `preventDefault()` on, so declining here costs the user a filter but not
  // the caret: a Mod-click either filters, or behaves exactly like a plain
  // click. Never nothing.
  const handleActivateTag = (tag: string): boolean => {
    // `undefined` means the live query has not resolved. Treating it as "no
    // tags" would make activation silently fail on a slow first paint — the
    // same mistake the vanished-tag effect above already guards against.
    if (tree.nodes === undefined) return false;

    // M7.6 ships two documented classes of pill whose tag is not in the
    // index (a tag ending link text, and a mark over leading whitespace).
    // Setting a scope for one would trip the vanished-tag effect above and
    // bounce the user to All Notes — a click that visibly throws them
    // somewhere they did not ask to go. Doing nothing is the honest answer.
    //
    // A tag typed within the last ~350 ms lands here too: the index is
    // written by autosave, so it has not been written yet. That case is why
    // this must report its refusal rather than let the plugin swallow the
    // event — the tag exists, it is simply not saved, and the user gets the
    // caret they would have got from a plain click instead of silence.
    if (!hasTag(tree.nodes, tag)) return false;

    setScope(tagScope(tag));
    tree.reveal(tag);
    return true;
  };

  const handleTrash = useCallback(async (id: string) => {
    await notes.trash(id);
  }, []);

  const handleRestore = useCallback(async (id: string) => {
    await notes.restore(id);
  }, []);

  const handleTogglePin = useCallback(async (id: string, pinned: boolean) => {
    await notes.setPinned(id, pinned);
  }, []);

  // The copy becomes the selection, the same as a newly created note does.
  // Duplicating and then having to find the copy in a list ordered by date
  // would be a worse answer than the user asking for a copy implies.
  //
  // No `seed`: unlike `handleCreate`, a duplicate is never empty (it holds
  // the source's text), so the blank-note purge has nothing to reclaim and
  // there is no seeded text for `NoteEditor` to scope its discard to.
  const handleDuplicate = useCallback(
    async (id: string) => {
      const copy = await notes.duplicate(id);
      select(copy.id);
    },
    [select],
  );

  // Which destructive action is awaiting confirmation, if any. A single piece
  // of state rather than two booleans: the two dialogs are mutually exclusive
  // and two flags could both be true.
  const [pending, setPending] = useState<{ kind: 'purge'; id: string } | { kind: 'empty' } | null>(
    null,
  );

  // Cmd/Ctrl+F focuses the app's own search. The browser's find would only
  // search the rows currently in the DOM, which is never what is wanted here.
  // Guarded on `pending`: `ConfirmDialog` traps focus while a destructive
  // action awaits confirmation, and stealing focus into the search field
  // would escape that trap, leaving Tab free to walk the page behind the
  // still-open modal.
  useScopeShortcuts({
    onSearch: useCallback(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    }, []),
    onScope: setScope,
    // The `pending` guard the inline handler carried, kept and widened: it
    // stopped the search shortcut escaping `ConfirmDialog`'s focus trap, and a
    // scope shortcut would be worse still — it rearranges the list behind a
    // dialog that names a note in it.
    enabled: pending === null,
  });

  const mode = useLayoutMode();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // DERIVED, never stored. A stored screen can disagree with the selection —
  // an editor showing no note, a note open behind a list — and nothing makes
  // those states unreachable. Deriving makes them unrepresentable, and every
  // existing transition then does the right thing without a rule of its own:
  // creating a note selects it so the editor opens; trashing clears the
  // selection so the list returns; back clears it so the blank-note reclaim
  // runs exactly as it does on desktop.
  //
  // From `selectedNoteId`, NOT `selectedNote`: `useNotes` routes every
  // selection change through a transient `undefined` on the note OBJECT
  // (`docs/rulings/notes-lifecycle.md`), so a screen derived from the object
  // would flicker back to the list mid-switch. The id does not do that.
  const phoneScreen = selectedNoteId === null ? 'list' : 'editor';

  const showSidebarPane = mode === 'desktop';
  const showNoteListPane = mode !== 'phone' || phoneScreen === 'list';
  const showEditorPane = mode !== 'phone' || phoneScreen === 'editor';

  const backToList = useCallback(() => select(null), [select]);
  useOverlayHistory(mode === 'phone' && phoneScreen === 'editor', backToList, 'editor');

  // The drawer only exists below desktop, so a window dragged wide with it
  // open would otherwise leave `drawerOpen` true and un-closable.
  useEffect(() => {
    if (mode === 'desktop') setDrawerOpen(false);
  }, [mode]);

  const confirmPending = useCallback(async () => {
    if (pending === null) return;
    setPending(null);
    if (pending.kind === 'purge') await notes.purge(pending.id);
    else await notes.emptyTrash();
  }, [pending]);

  return (
    // Outermost: the loader is global chrome, unrelated to the session
    // context nested inside it. `NoteEditor`, several panes down, begins the
    // export and needs to reach the SAME provider instance the top bar
    // reads — see `ExportProgressContext`'s docblock for why this has to be
    // a shared ancestor rather than state local to either side.
    <ExportProgressProvider>
      <ExportProgressBar />
      <SessionProvider>
        <main className="bg-canvas text-text flex h-full w-full gap-2 overflow-hidden p-2">
          {showSidebarPane && (
            <Pane
              label={t('pane.sidebar')}
              width={widths.sidebarWidth}
              // Not a card: in Soft Depth the sidebar dissolves into the ground and
              // only the panes holding content float. Its `--bear-sidebar` equals
              // `--bear-canvas` in the indigo themes for the same reason.
              elevated={false}
              className="bg-sidebar flex flex-col overflow-hidden"
            >
              <SidebarContent
                scope={scope}
                onScopeChange={setScope}
                counts={counts}
                nodes={tree.nodes}
                isCollapsed={tree.isCollapsed}
                onToggle={tree.toggle}
              />
            </Pane>
          )}

          {/*
            Not RENDERED below desktop, not hidden. `Resizer` is a focusable
            `separator` carrying `aria-valuenow`; `display: none` would take it
            off the screen while leaving it in the tab order and in the
            accessibility tree, which is worse than either showing it or not
            building it.

            `maxPaneWidth` closes a pre-existing bug: each pane used to be
            clamped to 160..560 with no knowledge of the viewport, so both
            panes dragged wide in a 1024px window left the editor a NEGATIVE
            width.
          */}
          {showSidebarPane && (
            <Resizer
              label={t('resizer.sidebar')}
              width={widths.sidebarWidth}
              min={MIN_PANE_WIDTH}
              max={maxPaneWidth(window.innerWidth, widths.noteListWidth)}
              onResize={widths.onSidebarResize}
              onCommit={widths.onSidebarCommit}
            />
          )}

          {showNoteListPane && (
            <Pane
              label={t('pane.noteList')}
              // `undefined` makes a Pane `flex-1`. On a phone the list IS the
              // screen, so it fills. On a tablet it keeps its stored width and
              // only the editor flexes — two `flex-1` panes would split the
              // screen in half and give a 400px list beside a 400px editor.
              width={mode === 'phone' ? undefined : widths.noteListWidth}
              className="bg-surface"
            >
              <NoteList
                scope={scope}
                items={visibleItems}
                selectedNoteId={selectedNoteId}
                onSelect={select}
                onCreate={() => void handleCreate()}
                onTrash={(id) => void handleTrash(id)}
                onRestore={(id) => void handleRestore(id)}
                onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}
                onPurge={(id) => setPending({ kind: 'purge', id })}
                onDuplicate={(id) => void handleDuplicate(id)}
                onEmptyTrash={() => setPending({ kind: 'empty' })}
                // Gated on the UNFILTERED `items`, not `visibleItems`: a query that
                // matches nothing in a full trash must not disable the button that
                // empties it. Emptying always empties every trashed note regardless
                // of the query — the dialog copy already says so — so what it
                // needs to know is whether the trash itself is empty, not whether
                // the current search happens to show anything.
                emptyTrashDisabled={items === undefined || items.length === 0}
                // Same reasoning, same source (the UNFILTERED `items`): whether the
                // no-results empty state may override a scope's own special-cased
                // empty copy (Locked, Trash) depends on whether the scope had
                // anything before the query narrowed it, not on the narrowed view.
                hasUnfilteredItems={items !== undefined && items.length > 0}
                count={items?.length ?? 0}
                scopeQuery={scopeQuery}
                previewSize={previewSize}
                onOrderChange={setOrder}
                onPreviewSizeChange={setPreviewSize}
                // The menu reports the new `includeDescendants`; the setting stores
                // its inverse, so exactly one place does the flip.
                onIncludeDescendantsChange={(next) => setHideSubTagNotes(!next)}
                onScopeChange={setScope}
                mode={mode}
                onOpenDrawer={() => setDrawerOpen(true)}
                query={query}
                onQueryChange={setQuery}
                searchInputRef={searchRef}
              />
            </Pane>
          )}

          {showSidebarPane && (
            <Resizer
              label={t('resizer.noteList')}
              width={widths.noteListWidth}
              min={MIN_PANE_WIDTH}
              max={maxPaneWidth(window.innerWidth, widths.sidebarWidth)}
              onResize={widths.onNoteListResize}
              onCommit={widths.onNoteListCommit}
            />
          )}

          {showEditorPane && (
            <Pane label={t('pane.editor')} className="bg-bg flex flex-col">
              {/*
                The phone's only route back to the list. On desktop and tablet
                the list is still on screen, so there is nothing to go back to
                and a back control would be a lie.

                It is also where focus lands when the screen opens — a screen
                swap has no `Dialog`-style focus restore, so without a real
                control here a screen-reader user is left parked on a row that
                is no longer rendered.
              */}
              {mode === 'phone' && selectedNote != null && (
                <div className="border-border flex h-9 shrink-0 items-center border-b px-1">
                  <Button variant="ghost" onClick={backToList} label={t('nav.backToList')}>
                    <Icon glyph={ChevronLeft} size="sm" />
                  </Button>
                </div>
              )}
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
                  onActivateTag={handleActivateTag}
                />
              )}
            </Pane>
          )}

          {mode !== 'desktop' && (
            <SidebarDrawer
              open={drawerOpen}
              onClose={closeDrawer}
              scope={scope}
              onScopeChange={setScope}
              counts={counts}
              nodes={tree.nodes}
              isCollapsed={tree.isCollapsed}
              onToggle={tree.toggle}
            />
          )}

          <ConfirmDialog
            open={pending !== null}
            destructive
            title={
              pending?.kind === 'empty'
                ? t('confirm.emptyTrash.title')
                : t('confirm.deleteForever.title')
            }
            body={
              pending?.kind === 'empty'
                ? t('confirm.emptyTrash.body')
                : t('confirm.deleteForever.body')
            }
            confirmLabel={
              pending?.kind === 'empty' ? t('noteList.emptyTrash') : t('noteList.deleteForever')
            }
            cancelLabel={t('confirm.cancel')}
            onConfirm={() => void confirmPending()}
            onCancel={() => setPending(null)}
          />
        </main>
      </SessionProvider>
    </ExportProgressProvider>
  );
}

/**
 * Split out so `useExportProgress()` can be called from inside the provider
 * `AppShell` itself renders — a component cannot read a context it is in the
 * middle of establishing in its own return statement.
 */
function ExportProgressBar(): ReactElement {
  const t = useT();
  const { pending } = useExportProgress();
  return <ProgressBar label={t('export.progress.label')} active={pending} />;
}
