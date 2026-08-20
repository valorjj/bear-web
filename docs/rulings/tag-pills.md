# Tag pills and activation

Governs how `#tag` is rendered inside the editor as a decoration, how the pill's
extent is kept in agreement with the tag index, and how Mod-click activates a
tag into a scope.

**Trigger:** any change to `src/features/editor/TagPill.ts` (`tagDecorations`,
`tagRangeAt`, `tagHitsIn`, `TagPillOptions`, the `handleDOMEvents.mousedown`
handler), `src/features/editor/blockText.ts` (`maskedBlockText`, `MASK`),
`findTagRanges`/`parseTags` in `src/data/tags/parseTags.ts`,
`RichEditor.tsx`'s `activateRef` / `onActivateTag` / `data-mod-held` wiring,
`AppShell.handleActivateTag`, the `--bear-tag-fill` and `--bear-tag-fill-strong`
tokens or the `.bear-tag` rules in `src/styles/editor.css`, and the suites
`tagPill.test.ts`, `tagAgreement.test.ts`, `blockText.test.ts`,
`src/data/tags/tagRanges.test.ts`.

- **`parseTags` is the deduped name-only view of `findTagRanges`, and the tag
  grammar exists in exactly one place.** The scanner always computed each
  tag's start and end and threw them away; M7.6 stopped throwing them away
  rather than writing a second parser for the editor, which would have been
  two implementations of one grammar — this project's signature defect.
  `parseTags` is now defined as
  `[...new Set(findTagRanges(x).map(r => r.tag))]`, so the agreement describe
  block in `parseTags.test.ts` is tautological while that one-line definition
  holds — it asserts the exact same expression the implementation already is,
  so it does not, by itself, prove the grammar's behaviour is preserved. What
  it does do is act as a tripwire: the instant someone forks the two into
  separate implementations, the tautology breaks and the test starts
  asserting something real. Behaviour preservation of the grammar itself is
  guarded separately, by every other describe block in `parseTags.test.ts` —
  the corpus of cases that predates M7.6 and asserts `parseTags`' actual
  output against expected tag lists.

- **The tag pill is a ProseMirror DECORATION, never a mark.** The document is
  untouched, so no schema, serializer or round-trip path is involved and a
  pill can never survive into a note's Markdown. The cost is that **every
  round-trip test in this project is blind to whether the plugin runs at
  all** — the same blind spot that let a dead `==highlight==` tokenizer and a
  live-but-banned underline mark ship in M4. `tagPill.test.ts` asserts on the
  decoration set itself and is the only thing that can catch a dead plugin.

- **`maskedBlockText` emits one character per document position, and the
  plugin's position arithmetic depends on it.** `node.textContent` cannot be
  used: a `hardBreak` contributes no characters but occupies a position, so
  every offset after it would shift and pills would paint the wrong
  characters. Non-text inline nodes contribute one mask character per
  position, which is also correct — a line break must terminate a tag.
  **A `hardBreak` itself contributes `'\n'`, not the mask character** — an
  earlier draft of the plan masked it, and that was wrong: a hard break
  genuinely is a line break, so serializing the paragraph makes `parseTags`
  find the same tag `maskedBlockText` must also see. A newline is whitespace,
  so it both terminates a tag and permits one to start — the opposite of what
  the mask character is for — but it is still exactly one character, so the
  one-character-per-position invariant survives. **A known limit, accepted,
  not fixed:** a paragraph containing both a fence marker and a hard break
  suppresses the pill while `parseTags` still yields the tag — the tag works,
  only the pill is missing, the same shape as the mark-boundary limit below.

