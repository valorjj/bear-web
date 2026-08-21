# A — The note-list header

Written 2026-08-21. Sub-project **A** of the three in `docs/superpowers/NEXT.md`,
and the first of them by that file's ordering. **B** shipped as B1 on
2026-08-21; **C** (code block language and highlighting) is still queued.

The letters are `NEXT.md`'s and are not milestone ids.

## Purpose

The note list has never named what it is showing. Since M3 the only on-screen
indication of the active filter has been the `aria-current` row in the sidebar —
which is why activating a tag pill has to reveal collapsed ancestors, so the
user can see where they landed. `deferred.md` has carried this as an open item
past M6, M7, M8 and M9a.

A adds the header Bear puts there: a chevron button naming the current scope,
and a menu holding a note count, the sort order, the preview density, a sub-tag
filter, and every scope with a keyboard shortcut.

Three things arrive that the app cannot do today at all:

- **Choosing a sort order.** Ordering is hardcoded `byPinnedThenRecent` in
  `src/data/repositories/notes.ts`. There is no user-facing control anywhere.
- **Choosing a row density.** Every row renders a two-line snippet with the
  second line's height reserved. There is no way to get a compact list.
- **Switching scope from the keyboard.** The app has exactly one keyboard
  shortcut today, `Mod-f`, declared inline in `AppShell`.

## Reference

Bear's own header, from four screenshots supplied by the user on 2026-08-21.
Its menu, in order: a dimmed count (`33 메모`); `정렬 ▸` with 수정일 / 생성일 /
제목 and a separate `새로운 항목 맨 위로` toggle; `미리 보기 스타일 ▸` with
작음 / 중간 / 큼 plus `첨부 파일 숨기기` and `하위 태그 메모 숨기기`;
`메모 내보내기`; then all eight scopes with `⌥⌘1`–`⌥⌘6`, `⌥⌘9`, `⌥⌘0`.

Bear is a reference, not a target — CLAUDE.md's standing rule. Every place this
spec diverges says why.

## Decisions already taken

Recorded here because each closes a question that would otherwise be re-opened
during implementation.

### The scope list stays in the menu, despite the sidebar

`NEXT.md` left this explicitly undecided, on the grounds that Bear can collapse
its sidebar — making that menu sometimes the only route to a scope — while ours
is always visible, which could make the list redundant.

**Ruled: keep it.** The menu is where the shortcut hints live, and a shortcut
nobody can discover is a shortcut nobody uses. The scope rows are what makes
`⇧⌘3` findable. Redundancy with an always-visible sidebar is the price of
discoverability, and it is the same price the sidebar already pays against the
tag tree.

### Sort and preview style are global, not per-scope

One `noteOrder` row and one `previewSize` row in the `settings` table, applying
everywhere. Bear behaves this way.

Per-scope was rejected on a concrete cost: tag scopes are unbounded, so keying
preferences by `scopeKey()` accumulates a settings row per tag the user has ever
visited, with nothing to prune them when a tag stops existing. The expressiveness
bought — Todo by created date while a tag sorts by title — is not worth a table
that only grows.

### Pinned notes stay on top under every sort

`byPinnedThenRecent` becomes `byPinnedThen(order)`: the pinned partition is
applied first, always, and the user's chosen order is the tiebreaker **within**
each partition. Bear does the same, and the alternative makes the Pinned smart
list mean something different from pinning.

### Trash keeps its own order, and says so

`listTrashed` sorts by `trashedAt` descending. That field is not one of the
three offered, and inventing a fourth implicit sort field for one scope is
worse than the exception. In Trash the three sort rows and the direction toggle
render `aria-disabled` with copy naming the reason.

A disabled control whose reason is invisible is the defect B1 rejected the
pane-width threshold over, and `deferred.md` records the same rule again against
the title-line affordance. The copy is not decoration.

### Preview size drives the render and the accessible name together

Small = title + date. Medium = one snippet line. Large = two snippet lines —
today's row, and the default.

Each size reserves its own snippet height, so rows stay uniform within a size.
The current `min-h-[2.0625rem]` exists because a list whose rows change height
with their content reads as ragged; that problem does not disappear at the other
two sizes, it just takes different values.

