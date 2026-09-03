# Markdown round-trip and the editor schema

Governs how a note's Markdown is parsed, serialized and normalized, which
constructs the editor schema may claim, and what the round-trip suite is and is
not able to prove.

**Trigger:** any change under `src/features/editor/` touching `markdown.ts`,
`extensions.ts` (`buildEditorExtensions`, `editorExtensions`, `StarterKit.configure`),
`RawBlock.ts` (`createRawBlock`, `RawDefinition`, `RawHtmlBlock`, `RawImage`,
`createRawInlineHtmlNode`), `toolbarSelection.ts`, `taskItemPromotion.ts`,
`Highlight.ts` (`HIGHLIGHT_COLORS`, `highlightClass`, the `color` attribute,
the tokenizer's two branches), `TableHandles.ts`, `ContextMenu.ts`,
`HeadingFold.ts` (`headingFoldKey`, `foldedKeys`, `toggleElement`, `badgeElement`,
`markerElement`), `headingSections.ts` (`foldKeyOf`, `headingSections`,
`hiddenRangesFor`, `serializeFoldKey`), or `HeadingMenu.tsx`; any edit
to `markdown.test.ts`'s `CANONICAL`, `stability.test.ts`'s `NON_CANONICAL`,
`rawBlock.test.ts`, `characterization.test.ts`, `extensions.test.ts` or
`headingFold.test.ts`; a new import of `@tiptap/markdown` anywhere; a new or
removed Tiptap extension, input rule or `markdownTokenName`; a new or changed
`Mod-Alt-*` keymap entry **or any other keyboard binding** (`ContextMenu.ts`'s
`Shift-F10` and `ContextMenu` key included); any `normalizeMarkdown` /
`parseMarkdown` / `serializeMarkdown` call site; `src/features/editor/lowlight.ts`
(`lowlight`, `lowlightForEditor`), `src/features/editor/codeLanguages.ts`
(`resolveLanguage`, `DIAGRAM_LANGUAGE_ID`), `src/features/editor/highlightClasses.ts`
(`roleOfFlattenedClasses`, `KNOWN_FLATTENED_COLLISIONS`), and
`src/features/editor/CodeLanguageControls.ts`. Also `MermaidDiagram.ts`
(`isMermaidBlock`, `diagramName`), `src/features/diagrams/` (`ensureDiagram`,
`requestDiagram`, `DiagramError`). Also `LinkPill.ts`'s
`setKnownNoteTitles`, `LinkAutocomplete.ts`'s `move`/`dismiss` dispatches, and
any other `skipTrailingNodeMeta` call site or meta-only `tr.setMeta(...)`
dispatch anywhere in `src/features/editor/`. Also `MarkdownPaste.ts`
(`markdownPasteKey`, `sliceFor`) and `pastedMarkdown.ts`
(`htmlCarriesStructure`, `STRUCTURAL_HTML`, `decodeEntities`,
`PARSER_HANDLED`); any edit to `importCycle.test.ts`.

- **`markdown.ts` is the only importer of `@tiptap/markdown`.** The round-trip
  suite drives `MarkdownManager` standalone, with no `Editor` and no DOM, which
  is what lets it be exhaustive and fast. Importing the package elsewhere
  couples serialization to a mounted editor and puts the suite behind jsdom's
  contenteditable limitations. **This is convention enforced by nothing** — there
  is no lint rule, and oxlint has no import-restriction equivalent configured.
  A second importer would simply work. `characterization.test.ts` is a deliberate
  exception: it describes the dependency itself.

- **The round-trip suite asserts three properties, not one.** Fidelity pins what
  each construct must produce; stability proves normalization settles;
  preservation proves unsupported constructs survive. Idempotence alone —
  the parent spec's original wording — is satisfied by a serializer that
  discards every note, so dropping the fidelity suite silently guts the others.
  **These three properties are not interchangeable, and fidelity is the
  load-bearing one.** Fidelity pins exactly one string per construct; stability
  only covers its listed inputs. A defect that is a no-op on the pinned string
  and corrupts every other instance of that construct passed the entire suite
  until stability coverage was extended. Any new construct needs entries in
  **both**.

- **A known, irreducible limit of the round-trip suite:** any serializer defect
  whose output is _itself valid Markdown for the same construct_ — so
  reparsing reproduces it exactly — corrupts every input except the one pinned
  fidelity string, and no amount of stability coverage catches it. Closing that
  needs semantic-equivalence checks or property-based fuzzing, not more cases.
  Do not attempt to fix it with more test cases.

- **Known stable-but-lossy transformations. These are instances of the limit
  above, not new bugs — do not "fix" them.** Each one round-trips to a fixed
  point, so the suite is green, and each one is a legitimate reading of the
  source by CommonMark's rules; only a semantic-equivalence check could tell
  them apart from correct output. Found by the M4 final review:
  `&copy;` → `&amp;copy;`, `a < b` → `a &lt; b`, `my_var_name` →
  `my\_var\_name`, autolinks and reference links rewritten to inline form,
  YAML front matter mangled, and whitespace-only notes normalizing to empty
  (they are no longer purged for it — see the `discard` guard in
  `notes-lifecycle.md`).

- **A dead custom tokenizer is invisible to round-trip tests.** Inert
  `==text==` serializes byte-identically to a working highlight. Constructs
  whose tokenizer is ours need **structural** assertions on the parsed
  document, not just round-trip assertions.

- **`RawBlock` is why deferring a construct is safe, and the MECHANISM must
  stay even as individual fallbacks retire.** A note containing a table already
  existed in real databases, written in M3's textarea or restored from a JSON
  import; without the verbatim fallback, opening one and typing destroyed it
  with no error and no recovery. M8c retired `RawTable` specifically, because a
  real table node now claims that token and two nodes claiming one token is a
  defect — but `RawDefinition`, `RawHtmlBlock`, `RawImage` and the inline-HTML
  node all remain, and so does the factory. **Retiring a fallback is only safe
  when the replacement round-trips at least as well as the fallback did**, which
  for tables it did not at first: the vendor serializer dropped a cell whose
  neighbour contained a pipe, a regression against verbatim preservation. See
  `tables.md`. (`RawTable` still exists as an unused export in `RawBlock.ts`;
  what was retired is its registration in `editorExtensions`, and
  `table.test.ts` asserts `rawTable` is absent from the schema.)

- **Underline is switched off at the schema, in
  `StarterKit.configure({ underline: false })`, and must stay off.** It has no
  Markdown representation; `_underline_` collides with CommonMark italic, and
  serializing to raw `<u>` was considered and rejected. Highlight is `==text==`.
  **This rule needs a SCHEMA-level assertion, and that is why it escaped.**
  StarterKit registers `@tiptap/extension-underline` by default, so for the
  whole of M4 the mark was live: `Mod-U` worked and persisted `++text++`, and
  because `u` then appeared in the schema-derived `recognizedHtmlTags`, an
  existing note's `<u>x</u>` was rewritten to `++x++` instead of being preserved
  verbatim by the raw-inline fallback. The spec, this file, and a passing test
  all asserted the rule while all of that shipped — the test checked that no
  underline BUTTON was rendered, which says nothing about the schema, the keymap
  or the serializer. `src/features/editor/extensions.test.ts` now asserts the
  mark, the command, the `Mod-U` binding and `<u>` preservation. Any future
  "not supported" ruling about a StarterKit-bundled extension needs the same
  treatment: assert on `getSchema(editorExtensions)`, never on the UI.

- **`AllSelection` must be pinned to a `TextSelection` before any block-level
  toolbar command.** ProseMirror's `AllSelection` (what
  `editor.commands.selectAll()` and the real `Ctrl/Cmd+A` keyboard shortcut both
  produce) never collapses to a fixed range — its `.map()` re-derives to "the
  whole document, whatever it is now." Every toolbar action restores this stale
  selection via `.focus()`, so `TrailingNode`'s appended empty paragraph gets
  wrapped by the next toggle, which appends its own trailing paragraph, forever
  — a note that silently grows without bound on repeated clicks. See
  `src/features/editor/toolbarSelection.ts` for the fix and the full diagnosis.
  Verified in a real Chromium browser via Playwright for both the programmatic
  `selectAll()` path and the real keyboard `Ctrl/Cmd+A` path — the two are
  driven by the identical `AllSelection` mechanism and the identical fix closes
  both.

