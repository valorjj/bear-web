# Tag pills and activation

Governs how `#tag` is rendered inside the editor as a decoration, how the pill's
extent is kept in agreement with the tag index, and how a plain click
activates a tag into a scope (S4) or opens a `[[link]]`'s target (the change
that followed it — see below).

**Trigger:** any change to `src/features/editor/TagPill.ts` (`tagDecorations`,
`tagRangeAt`, `tagHitsIn`, `TagPillOptions`, the `handleDOMEvents.mousedown`
handler), `src/features/editor/blockText.ts` (`maskedBlockText`, `MASK`),
`findTagRanges`/`parseTags` in `src/data/tags/parseTags.ts`,
`RichEditor.tsx`'s `activateRef` / `onActivateTag` wiring,
`AppShell.handleActivateTag`, the `--bear-tag-fill` and `--bear-tag-fill-strong`
tokens or the `.bear-tag` rules in `src/styles/editor.css`, and the suites
`tagPill.test.ts`, `tagAgreement.test.ts`, `blockText.test.ts`,
`src/data/tags/tagRanges.test.ts`. Also `src/features/editor/LinkPill.ts`
(`linkDecorations`, `linkRangeAt`, `linkHitsIn`, `LinkPillOptions`, its
`handleDOMEvents.mousedown`), `AppShell.handleActivateLink`, and
`linkPill.test.ts` — the link pill's activation is a deliberate copy of this
file's contract, not an independent design. Also `tagSyntaxDecorations` and
`linkSyntaxDecorations`, the `bear-tag__hash` / `bear-link__bracket` /
`bear-link__slash` / `bear-link__heading` / `bear-link__tail` classes,
`src/data/links/splitLinkTarget.ts`, `src/features/editor/HeadingReveal.ts`,
`keysRevealing` in `headingSections.ts`, `AppShell`'s `reveal` state and
`NoteEditor`'s `foldsRestored`,
the `--bear-tag-icon` and `--bear-link-icon` tokens, and any selector anywhere that counts
`.bear-tag` or `.bear-link` elements. Also `src/features/editor/TagAutocomplete.ts`
(`tagAutocompleteMatchAt`, `matchingTags`, `insertTag`, `openRows`, `openFrom`)
and `tagAutocomplete.test.ts` — S4's autocomplete is the premise the plain-click
ruling below rests on.

- **`LinkPill`'s activation matches `TagPill`'s exactly, and now including
  the gesture: a PLAIN click opens the target, an unresolved link falls
  through to the caret, and `onActivateLink === null` makes the plugin inert
  — same reasons, same shape.** `mousedown`, not
  `handleClick`, because the browser moves the DOM selection natively during
  mousedown and by mouseup the caret has already moved and the pill has
  already vanished. `preventDefault()` is called only AFTER
  `onActivateLink` answers true, for the identical reason as `onActivate`
  above: calling it first would make every declined case (no note has that
  title, the index has not caught up with a just-typed link) cost the user
  the caret as well as the navigation, turning a decline into the gesture
  simply vanishing. `RichEditor` passes `null` for `onActivateLink` when no
  `onActivateLink` prop is supplied, matching `onActivate`'s `null` contract
  bullet above verbatim: the schema-only `editorExtensions` constant (used
  wherever the editor is mounted with no app wiring, e.g. some tests) gets a
  plugin that never even hit-tests a click, not one that asks and is always
  told no.

- **One divergence from `TagPill`, and it is deliberate: link resolution
  reads a KNOWN-TITLES SET held in plugin state, not a Tiptap option.**
  Options are read once at construction; a title set passed as an option
  would never refresh, and every link created during a session would render
  unresolved forever. `RichEditor` dispatches `setKnownNoteTitles` as a
  meta-only transaction whenever `notes.allNoteTitles()` resolves, and that
  transaction must carry `skipTrailingNodeMeta` — see
  `docs/rulings/markdown-and-schema.md`'s `TrailingNode` entry for why a
  meta-only, zero-document-step dispatch is dangerous without it.

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

