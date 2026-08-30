# Deferred, with a ruling

The standing set of things this project knows about and has deliberately chosen
not to do yet, each with the reasoning that justified deferring it — real, not
forgotten. Historically titled "Carried into M5b and M6"; the list has outlived
those milestones. Full reasoning lives in the per-milestone ledgers
(`.superpowers/sdd/2026-08-08-m3-notes/progress.md`,
`.superpowers/sdd/2026-08-09-m4-editor/progress.md`,
`.superpowers/sdd/2026-08-10-m5-tags/progress.md`; M5.5's ledger is gitignored
and not carried forward — the items below are what survived it). Items resolved
since are struck rather than deleted, so a reader can see the ruling was retired
on purpose.

**Trigger:** open this when planning a milestone — fold these in rather than
rediscovering them — and before touching any subsystem named here: pane-width
persistence, `NoteEditor`'s seed/discard logic, `AppShell`'s confirm handlers,
the tag tree and tag pills, the note-list header, the editor typography tokens,
theme palettes, or the Playwright pointer-drag tests. A deferral you disagree
with is not resolved; only code can retire one.

- **A tag pill has no keyboard activation, deliberately.** Making a span inside
  a contenteditable focusable fights the editor for the selection and for Tab,
  and the tag sidebar is already a complete keyboard route to every filter.
  Recorded as a ruling rather than an omission.
- ~~**The note list has no header naming the current scope.** Bear has one. The
  only on-screen indication of an active filter is the `aria-current` sidebar
  row, which is why activation reveals collapsed ancestors. `NoteList`'s header
  strip holds action buttons and the search field only; it names nothing. Still
  open past M8 and M9a.~~ **Resolved by A** (2026-08-21). The strip now opens
  with a chevron button naming the scope — a smart list's translated label, or
  the raw tag — which also opens the options menu. Two things worth carrying
  forward from how it landed: its accessible name is `List options: {scope}`,
  NOT the bare scope name, because the sidebar already has a row called
  "Notes" and two controls sharing an accessible name is ambiguous to anyone
  reaching for either; and the count it shows comes from the UNFILTERED scope
  list, the same distinction `emptyTrashDisabled` and `hasUnfilteredItems`
  already draw.
- Tag rename and delete are still carried from M5b and unscheduled. So is
  syntax-visibility toggling — M5's original three-item list named it
  alongside the inline mark and rename/delete; M7.6 ruled only on the inline
  mark (a decoration, not a mark), and the toggle itself remains unimplemented
  and unscheduled.
- ~~**`usePaneWidths` writes `void settings.set(...)` with no flush**, so
  dragging a separator and reloading immediately can lose the width. Deferred
  because it costs a pane width rather than note content, and because
  `useAutosave` now has the general `beforeunload`/`visibilitychange` flush pair
  that should be extracted and shared rather than duplicated one-off.~~
  **Resolved**, and by exactly the route the ruling prescribed rather than a
  one-off: the flush pair was extracted to `src/lib/useFlushTriggers.ts`, and
  `usePaneWidths` now tracks the last committed width in a `lastCommitted` ref
  and re-issues both writes from `useFlushTriggers`. The commit write is still
  fire-and-forget; the redundant re-issue on flush is what closes the window.
- **The keyed-remount rule (`key={note.id}`) is currently unfalsifiable at the
  app level.** Removing the key from `AppShell`'s render of `NoteEditor` left
  all 14 pre-M4 e2e tests green: `useNotes` routes every selection change
  through a transient `undefined`, which unmounts/remounts `NoteEditor`
  independently of the key, masking its removal. Reproduced identically on the
  pre-Tiptap textarea, so this is pre-existing, not a Tiptap regression. The key
  is not wrong — it is defence in depth whose own app-level test cannot fail. A
  future milestone touching `useNotes`' selection handling should either close
  this gap or record why it remains open. (`AppShell.test.tsx` does carry a test
  named for this — "shows each note's own text after switching" — but it is the
  one the gap is about: it passes with or without the key, because the transient
  `undefined` remounts anyway.)