- **`TrailingNode`'s `appendTransaction` runs on EVERY dispatched transaction,
  not only `docChanged` ones, and a meta-only dispatch into a note ending in a
  list or table WILL insert a spurious trailing paragraph that autosave then
  silently persists.** Found in L2 (Task 4): `LinkPill.setKnownNoteTitles`
  dispatches a transaction whose only content is a `setMeta` call — zero
  document steps — fired from `RichEditor`'s mount effect once
  `notes.allNoteTitles()` resolves. StarterKit's `TrailingNode` extension
  checks the document's last node type and appends an empty paragraph
  whenever it needs one to be typeable into, and that check is NOT gated on
  whether the transaction actually changed the document — it runs after
  every transaction, unconditionally. So opening a note that happens to end
  in a bullet list, with no user edit at all, picked up a trailing empty
  paragraph the instant the known-titles command fired, and autosave wrote it
  back: a note silently growing a blank paragraph on every open, invisible to
  anyone not diffing the stored Markdown. The same hazard applies to
  `LinkAutocomplete.ts`'s `move`/`dismiss` meta transactions and to
  `HeadingFold.ts`'s `setKeys`/`setDrag`, which build nine meta-only
  dispatches between them — any transaction whose only purpose is to update
  plugin state, not the document, is vulnerable. (`CodeLanguageControls` is
  NOT such a case, and an earlier version of this bullet said it was: that
  file contains zero `setMeta` calls and dispatches only a `setNodeMarkup`,
  a genuine document change for which `TrailingNode`'s append is correct and
  wanted.)
  **The fix is `.setMeta(skipTrailingNodeMeta, true)` (from
  `@tiptap/extensions`, the same constant `TrailingNode` itself reads) on
  every meta-only dispatch, with no exceptions** — a transaction carrying no
  document steps either has the tag or is a live instance of this bug. The
  test is the transaction, never the call site: `HeadingFold`'s `setKeys` is
  shared between four meta-only commands and `applyMove`, which rides a real
  section move on the same `tr`, so it tags on `!tr.docChanged` and leaves a
  document-changing move to behave exactly as ordinary typing does.
  **The testing trap, which is why this is easy to "fix" without actually
  fixing it:** the vulnerability flag `TrailingNode` tracks is computed once
  at plugin `init` and is BURNED PERMANENTLY by the first untagged
  transaction a test dispatches — including one the test itself uses only to
  set up its fixture. L2 Task 6's first trailing-node test typed `[[de` to
  open the autocomplete menu as setup, then asserted the document was
  unchanged; it passed even with `skipTrailingNodeMeta` deleted from the
  command under test, because typing `[[de` (an ordinary, untagged,
  `docChanged` transaction) had already consumed the vulnerability before the
  code under test ever ran — nothing was left for the tag to protect against.
  The implementer caught this by investigating a suspiciously easy green
  rather than trusting it, and rebuilt the fixture around a `quietlySelect`
  helper that reaches the dispatch under test using ONLY tagged transactions
  from the start. **Any test asserting a meta-only dispatch does not corrupt
  the document must ensure every transaction before the one under test — the
  fixture setup included — also carries the tag, or the test proves nothing
  while appearing to prove everything.** Verified at the dependency's own
  source (`@tiptap/extensions`'s compiled `appendTransaction`, ungated on
  `docChanged`), not merely from the symptom.

- **Before M7, typing `- [ ] milk` did not create a task item, and that was an
  editor input-rule defect, not a Todo defect.** StarterKit's bullet-list input
  rule fired on `- ` first and converted the block to a `listItem`; `TaskItem`'s
  own `wrappingInputRule` could not then wrap a paragraph already inside a
  `listItem`, leaving the user with a plain bullet and the literal text
  `[ ] milk`, which never reached Todo's predicate. M6's Todo predicate,
  registry, and counts were all verified correct — this was purely the
  M4-era editor never having its own promotion rule for this keystroke. M7's
  `TaskItemPromotion` (see the structural-assertion rule below) closed it; do
  not "fix" a regression here by loosening the Todo predicate to match literal
  `[ ] text` bullets — that was ruled out in M6 and stays ruled out.