- **`maskedBlockText` masks the FIRST character of every marked text run, and
  `code` whole.** All six marks in this schema — `bold`, `italic`, `strike`,
  `highlight`, `link`, `code` — serialize with an opening delimiter (`**`,
  `*`, `~~`, `==`, `[`, `` ` ``), verified against the real serializer. So the
  first character of a marked run is preceded by `*`, `~`, `=`, `[` or a
  backtick in the Markdown, never by whitespace, and `parseTags` refuses to
  start a tag there. The document contains no such character, so without this
  the plugin accepted `**#bravo**` as the tag `bravo` while the index —
  correctly — held nothing. **That is a pill asserting something false about
  the user's data**: the user bolds a tag to emphasise it, the pill stays, and
  the tag silently vanishes from the sidebar, its counts and tag filtering.
  Strictly worse than a missing pill, and the inverse of the fail-safe
  direction the spec's known limit assumed. Masking the run WHOLE was rejected:
  `**see #work here**` puts the `#` after a space, a tag really is there, and
  removing the pill trades one disagreement for another. One character also
  keeps the one-character-per-position invariant, and an astral first character
  is replaced code-unit-for-code-unit rather than by a single mask.

- **The pill set and the tag index are asserted EQUAL, over a corpus, as one
  property — `tagAgreement.test.ts`.** That the two agree is the milestone's
  central claim, and until M7.6's Task 6 nothing anywhere compared them: each
  side was tested against its own expectations, which is how the `**#bravo**`
  defect survived five task reviews and a whole-branch review. Both halves come
  from the real pipeline — decorations read back through
  `doc.textBetween`, and `parseTags` over `serializeMarkdown(editor.getJSON())`,
  exactly what `RichEditor.getMarkdown` produces. **Any new construct, mark or
  masking rule belongs in that corpus**, the same way a new Markdown construct
  needs entries in both the fidelity and stability suites.

- **A known limit, accepted and NOT fully fail-safe: a mark delimiter landing
  inside or immediately after a tag's own characters.** `*`, `~` and `=` are
  not tag boundaries, so `parseTags` reading `**see #work**` yields the tag
  `work**`, while the pill covers `#work` — **a pill of the wrong extent, not
  merely a missing one.** Same shape for `*…*`, `~~…~~`, `==…==`, for
  `#work**bold**` (indexes as `work**bold**`), and for a tag continuing into a
  mark — `x #wo**rk** y` pills `#wo` and indexes `wo**rk**`. **The `link` case
  is worse and is ONE of two surviving lying-pill classes** (the other is the
  whitespace hoist in the next bullet): `[see #work](https://e.com)` indexes
  NOTHING, because `](https://…)` puts an empty `/`-segment in the name and
  `normalizeTag` rejects the whole candidate — so the pill is there and the
  tag is not. No editor-side masking can close any of this: agreement would
  need the pill to cover characters the document does not contain, and the
  cause is a pre-existing parser/serializer interaction that predates pills and
  is visible in the sidebar with or without them. Closing it means changing
  `parseTags`' grammar, which reorganises every existing user's sidebar.
  A code span is the control that proves the diagnosis: backticks ARE masked on
  both sides, so a tag continuing into an inline code span agrees exactly. All
  of it is pinned with its real values in `tagAgreement.test.ts`'s `RESIDUAL`
  block. **The spec is wrong about this residue in two ways, and the corpus
  pins the truth instead.** Its "Known limit" paragraph in
  `docs/superpowers/specs/2026-08-13-m7-6-tag-pills-design.md` calls the
  residue fail-safe, which the extents above disprove; and it says a tag split
  across a mark boundary (`#wo` bold, `rk` plain) still indexes and only loses
  its pill, which it does not — `**#wo**rk` puts `**` before the `#`, so
  `parseTags` rejects it too and the two views agree. Do not restore the spec's
  wording from prose.

- **The second lying-pill class: a mark applied over a run's own LEADING
  WHITESPACE, which the serializer hoists outside the delimiter.** This is why
  `maskedBlockText`'s docblock says a marked run's first character is only
  _usually_ delimiter-adjacent — as an absolute the claim is false. Measured:
  bold over `'  #work'` between `pre` and `post` serializes to
  `pre  **#work**post`, so the space moved OUT of the delimiter; the pill
  covers `#workpost` and the index holds nothing. Identical for `italic`
  (`pre  *#work*post`), `strike` (`pre  ~~#work~~post`), `highlight`
  (`pre  ==#work==post`) and `link` (`pre  [#work](https://e.com)post`).
  `'   #work '` gives `pre   **#work** post`, pill `work`, index none; a run of
  `'  #work'` alone in a block gives `  **#work**`, same. **The precondition is
  two or more leading whitespace characters** — with exactly one space, or one
  tab, the first-character mask covers it and the two views agree, and `code`
  is masked whole so it agrees too. Pre-existing (it lied before the
  first-character masking as well) and unreachable from Markdown: only applying
  a mark over leading whitespace in the UI produces it, which is why no
  Markdown-sourced corpus entry could catch it and why its fixtures in
  `tagAgreement.test.ts` are built node-wise.

- **The pill lifts while the cursor is inside its tag.** Without it, typing
  `#w`, `#wo`, `#wor` re-pills on every keystroke and character widths jump
  under the cursor. Intersection, not containment: a caret at either edge
  counts as inside. **Gated on `editor.isFocused`**: an unfocused editor still
  has a selection (a fresh note opens with one at position 1) but no caret on
  screen, and without the gate a note seeded with a leading tag — exactly what
  creating a note inside a tag scope does — opened with that tag permanently
  unpilled.

- **The `#` stays visible inside the pill.** This app does not hide Markdown
  syntax, and the hash is the only thing distinguishing a tag from the heading
  that `# ` — one space different — produces.

- **`--bear-tag-fill` is a separate token from `--bear-selected`, and the two
  deliberately diverge.** Same hue, different alpha: Paper's `selected` at 0.11
  is right for a selected row — a whole band that only has to read as present —
  and too weak for a pill, which is a few characters of inline text and has to
  read as a discrete chip. At 0.11 the pill read as a highlighted word. Paper's
  fill is 0.16; Ink's 0.18 was already comfortable, so the two tokens coincide
  there. **`--bear-tag-fill-strong` is a third token**, used only by the
  `[data-mod-held='true']` rule, and `--bear-selected` was rejected for that
  state because it is fainter than a resting pill in Paper and identical to it
  in Ink — holding the modifier would look like the pill fading rather than
  lighting up. Both are tier-1 palette tokens, so every theme in the roster
  must define them; `scripts/sourceLint.test.ts` checks that per theme and
  compares the system-dark block against its named theme value-for-value.

- **The pill's horizontal padding is asymmetric, and that is not a typo.**
  `0.05em 0.15em 0.05em 0.25em`. Equal padding pushed a following comma or
  full stop visibly away from the word it belongs to — `#friday ,` — because
  a tag ends at punctuation far more often than it begins after it. The
  leading side keeps its full inset so the `#` reads as part of the chip.
  A negative inline margin was considered and rejected: it hides the gap by
  letting the pill overlap its neighbouring characters.

- **Plain click on a tag pill edits; Mod-click activates.** Bear filters on a
  plain click, and this is a deliberate divergence: Bear can afford it because
  its tag autocomplete makes mistyped tags rare, while this app has none, so
  editing a tag in place is the normal repair path and a pill that defended
  itself against being edited would be worse than an inert one. **If
  autocomplete ever ships, revisit this ruling** — it is the premise the
  divergence rests on.

- **Mod is Cmd on Apple platforms and Ctrl elsewhere, never `metaKey ||
  ctrlKey`.** Ctrl-click on macOS is the context-menu gesture; accepting both
  means one gesture opens a menu AND changes scope. `isMacOS` from
  `@tiptap/core` decides. Getting this wrong is invisible on Linux CI, so
  `tagPill.test.ts` asserts both branches.

- **Activation is handled in `handleDOMEvents.mousedown`, not `handleClick`.**
  ProseMirror does not place the caret itself on a plain click — the browser
  moves the DOM selection natively during `mousedown` and ProseMirror reads it
  back. By `handleClick` (which runs on `mouseup`) the caret has already moved,
  suppression has already lifted the pill, and the thing the user clicked has
  vanished under the cursor. `event.preventDefault()` on mousedown is the only
  point that stops it.

- **`tagRangeAt` hit-tests the grammar, never the decoration set.** A tag the
  caret sits inside has no pill; if activation followed the pills, the same
  gesture would work or not work with nothing on screen to explain the
  difference. Behaviour must not depend on invisible state. It shares
  `tagHitsIn` with `tagDecorations`, so the `blockPos + 1 + offset` arithmetic
  exists once — perturbing it fails both suites, which is the proof. Both also
  gate on `type.spec.code` rather than on a node name, so a rename or a second
  code-ish node stays covered.

- **`tagRangeAt` resolves the clicked position to its own textblock; it does
  not walk the document.** `state.doc.resolve(pos)` already knows the
  position's ancestry, so the containing block is reachable directly and the
  gesture costs the same on a 900-block note as on a one-line one — the
  whole-document `descendants` walk it replaced measured 1.5 ms median / 5.2 ms
  worst on 100 KB, imperceptible but proportional to note size where the spec
  said constant. The two are behaviourally identical (document positions are
  unique, so no other block's ranges can contain `pos`), which means **this
  change is pinned by no behavioural test and could be reverted silently.**
  What IS pinned: `$pos.before()` must take the position of the _immediate_
  textblock, not an outer one — a paragraph inside a blockquote starts one
  position later than the blockquote does, and `before(1)` shifts every offset
  by the difference (a `tagPill.test.ts` test fails on exactly that). And
  `!$pos.parent.isTextblock` is load-bearing twice: it rejects what cannot hold
  a tag, and it is what keeps `before()` from throwing at depth 0, where the
  parent is the document itself. An explicit `$pos.depth === 0` clause was
  written alongside it and then removed — `doc.isTextblock` is false, so no
  injection could make that clause fail, and an unfalsifiable branch is a
  defect here.

- **Activating a tag the index does not hold does nothing.** M7.6 ships two
  classes of lying pill. Setting a scope for one would trip the vanished-tag
  effect and bounce the user to All Notes — a click that visibly throws them
  somewhere they did not ask to go. The same handler returns early while
  `tree.nodes` is `undefined`, because that means "loading", not "no tags".

- **`onActivate` returns a boolean, and the app's answer — not the plugin — is
  what consumes the event. A Mod-click either filters, or behaves exactly like
  a plain click. Never nothing.** The plugin originally called
  `preventDefault()` before asking, which made every case the app declines cost
  the user the caret as well as the filter: the click simply vanished. That is
  not only the two lying-pill classes and a trashed note's pills — **a tag
  typed within the last ~350 ms is unactivatable too**, because the index is
  written by autosave (`AUTOSAVE_DELAY_MS = 300`) and the guard correctly
  declines a tag that is not in it yet. Measured before the fix: 50/150/300 ms
  after typing → nothing at all; 400/500/700 ms → filtered. So the plugin now
  asks first and consumes second, and `AppShell.handleActivateTag` returns
  `false` on both refusals and `true` after setting the scope. **`RichEditor`'s
  ref-backed wrapper must PROPAGATE that boolean** — the "simplification" to a
  statement body returns `undefined`, which reads as declined and silently
  disables the whole feature while every callback still fires; pinned by a
  `RichEditor.test.tsx` test asserting both directions.

- **`RichEditor` passes `null` for `onActivate` when no `onActivateTag` prop is
  supplied, and the boolean gate above made that contract look redundant
  without making it so.** The decision is made once, in the `useState`
  initializer, matching the plugin's read-once semantics. Historically a
  non-null wrapper meant the plugin believed someone was listening and
  `preventDefault()`ed a Mod-click into nothing; since the boolean contract the
  outcomes coincide instead — with an unconditional wrapper and no prop,
  `activateRef.current` is `undefined`, `undefined === true` is `false`, and
  the app-declined path produces a byte-identical `handled: false` /
  `defaultPrevented: false`, so deleting the `null` guard left 1034/1034 green
  one commit after the same injection failed a test. The two exits are still
  genuinely different: `null` declines **before** the hit test, a `false`
  answer **after** it. The test therefore spies on `posAtCoords` and asserts
  the plugin never even asked where the click landed; the decline-by-answer
  test asserts the mirror. **Any future guard added in front of this handler
  needs the same treatment** — outcome-only assertions cannot separate two
  exits that produce the same outcome.

- **The tooltip stays optimistic on pills that cannot work, and that is
  inherent.** Both lying-pill classes and every pill in a trashed note light up
  under the modifier and read "Cmd-click to filter by this tag", then decline.
  The editor deliberately learns nothing about scopes or the tag index, and the
  guard that knows lives downstream of the decoration, so making the copy
  honest means pushing index knowledge into the editor — the boundary M7.6 and
  M7.7 were both careful not to cross. After the boolean contract above the
  _click_ is honest (it places the caret, exactly like a plain click); only the
  copy still promises. Do not chase this further without a design that crosses
  that boundary deliberately. One related latency with no live instance:
  `RichEditor` passes `activateHint` unconditionally, so a `RichEditor`
  rendered with no `onActivateTag` — where `onActivate` is `null` and the
  gesture is genuinely off — would still paint promising tooltips. Every live
  call site supplies the prop; if one ever does not, gate the hint on the same
  condition.

- **The modifier affordance is a DOM attribute set through a ref, never React
  state.** `data-mod-held` on the editor's outer element; setting state on
  every `keydown` would re-render the editor subtree on every keystroke the
  user types. It is derived from each event's own modifier flags on both
  `keydown` and `keyup`, and cleared on window `blur` — hold Cmd, press Tab to
  leave the window, and the `keyup` never arrives, leaving pills claiming to
  be clickable while a plain click edits. **This is convention enforced by
  nothing** — there is no lint rule or test forbidding a future edit from
  routing this through `useState` instead, the same gap the
  `@tiptap/markdown` single-importer rule already names for itself.

- **`editorExtensions` is `buildEditorExtensions()` with no options**, so
  `getSchema(editorExtensions)` and `computeRecognizedHtmlTags()` are
  unaffected by anything the app injects. An `Extension` registers nothing in
  the schema, and the options must never be able to change that. **This too is
  convention enforced by nothing**: no test asserts that a future option added
  to `TagPillOptions` (or any sibling extension) leaves the schema untouched.

- **The tooltip's locale is frozen at mount.** `RichEditor` builds its
  extension array once, so switching locale leaves every pill's `title` in
  the old language until the editor remounts — which a note switch does
  anyway, since `NoteEditor` is keyed by note id. Fixing it properly means
  either recreating the editor on locale change (throwing away undo history)
  or turning `activateHint` into a getter, changing an option shape that is
  now pinned by tests. Accepted, not a defect.

- **Under jsdom `navigator.platform === ''`, so `isMacOS()` is false on every
  machine, including a Mac.** Any test of a platform-dependent branch must
  stub `navigator.platform` explicitly before the code under test runs — for
  `RichEditor` that means before render, since `isMacOS()` runs inside a
  `useState` initializer — and restore it in a `finally`. This milestone
  shipped two tests named for platform branches that could never execute
  them.