The `aria-label` is built from the same size decision that drives the render.
At Small it announces `title, date` and nothing more. The rejected alternative —
always announcing the full triple regardless of size — was argued on the grounds
that density is a visual preference that should not remove information from
screen-reader users. It was rejected because it creates two contracts where
there is now one, and because `NoteListItem`'s label already exists to make the
announcement match what is on screen: the explicit commas were added in M7
precisely because the name diverged from the rendering.

### The menu is flat, with typed roles

No submenus. One panel, separators between groups.

Bear nests `정렬 ▸` and `미리 보기 스타일 ▸`. Nesting costs hover-intent timing,
a second popover placement layer, right-arrow-to-open, and focus return on
close — and none of it is unit-testable, because jsdom has no layout engine to
place a submenu against. Coverage would move to Playwright for a menu that is
sixteen rows flat, shorter than the scope list Bear already shows unnested.

The checkmarks in Bear's menu become structure rather than drawing:
`role="menuitemradio"` with `aria-checked` for the sort field, the preview size
and the current scope; `role="menuitemcheckbox"` for the direction toggle and
the sub-tag filter.

### Scope shortcuts are `⇧⌘`, not `⌥⌘`

The `⌥⌘` digit family is already spent. `@tiptap/extension-heading` binds
`` `Mod-Alt-${level}` `` for levels 1–6 and B1 shipped on it;
`@tiptap/extension-paragraph` binds `Mod-Alt-0`, which is why B1 moved its fold
toggle to `Mod-Alt-f`. With the editor focused, `⌥⌘1` would make an H1 *and*
switch scope — one keystroke, two unrelated effects, differing by where focus
happens to be.

`Ctrl`+digit is free in Tiptap and rejected anyway: `Ctrl+1`–`8` switches
browser tabs in Chrome on Windows and Linux, and this ships to GitHub Pages.

The verification, run the way `HeadingFold.ts` documents:

| Binding | Owner | Status |
| ----------------------------- | -------------------------------------- | ------ |
| `Mod-Alt-1`–`6` | `@tiptap/extension-heading` | taken |
| `Mod-Alt-0` | `@tiptap/extension-paragraph` | taken |
| `Mod-Alt-c` | code block | taken |
| `Mod-Shift-7` / `8` / `9` | ordered list / bullet list / blockquote | taken |
| `Ctrl-a` / `d` / `e` / `h` | ProseMirror base keymap (letters only) | taken |
| `Mod-Shift-1`–`6`, `Mod-Shift-0` | — | **free** |

**Ruled: `⇧⌘1`–`⇧⌘6` and `⇧⌘0`.** Bear's digits are kept exactly; only the
modifier differs, so the number carried over from Bear still works. `⌥⌘` stays
with headings where B1 put it.

Consequence, named now rather than discovered later: `⇧⌘9` is blockquote, so
the Archive slot this spec leaves vacant cannot later be `⇧⌘9`. A future Archive
list needs a different key.

### The digit mapping leaves 9 vacant

`⇧⌘1` Notes, `⇧⌘2` Untagged, `⇧⌘3` Todo, `⇧⌘4` Today, `⇧⌘5` Pinned,
`⇧⌘6` Locked, `⇧⌘0` Trash.

**The digits follow `SMART_LIST_IDS`, not Bear.** Bear orders 잠긴항목 (5)
before 고정됨 (6); our sidebar has always run `…today, pinned, locked, trash`.
The menu lists scopes in sidebar order, and a digit that disagreed with the row
above it would be worse than a digit that disagrees with another app. Positions
1–4 and 0 are identical to Bear regardless.

Bear numbers 아카이브 at 9 and 휴지통 at 0. We have no Archive list, but `Note`
already carries an unused `archivedAt` field, so Archive is a real future list.
Numbering Trash contiguously at 7 would guarantee either a renumber or a
permanent divergence the day Archive ships; leaving the gap costs nothing and
keeps Bear muscle memory for Trash intact.

## Architecture

### Ordering is a data-layer value

`src/features/notes/scope.ts` carries an explicit ruling:

> Ordering comes from the repository and is never re-sorted here: every lister
> returns its own order, and pinned-first ordering lives in the repository so it
> applies to the tag scope too.

That ruling stands. The repository does not stop owning ordering; it starts
accepting an argument.

**`src/data/order.ts`** (new):

```ts
export type NoteOrderField = 'updated' | 'created' | 'title';
export interface NoteOrder {
  field: NoteOrderField;
  newestFirst: boolean;
}
export const DEFAULT_NOTE_ORDER: NoteOrder = { field: 'updated', newestFirst: true };
export function compareNotes(order: NoteOrder): (a: Note, b: Note) => number;
export function isNoteOrder(value: unknown): value is NoteOrder;
```