- **The bullet-to-task input rule needs a STRUCTURAL assertion, and that is
  why the M4-era version of this bug hid.** A promoted task item and a
  hand-authored one serialize to byte-identical Markdown, so every round-trip
  suite passes whether or not `TaskItemPromotion` fires — the same blind spot
  that let a dead `==highlight==` tokenizer and a live-but-banned underline
  mark both ship. `taskItemPromotion.test.ts` asserts on the parsed document
  and `e2e/notes.spec.ts` drives the real keystrokes (`- [ ] milk` typed, never
  filled — `fill` bypasses input rules entirely).

- **Promoting a bullet lifts it out of an enclosing blockquote, while
  `TaskItem`'s own rule keeps the blockquote in the analogous case.** Accepted,
  not endorsed — nothing is lost and the parent survives, which beats the
  defect. Pinned by a PAIR of tests, one for each rule, so the divergence is
  checked on every run rather than asserted in prose.

- **A nested bullet promoted with `[ ] ` is lifted to the top level, losing
  its indentation.** Accepted for the same reason as the blockquote case:
  nothing is lost and it beats the defect. Pinned by a test.

- **`1. [ ] milk` inside an ordered list does not promote**, because a
  `taskItem` cannot live in an `orderedList`. Fail-safe — the user keeps a
  plain ordered-list item rather than losing anything — and pinned by a test.

- **`toggleTaskList()` DOES split a bullet list correctly when promoting a
  single middle item** — the neighbours survive as plain bullets. This was an
  open question in the M7 spec; the answer is recorded here so nobody
  re-derives it by trial and error.

- **Registration order does not decide which input rule wins FOR THIS PAIR —
  that is not a general law.** `@tiptap/core`'s input-rules runner
  (`InputRule.ts`) is `let matched = false; rules.forEach(rule => { if
(matched) return; ...; if (handler === null || !tr.steps.length) return; ...
matched = true })`: once any rule commits steps, `matched` is set and every
  later rule in the array is skipped for that keystroke — order is load-bearing
  in general. `TaskItemPromotion` and `TaskItem`'s own rule are the one pair
  where order is provably immaterial, because they decline in exactly
  complementary cases (one fires only inside an existing `listItem` in a
  `bulletList`, the other only outside one), so at most one of them ever
  commits steps for a given keystroke regardless of which is checked first.
  Verified by moving `TaskItemPromotion` above `TaskList`/`TaskItem` and
  watching every test in `taskItemPromotion.test.ts` stay green — that result
  does not generalize to any other pair of rules. A rule "declines" by
  returning `null` from its handler (the `handler === null` half of the guard
  above); `TaskItemPromotion` uses that half. The `!tr.steps.length` half is a
  separate guard for a handler that returns non-null but happens not to have
  queued any steps — not the mechanism this rule relies on.

- **`HeadingFold` is an `Extension`, not a `Node` or a `Mark`, so it registers
  nothing in the schema.** Folding is decoration only: a `Decoration.widget`
  for the toggle and badge, and a `Decoration.node` both for the accessible
  name (see below) and, separately, for each hidden top-level block — tagged
  `class: 'bear-fold-hidden'`, which `editor.css` renders `display: none`.
  (There is no `Decoration.hide` in ProseMirror's API; do not grep for one.)
  The document itself is never mutated, so Markdown round-tripping and every
  existing schema test are completely blind to whether this plugin runs at
  all. That is the exact same blind spot that once let a dead `==highlight==`
  tokenizer and a live-but-banned underline mark ship in M4 unnoticed;
  `headingFold.test.ts` exists specifically to assert on the decoration set
  itself, because nothing else in the suite can see it.

- **Fold identity is content-derived (`foldKeyOf`) and fails open, not
  closed.** An ordinal section index (first `##`, second `##`, …) fails
  *closed* on the single commonest edit — inserting or deleting a heading
  above the folded one silently refolds the wrong section — while a stable id
  written into the document would be view state leaking into the user's own
  Markdown, which this project treats as worse than an occasional stale fold.
  Content-derived keys fail *open* in the sense that matters most: a fold
  that no longer matches any heading is simply dropped, never applied to
  content the user never folded. **This is not an absolute guarantee against
  ever applying to the "wrong" section, and a prior version of this bullet
  overclaimed that it was.** Measured: fold `## A`, then insert a NEW `<h2>A</h2>`
  above it — the new section is `nth=0` and inherits the fold, while the
  section the user actually folded is now `nth=1` and reopens. Nothing is
  hidden that the user never folded (the fail-open property holds), but the
  *visible* section is not the one they folded, either — the fold followed
  the occurrence, not the user's original heading. Accepted, recoverable (the
  inline "…" marker on the now-folded section cues that something is folded
  there), and covered in the B1 spec's "Known limits" alongside the
  already-documented reordering case.

- **`Mod-Alt-1`–`6` come from `@tiptap/extension-heading` itself, not from any
  code in this repo, and Bear's own `⌘1`–`⌘6` for the same job is unavailable
  to any web app** (browser/OS chrome claims low digit-only Cmd/Ctrl chords).
  Do not "fix" the level menu's shortcut hints to match Bear's screenshots —
  they are already correct for the web.

- **`Mod-Alt-0` is NOT free.** It is `@tiptap/extension-paragraph`'s
  `setParagraph`, registered as a Tiptap extension like the heading levels
  above it. Tiptap's `StarterKit`/extension list is applied in *reverse*
  registration order for keymap purposes, so whichever extension is later in
  the array wins a shortcut collision silently — no build warning, no runtime
  error, just the other extension's command firing. The general rule this
  cost us: a candidate keybinding, including a template-literal family like
  `` `Mod-Alt-${level}` ``, must be checked against every installed editor
  package's own keymap before being treated as free, not merely against
  browser/OS shortcuts.

- **`HeadingFold` adds `Mod-Alt-f` as a new keymap entry — this is a real,
  deliberate addition, not "no new keyboard binding."** It exists because no
  focusable in-editor control could be built for the toggle: see the Chromium
  finding in `docs/rulings/accessibility.md` (any heading containing a
  `Decoration.widget` becomes a subtree Chromium refuses `.focus()` to, for
  every descendant, regardless of `tabindex`). With no route to a focusable
  gutter control, a keymap was the only way to give keyboard and
  screen-reader users any way at all to reveal `display: none` content.