- **A tag tree row's own count and its children resolve as two independent live
  queries.** `useTagTree` runs `notes.allTagRows()` and `tags.allMeta()`
  separately, so a previously-collapsed row can flash open for a frame before
  the collapsed-state query lands, and a rapid double-toggle click collapses to
  one logical toggle rather than two (it converges, so no test currently fails
  on it). Cheap to fix by joining the queries; not done because M5 had no user
  complaint to point at.
- **A tag key of `''`, or one with a leading slash, would vanish from the tree
  entirely** — not merely mis-parented, its note disappears from every list.
  `buildTagTree` still splits on `/` with no empty-segment guard. Unreachable
  today because the TDD-pinned `parseTags` grammar never emits such a key, but a
  one-line defensive skip would be cheap insurance against a future parser
  change reopening a data-loss-shaped bug.
- **`NoteEditor`'s seed-vs-editor-reading comparison would be sturdier if it
  captured the mounted editor's own text at mount** when `note.text === seedText`,
  the way the general autosave-seed rule already does, rather than trusting
  `seedText` and the editor to agree. `isEmpty` still compares the editor's
  reading against a separately-normalized `seedText`. Not reshaped at M5's end
  because the current failure mode is fail-safe (a stray note lingers, nothing
  is deleted), unlike the manager/schema divergence that motivated the general
  rule.
- **All five editor typography tokens are wired and guarded, but none has a
  slider.** M7.5 wired `--bear-font-size` and `--bear-line-height`; M8 set
  `--bear-line-width` to its measured value and wired the last two
  (`--bear-para-spacing`, `--bear-para-indent`) as additive, with a test that
  drives each from the page. The CSS half is fully closed. **The UI half is
  still open**: there is no `type="range"` anywhere in `src/`, and
  `src/features/appearance/` holds only the M9a theme picker. Bear exposes
  exactly these five as sliders plus three font pickers, which is the shape the
  panel should take — see the typography table in
  `docs/design/DESIGN-bear-web.md`. The theme picker is the natural surface to
  grow it on.
- **`confirmPending` in `AppShell` clears its state and then awaits with no
  `try`/`catch`.** A rejected `purge` or `emptyTrash` closes the dialog and
  leaves the user believing the deletion succeeded. This matches the four
  sibling handlers (`handleTrash`, `handleRestore`, `handleTogglePin`,
  `handleCreate`), so it is a house pattern rather than a regression — but it
  is the worst place in the app for it, because the action is destructive,
  irreversible, and has no copy anywhere else. Worth raising to must-fix when
  a milestone adds any error surface.
- **The `current === undefined` half of `NoteEditor`'s `discard` condition is
  untested.** Removing it leaves that file's suite green. It exists so a
  double-discard is a no-op rather than a `TypeError`; `notes.purge` of a
  missing id is already a documented no-op, so the consequence is small — but
  a regression there would pass CI silently.
- **An intermittent unit flake in `NoteEditor.test.tsx`'s "purges a seeded note
  the user typed into and then deleted back to the seed" — OPEN, observed
  during A on 2026-08-21.** Seen twice in roughly twenty full `npm test` runs,
  never in isolation (8/8 clean running that file alone, and 20+ clean full
  runs afterwards, so the assertion message was never captured). It did NOT
  appear on `main` across six full runs at the time, so A's ~81 extra tests are
  what surface it, not what break it: nothing in A touches `NoteEditor`, the
  autosave path, or the seed/discard logic.

  The likely mechanism is contention against a test the file itself already
  documents as timing-sensitive — its two `userEvent.type` calls are split
  precisely because jsdom's selection tracking reports a stale `anchorOffset`
  after `TagPill`'s decoration redraws the span, and a slower machine has more
  room for that drift.

  Not chased further because it is unreproducible in isolation and the
  behaviour it guards is verified in a real browser. **If it recurs, capture
  the assertion message first** — run the full suite in a loop redirecting
  output, rather than re-running the file alone, which has never failed.