`compareNotes` is pure and switches exhaustively over `NoteOrderField`, so
adding a field is a compile error until every arm is handled.

Title comparison uses `localeCompare`, not `<`. The user's corpus is Korean and
codepoint order on Hangul is not alphabetical order. A note with no title
compares under the same fallback string the row displays, so the list order
matches what the user reads.

`newestFirst` inverts every field, not only the dates — under `Title` it means
Z→A. That is what Bear's single checkbox does, and it is why the preference is
one boolean rather than three.

**`src/data/repositories/notes.ts`**:

```ts
listActive(order?: NoteOrder): Promise<Note[]>
listByTag(tag: string, options?: { order?: NoteOrder; includeDescendants?: boolean }): Promise<Note[]>
listTrashed(): Promise<Note[]>   // unchanged, deliberately
```

Both defaults reproduce today's behaviour exactly, so every existing call site
and every existing test compiles and passes untouched — the diff is additive.
`byPinnedThenRecent` becomes `byPinnedThen(order)`.

`includeDescendants` defaults to `true`. `listByTag` already runs the exact and
descendant queries separately, so hiding sub-tag notes is one skipped query, not
new traversal.

**`src/features/notes/scope.ts`**: `listForScope` gains the order and the
sub-tag flag and passes both straight through, re-sorting nothing. Its docblock
gains one sentence noting the repository now accepts an order. `ScopeLister`'s
`Pick<>` widens with the signatures.

### Preferences

Three rows in the existing `settings` table: `noteOrder`, `previewSize`,
`hideSubTagNotes`.

**`src/app/useSetting.ts`** (new): `useSetting<T>(key, fallback, guard)` wrapping
`useLiveQuery(() => settings.get(key, fallback), [])` and an awaited
`settings.set`. `guard` validates on read — a hand-edited or future-version row
falls back to the default rather than reaching `compareNotes` as an unhandled
field.

Deliberately **not** modelled on `usePaneWidths`. That hook's `drag`,
`pendingCommit` and `lastCommitted` machinery exists to absorb a continuous
pointer drag and to close a window `settings.set`'s fire-and-forget write left
open. A menu click is a single discrete event with nothing to render
optimistically, and the write is awaited, so neither the optimistic overlay nor
`useFlushTriggers` is needed here.

### The header

The scope button goes at the **left of the existing 36px action strip** in
`NoteList`, before `New note`, with the action buttons pushed right by
`ml-auto`. Title left, controls right — the reading order in Bear's header.

The search row below is untouched. Bear hides search behind a magnifier; doing
the same would churn `SearchField`'s existing coverage for nothing A needs, and
it is separable from this sub-project.

The button renders `{scope name} ˅`, using the existing `smartList.*` keys for
builtins and the raw tag for tag scopes, `variant="ghost"` like its neighbours,
with `aria-haspopup="menu"` and `aria-expanded`.

### `src/features/notes/ScopeMenu.tsx` (new)

Rendered through the existing `Popover`. Extends `ExportMenu`'s pattern — focus
the first item on open, Escape returns to the opener — and adds roving
`ArrowUp` / `ArrowDown` / `Home` / `End`, which sixteen rows need and three did
not.

```
┌ 33 notes                    ← aria-hidden, presentational, not focusable
├ ─────────────
├ Date modified   ✓           ← menuitemradio
├ Date created
├ Title
├ Newest first    ✓           ← menuitemcheckbox
├ ─────────────
├ Small
├ Medium
├ Large           ✓           ← menuitemradio ×3
├ Hide sub-tag notes          ← menuitemcheckbox, disabled outside tag scopes
├ ─────────────
└ Notes ⇧⌘1 … Trash ⇧⌘0       ← menuitemradio ×7, checked = current scope
```

The count comes from the **unfiltered** scope list, never the query-narrowed
view. `NoteList` already draws this distinction for `emptyTrashDisabled` and
`hasUnfilteredItems`, for the same reason: a search matching two notes must not
relabel a 33-note list as "2 notes".

Shortcut hints render as text in the row, not as part of the accessible name.