- **B2 adds `Mod-Alt-ArrowUp`/`Mod-Alt-ArrowDown` for `moveHeadingSectionUp`/
  `moveHeadingSectionDown`, and they collide with nothing only because
  `StoredImage.ts` claims the horizontal pair, not the vertical one.**
  `StoredImage.ts` already binds `Mod-Alt-ArrowRight`/`Mod-Alt-ArrowLeft` (and
  `Mod-Alt-0`) for image resize; B2's own `grep -rEn
  "Mod-Alt-[0-9a-zA-Z]|Mod-Alt-\$\{" node_modules/@tiptap` turned up
  `Mod-Alt-c` from an unrelated package, which is what actually surfaced the
  need to check this family exhaustively rather than by inspection. Any
  future `Mod-Alt-Arrow*` binding — a table nudge, say — must re-run that grep
  against `node_modules/@tiptap`, not assume the arrow keys are still free
  just because Up/Down and Left/Right look like a natural split.

- **The level menu SETS a level; the `Mod-Alt-N` shortcut TOGGLES.** Choosing
  the level a heading already has via the menu is a no-op — the check mark is
  radio semantics, and toggling from a selected radio item would contradict
  the mark. The shortcut's toggle behaviour is pre-existing upstream
  (`@tiptap/extension-heading`) behaviour, deliberately left alone rather than
  overridden to match the menu, because there is nothing wrong with a
  shortcut and a menu having different semantics for the same underlying
  command.

- **`⌥⌘`+digit belongs to heading levels; `⇧⌘`+digit belongs to scope
  switching.** `@tiptap/extension-heading` binds `` `Mod-Alt-${level}` `` for
  1–6 and B1 shipped on it, so a scope shortcut in that family would make an H1
  AND switch scope whenever the editor had focus — one keystroke, two unrelated
  effects, differing by where focus happens to be. `Ctrl`+digit is free in
  Tiptap and was rejected anyway: `Ctrl+1`–`8` switches browser tabs on Windows
  and Linux, and this ships to GitHub Pages.

  **`⇧⌘7`, `⇧⌘8` and `⇧⌘9` are NOT available** — ordered list, bullet list and
  blockquote own `Mod-Shift-7/8/9`. A future Archive smart list therefore
  cannot take `⇧⌘9`, which is the digit Bear gives it.

  **Verify any new binding against `node_modules/@tiptap`, not only against
  browser shortcuts**, and remember the template-literal form a naive grep
  misses:

  ```
  grep -rEn "Mod-Shift-[0-9]|Mod-Alt-[0-9]|Mod-Alt-\$\{" node_modules/@tiptap
  ```

  `e2e/noteListHeader.spec.ts` keeps both halves executable: `⇧⌘4` switches
  scope with the editor focused and writes no heading, and `⌥⌘4` makes an `h4`
  and does not switch scope. If the second ever fails, the reason `⇧⌘` was
  chosen has gone away and this ruling should be revisited.

- **Match global shortcuts on `event.code`, never `event.key`.** With Shift
  held, `key` for the 1 key is `'!'` on a US layout and shifts again under
  두벌식; `code` is the physical key regardless of layout or modifier.
  `useScopeShortcuts` also REJECTS `altKey` rather than merely not matching it,
  so `⌥⇧⌘1` cannot fire a scope switch and a heading toggle together.

- **Highlight has TWO serialized forms, and the `<mark>` one must keep its own
  tokenizer.** `==text==` carries no colour slot, so a non-default colour
  round-trips as `<mark class="hl-blue">text</mark>`. Inventing `==blue|text==`
  was rejected: it puts a literal `blue|` inside the highlight in every other
  reader, while GFM renders `<mark>` as a highlight and merely ignores the
  class.

  The half that is easy to get wrong: **the mark's tokenizer has to claim the
  `<mark>` form itself and lex the contents with `lexer.inlineTokens`.** Left
  to marked's built-in inline-HTML handling, the tag was taken but its
  contents passed through as literal text, so
  `<mark class="hl-green">**bold** green</mark>` came back with a literal
  `\*\*bold\*\*` inside it. That is not an exotic input — it is exactly what
  this app writes the moment a user colours a highlight over text that is
  already bold. **A byte-for-byte fidelity fixture cannot see this**, because
  literal `**bold**` round-trips byte-for-byte too; only a structural
  assertion on the parsed document separates "bold survived as a mark" from
  "bold survived as characters".

- **A `<mark>` class outside the roster is dropped, and that is not a new
  lossy path.** `<mark class="anything">` has always parsed to a plain
  highlight with its class discarded — `mark` is in the schema-derived
  recognized-tag set, so the raw-inline fallback declines it. Recognising four
  names is a strict improvement on discarding all of them. It belongs with the
  other known stable-but-lossy transformations above, not on a list of things
  to fix.

- **The colour menu SETS; it does not toggle.** `toggleMark(type, attrs)`
  decides by `isActive(type, attrs)`, so picking a DIFFERENT colour already
  replaces — a test that only did that passed with the toggle wired in, and
  was verified to by fault injection. Picking the colour that is ALREADY
  CHECKED is where the two diverge: the toggle removes the highlight entirely.
  Setting is correct for the same reason the heading level menu sets while
  `Mod-Alt-N` toggles: these are `menuitemradio`s, and toggling off from a
  checked radio contradicts the mark the user is looking at.

- **`TableHandles` is an `Extension`, like `HeadingFold`, and registers
  nothing in the schema.** H deleted the floating bar this bullet used to
  describe (`TableControls`, one `Decoration.widget` placed before the table)
  in favour of `⊕` edge handles rendered from the table's own row/column
  boxes. The document is still never mutated by either shape, so every
  Markdown round-trip test in the suite stays blind to whether the plugin
  runs at all — `tableHandles.test.ts` asserts on the decoration set and on
  command dispatch, because nothing else in the suite can see this plugin,
  and asserts on neither position nor rect, because jsdom has no layout
  engine (that coverage is Playwright's, in `e2e/editorContext.spec.ts` and
  `e2e/editorAffordances.spec.ts`). With no `labels` option `TableHandles`
  registers **no plugin at all** rather than a layer of unlabelled buttons —
  the same "nobody is listening" shape as `TagPill`'s `onActivate` and
  `HeadingFold`'s `foldHint`, and for the same reason: no user-facing string
  may be hardcoded in this app. See `docs/rulings/tables.md` for the
  shape-guard defect this rebuild logic was fixed against.

- **`ContextMenu` is the same shape again: an `Extension`, event source only,
  no schema footprint.** It owns the `contextmenu` DOM event and the
  `openContextMenu` command, and hands a request UP through an `onOpen`
  callback captured at construction — React draws the actual menu
  (`EditorContextMenu.tsx`). `null` `onOpen` means nobody is listening, the
  same absent-not-inert convention as `TableHandles.labels` and
  `TagPill.onActivate`, and in that state the plugin registers nothing, so
  the browser's native context menu is left untouched. `contextMenu.test.ts`
  is the only thing in the unit suite that can see this plugin run.

- **Two new keyboard bindings reach the context menu, and both are required by
  `docs/rulings/accessibility.md`, not optional convenience.**
  `ContextMenu.ts`'s `addKeyboardShortcuts` wires `Shift-F10` and the
  dedicated `ContextMenu` key (present on many Windows keyboards) to the same
  `openContextMenu` command the pointer route's `contextmenu` handler calls.
  Without them a keyboard-only user has no route to this menu at all — the
  pointer is otherwise the only way in. The command reads `state.selection`
  directly and is authoritative doing so, unlike the pointer route below it in
  the same file, which reads the live DOM `Selection` instead: a command runs
  synchronously against the current state, so there is no DOM-vs-model lag to
  guard against the way a `contextmenu` DOM event must.

- **`codeBlock: false` on `StarterKit.configure` (`extensions.ts`) is
  load-bearing beside `underline: false` next to it, for the identical
  reason: StarterKit registers its own plain `codeBlock`, and leaving it
  enabled while also registering `CodeBlockLowlight` gives the schema two
  extensions claiming the same node type. Tiptap does not reject this loudly
  — the failure mode is a silent double-registration, not a build error —
  which is exactly why `underline: false` was already documented and why
  `codeBlock: false` needed the same treatment rather than being assumed
  obvious by proximity. `extensions.test.ts` asserts the surviving `codeBlock`
  extension carries a `lowlight` option, which only holds if the StarterKit
  copy lost the registration race.

- **A fence's language string is never normalized.** `` ```ts `` stays `ts`
  in the document and on round-trip; it is never rewritten to `typescript`.
  `resolveLanguage` (`codeLanguages.ts`) maps `ts` to the TypeScript grammar
  and label for the PICKER and for highlighting, but that resolution is a
  read-time lookup, not a write. Writing the canonical id back would be a
  silent document mutation on nothing more than opening a note — the exact
  class of rewrite this app's Markdown layer treats as a defect everywhere
  else (see `isNoOp` and the round-trip suite generally). An unrecognised
  fence string (`rust`, or any language this app does not register) resolves
  to nothing, renders unhighlighted, and — critically — keeps its fence text
  exactly as written; it must never fall back to `highlightAuto`-style
  guessing, which would silently colour a block of plain prose as if it were
  code.