- **A pill's HIT AREA is its drawn element, not its document range.** Both
  `mousedown` handlers test `event.target.closest('.bear-tag' / '.bear-link')`
  before doing anything else, and that test is what makes a pill possible to
  type after.

  `tagRangeAt`/`linkRangeAt` match inclusively at BOTH edges
  (`pos >= from && pos <= to`), which is correct for the question they were
  written for — "should the pill lift, given where the caret is?" — because a
  caret at either edge is inside. Reusing them to answer "did the user CLICK
  the pill?" conflates two different questions, and the position just past the
  closing bracket is exactly where a caret goes to continue the sentence.
  `posAtCoords` resolves a click in the gap after a pill to that position, so
  **every attempt to place the caret after a tag or a link activated it
  instead**, and the keyboard was the only way to type there. Reported from
  real use on 2026-09-16, after shipping since S4/L2.

  This is J2's rule seen from the other side: there the danger was targets too
  SMALL to hit, here a target wider than its ink stole the character beside
  it. An oversized target turning a near-miss into the wrong action is the
  same defect either way.

  **The geometry decides whether a test can see this, and the first two
  attempts could not.** A pill with prose after it on the same line does NOT
  reproduce it — a click in the following space resolves past `to`, so even
  the old code fell through. It bites only where the pill ENDS ITS LINE, where
  `posAtCoords` clamps back onto the last position in the textblock. Both
  regression tests therefore use a line-ending pill
  (`e2e/tags.spec.ts`, `e2e/backlinks.spec.ts`'s own seeded fixture), and both
  were demonstrated failing against the unfixed handlers.

  Consequence for the unit tests: a synthetic `new MouseEvent` that is never
  dispatched has `target === null`, which is an event no browser produces at
  those coordinates. The three helpers now attach the real element ProseMirror
  rendered. Sixteen tests passed before this change while exercising a hit
  path the browser could not produce.

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
  there. **`--bear-tag-fill-strong` is a third token**, used by the tag pill's
  `:hover` rule — which was a `[data-mod-held='true']` rule until the gesture
  lost its modifier. It had a second consumer, the RESOLVED link pill's hover,
  until that pill lost its fill and its hover became an underline (see below);
  do not read its single call site as dead-token evidence. `--bear-selected`
  was rejected for that state because it is fainter than a
  resting pill in Paper and identical to it in Ink — the hover would look
  like the pill fading rather than lighting up. Both are tier-1 palette tokens, so every theme in the roster
  must define them; `scripts/sourceLint.test.ts` checks that per theme and
  compares the system-dark block against its named theme value-for-value.

- **The pill's horizontal padding is asymmetric, and that is not a typo.**
  `0.05em 0.15em 0.05em 0.25em`. Equal padding pushed a following comma or
  full stop visibly away from the word it belongs to — `#friday ,` — because
  a tag ends at punctuation far more often than it begins after it. The
  leading side keeps its full inset so the `#` reads as part of the chip.
  A negative inline margin was considered and rejected: it hides the gap by
  letting the pill overlap its neighbouring characters.

- **A plain click on a tag pill filters, matching Bear, since S4 — and a
  plain click on a RESOLVED link pill opens its target, since the change
  right after it.** The previous ruling here (no modifier gesture at all;
  Mod-click reserved for `LinkPill`) read "if autocomplete ever ships,
  revisit this ruling" and S4 is that revisit: with `TagAutocomplete.ts` in
  place, the repair path for a mistyped tag no longer depends on a plain
  click landing a caret inside the pill, so the divergence's premise is gone
  and the Mod-activates requirement is deleted outright.

  **S4 then left `LinkPill` holding a reservation for a gesture nothing was
  reserving it from**, and that asymmetry is what the follow-up deleted: a
  plain click acted on a tag and did nothing on a link, with no principle
  left holding the difference up. The premise transfers whole — `[[`
  autocomplete shipped with L2, so the repair path for a wrong title does
  not run through clicking a caret into the pill either. It was reported as
  a bug by the user, in exactly those terms: "I expect the actual
  navigation, but it does not."

  Links keep ONE thing tags do not need: an unresolved pill still places the
  caret, because `handleActivateLink` declines a title with no note behind
  it and the plugin consumes nothing on a decline. That is not a special
  case bolted on for this — it is the pre-existing boolean contract two
  bullets up, and it happens to leave the pointer a way into a link's own
  text. `e2e/backlinks.spec.ts` pins both halves, and the resolved half was
  demonstrated failing against a re-injected modifier gate before it was
  trusted. The macOS Ctrl-click refusal is a different piece of
  platform knowledge and survives — `isMacOS` is still imported and used by
  `TagPill.ts`; see the bullet three below for why.

  Two gestures regress as a direct consequence, and both are accepted rather
  than worked around. **A selection drag that STARTS inside a pill filters
  instead of selecting** — starting from the space before the tag still
  works. **A double-click on a tag filters on the first `mousedown`, so no
  word selection ever happens** — the second click of the pair lands on
  whatever note the filter just switched to. Deferring the decision to
  `mouseup` (`handleClick`) cannot rescue either case: by `mouseup` the caret
  has already moved, the pill's suppression-while-caret-inside has already
  lifted it, and the thing the pointer went down on has already changed
  underneath it — this is the same ordering argument the `mousedown`-not-
  `handleClick` bullet below makes for activation generally, and it applies
  identically to a drag's `mousedown` and a double-click's first `mousedown`.
  `mousedown` remains the only interception point that can stop the caret
  moving at all, which is exactly what makes it the only workable point for
  this gesture too — there is no later point in the sequence that still has
  the information filtering needs.

- **~~Mod is Cmd on Apple platforms and Ctrl elsewhere, never `metaKey ||
  ctrlKey`~~ — struck: no pill has a modifier REQUIREMENT left.** `TagPill`
  lost its at S4, `LinkPill` its at the change above. What both keep is the
  narrower half, and it is the half that is easy to lose by "simplifying":
  **both mousedown handlers still refuse a macOS Ctrl-click**
  (`isMacOS() && event.ctrlKey` returns `false`), because on macOS a
  Ctrl-click is the context-menu gesture and arrives as `button === 0` with
  `ctrlKey` set, NOT as `button === 2` — so `event.button !== 0` alone does
  not exclude it. Without the refusal, one gesture would open the context
  menu AND re-scope the note list, or open the menu AND navigate away from
  the note the menu belongs to. This is why `isMacOS` is still imported by
  `TagPill.ts` and `LinkPill.ts` and by nothing else in the editor.

  No Linux CI run can see either refusal: jsdom reports `navigator.platform`
  as `''`, so `isMacOS()` is false on every machine and a test that merely
  BRANCHES on it exercises the non-Apple arm twice. Both `tagPill.test.ts`
  and `linkPill.test.ts` stub `navigator.platform` explicitly and restore it
  in a `finally`, which is the only shape that drives the Apple arm at all.

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
  what consumes the event. A click either filters, or places the caret.
  Never nothing.** The plugin originally called
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
  `preventDefault()`ed a click into nothing; since the boolean contract the
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
  inherent.** Both lying-pill classes and every pill in a trashed note read
  "Filter by this tag" (or, on a link, "Open this note"), then decline.
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

- **~~The modifier affordance is a DOM attribute set through a ref, never
  React state~~ — struck: `data-mod-held` no longer exists.** It was the
  editor's outer-element mirror of the held modifier, kept out of React state
  because setting state on every `keydown` re-renders the editor subtree on
  every keystroke. S4 left it alive for the link rules alone; when the link
  gesture lost its modifier too, the attribute, its window `keydown`/`keyup`/
  `blur` listener in `RichEditor`, and the two `RichEditor.test.tsx` tests
  that read it were all deleted, and both CSS rules became plain `:hover`.
  Deleted rather than left inert on purpose — an attribute nothing selects on
  is the kind of thing a later reader keeps alive by accident.

  **The reasoning survives the attribute**, and is why this bullet is struck
  rather than removed: any future affordance that must track a live input
  state across the editor belongs on a DOM attribute set through a ref, for
  exactly the re-render reason above. And the `blur` backstop is the detail
  worth carrying forward — hold Cmd, press Tab to leave the window, and the
  `keyup` never arrives.

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

## The sigil is hidden in the rendered state, and revealed under the caret

Added 2026-09-07, when the tag pill was restyled to read as an object in the
prose rather than as emphasis on it.

- **"This app never hides Markdown syntax" is retired, and it was
  MIS-STATED rather than merely wrong.** It lived as a comment in
  `src/styles/editor.css` beside the link pill. The editor holds a real
  ProseMirror document, not Markdown text: `**bold**` is a `strong` mark,
  `# ` is a heading node, a fenced block is a `codeBlock`. None of those have
  any syntax in the document to hide or show, so the rule could only ever
  have applied to the two constructs that live as PLAIN TEXT with a
  decoration painted over them — `#tag` and `[[title]]`. It described two
  special cases as a universal principle, which is why reversing it for tags
  read as breaking a rule rather than as correcting one.

  The replacement, which is also what the reference app does — measured from
  two screenshots on 2026-09-07, not assumed: **rendered syntax is hidden,
  and the syntax under the caret is revealed.** Bear shows `**` dimmed on the
  line the caret is in and hides it everywhere else; with the caret in a
  heading, nothing in the note shows a marker at all.

- **The reveal is not a second rule, and must not become one.** It falls out
  of the suppression that `tagDecorations` and `linkDecorations` already
  perform: a tag or link the selection intersects gets NO pill, so there is
  nothing to hide its sigil either. `tagSyntaxDecorations` and
  `linkSyntaxDecorations` are therefore derived from the PILL decorations —
  mapped from their ranges, never computed from a second doc walk — which is
  what makes the two incapable of disagreeing. Any future change that
  computes the collapse independently reintroduces the possibility of a
  hidden sigil the user cannot reveal, which is the one outcome this design
  exists to prevent.

- **A pill therefore renders as TWO spans, and a resolved link pill as
  THREE.** ProseMirror splits overlapping inline decorations into one span
  per distinct class set, so `#work` is
  `<span class="bear-tag bear-tag__hash">#</span><span class="bear-tag">work</span>`.
  Every selector that counts pills must exclude the sigil span
  (`.bear-tag:not(.bear-tag__hash)`), and this is not hypothetical
  book-keeping: a bare `.bear-tag` in `e2e/measure.spec.ts` matched the
  collapsed span first and recorded a **0 x 0 transparent box** into the
  committed `measurements.md` — a reference file that looks like coverage
  while measuring nothing. `tagPill.test.ts`, `appearance.spec.ts` and
  `notes.spec.ts` all had to be corrected the same way.

- **Link brackets collapse on a RESOLVED pill only.** An unresolved link is
  muted text plus a dashed underline and carries no glyph, so its `[[ ]]` are
  the only thing separating "a link to a note I have not written yet" from
  ordinary prose. Hiding them there deletes the signal; hiding them on a
  resolved link costs nothing, because the accent colour and the glyph ARE the
  signal. (This bullet read "because the fill IS the signal" until
  2026-09-15, when the fill was removed — the conclusion held, its stated
  reason did not.)

- **A resolved link is accent text plus a raised glyph, NOT a filled pill —
  and it is the one place the link deliberately stops copying the tag.** The
  fill it shared with `.bear-tag` was dropped on 2026-09-15. The reason is
  what the two constructs ARE, not how they are drawn: a tag is an object
  dropped into the prose and reads correctly as a chip, while a link IS the
  prose, and a background behind it inserts padding mid-sentence and breaks
  the line's text continuity for no signal the accent colour was not already
  carrying. The reference app marks a link with colour alone.

  Colour alone was still rejected here, and that is the whole of the
  divergence from the reference: an accent-coloured run is not distinguishable
  from any other accent-coloured run, and nothing else in the app says the
  text is clickable. `--bear-link-icon` (lucide `ArrowUpRight`, masked over
  `currentColor` exactly as `--bear-tag-icon` is) draws on the title span's
  `::after`, raised by `vertical-align` to sit as a footnote marker does. It
  is TRAILING, not leading, because a leading mark indents the link text and a
  link that starts a line would then sit out of step with the paragraph above
  it. Superscript, so it costs the line no horizontal rhythm.

  Three consequences, none of them optional. `.ProseMirror .bear-link` has no
  base rule left — `border-radius`, `padding` and `box-decoration-break`
  existed only to shape the fill. The hover is an underline, because
  `--bear-tag-fill-strong` has nothing to sit on and re-introducing a
  background on hover alone would reinstate the very padding jump the fill was
  dropped to avoid. And `e2e/contrast.spec.ts` lost its
  `{ overlay: 'tag-fill', ground: 'bg', fg: 'accent', min: 3.0 }` row, which
  existed for this pill alone: nothing paints accent on that fill any more, so
  the row would have passed while measuring a combination the app does not
  render. A link is `accent` on `bg`, already checked at 4.5 — stricter than
  the 3.0 removed.

## Heading links: `[[Note/Heading]]`

Added 2026-09-15, sub-project U. Spec:
`docs/superpowers/specs/2026-09-15-u-heading-links-design.md`.

- **`splitLinkTarget` is the only place the `/` rule exists, and its first
  branch must stay first.** The whole inner text is tried as a title BEFORE
  any split, so a note genuinely titled `A/B testing` resolves as itself
  rather than as note `A` with heading `B testing`. Titles containing a slash
  are ordinary (`TCP/IP`, `2026/09/15`). Failing that, it walks the slashes
  right-to-left and takes the LONGEST prefix naming a real note — so a heading
  may itself contain a slash, which is the opposite of the intuitive reading
  and is pinned by a test.

- **It scans the RAW text and normalizes each candidate as it goes, never the
  normalized string.** `normalizeTitle` lowercases and collapses whitespace,
  so an index taken from its output does not address the same character in the
  raw text — and `slash` exists precisely so the pill can cut the text it is
  decorating. A double-spaced title is the case that catches this.

- **Resolution reads the NOTE alone; the heading never makes a link look
  broken.** A heading renamed or deleted since the link was written opens the
  note at the top and costs the reader nothing else. This is why there is no
  heading index, no new Dexie table and no migration — the alternative was
  put to the user and declined.

- **Exactly ONE span carries `bear-link__tail`, and the `::after` glyph hangs
  off that class.** A resolved heading link renders as three content spans
  (note, slash, heading), so the older `:not(.bear-link__bracket)` selector
  matched every one of them and would have drawn three arrows. Nothing in the
  repo can SEE a doubled glyph — it is painted by CSS off a class — so
  `linkPill.test.ts` counts tail spans instead, and that count was
  demonstrated failing against a tail widened to the whole content.

- **The index is unchanged and stores the RAW target.** `parseLinks`,
  `reindexNote` and the `noteLinks` schema are untouched; `notes.linksTo`
  gains a `startsWith(key + '/')` query beside its exact one, and
  `buildGraph` splits before its `byTitle.get`. Splitting at index time was
  rejected because it would make a note's derived rows depend on OTHER notes
  existing. The separator is part of the prefix on purpose — `startsWith(key)`
  alone also matches a note titled `Deploy Checklist v2`.

- **A heading link into a note that does NOT exist still makes one graph ghost
  per distinct target.** Splitting requires a known title and a missing note
  has none. Unchanged from before U, pinned by a test, and recorded because
  the opposite is what a reader expects.

- **The reveal travels as a nonce-carrying prop, not through the editor
  handle.** `AppShell` keys the editor by note id, so following a link to
  another note remounts it and the target editor does not exist at click time.
  A read-once-at-mount prop would still be enough for that case — but a link
  to a heading in the note you are ALREADY in remounts nothing, and without a
  changing value there is nothing for the effect to react to. **A single-click
  e2e test cannot see this**: it passed against an effect keyed on the heading
  text. The test follows the same link twice, with a scroll between.

- **`NoteEditor` gates `revealHeading` on `foldsRestored`, and the sequencing
  is load-bearing.** The persisted fold restore is ASYNCHRONOUS, so without
  the gate the order is: reveal unfolds the target (against an empty fold set,
  removing nothing), then the restore lands and folds it straight back. The
  link then opens the right note at a collapsed heading — the exact "reads as
  broken" failure the unfold exists to prevent. Found by e2e; no unit test can
  see it, because jsdom neither lays out nor scrolls.

- **`keysRevealing` drops ANCESTOR folds too**, and tests the range
  `pos`..`end` rather than `contentStart`..`end`: a folded h2 hides its h3s,
  and a section's own fold leaves its heading visible while hiding the body —
  arriving at a collapsed heading with nothing under it reads as a broken
  link.

- **A folded section's text is still in the DOM (`display: none`), so
  Playwright's `toContainText` cannot see a fold at all.** Written that way,
  the unfold test passed both against a fold that never happened and against
  an unfold that never happened — two vacuous assertions in one test. Assert
  `toBeVisible` / `toBeHidden` on the body paragraph.

- **There is ONE heading reader, and it goes through the real parser.**
  `noteHeadings.ts` derives headings with `parseMarkdownDoc` plus
  `headingSections`; `notes.textOf` hands back text and the data layer knows
  nothing about heading grammar. A regex scanner in `src/data/` existed first
  and an agreement test caught it on its first run: `headingSections` reports
  a heading as RENDERED (`node.textContent`), the scanner reported it as
  WRITTEN, so `## Some **bold** step` would have been offered by the popover,
  written into the link, and never found by the navigator. Do not reintroduce
  a second reader "for speed".

- **`linkAutocompleteMatchAt` matches with the caret immediately before a
  link's own `]]`, and `insertLink` consumes those brackets via `closeTo`.**
  L2's guard refused any caret with a `]]` ahead of it on the line, because
  replacing `[[`→caret alone stranded the original tail as
  `[[Full Title]] Title]]`. U made that exact position load-bearing: the
  popover inserts `[[Title]]` CLOSED, so adding `/heading` afterwards means
  moving back inside — and the guard rejected there, leaving the two halves of
  U unable to meet. **Shipped that way and reported from production on
  2026-09-15**; every test in the branch typed the title by hand and never let
  the popover close a link, which is why none of them saw it.

  What still refuses, and must: a new link opened to the LEFT of an existing
  one (`[[Be| and [[Alpha]]`) — the `]]` ahead belongs to the other link, and
  `after` does not start with it — and a caret mid-title (`[[first no|te]]`),
  which is conservative and costs one arrow key.

- **Clicking a pill needs `data-resolved="true"` waited for, not assumed.**
  The known-title set reaches the plugin from an effect after
  `notes.allNoteTitles()` resolves, so a pill is briefly unresolved and a
  click then places a caret instead of navigating — which presents as
  Playwright's "element is not stable".

- **`white-space: nowrap` on the pill is load-bearing, not tidying.** The
  glyph is drawn by the name span's `::before`, and
  `box-decoration-break: clone` gives a wrapped fragment a complete box — so
  a break between glyph and name produced a box containing nothing but the
  glyph at the end of one line and the name in a second box on the next,
  reading as two pills, one of them empty. Measured with
  `#economy/us-market` from the corpus at the new size, not guessed. The
  accepted cost is that a tag longer than the 40em measure overflows instead
  of wrapping.

- **`--bear-tag-fill` is derived from `--bear-text`, not `--bear-accent`.**
  An accent tint reads as emphasis on the text; the pill is meant to read as
  an object sitting in it. The tint SCALE is unchanged, so each theme's own
  tuning still applies. All seven explicit per-theme overrides had to move
  too — High Contrast keeps OPAQUE fills, as everything in that theme does,
  with only the hue going neutral — and `e2e/fixtures/themeBaseline.json` was
  re-based for the five pre-F themes with the reason recorded in that spec's
  docblock. That guard exists to catch accidental drift; this was a change of
  intent, and the fact that every other token in the baseline stayed
  identical is what made the two distinguishable.

  Note the second, indented copy of the dark palette inside
  `@media (prefers-color-scheme: dark)`: a two-space search-and-replace over
  `tokens.css` silently skips it, and `sourceLint.test.ts`'s
  "keeps the system-dark block identical to its named theme" is what catches
  the miss.

- **The pill's TEXT COLOUR now matches the prose deliberately**, so
  `appearance.spec.ts`'s pill test asserts `toBe(proseColor)` where it used
  to assert `not.toBe`. What separates a pill from the prose is the fill, the
  radius and type set above the surrounding size — the last of which the test
  now asserts, and which was demonstrated to fail against a stylesheet
  sabotaged back to `1em`.

- **Open, and deliberately not settled here: Bear keeps the FORMATTING while
  revealing the syntax; we drop the decoration entirely.** Bear's `**text**`
  stays bold with the markers dimmed beside it; our tag reverts to plain text
  the moment the caret enters, because `tagDecorations`' suppression predates
  the glyph and exists so character widths do not jump while a tag is being
  typed. At the pill's new size, keeping the pill and adding a visible `#`
  would jump the line further than Bear's two dim asterisks do. Whether the
  pill should persist through editing is a real question; it is not answered
  by this ruling.