The scope rows are generated from `SMART_LIST_IDS`, never hand-listed. M6
deleted `ScopeSidebar` precisely because it hardcoded its rows, and
`SmartListSidebar` renders all seven builtins as data; a second surface listing
the same scopes must not reintroduce the registry-grown-row-by-row shape. Adding
a builtin stays a one-line change in `scope.ts`.

The count needs a plural rule, so it is two keys (`noteList.count.one` /
`noteList.count.other`) selected by the value, not one key with an interpolated
number — Korean has no plural inflection and English does, and the existing
`useT` has no plural machinery to lean on.

### `src/app/useScopeShortcuts.ts` (new)

A window `keydown` listener taking `onScope: (scope: NoteScope) => void`.
`AppShell` calls it and stays thin; the existing inline `Mod-f` handler moves in
beside it, so the app has one place where global keys live rather than two.

Matching is on **`event.code`, never `event.key`**. With Shift held on macOS,
`event.key` for the 1 key is `'!'`, and under the 두벌식 layout the values shift
again; `event.code === 'Digit1'` is the physical key regardless of layout or
modifier. The handler requires `metaKey || ctrlKey` and `shiftKey`, rejects
`altKey` explicitly so a stray `⌥⇧⌘1` cannot fire both this and a heading
toggle, and calls `preventDefault` only on a match.

### `NoteListItem`

Gains a `size: PreviewSize` prop. Reserved snippet heights: `0` / `1.03125rem` /
`2.0625rem`. The `aria-label` is derived from the same size value.
`HighlightedText` still receives `query` only for real content, unchanged — a
query matching an i18n placeholder must not highlight it.

### i18n

Roughly fourteen new keys under `noteList.sort.*`, `noteList.preview.*`,
`noteList.scope.*`, added to `en.ts` **and** `ko.ts`. `ko.ts` is annotated
`Record<TranslationKey, string>`, so a missing Korean string is a compile error;
the rule is to add the translation, never to weaken the annotation.

## Testing

**Unit (Vitest).** `compareNotes` across all three fields and both directions,
including Hangul ordering and the untitled fallback. The repository honouring an
order, and `listTrashed` ignoring it. `listByTag` with
`includeDescendants: false`. `ScopeMenu`'s roles, `aria-checked`, and disabled
states in Trash and outside tag scopes. `NoteListItem` at all three sizes,
asserting render and accessible name in the same test so the two cannot drift.
`useSetting` round-tripping through fake-indexeddb, including a corrupt stored
value falling back. `useScopeShortcuts` is jsdom-testable — a plain window
listener, no `setPointerCapture`, no layout.

**E2E (Playwright).** Choose a sort, reload, assert it survived; the same for
preview size. `⇧⌘3` switching scope from a cold page, **and** with the editor
focused while asserting no heading was created — that last one is the regression
test for the `⌥⌘` collision this spec found, and only a real browser can run it.

**Before any e2e run that follows a source change, and always before a fault
injection:** `lsof -ti:4173 | xargs -r kill -9`. CLAUDE.md records this failing
silently in both directions; M9a hit it twice.

**Visual tooling.** `npm run shots` gains the open menu (12 shots × 5 themes).
`npm run measure` gains the header strip and the three row heights. Nothing in
the test suite can see "renders wrong", which is why a visual change is checked
against a measured number and a screenshot.

## Out of scope

- **Bulk `메모 내보내기`.** Per-note export shipped in M8b. Scope-wide export
  needs its own filename scheme and an archive story.
- **`첨부 파일 숨기기`.** There are no attachments. Image storage is named in
  the project's goal and has never been scheduled.
- **Collapsing search behind a magnifier icon.** Churns existing coverage for
  nothing A needs.
- **The note-row context menu** (Bear's right-click menu: pin, copy as, archive,
  duplicate, merge). A separate feature, not part of the header.
- **An Archive smart list.** `archivedAt` exists on `Note` and is unused. This
  spec only reserves its number and records that `⇧⌘9` is unavailable to it.

## Rulings this changes

**Closes**, in `docs/rulings/deferred.md`: "The note list has no header naming
the current scope." Open since M3.

**New**, to be written on landing:

- Ordering is a repository argument and is never re-sorted downstream
  (`scopes-and-search.md`).
- `⌥⌘`+digit belongs to heading levels; `⇧⌘`+digit belongs to scope switching.
  Verify any new binding against `node_modules/@tiptap`, not only against
  browser shortcuts (`markdown-and-schema.md`).
- Preview size drives the rendered row and its accessible name from one
  decision (`accessibility.md`).