- **There are TWO lowlight registries in `lowlight.ts`, and collapsing them
  back into one silently reintroduces a shipped bug.** `lowlight` (full,
  including a working `highlightAuto`) and `lowlightForEditor` (byte-identical
  except `highlightAuto` is starved — it returns an empty text node instead of
  guessing) exist because highlight.js's `highlightAuto` GUESSES a language,
  and `@tiptap/extension-code-block-lowlight`'s decoration plugin calls it
  automatically whenever a fence names no language or an unregistered one.
  `CodeBlockLowlight` MUST be configured with `lowlightForEditor`: with the
  guessing registry, a `` ```rust `` fence — or a bare unlabelled fence — gets
  auto-detected and highlighted live in the editor, directly contradicting
  the no-normalization rule above. This shipped and was invisible to every
  test written for it, including the language-picker's own no-op test on
  `` ```rust ``, until someone typed the fence into a running browser and read
  the DOM. `src/features/editor/index.ts` re-exports the GUESSING `lowlight`
  deliberately: `src/features/export/html.ts` consumes it, because an
  exported document re-highlighting from scratch has no live editor state to
  fall back to and export's own fallback path is guarded separately (see
  `highlightCodeBlocks` in `html.ts`). Do not "simplify" the two back into
  one; a future reader doing so restores exactly the bug this split fixed.

- **Known, deliberately unfixed: the code-language picker acts on "wherever
  the selection is," not on the block its widget is attached to.**
  `CodeLanguageControls.ts`'s `choose` and its filter-input handler both
  re-derive the target block via `codeBlockPosAt(view.state)` rather than
  using the widget's own captured `pos`. Benign today, because the widget
  only renders while the caret sits inside that exact code block — so
  "wherever the selection is" and "the block this control is attached to"
  are always the same block in practice — but the two are not the same
  question, and a future change that lets the widget outlive the caret
  leaving its block (e.g. a hover-triggered picker) would need `pos` wired
  through instead.

- **The `.hljs-*` → syntax-role class mapping exists in THREE places, kept in
  step by comment and review rather than by a test (ruling R4), and the
  compound selectors in two of them are load-bearing.**
  `highlightClasses.ts`'s `ROLE_CLASSES`, `src/styles/editor.css`, and the
  export stylesheet embedded in `src/features/export/html.ts` must all carry
  the same classes for the same six roles — including the UNPREFIXED
  `function_`, `class_` and `inherited__` highlight.js emits without an
  `hljs-` prefix. Nothing mechanically enforces the three-way agreement; a
  role coloured in the editor and not in export (or vice versa) is the
  failure mode, and the mitigation is that a reviewer is told to diff the
  three lists by hand. This ruling (R4) has been tested twice by real
  defects and held both times only because a human review caught it; if a
  third instance ships, replace comment-and-review discipline with a real
  guard that parses the export stylesheet, rather than re-affirming R4 again.
  The compound selectors are NOT stylistic: highlight.js nests scopes as
  MULTIPLE classes on one leaf element (e.g. `class="hljs-title
  class_"`), and the editor's decorations FLATTEN that onto one span while
  export's `DOMSerializer` output NESTS real elements. On the flattened span,
  equal-specificity single-class rules are decided by stylesheet order —
  silently and differently from the nested case, where the innermost element
  simply wins by DOM structure. `KNOWN_FLATTENED_COLLISIONS` in
  `highlightClasses.ts` and its mirrored compound rules in both stylesheets
  exist so the flattened case resolves identically to the nested one instead
  of depending on which role's CSS block happens to sit last in the file.
  **This list is proven NOT exhaustive by its own history** — four rounds of
  widening the sweep corpus each found new combinations (2, then 4, then 9,
  then 10) — so `highlightClasses.test.ts`'s mechanical enumeration test,
  not the current count of entries, is the actual guard: it fails BY NAME on
  any flattened combination the corpus produces with no matching compound
  rule. Do not "tidy away" a compound selector, and do not reorder the
  per-role CSS blocks in either stylesheet on the assumption that source
  order no longer matters — it still decides every combination this list has
  not yet been told about.