- **An intermittent Playwright resize-test flake.** Seen once during M5.5, not
  reproducible afterwards across three consecutive full runs (18/18 each). Not
  actionable without a failing artifact, but worth naming because `jsdom` has
  no `setPointerCapture` — Playwright is the _only_ coverage for pointer-drag
  paths (`e2e/smoke.spec.ts`), so a flake there is a hole in the one place that
  can test them. If it recurs, run that spec with `--repeat-each`.
- **Paper's `--bear-selected` at `rgb(207 59 44 / 0.11)` reads faint.** On the
  bottom toolbar's pressed toggles it is a light wash over white, and on some
  displays the pressed state reads mainly through the text-colour shift rather
  than the background. Ink's `0.18` alpha is comfortable. Raising Paper's alpha
  is a design call, and it ripples into `e2e/smoke.spec.ts`, which now pins the
  shipped palette deliberately. Less urgent since M9a — Paper is no longer the
  default theme — but the value is unchanged and the ruling stands.
- ~~`rounded-md`, `rounded-lg`, `shadow-popover` and `shadow-dialog` are
  provisioned but unused.~~ **Resolved.** `ConfirmDialog` took the dialog
  shadow in M6, and M8 put `rounded-lg` + `shadow-popover` on the panes, both
  floating toolbar pills, the info popover and the export menu. Every provisioned
  radius and shadow now has at least one call site.
- **`scripts/fonts.test.ts` ignores `font-weight` and `font-style`.** Its
  `declaredFamilies` collects every `font-family:` an `@font-face` block
  declares regardless of which face it belongs to, so a family declared _only_
  at a weight or style the app never uses would satisfy the check. Latent, with
  no live instance — Pretendard ships `font-weight: 45 920` normal and
  JetBrains Mono `100 800` normal, so every declared family is one the app can
  actually render.
- **The title line's fold affordance depends on markup the user cannot see —
  OPEN, found by eyeball testing on 2026-08-21, not by a test.** A note's first
  block renders as its title whether it is a `paragraph` or an `h1`, by design:
  `editor.css`'s `> :is(p, h1, h2, h3, h4, h5, h6):first-child` rule exists so
  that "a note beginning with a plain paragraph and a note beginning with
  `# Heading` present the same title". B1's gutter affordance, however, keys on
  the node type. Measured:

  ```
  "Title test\n\n## header2 test"    → first node paragraph → sections [2:header2 test]
  "# Title test\n\n## header2 test"  → first node heading   → sections [1:Title test, 2:header2 test]
  ```

  So two visually identical title lines behave differently — one offers a fold
  chevron on hover, the other does not — and nothing on screen explains which
  is which. That is the same "behaviour must not depend on invisible state"
  rule B1 invoked to REJECT hiding the affordance below a pane-width threshold;
  it was applied to the gutter and never to the title line. Second consequence:
  when the first block IS an `h1`, folding it collapses everything to the next
  `h1` — i.e. the whole note — which is a gesture nobody asked for.

  **Recommended resolution, not yet taken:** never render the affordance on the
  first block, whatever its markup. The title line is the note's name, not a
  section. One guard in `headingSections`, a test, and a ruling. The competing
  option — show it whenever the first block is a heading — keeps the
  inconsistency and is only defensible if `# Title` should be foldable.

  **No test covers a note whose first line is a heading.** That absence is why
  this reached a human's eyes instead of the suite's, and it should be closed
  alongside whichever resolution is chosen.
- **A stale fold key can fold the wrong `h1` after the title-line rule, in one
  narrow shape.** Fold keys are `level:nth:text`, and `nth` is counted over the
  post-exclusion section list — so excluding the title renumbers any heading
  that shared its level and text. Almost always this fails open: a stale key
  matches nothing and the section simply shows. The exception is a note whose
  title `h1` and a body `h1` carry identical text, where a fold persisted
  against the title before this change (`1:0:Title`) now matches the body
  heading and folds it on open. Not data loss, self-correcting the moment the
  user unfolds, and it needs both headings to share level and text exactly.
  **Ruled: no migration.** Writing one means versioning a view-state table to
  repair a case that costs one click, in an app where fold rows are already
  discarded on import. Recorded so nobody re-derives it from a bug report.
