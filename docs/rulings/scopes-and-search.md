# Scopes, smart lists, and search

Governs how a `NoteScope` selects the note list, how the seven builtin smart
lists are defined and counted, and how the search query filters and highlights
that list without ever becoming part of the query itself.

**Trigger:** any change to `src/features/notes/scope.ts` (`NoteScope`,
`SMART_LIST_IDS`, `scopeKey`, `isTrash`, `allowsTrash`, `acceptsNewNote`,
`seedTagFor`, `listForScope`, `ScopeQuery`), `src/data/order.ts` (`NoteOrder`,
`compareNotes`, `isNoteOrder`), `src/features/notes/ScopeMenu.tsx`,
`src/app/useSetting.ts`, `smartLists.ts` (`UNCHECKED_TASK`,
`SMART_LIST_PREDICATES`), `useNotes.ts`, `useSmartListCounts.ts`, `search.ts`
(`findMatchRanges`, `filterByQuery`, `normalizeForSearch`), `HighlightedText.tsx`,
`NoteList.tsx`'s `emptyTrashDisabled`/`hasUnfilteredItems` props,
`src/ui/ConfirmDialog.tsx`, or the `scope`/`query`/`seed` state and the
vanished-tag effect in `src/app/AppShell.tsx`.

- **`NoteScope` is an object union, so every `useLiveQuery` keyed on it uses
  `scopeKey`, never the object.** An object literal has a fresh identity every
  render; passing it as a dependency is an unbounded refetch loop. `ACTIVE_SCOPE`
  and `TRASHED_SCOPE` are module constants for the same reason. The only call
  site that can falsify this is `useNotes.test.tsx`'s refetch test, which needs
  an explicit effect flush to observe anything.

- **Widening a two-armed union to three is not a safe default when logic is
  gated with `===`.** `NoteScope` grew a `tag` arm; `NoteList`'s Trash button
  stayed gated on `scope.kind === 'active'`, which was total over the old two
  scopes and silently became partial — a tag scope rendered neither Trash nor
  Restore, so a note filtered to `#work` had no delete affordance at all, and
  no test covered the missing third arm. Gate the total case (`!== 'trashed'`)
  rather than enumerating the arms that should pass, and add a test for the
  new arm whenever a union grows.

- **A tag filter never deselects the open note.** `useNotes` reconciles on
  trash state alone. Deselecting on tag membership would pull the editor out
  from under someone deleting a hashtag — or merely typing `#wo` on the way to
  `#work`.

- **The vanished-tag fallback must not fire while the tag tree is loading.**
  `useTagTree` returns `nodes: undefined` before its live query resolves, and
  `AppShell`'s effect returns early on it. Treating `undefined` as "no tags"
  ejects the user from their own filter on every unrelated edit. **This loading
  guard is currently unreachable in the shipped app** — `scope` starts at
  `ACTIVE_SCOPE` and is not persisted, so nothing selects a tag before the tree
  has resolved once. It is kept as defence in depth against a future persisted
  scope, not because it is load-bearing today; it has no falsifying app-level
  test. `AppShell.handleActivateTag` makes the same `undefined` ruling for the
  same reason.

- **`NoteScope` has two arms permanently, and every behavioural question is a
  named capability function.** Adding a smart list is a row in
  `SMART_LIST_IDS`, never a union arm and never a `scope.kind` comparison at a
  call site. `scope.test.ts` asserts capabilities exhaustively over
  `SmartListId`, so a new list without a ruling fails the suite. This is the
  defence against the M5 defect where a widened union silently removed the
  delete affordance from tag scopes.

- **The Todo predicate's test fixture is derived from the editor's own
  serializer, never hand-written.** `smartLists.test.ts` builds it with
  `normalizeMarkdown` (`parseMarkdown` then `serializeMarkdown`, the single
  `@tiptap/markdown` importer). The parent spec writes the rule as "contains an
  unchecked `- [ ]`", which is an assumption about our own output. Our
  serializer emits `- [ ]` and normalizes `* [ ]` to it, but that is a fact
  about the serializer, not a licence to hardcode it.

- **`UNCHECKED_TASK` must not carry the `g` flag.** A global regex keeps
  `lastIndex` between `.test()` calls, so a module-level constant reused per
  note alternates true and false on identical input and drops roughly half the
  matching notes.

- **`UNCHECKED_TASK` matches `-`, `*` and `+` bullets** because `importDatabase`
  accepts arbitrary Markdown and a note is only canonical once it has been
  through the editor. A checkbox the user can see must not be invisible until
  they open the note.