- **A note-list preview STRIPS Markdown, block and inline alike. The opposite
  rule was retired on 2026-08-26 and again on 2026-08-27, not caveated.**
  `deriveSnippet` used to preview the
  raw text verbatim, on the reasoning that the row should show what the user
  typed. On a note containing a table that produced
  `hi | a | b | c | | --- | --- | --- |` — which says nothing about the note
  and looks broken. A preview is a summary; the editor is where syntax
  belongs.

  What is removed, and why each: **table rows are dropped ENTIRELY** rather
  than stripped of their pipes, because cells are the shortest text in a note
  and carry none of its sense, so the prose around the table is what the
  preview should show. **Fence delimiters** go for the same reason. **Leading
  block markers** — heading hashes, bullets, ordered numbers, task checkboxes,
  blockquote arrows — are trimmed from the FRONT of a line only, so a `#`
  inside prose is still a tag and still previews as one.

  **Inline marks go too, and the rule that kept them was wrong.** It said
  `**bold**` and `` `code` `` read as light emphasis rather than as structure.
  What it never anticipated is that a COLOURED highlight does not serialize to
  a light delimiter at all: `Highlight.ts`'s `renderMarkdown` emits real inline
  HTML, because `==` carries no colour slot. A real note therefore previewed as
  `hi <mark class="hl-green">abcd</mark> hi, this is good.` — more characters
  of attribute than of note. Once the tag has to go, there is no principled
  line that keeps `**` and drops `<mark>`.

  `stripInline` removes, in this order: code spans, autolinks, raw inline HTML
  tags, links (keeping their text), `==highlight==`, `~~strike~~`, then
  emphasis longest-delimiter-first. **The order is load-bearing** — code spans
  must be unwrapped before a `*` inside one can read as emphasis, and the
  autolink rule must precede the raw-tag rule or `<https://…>` is deleted as a
  tag. It is a sequence of trims, not a Markdown parse: it runs for every row
  on every keystroke of a search.

  **An UNPAIRED delimiter is left alone**, and every pair requires a non-space
  character inside it — CommonMark's own rule. A half-typed `**` is a note
  being written, and deleting one side of a pair silently drops the user's
  characters. Underscore emphasis additionally refuses to fire intra-word, so
  `some_var_name` survives.

  **A backslash escape is held aside under a NUL sentinel while the rules run**,
  or `\*star\*` reads as an emphasis pair and the stripper deletes the very
  characters the backslash exists to keep.

  **A `query` is matched against the STRIPPED lines**, not the raw ones.
  `HighlightedText` searches the snippet `deriveSnippet` returns, so a line
  chosen because it matched must still contain the match after stripping —
  otherwise the row highlights nothing and reads as a false positive. Nobody
  searches for `<mark`.


## Stored images (K1)

- **A stored image is `![alt](files/<id>.webp)` — a relative path, and the
  choice is irreversible.** It cannot change without rewriting every note that
  has an image. Two properties pay for it: sync moves note text verbatim, so a
  device-independent path needs no rewriting in either direction; and a note
  exported beside a `files/` directory is a Markdown bundle that opens in any
  editor, with no app-specific syntax to strip. `src/data/images/` owns the
  pattern, anchored at both ends so `https://x/files/a.webp` does NOT match.

- **`RawImage` owns the `image` token and BRANCHES; `StoredImage` does not
  compete for it.** Two extensions declaring the same `markdownTokenName`
  leaves the winner to the manager's iteration order, which is not a contract
  anyone wrote down. `RawImage.parseMarkdown` checks the destination and emits
  a `storedImage` node or a raw inline explicitly.

- **A REMOTE image URL renders as monospace source, and that is a privacy
  decision rather than an unfinished feature.** A note that fetches from a
  third-party host the moment it opens turns a pasted tracking pixel into a
  beacon and spends a phone's data unasked. Changing it should be its own
  decision with its own setting. **The note list broke this rule for a whole
  sub-project without anyone noticing** — `thumbnail.ts` read the first remote
  URL and rendered it, so the app made exactly those requests one pane over.
  Found by an e2e test that routed the host and watched the request happen;
  `e2e/images.spec.ts` keeps that assertion.

- **Insert a `storedImage` NODE, never the text `![](path)`.** ProseMirror
  serializes a text node with escaping, so inserted Markdown round-trips to
  `!\[\](files/…)` — a broken reference that then renders as source. The
  round-trip fixtures in `markdown.test.ts` are what catch it.


## The image display width (K3)

- **A width rides in the ALT TEXT: `![alt|640](files/<id>.webp)`.** Obsidian's
  convention, chosen over a `displayWidth` column so the size travels with the
  note — sync carries it, an exported bundle carries it, another device lays
  the note out the same way — and so it is per-USE: one screenshot can be full
  width in one note and a thumbnail in another. The cost is real and accepted:
  this is not standard Markdown, and a strict reader shows `alt|640` as the alt
  text.

- **A NON-numeric suffix stays part of the alt text.** `a|b` is what every
  other reader will display, so treating it as a malformed width would silently
  swallow a character the user typed. Zero, negatives, decimals and units are
  all "not a width" for the same reason.

- **The pipe is OMITTED when no width is set**, so an image nobody resized
  round-trips byte-identically to what K1 wrote — and `Mod-Alt-0` resets to
  `null` rather than `|0`, which would parse back the same but serialise
  differently.

- **The width applies as a CSS width, never the HTML `width` attribute.** The
  attribute carries the STORED dimensions so the box can be reserved before the
  blob resolves; a display width must override that without two sources of
  truth fighting over one box.