- **Every fold test's fixture used to begin with a heading — a document shape
  the app never produces.** A note's first block is its title, so a real
  document always has a title line before its first section. That unrealistic
  shape is why the title-line affordance gap survived eight tasks and their
  reviews, and why repairing it surfaced seven tests passing for the wrong
  reason — one whose `Decoration.node` aria-label was never applied at all, and
  one that could not fail for the reason it existed. **When writing an editor
  fixture, start it the way a real note starts.** `docFor` in
  `headingSections.test.ts` and `headingFold.test.ts` carries this as a comment.

- **Pane-width persistence gained a viewport dimension in J1**, and the ruling
  above about `usePaneWidths`' flush is unchanged by it. What changed:
  `clampPaneWidth` takes an optional third `max`, `maxPaneWidth(viewport,
  otherPane)` supplies it, and widths are WRITTEN in desktop mode only. The
  bug this closed was pre-existing and reachable: both panes dragged wide in a
  1024px window left the editor a negative width.

- **A pre-existing `ContextMenu.ts` gap now costs more: the keyboard route can
  open a menu missing the Section group entirely, not just show a stale
  toggle.** `ContextMenu.ts`'s own docblock (on `ContextMenuRequest.selection`)
  already documents that `state.selection` can be briefly stale after a
  keyboard (arrow-key) selection change, because ProseMirror resyncs its model
  from a browser-handled selection change asynchronously. The pointer route
  works around exactly this by re-reading the live DOM `Selection` before
  trusting it; the keyboard route does not — its comment claims
  `state.selection` "IS authoritative" for a command executing synchronously,
  which is true of the command itself but not of a selection change made by a
  PRIOR keystroke that has not finished resyncing when the menu-opening
  keystroke lands immediately after. **Repro: arrow into a section, then
  press `Shift+F10` with no pause.** Before B2 the worst case reachable this
  way was a stale checkbox/radio state in the menu. Since B2, `flags.section`
  in `EditorContextMenu.tsx` is computed from that same selection at open
  time, so the same staleness can make the whole group silently ABSENT, not
  merely wrong — a menu that is missing an entry reads as "this note cannot do
  that", where a stale checkbox reads as a glitch.

  **The severity stops there, and an earlier draft of this entry overstated
  it** by calling the Section group B2's only keyboard and screen-reader route
  to reordering. It is not: `Mod-Alt-ArrowUp`/`Mod-Alt-ArrowDown` move a
  section from the caret with no pointer and no menu, so a keyboard user who
  hits the stale-selection window is not locked out of reordering — only out
  of the discoverable route to it (see `docs/rulings/accessibility.md`). That
  weakens the case for fixing this urgently; it does not remove it, because
  the discoverable route is the only one an unfamiliar user has.
  **Deferred, not fixed, on purpose:** this predates B2, and closing it
  is a change to `ContextMenu`'s keyboard-selection handling with its own test
  surface (something that resyncs the model, or re-reads a keyboard-side
  ground truth analogous to the pointer route's DOM read) — out of scope for a
  documentation task. Cost if wrong: a keyboard user occasionally opens the
  context menu right after an arrow key and finds no Section group;
  recoverable by closing and reopening the menu.

## L2 (backlinks)

- **`LinkPill.setKnownNoteTitles` still has no trailing-node regression
  test.** It dispatches a meta-only transaction and it carries
  `skipTrailingNodeMeta` today, verified by reading the source — but only
  `LinkAutocomplete.ts`'s `move`/`dismiss` paths and `HeadingFold.ts`'s
  `setKeys` have a test that would catch the tag being dropped. `LinkPill`
  has no `aria-activedescendant` question at all, because it renders a
  decoration, not a listbox — nothing to defer there. Deliberately not
  widened into L2 Task 6: the fix belongs with whichever future change next
  touches that file, using `quietlySelect`'s all-tagged-transactions pattern
  (see `docs/rulings/markdown-and-schema.md`'s `TrailingNode` entry) rather
  than invented fresh. Cost if wrong: a future edit to `setKnownNoteTitles`
  silently reintroduces a growing-note bug with nothing to catch it.
  **This item named `CodeLanguageControls` until the L2 final review, and
  that was simply false**: it holds zero `setMeta` calls and its only
  dispatch is a `setNodeMarkup`, so `TrailingNode`'s behaviour there is
  correct and nothing is owed. The file that WAS exposed and named nowhere
  was `HeadingFold.ts` — nine untagged meta-only dispatches, reachable
  without typing a character, since `NoteEditor` calls `setHeadingFolds` from
  a mount effect. Fixed in the same review; the lesson is that a deferred
  item pointing at the wrong file is worse than no item, because it retires
  the worry.
- **The backlinks panel shipped always-expanded; the spec said
  "collapsible".** Mitigated by an existing `max-h-48 overflow-y-auto` cap on
  `BacklinksPanel`'s `<nav>`, so a note with many backlinks scrolls inside a
  bounded box rather than pushing the editor off-screen — judged defensible
  by both the implementer and the task review. No persisted expand/collapse
  state interface exists anywhere in the app to hang a real toggle off of.
  The spec is corrected in the same commit as this entry
  (`docs/superpowers/specs/2026-08-31-l2-backlinks-design.md`) to describe
  what shipped. Cost if wrong: a note with an unusually long backlinks list
  keeps a modest, non-collapsible scroll region rather than a toggle.
- **`NoteEditorProps.onOpenNote` is optional, so a future second consumer
  that forgets to wire it gets a silently absent panel, not a type error.**
  `AppShell` is the only caller today and always supplies it
  (`onOpenNote={select}`). Cost if wrong: a new host of `NoteEditor` ships
  with no visible backlinks panel and no compiler error pointing at why.
- **`LinkAutocomplete`'s listbox/option ids are keyed on `from` + index, not
  namespaced per editor instance.** Safe under the app's actual one-editor-
  at-a-time usage; would collide (duplicate DOM ids) if two autocomplete-
  bearing editors ever shared one DOM tree. Cost if wrong: exactly that
  collision, the day a second simultaneous editor instance is built.
- **A cross-scope link leaves the note list with no visible selection.**
  Ruled deliberately in Task 4: `AppShell.handleActivateLink` does not change
  `scope` when the target note is outside the current filter, because a link
  is a lateral move and silently re-scoping would lose the user's place
  mid-triage in a filtered list. The editor can therefore show a note the
  list does not currently contain, with no row marked current anywhere.
  `e2e/backlinks.spec.ts` exercises only the same-scope case (both corpus
  notes are in "All notes") and asserts the resulting `aria-current`
  honestly, per the controller's instruction not to paper over this with a
  same-scope-only test that implies more coverage than it has. Cost if
  wrong: a user who Mod-clicks a cross-scope link may wonder, briefly, which
  row in the list corresponds to what they are now reading — recoverable by
  clicking any list scope, which reselects normally.
- **The rename-while-panel-open stale-title guard (`BacklinksPanel`'s
  `result?.title === title` discard) has no direct Playwright test.**
  Attempted and left out: forcing the actual race — a rename landing between
  `useLiveQuery`'s dispatch and its resolution — needs either an artificial
  delay instrumented into the app itself (which would make the test assert
  against harness behaviour, not the app's) or advancing fake timers past
  autosave's debounce at a precise instant relative to an async IndexedDB
  read, neither of which Playwright can do deterministically from the
  outside. The guard is unit-testable in principle by mocking `notes.linksTo`
  with a controllable delay; that is a `BacklinksPanel.test.tsx` addition,
  not an e2e one, and is left for whoever next touches that component. Cost
  if wrong: the guard's only protection is the reviewer's source-level
  verification recorded in the L2 progress ledger.