- **A task inside a fenced code block counts as a todo.** Accepted: masking
  code spans lives in `parseTags` in the data layer, and duplicating it for one
  smart list is not worth a second copy.

- **Only `untagged` reads the tag index in `listForScope`.** `allTagRows` is a
  full table scan; paying for it on every scope switch would double the work
  for six of the seven builtins. The `NEEDS_TAG_INDEX` set is what states this,
  so a future predicate reading `ctx.tagged` must be added to it.

- **All seven sidebar counts come from one live query.** `useSmartListCounts`
  awaits `listActive`, `listTrashed` and `allTagRows` together inside a single
  `useLiveQuery` and derives every row from that one snapshot. Seven
  independent queries would let rows land in seven different frames — the
  mechanism behind M5's collapsed-tag flash — and would let untagged plus
  tagged disagree with all. Its deps are constant `[]`, so the tag-and-verify
  pattern deliberately does not apply. **This property is documented but not
  enforced.** Splitting it into two `useLiveQuery` calls leaves every test green
  — jsdom resolves fast enough that the race never surfaces. Catching a
  regression would need injected staggered resolution: mock `notes.listActive`
  and `notes.allTagRows` with different delays and assert the hook never
  renders a transient state where untagged plus tagged disagrees with all.
  Same mechanism as M5's collapsed-tag flash, so it is a real property, just
  an expensive one to pin.

- **`useSmartListCounts` returns `undefined` while loading, never a
  zero-filled object.** Zeros render as "empty" rather than "not known yet".

- **Pinned notes sort first in every list except Trash.** `byPinnedThenRecent`
  lives in the repository, so it applies to `listByTag` as well as
  `listActive`; `listTrashed` orders by deletion time instead, because a pinned
  note deleted earlier is not more important than one deleted later. `pinned`
  stays unindexed — IndexedDB rejects boolean keys.

- **`ConfirmDialog` focuses Cancel on open.** These guard irreversible deletion
  with no server copy, and an Enter keypress already in flight must not
  destroy anything. Cancel is therefore FIRST in DOM order — that is what the
  mount effect focuses and what the Tab-wrap arithmetic treats as `first`, so
  reordering the two buttons changes which one an in-flight Enter activates.
  `window.confirm` was rejected: it ignores the theme, and
  some embedded contexts suppress it silently, turning a guarded delete into
  an unguarded one. **The focus trap queries `'button'` specifically, which is
  a gap, not a guarantee.** Any future non-button focusable inside the dialog —
  a link, an input — is invisible to both the initial-focus effect and the
  Tab-wrap arithmetic, so it would be skipped by the trap rather than held at
  its edge. Harmless today with exactly two buttons; widen to a standard
  focusable selector the moment a third element is added.

- **Today does not roll over at midnight.** A note edited at 23:59 stays in
  Today until something else re-runs the query. A timer whose only job is to
  move one row is not worth a live subscription.

- **Search is a filter over the list a scope produced, never a `NoteScope`
  arm and never inside a `useLiveQuery`.** Two properties depend on the
  placement. A third arm would reopen the M5 defect where a widened union
  silently made every `===` gate partial. And putting `query` in a
  `useLiveQuery` dependency array would hand search the documented
  previous-deps-for-one-tick behaviour, rendering the previous query's
  results for a frame on every keystroke. `AppShell` applies
  `filterByQuery` to `useNotes`' output, and `useNotes` is untouched.
  `filterByQuery` passes `undefined` through untouched for the same reason —
  collapsing "not loaded yet" to `[]` would render "no matches" on the first
  frame of every load.

- **`findMatchRanges` returns indices into `text.normalize('NFC')`, not into
  `text`.** NFC changes string length, so Hangul offsets computed on one form
  do not address the other; `HighlightedText` renders the normalized string
  for exactly this reason. It also returns `[]` rather than shifted ranges
  when `.toLowerCase()` changes length (`'İ'` folds to two code units) —
  losing a highlight is acceptable, marking the wrong characters is not.
  Matching uses `indexOf`, not `RegExp`, so metacharacters are literal with
  no escaping step to get wrong.

- **Creating a note clears the query.** A new note is empty and matches no
  non-empty query, so it would be created invisible — the same defect
  `acceptsNewNote` solves for scopes, with the same resolution. Switching
  scope deliberately does NOT clear it, which is why the no-results empty
  state has its own copy naming the query as the cause.