- **A top-level inline node is re-wrapped in a paragraph, and this fixed a
  shipped bug.** `doc` accepts block content only, so an inline node as its
  direct child is an INVALID document and every transaction on it throws
  `Called contentMatchAt on a node with invalid content` — surfacing as an
  editor that silently refuses to be typed into. `@tiptap/extension-paragraph`
  unwraps a paragraph whose only token is an image, so K1's
  `![](files/<id>.webp)` alone on a line produced exactly that: paste an image
  into an EMPTY note, reload, and the note was frozen. `rawBlock.test.ts` had
  asserted the unwrapped shape and called it correct — the assertion recorded
  the upstream fact and hid the consequence, because nothing ever tried to EDIT
  such a document.

## Callouts (M9b)

- **`> [!warning] Title` is the syntax, and the choice is irreversible.** It
  goes into note text and cannot change without rewriting every note that has
  a callout. The plugin's other spelling — a fenced ` ```ad-warning ` block —
  was rejected because it degrades, in every reader that does not know it, to
  **a code block full of the user's prose**. `> [!warning]` degrades to a
  blockquote, and GitHub and Obsidian core both render it natively. K1 made
  "an exported folder is a portable Markdown bundle" a property of this app;
  a callout that degraded to a monospace box would quietly undo it.

- **The marker used to be ESCAPED, and that was silent corruption.** Probed
  on 2026-08-27: `> [!NOTE]` serialized to `> \[!NOTE\]`, so merely opening
  and saving a note carrying a GitHub alert rewrote it. Nothing in the suite
  could see it. The tokenizer claiming the marker is what fixes it — the same
  mechanism `Highlight` uses for `<mark>`, and for the same reason.

- **The marker is anchored to the START of a block, and a `[!x]` mid-sentence
  keeps its escape.** `markdown.test.ts` asserts
  `> see [!warning] here` still round-trips as `> see \[!warning\] here`.
  That assertion is what stops the fix above from over-reaching into prose.

- **Read leniently, write canonically.** Both spacings parse and they parse
  DIFFERENTLY — the tight form Obsidian and GitHub write produces ONE
  paragraph carrying a hard newline, the loose form two paragraphs — so
  `parseMarker` splits at the first newline and the serializer always emits
  the loose form. Aliases (`note`, `caution`, `failure`, …) normalize to the
  five canonical spellings on save, case-insensitively.

- **An unrecognised marker is never a colour and never lost.** It stays a
  plain blockquote whose `rawMarker` attribute carries the word back out
  verbatim. Inventing a hue from an unknown word would be worse than the loss
  it replaces; dropping the text is not on the table; and leaving it as
  ordinary prose would hit the escaping bug above. **Consequence worth
  knowing:** the marker is consumed, so the user sees a plain quote with no
  visible sign the word is still there. It is, and it round-trips.

- **A callout is an ATTRIBUTE on `blockquote`, never a new node.** A callout
  IS a blockquote — that is what the Markdown says — so the toolbar button,
  `Mod+Shift+B`, nesting, `EditorContextMenu` and `editorState`'s
  `blockquote` flag all keep working untouched, and switching type is
  `updateAttributes` rather than a content-preserving migration between two
  node types. `blockquote: false` on StarterKit is load-bearing for exactly
  the reason `codeBlock: false` beside it is.

- **`calloutTitle` parses from `p[data-callout-title]`, NOT a `div`.**
  `computeRecognizedHtmlTags()` derives its set from every `parseHTML` rule in
  the schema. `div` is not in that set today and `p` already is, so keying on
  `p` cannot change what `createRawInlineHtmlNode` rescues as a side effect —
  and `rawBlock.test.ts` pins `<div>raw html</div>` round-tripping verbatim.

- **`calloutTitle` has NO `renderMarkdown`, deliberately.** Measured: a title
  in an invalid position then serializes to nothing at all, losing its text
  (`'\n\nafter'` for a document whose first child read `stray`). A lenient
  renderer on the node would have HIDDEN that. `sanitize`'s repair unwraps
  such a node to a paragraph instead, which preserves the words and keeps the
  loss observable in a test rather than only in a user's note. Fault
  injection: three of its four tests fail without the repair.

- **`setCalloutType` chains `wrapIn`; it must not call it twice on
  `commands`.** A second `commands.setCalloutType` re-reads the ORIGINAL
  state, where the blockquote does not exist yet, and the stale positions
  throw `TransformError: Gap is not a flat range`. A chain hands each step a
  state derived from the shared transaction.

- **Callouts do not collapse, and that is B1's rule upheld rather than
  overlooked.** `2026-08-20-b1-collapsible-headings-design.md` rules "no list
  folding, no blockquote folding, no code-block folding". Reopened
  deliberately in M9b's brainstorm and kept: a callout long enough to want
  folding usually wanted to be a section under a heading. This is why there is
  no `-`/`+` flag in the Markdown and no fold state to persist.

## Mermaid diagrams (L5)

