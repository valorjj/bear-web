import {
  lazy,
  type ReactElement,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

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
import { SessionProvider, useSessionValue, useSync } from '@/features/account';
import { ExportProgressProvider, useExportProgress, type ExportFormat } from '@/features/export';
import type { CommandDeps } from '@/features/palette/commands';
import { Pane } from '@/ui/Pane';
import { ProgressBar } from '@/ui/ProgressBar';
import { Resizer } from '@/ui/Resizer';

import { maxPaneWidth, MIN_PANE_WIDTH } from './paneWidths';
import { resolveLinkTarget } from './resolveLinkTarget';
import { SidebarContent } from './SidebarContent';
import { SidebarDrawer } from './SidebarDrawer';
import { usePaneWidths } from './usePaneWidths';
import { useScopeShortcuts } from './useScopeShortcuts';
import { useSetting } from './useSetting';
import { useTheme } from './useTheme';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * Lazy, and STRUCTURALLY so — not as an optimisation.
 *
 * `scripts/bundleSize.test.ts` caps the main bundle at 340,000 B gzipped and
 * `main` measured 337,259 B on 2026-08-31: 2,741 bytes of headroom against
 * `d3-force`'s 5.6 KB. An eager import here breaches the ceiling before any
 * first-party code counts. If that guard ever fails on this branch, something
 * has leaked across this boundary — find the leak; do not raise the number.
 */
const GraphView = lazy(() => import('@/features/graph/GraphView'));

/**
 * Lazy, and structurally so — not an optimisation.
 *
 * `scripts/bundleSize.test.ts` caps the main bundle at 340,000 B gzipped and
 * `main` measured 338,350 B after L3: 1,650 bytes of headroom. The palette,
 * its registry and its matcher do not fit. If that guard fails on this
 * branch, something leaked across this boundary — find the leak; do not raise
 * the number.
 */
const CommandPalette = lazy(() => import('@/features/palette/CommandPalette'));

export function AppShell(): ReactElement {
  const t = useT();
  const widths = usePaneWidths();

  const [scope, setScope] = useState<NoteScope>(ACTIVE_SCOPE);

  // Which surface fills the shell: the three-pane note view, or L3's graph
  // takeover. Derived nowhere else — a note stays selected underneath so
  // returning from the graph lands back where the user left off.
  const [view, setView] = useState<'notes' | 'graph'>('notes');
  const toggleGraph = useCallback(() => setView((v) => (v === 'graph' ? 'notes' : 'graph')), []);
  const closeGraph = useCallback(() => setView('notes'), []);

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

  const themeControl = useTheme();

  // Whether L4's command palette is open. A single flag: unlike `view`, the
  // palette is an overlay on top of whatever is already on screen, not a
  // surface that replaces it.
  const [paletteOpen, setPaletteOpen] = useState(false);

  // `handleExport` for the currently open note lives entirely inside
  // `NoteEditor` — it reads the LIVE editor text, not `note.text`
  // (`docs/rulings/export.md`), and that text only exists inside the mounted
  // `RichEditor`. This ref is how the palette's export command reaches it
  // from up here; `null` whenever no note is open, which is also when
  // `CommandDeps.hasOpenNote` is false and the palette never offers the
  // command in the first place.
  const exportRef = useRef<{ export: (format: ExportFormat) => void } | null>(null);

  // Holds the live `session.signOut`, kept current by `CommandPaletteHost`
  // on every render. `useSession`'s state lives in `SessionProvider`, an
  // ancestor of this component's own scope, so `AppShell` cannot call
  // `useSessionValue()` itself (see `ExportProgressBar` below for the
  // identical constraint with `useExportProgress`) — but `confirmPending`,
  // below, still needs to be able to call the real `signOut` once the user
  // confirms. A ref survives `CommandPaletteHost` unmounting (closing the
  // palette does not close the confirm dialog it opened) because the
  // function it holds belongs to `SessionProvider`, not to the host.
  const signOutRef = useRef<() => Promise<void>>(async () => {});

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

  /**
   * Every active note's id/title/updatedAt, live-queried independently of
   * `items` — `items` is filtered by the CURRENT scope, but a `[[link]]`
   * pill must resolve to its target regardless of what the sidebar happens
   * to be showing. `undefined` while the query hasn't resolved yet, handled
   * by `handleActivateLink` the same way `handleActivateTag` treats
   * `tree.nodes === undefined`: as "not yet known", never as "no notes".
   */
  const noteIndex = useLiveQuery(() => notes.listActive(), []);

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

  // The note the app just created, so its editor can take the caret.
  //
  // A SEPARATE flag from `seed`, not a reuse of it: `seed` is only set for a
  // note created inside a tag scope, and the note created outside one — the
  // common case, and exactly the one where nothing on screen moved — carries
  // no seed at all.
  //
  // Cleared the moment the selection leaves it, on the same reasoning as the
  // seed above: without this, returning to that note later in the session
  // would grab focus again for a note the user merely re-opened.
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  useEffect(() => {
    if (justCreatedId !== null && selectedNoteId !== justCreatedId) setJustCreatedId(null);
  }, [justCreatedId, selectedNoteId]);

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
      setJustCreatedId(created.id);
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

  // Answers a Mod-click on a `[[link]]` pill in the editor. Same contract as
  // `handleActivateTag` right above: returns whether it acted, so a decline
  // costs the user a navigation but never the caret.
  //
  // Deliberately a plain function, not `useCallback`, for the identical
  // reason `handleActivateTag` is: `noteIndex` is a fresh array from
  // `useLiveQuery` whenever the underlying data actually changes, and a
  // `[noteIndex]` dependency array would recompute this on every render the
  // query returns a result for anyway.
  const handleActivateLink = (title: string): boolean => {
    // `undefined` means the live query has not resolved yet — treated as
    // "not yet known", never as "no notes", the same discipline
    // `handleActivateTag` applies to `tree.nodes === undefined`.
    if (noteIndex === undefined) return false;

    const target = resolveLinkTarget(noteIndex, title);
    if (target === null) return false;

    select(target.id);
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
  // of state rather than several booleans: the dialogs are mutually exclusive
  // and separate flags could all be true at once. `trash` and `signOut` are
  // L4's: the note list trashes a note directly with no confirmation, but a
  // palette command marked `destructive` (`commands.ts`) always routes
  // through here instead of running inline.
  const [pending, setPending] = useState<
    | { kind: 'purge'; id: string }
    | { kind: 'empty' }
    | { kind: 'trash'; id: string }
    | { kind: 'signOut' }
    | null
  >(null);

  // Shared by the search shortcut and the palette's "Search notes" command —
  // both mean exactly the same thing: focus the app's own search field. The
  // browser's find would only search the rows currently in the DOM, which is
  // never what is wanted here.
  const focusSearch = useCallback(() => {
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);

  // Guarded on `pending`: `ConfirmDialog` traps focus while a destructive
  // action awaits confirmation, and stealing focus into the search field
  // would escape that trap, leaving Tab free to walk the page behind the
  // still-open modal. The palette shortcut needs the identical guard — an
  // overlay opening on top of a focus-trapped dialog would escape it exactly
  // the same way.
  useScopeShortcuts({
    onSearch: focusSearch,
    onScope: setScope,
    onGraph: toggleGraph,
    onPalette: useCallback(() => setPaletteOpen(true), []),
    // Only closes the graph while it is actually open — Escape has other
    // consumers (dialogs, menus, the sidebar drawer) that must keep working
    // when the graph isn't the thing on screen.
    onEscape: useCallback(() => {
      if (view === 'graph') closeGraph();
    }, [view, closeGraph]),
    // The `pending` guard the inline handler carried, kept and widened: it
    // stopped the search shortcut escaping `ConfirmDialog`'s focus trap, and a
    // scope shortcut would be worse still — it rearranges the list behind a
    // dialog that names a note in it.
    enabled: pending === null,
  });

  // `hasOpenNote`/`openNoteTrashed`/`openNotePinned` feed `CommandDeps`: the
  // exact three flags `buildCommands` gates the note-scoped commands on.
  // Derived from `selectedNote`, not `selectedNoteId` — the id alone can't
  // say whether the open note is trashed or pinned.
  const hasOpenNote = selectedNote != null;
  const openNoteTrashed = selectedNote?.trashedAt != null;
  const openNotePinned = selectedNote?.pinned ?? false;

  // Everything `buildCommands` needs except `t`, `hasQuery`, `signedIn` and
  // the three account handlers — those come from `CommandPaletteHost`, which
  // alone can reach `useSessionValue`/`useSync` (see `signOutRef`'s comment
  // above and `ExportProgressBar` below for the identical constraint).
  // Memoised because it feeds `buildCommands`, which runs on every keystroke
  // typed into the palette.
  const paletteBaseDeps = useMemo(
    () => ({
      t,
      hasOpenNote,
      openNoteTrashed,
      openNotePinned,
      onScope: setScope,
      onOpenGraph: toggleGraph,
      onFocusSearch: focusSearch,
      onNewNote: () => void handleCreate(),
      onDuplicateNote: () => {
        if (selectedNote != null) void handleDuplicate(selectedNote.id);
      },
      onTogglePin: () => {
        if (selectedNote != null) void handleTogglePin(selectedNote.id, !selectedNote.pinned);
      },
      // Sets `pending` rather than trashing directly — every destructive
      // palette command routes through the confirm dialog, unlike the note
      // list's own trash button.
      onTrashNote: () => {
        if (selectedNoteId !== null) setPending({ kind: 'trash', id: selectedNoteId });
      },
      onRestoreNote: () => {
        if (selectedNote != null) void handleRestore(selectedNote.id);
      },
      onEmptyTrash: () => setPending({ kind: 'empty' }),
      onExport: (format: ExportFormat) => exportRef.current?.export(format),
      onSetTheme: themeControl.setChoice,
      onSetPreviewSize: setPreviewSize,
      onSetOrder: setOrder,
      onToggleHideSubTagNotes: () => setHideSubTagNotes(!hideSubTagNotes),
    }),
    [
      t,
      hasOpenNote,
      openNoteTrashed,
      openNotePinned,
      focusSearch,
      toggleGraph,
      handleCreate,
      selectedNote,
      handleDuplicate,
      handleTogglePin,
      selectedNoteId,
      handleRestore,
      themeControl.setChoice,
      setPreviewSize,
      setOrder,
      hideSubTagNotes,
      setHideSubTagNotes,
    ],
  );

  // The title becomes an H1 line, matching how a note created from the title
  // bar of an export or a wikilink starts. The selection follows, same as
  // every other note-creating action in this file.
  const createNoteTitled = useCallback(
    async (title: string) => {
      const created = await notes.create(`# ${title}\n\n`);
      select(created.id);
      setView('notes');
    },
    [select],
  );

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
  useOverlayHistory(view === 'graph', closeGraph, 'graph');

  // The drawer only exists below desktop, so a window dragged wide with it
  // open would otherwise leave `drawerOpen` true and un-closable.
  useEffect(() => {
    if (mode === 'desktop') setDrawerOpen(false);
  }, [mode]);

  const confirmPending = useCallback(async () => {
    if (pending === null) return;
    const current = pending;
    setPending(null);
    if (current.kind === 'purge') await notes.purge(current.id);
    else if (current.kind === 'empty') await notes.emptyTrash();
    else if (current.kind === 'trash') await notes.trash(current.id);
    // `signOutRef.current` is `session.signOut`, kept live by
    // `CommandPaletteHost` — see its declaration above for why a ref, not a
    // direct call, is what reaches it from here.
    else await signOutRef.current();
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
        {view === 'graph' ? (
          <Suspense fallback={<div className="bg-canvas h-full w-full" aria-busy="true" />}>
            <GraphView
              activeId={selectedNoteId}
              onClose={closeGraph}
              onOpenNote={(id) => {
                select(id);
                setView('notes');
              }}
            />
          </Suspense>
        ) : (
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
                  onOpenGraph={toggleGraph}
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
                  <div className="flex h-14 shrink-0 items-center px-2">
                    <Button
                      variant="soft"
                      size="touch"
                      onClick={backToList}
                      label={t('nav.backToList')}
                    >
                      <Icon glyph={ChevronLeft} />
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
                    autoFocus={justCreatedId === selectedNote.id}
                    onActivateTag={handleActivateTag}
                    onActivateLink={handleActivateLink}
                    onOpenNote={select}
                    exportRef={exportRef}
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

            <CommandPaletteHost
              open={paletteOpen}
              onClose={() => setPaletteOpen(false)}
              onOpenNote={(id) => {
                select(id);
                setView('notes');
              }}
              onCreateNote={(title) => void createNoteTitled(title)}
              baseDeps={paletteBaseDeps}
              onRequestSignOut={() => setPending({ kind: 'signOut' })}
              signOutRef={signOutRef}
            />

            <ConfirmDialog
              open={pending !== null}
              destructive
              title={
                pending?.kind === 'empty'
                  ? t('confirm.emptyTrash.title')
                  : pending?.kind === 'trash'
                    ? t('confirm.trashNote.title')
                    : pending?.kind === 'signOut'
                      ? t('account.signOut.title')
                      : t('confirm.deleteForever.title')
              }
              body={
                pending?.kind === 'empty'
                  ? t('confirm.emptyTrash.body')
                  : pending?.kind === 'trash'
                    ? t('confirm.trashNote.body')
                    : pending?.kind === 'signOut'
                      ? t('account.signOut.body')
                      : t('confirm.deleteForever.body')
              }
              confirmLabel={
                pending?.kind === 'empty'
                  ? t('noteList.emptyTrash')
                  : pending?.kind === 'trash'
                    ? t('noteList.trash')
                    : pending?.kind === 'signOut'
                      ? t('account.signOut.confirm')
                      : t('noteList.deleteForever')
              }
              cancelLabel={
                pending?.kind === 'signOut' ? t('account.signOut.cancel') : t('confirm.cancel')
              }
              onConfirm={() => void confirmPending()}
              onCancel={() => setPending(null)}
            />
          </main>
        )}
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

interface CommandPaletteHostProps {
  open: boolean;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
  /** Everything `buildCommands` needs except `signedIn` and the three account handlers. */
  baseDeps: Omit<CommandDeps, 'hasQuery' | 'signedIn' | 'onSignIn' | 'onSignOut' | 'onSyncNow'>;
  /** Routes the destructive sign-out command through `AppShell`'s own confirm dialog. */
  onRequestSignOut: () => void;
  /** Kept live with `session.signOut`, for `AppShell.confirmPending` to call once confirmed. */
  signOutRef: RefObject<() => Promise<void>>;
}

/**
 * Split out for the identical reason `ExportProgressBar` is: `useSessionValue`
 * and `useSync` can only be called by a component INSIDE `SessionProvider`'s
 * own subtree, and `AppShell` is that provider's ancestor, not its
 * descendant.
 *
 * Always mounted, never gated on `open` — unlike `CommandPalette` itself,
 * which already returns `null` while closed. Keeping this host mounted keeps
 * `signOutRef` current even while the palette is closed: choosing "Sign out"
 * closes the palette immediately (`CommandPalette.choose` calls `onClose`)
 * but leaves the confirm dialog open, and that confirm can be answered long
 * after this host would otherwise have unmounted.
 */
function CommandPaletteHost({
  open,
  onClose,
  onOpenNote,
  onCreateNote,
  baseDeps,
  onRequestSignOut,
  signOutRef,
}: CommandPaletteHostProps): ReactElement | null {
  const session = useSessionValue();
  const sync = useSync(session.state);
  const signedIn = session.state.status === 'signedIn';

  // Assigned during render, not in an effect: the ref only needs to hold the
  // LATEST function by the time it is read (from `confirmPending`, after the
  // user answers a confirm dialog), never to react to the assignment itself.
  signOutRef.current = session.signOut;

  const deps = useMemo<Omit<CommandDeps, 'hasQuery'>>(
    () => ({
      ...baseDeps,
      signedIn,
      onSignIn: session.signIn,
      onSignOut: onRequestSignOut,
      onSyncNow: sync.syncNow,
    }),
    [baseDeps, signedIn, session.signIn, onRequestSignOut, sync.syncNow],
  );

  if (!open) return null;

  return (
    <Suspense fallback={null}>
      <CommandPalette
        open
        onClose={onClose}
        deps={deps}
        onOpenNote={onOpenNote}
        onCreateNote={onCreateNote}
      />
    </Suspense>
  );
}