- **A query never deselects the open note**, for the same reason a tag filter
  never does: the filter runs outside `useNotes`, which still reconciles on
  trash state alone.

- **`NoteList` takes explicit `emptyTrashDisabled` and `hasUnfilteredItems`
  props, and BOTH are supplied from the UNFILTERED note list.** Gating "Empty
  trash" on the filtered list meant a fruitless search while viewing Trash
  disabled emptying a full trash — the button read "disabled" for a reason that
  had nothing to do with whether Trash actually had anything in it. Emptying
  ignores the query anyway, as the dialog copy says. `hasUnfilteredItems`
  answers the sibling question by the same rule: whether the no-results empty
  state may override a scope's own special-cased empty copy (Locked, Trash)
  depends on whether the scope held anything before the query narrowed it.

- **Ordering is a repository argument, and is never re-sorted downstream.**
  `listActive` and `listByTag` take a `NoteOrder`; `listForScope` passes it
  through and returns the result in the order it arrived. The only
  transformation it applies is the smart list's predicate filter, which
  preserves order. Applying a comparator in `listForScope`, in `useNotes` or in
  `NoteList` would split ownership of row order across two layers — the shape
  that produced the pinned-everywhere bug the original ruling was written
  against — and sorting in the component would put ordering downstream of the
  search filter, silently reordering only the visible subset.
  `scope.test.ts`'s "preserves the repository order" test is what catches a
  reversal: a repository returning C, A, B under a title sort must still yield
  C, A, B.

- **The pinned partition is applied first under every order.** `byPinnedThen`
  splits on `pinned` and only then applies the user's comparator, so the chosen
  order is a tiebreaker WITHIN each partition and can never lift an unpinned
  note above a pinned one. Otherwise pinning would stop meaning what the Pinned
  smart list means.

- **Trash keeps `trashedAt` ordering, and the menu says so.** `listTrashed`
  deliberately takes no `NoteOrder`; deletion time is not one of the three
  fields, and inventing a fourth implicit field for one scope is worse than the
  exception. `ScopeMenu` renders the sort group `disabled` there **with copy
  naming the reason** — a control disabled for a reason the user cannot see is
  the defect B1 rejected the pane-width threshold over.

- **Sort and preview density are GLOBAL preferences, not per-scope.** Two
  `settings` rows (`noteOrder`, `previewSize`), plus `hideSubTagNotes`. Keying
  them by `scopeKey()` was rejected on a concrete cost: tag scopes are
  unbounded, so per-scope rows accumulate one per tag ever visited with nothing
  to prune them when a tag stops existing.

- **`useSetting` holds an optimistic value, and that is load-bearing.** Reads
  after a write must see the write: two menu clicks in quick succession each
  derive their new value from the RENDERED one, so choosing "Title" and then
  flipping "Newest first" wrote `{field: 'title'}` and then, from a still-stale
  render, `{field: 'updated', newestFirst: false}` — silently discarding the
  field just chosen. This is the same fire-and-forget window `usePaneWidths`
  documents. It also guards on read, because `compareNotes` switches
  exhaustively and a row from a future version would fall through every arm.

  **It also re-issues its last written value from `useFlushTriggers`.** The
  write is `void settings.set(...)` — issued, not awaited — so choosing a
  preference and reloading immediately can lose it. That is the same window
  `usePaneWidths` carried as a deferred ruling until it was resolved by exactly
  this route, and the claim that a click's write needed no flush (made in A's
  spec and in this hook's first docblock) was simply wrong.

  **A Playwright test that changes a preference and reloads must wait for the
  write to reach IndexedDB first**, via `waitForSetting` in
  `e2e/noteListHeader.spec.ts`. The DOM cannot tell you: the optimistic value
  makes the list read as committed before the write lands. `smoke.spec.ts`
  reads IndexedDB directly against `usePaneWidths` for the identical reason.
  Without that wait the density test failed roughly one run in ten.

- **`ScopeMenu`'s scope rows are generated from `SMART_LIST_IDS`, never hand-
  listed.** M6 deleted `ScopeSidebar` precisely because it hardcoded its rows.
  A second surface listing the same scopes must not reintroduce the
  registry-grown-row-by-row shape; adding a builtin stays a one-line change in
  `scope.ts`.

- **`useNotes` folds the view preferences into its live-query key.** The
  tag-and-verify guard must reject a list fetched under the previous sort for
  exactly the reason it rejects one fetched under the previous scope: rendering
  the order the user just asked to change is worse than rendering "still
  loading".