- **A ` ```mermaid ` fence is a `codeBlock`, and stays one.** No new schema
  node was added: the whole editing/rendered switch (`MermaidDiagram.ts`) is
  an `Extension` registering a node VIEW and a decoration over the existing
  `codeBlock` node, never a new node type. The Markdown round-trip is
  therefore untouched — a diagram note stays portable to GitHub, Obsidian, or
  anything else that reads a fence — and `computeRecognizedHtmlTags()` and
  every round-trip suite are correctly blind to whether the rendering plugin
  runs at all. `mermaidDiagram.test.tsx` is the only thing that can catch a
  dead plugin, precisely because nothing about the schema or serialization
  changed.

- **`CODE_LANGUAGES` is not where a non-highlight language goes.**
  `codeLanguages.ts`'s `CODE_LANGUAGES` is the single list `lowlight` reads to
  register highlight.js grammars; `mermaid` has none, and asking for one
  registers nothing and silently renders the fence as plain text. `mermaid`
  is instead `DIAGRAM_LANGUAGE_ID`, a standalone constant `MermaidDiagram.ts`
  keys its node view on and the language picker labels via
  `codeLabels.diagram`. A future non-highlight fence language belongs beside
  `DIAGRAM_LANGUAGE_ID`, not folded into `CODE_LANGUAGES`.

## Pasting Markdown as Markdown (N)

- **Every `text/plain` paste is parsed as Markdown, with no heuristic gate.**
  The app is Markdown — notes load through `parseMarkdown` and save by
  serializing back — so a paste of Markdown becomes the structure it
  describes. A conservative trigger was considered and rejected because the
  boundary is invisible to the user: they cannot tell why one paste became a
  table and another stayed literal, and a rule nobody can predict is worse
  than one that is occasionally wrong. Measured, not assumed: a lone
  `under_score` does not become emphasis and the serializer escapes it
  defensively, so the prose-mangling risk that argued for the heuristic is
  smaller than it reads. `⌘Z` reverses a paste in one step; no
  "paste as plain text" command ships, deliberately.

- **When a clipboard offers `text/html` that declares structure, that HTML
  wins; the plain flavour is parsed as Markdown only when there is no HTML at
  all or the HTML is pure wrappers.** `htmlCarriesStructure` is the gate, and
  it asks "did the source tell us the structure", NOT "which flavour looks
  more like Markdown". A source's HTML is its considered rendering; its
  plain-text sibling is a lossy serialisation, and re-parsing that is a second
  interpretation.

  **This reverses the rule that shipped with N**, which was "plain text wins
  when it looks like Markdown", and it was reversed on 2026-09-03 by the user
  after real use rather than on taste. Measured, from the reported clipboard
  (both flavours committed as `src/features/editor/fixtures/geminiAnswer.*`):
  a Gemini answer's plain flavour wrapped the whole document in a
  ```` ```markdown ```` fence, and the document itself contained a NESTED
  fence. Fences landed on lines 5, 63, 69 and 93, so the inner fence closed
  the outer one early — parsing it produced 3 paragraphs and 2 code blocks
  with an ASCII diagram stranded between them. The HTML flavour of the same
  clipboard counted `h1`-`h6`: 0, `ul`/`ol`/`li`: 0, `table`: 0, `pre`: 2, so
  ProseMirror's own HTML path yields prose plus exactly ONE clean code block.
  An earlier answer from the same source carried real headings and a real
  table in its HTML; Bear renders that correctly and we did not.

- **`<a>` counts as structure, and that is the point of the tag list rather
  than an oversight.** A paragraph copied off a web page has its link in the
  HTML flavour and NOTHING in its plain text, so calling that payload trivial
  would silently drop the link. Emphasis, code and the table parts are on the
  list for the same reason. Only pure wrappers — `div`, `span`, `p`, `br` and
  the `meta`/`html`/`head`/`body` scaffolding a clipboard payload arrives
  wrapped in — are absent, because a payload built from those alone is a
  plain-text document dressed in HTML and its Markdown reading is better.
  `STRUCTURAL_HTML`'s `[\s/>]` lookahead is load-bearing: without it
  `<article>` matches `a` and `<tablet>` matches `table`, so any page's own
  wrapper markup reads as structure and the Markdown path becomes
  unreachable. It is a regex LITERAL rather than a named array joined with
  `|` because the array form measured **+28 B** gzipped on the eager closure,
  which would have made this defect fix grow the bundle.

- **`looksLikeMarkdown` is GONE, deliberately, and must not come back as a
  gate on the plain-text path.** It had no caller left once the rule above
  landed — a plain-only clipboard is parsed unconditionally, so nothing gates
  it — and dead code with 28 passing tests reads as coverage. Reinstating it
  on the plain-text path would reinstate the heuristic rejected above, where
  the choice is between structure and literal characters and a wrong answer
  mangles a document rather than costing fidelity.

- **`decodeEntities` skips exactly `&amp;` `&lt;` `&gt;` `&quot;`, and the set
  is matched case-sensitively.** Those four are what `parseMarkdown` decodes
  itself; decoding them again is a double-decode, and `&amp;amp;` must reach
  the parser intact to become the text `&amp;` rather than `&`. Skipping them
  also preserves `&lt;div&gt;` reaching the parser as an entity pair, which it
  decodes and then claims as a raw-HTML node. Case-sensitively because `&AMP;`
  is a legacy alias the parser does NOT decode, so it must fall through.
  Everything else — `&nbsp;`, `&mdash;`, `&rsquo;`, numeric references —
  survives the parser as literal text **and gains an `&amp;` on the way back
  out**, so a note carrying one is permanently wrong. The decode happens on
  the PASTE path only: a paste is an import, typing is authoring. Fixing it in
  `markdown.ts` would repair typed notes too but edits the one component whose
  failure corrupts notes silently.

- **`MarkdownPaste` uses `handlePaste`; `ImagePaste` uses
  `handleDOMEvents.paste`. That split is load-bearing, not incidental.**
  ProseMirror consults `handleDOMEvents` before `handlePaste`, so an image
  paste is claimed and `preventDefault`ed before the Markdown handler is
  reached — no duplicated file-sniffing, and no ordering dependency between
  the two entries in `buildEditorExtensions`. Verified by injection
  (`markdownPaste.test.ts`'s "leaves an image paste to ImagePaste"), not
  inferred from ProseMirror's documentation. Moving either handler to the
  other hook reintroduces the contention.

- **`MarkdownPaste` receives its parser through the `parsePastedMarkdown`
  option and must never import `markdown.ts`.** This is not style. `markdown.ts`
  builds its `MarkdownManager` and its `schema` from `editorExtensions` at
  MODULE TOP LEVEL, so importing it from a module that `extensions.ts` reaches
  closes the cycle `extensions.ts -> MarkdownPaste.ts -> markdown.ts ->
  extensions.ts`. Whichever of the two evaluates first then re-enters the
  other before its bindings exist, `editorExtensions` reads `undefined`, and
  `getSchema` throws `Cannot read properties of undefined (reading 'map')` at
  `markdown.ts:40`. **The app does not boot, and all six gates pass** — nothing
  else in the suite happens to import these two in that order, and three code
  reviews read the diff without seeing it, because the defect is in the shape
  of the import graph rather than in any line of it. Shipped on
  2026-09-02 and caught only by running the app.
  `src/features/editor/importCycle.test.ts` pins that one order; it does not
  catch a future cycle in another direction. The option is named
  `parsePastedMarkdown`, not `parseMarkdown`, because `buildEditorExtensions`
  spreads every extension's options into ONE object and a colliding bare name
  silently loses.
