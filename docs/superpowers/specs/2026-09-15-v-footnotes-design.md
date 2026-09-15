# V — Footnotes (각주) — Design Spec

**Date:** 2026-09-15
**Status:** Draft — awaiting review
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Builds on:** sub-project U (`2026-09-15-u-heading-links-design.md`) — its
reveal machinery is reused rather than re-implemented, see "Navigation".
**Rulings that govern this work:** `docs/rulings/markdown-and-schema.md` (a new
node, a new tokenizer, a new keyboard binding, the round-trip fixtures),
`docs/rulings/export.md`, `docs/rulings/design-tokens-and-layout.md`,
`docs/rulings/accessibility.md`, `docs/rulings/testing-and-tooling.md` (the
eager-JS ceiling)

## Summary

`[^1]` in the prose renders as a superscript number; `[^1]: text` at the end of
the note renders as a 각주 section listing the notes. Clicking a marker reveals
its definition and a `↩` returns to the marker. A toolbar control inserts the
pair and puts the caret in the new definition.

Footnotes are CommonMark's own, stored exactly as written. The document is the
note — there is no generated block, no synchronisation layer, and nothing the
app rewrites behind the writer.

### Non-goals

- **Multi-paragraph definitions.** CommonMark lets a definition continue across
  indented paragraphs. V is single-block, stated up front rather than
  discovered halfway through the tokenizer.
- **Footnotes inside footnotes.** A `[^a]` inside a definition renders as a
  marker with no special nesting behaviour.
- **A generated footnotes container.** Considered and rejected — see the
  decisions below.
- **Any change to sync, the backlinks index, or the graph.** Notes are text;
  nothing here touches Dexie's schema.
- **Renumbering the SOURCE.** Inserting a footnote renumbers the display, never
  the labels in the file.

## Decisions made during brainstorming

Three questions were open. All three are settled.

**A footnote's text lives at the bottom of the note, as ordinary editable
blocks.** `[^1]` in the prose, `[^1]: text` as real blocks, rendered as a 각주
section. You edit a footnote by typing in it.

The alternative — editing the text in a popover on the marker, with the
definitions block generated on save — was rejected because it puts one truth in
two places: the app would rewrite the end of the note, and a definition edited
by hand there would have to be reconciled with the popover. The document being
the note is how every other construct in this app works.

A third option, "markers only, no editing affordance", was rejected as the
rendering half of the feature with none of the behaviour that makes footnotes
worth having.

**The number comes from the order of first reference, not from the label.**
CommonMark's own rule: `[^why]` is an identifier, and the visible number is
positional. So labels can be words, and inserting a footnote in the middle
renumbers everything after it ON SCREEN with no edit to the file.

Rendering the label verbatim was rejected: it is simpler to build, but it shows
a word label as that word, makes the writer renumber by hand, and diverges from
every other renderer that will ever read these notes.

**V is a writing feature as well as a reading one.** A toolbar control and
shortcut insert the marker, create the definition and move the caret into it.
Without it, every footnote costs a scroll to the end of the note and a label
typed twice by hand, which is the part people stop doing.

**The document models the construct — two real nodes.** Two alternatives were
weighed:

- *A mark on text, with definitions as ordinary paragraphs recognised by
  pattern.* Cheaper, but the document stops modelling the construct: the
  literal `[^1]:` either shows in the prose or needs hiding decorations, and
  every consumer re-derives "is this a footnote?" by regex. This project has
  paid for that shape once already — `parseTags`/`findTagRanges` exists because
  of it.
- *One `footnotes` container node holding every definition, kept at the end.*
  Closest to the reference app's section, and collapse gets a natural home —
  but definitions are legal anywhere in CommonMark, so the app would have to
  MOVE them into the container. That is the synchronisation layer the first
  decision rejected, reappearing in a different place.

## Architecture

### Schema

```ts
// src/features/editor/Footnote.ts
footnoteRef        // inline, atom, selectable; attrs: { label: string }
footnoteDefinition // block; attrs: { label: string }; content: inline*
```

Nothing else is stored, **and in particular not the number**. A number in an
attribute would be derived data living in the document, which goes stale the
moment a marker is inserted above it — and would then be serialized into the
user's file.

### Markdown

An inline tokenizer for `[^label]` and a block tokenizer for `[^label]: text`,
registered through `markdownTokenizer` exactly as `Highlight.ts` does for
`==…==` and `RawBlock.ts` does for inline HTML. Both serialize back verbatim,
so a note round-trips byte-for-byte.

Label grammar: `[^` followed by one or more characters that are not `]`,
whitespace or `^`, then `]`. Deliberately narrower than CommonMark, which
allows almost anything: a permissive label would let `[^` swallow prose when
the closing bracket is on another line, and this app has the tag grammar's
scars to prove how that ends.

`markdown-and-schema.md` requires a new construct to appear in the
`CANONICAL`/`NON_CANONICAL` round-trip fixtures; footnote cases go in with the
rest.

### Numbering — one function, two callers

```ts
export function footnoteNumbers(doc: ProseMirrorNode): Map<string, number>;
```

Pure, walking the document once and assigning `1..n` by order of FIRST
reference. Unreferenced definitions get no entry.

The editor paints those numbers as **decorations**. Decorations are view-only
and never serialize — the trap `CodeBlockLowlight` already sprang on this
project, where a correct stylesheet was applied to nothing in every export. So
`renderNoteBody` (`src/features/export/html.ts`) calls **the same function on
the same document**: it already builds a real `ProseMirrorNode` before
serializing, so no second walk and no second rule are needed. Markdown export,
HTML export, the server-rendered PDF and the published page all funnel through
that one function, so all four are served by this.

This is sub-project U's lesson applied before it costs anything. U shipped two
heading readers and a test to pin them together; the test failed on its first
run and the readers were collapsed into one. Here there is one implementation
from the start, so there is nothing to keep in agreement.

### The 각주 section

Generated chrome, never text. A decoration draws the header above the first
`footnoteDefinition` and makes the contiguous run collapsible.

The word "각주" must not enter the Markdown, and `Callout.ts` already argues
why: a UI-language string baked into note text makes the note depend on which
language was selected the last time it was saved. The header's string comes
from `useT` and is threaded into the extension as an option, the same contract
`linkActivateHint` and `linkEditLabel` follow.

**The collapse is session state and is deliberately NOT persisted.** Heading
folds are persisted (`noteFolds`) because the reader chose them per section and
would lose their place; the 각주 section is one run at the end of the note, and
a footnote list that stayed shut across a reload would read as footnotes that
had gone missing. It lives in plugin state, defaults open, and resets on
remount.

### Navigation

Clicking a marker reveals its definition; a `↩` control on each definition
returns to its first marker.

The `↩` is a **widget decoration**, not a character in the definition — the
same reason the link pencil is one: it is chrome, and anything in the document
reaches the user's Markdown and every export. Numbers on definitions are
decorations for the identical reason.

Both reuse U's machinery rather than repeating it. `HeadingReveal` currently
takes a heading's TEXT, finds its position and flashes it; the reusable core is
"reveal this POSITION" — unfold whatever hides it, scroll it near the top,
flash it. V extracts that core and calls it with a position; U's command keeps
its own text-to-position lookup on top. The `keysRevealing` unfold rule needs
no change at all.

### Writing

One command, `insertFootnote`, on one transaction so undo restores both halves
in a single step — the rule `moveHeadingSection` already follows.

It picks the next free NUMERIC label (`max(existing numeric labels) + 1`,
starting at 1), inserts the marker at the caret, appends the definition after
the last existing definition (or at the end of the document when there is
none), and leaves the caret in the new definition.

Numeric even though labels may be words: a label the app invents should read
like what it is, and a word label is a choice the writer makes deliberately.

Reached from the bottom toolbar beside the callout and table controls, and from
a keyboard shortcut registered the way `markdown-and-schema.md` requires a new
binding to be.

### Orphans fail open

A marker with no definition renders muted, the way an unresolved `[[link]]`
does. A definition nobody references keeps its label instead of taking a
number. Neither is an error; both are ordinary mid-writing states, and both
are reachable simply by typing the two halves in the natural order.

## Testing

- **`footnoteNumbers`** is pure and carries the bulk: order of first
  reference; a label referenced twice taking one number; an unreferenced
  definition taking none; a marker with no definition still numbered; insertion
  in the middle shifting everything after it.
- **Round-trip fixtures** for both forms, in `CANONICAL` and `NON_CANONICAL`,
  driven standalone through the manager as every serializer test is.
- **The export path** needs its own assertion that numbers reach the HTML —
  this is exactly where decorations would have silently produced nothing, so a
  test that only looks at the editor would pass against a broken export.
- **Navigation** belongs in Playwright: jsdom cannot scroll, and U's e2e
  already proves the shape.
- **The insert command** must assert ONE undo restores both halves. A test that
  checks only the marker would pass against two transactions.
- **Orphans** get their own rendering assertions, since they are the states a
  writer is in most of the time while writing.

Per `testing-and-tooling.md`, any test here that could pass against a sabotaged
implementation is not yet a test — and per U's own postmortem, at least one
test must drive the real toolbar control rather than hand-typing the Markdown
the control would have produced.

## What could go wrong

- **The eager-JS ceiling.** U left **2,985 B** of headroom at 361,000. Two
  nodes, two tokenizers, a numbering pass, decorations, navigation and a
  toolbar control may not fit. **Measured early — after the schema and Markdown
  layer, roughly half the cost — not at the final gate**, so the choice arrives
  while the branch is still small. The options are the ruling's three (lazy
  boundary, server, cut) and a raise is the user's call.
- **`[^` in ordinary prose.** A note about Markdown syntax will contain
  `[^1]` as an example. The narrow label grammar and the code-mask both help,
  but the honest answer is that a footnote-looking string IS a footnote, the
  same rule `#tag` follows.
- **A definition in the middle of a note.** Legal in CommonMark. It renders
  where written, and the 각주 header decorates the first one — so a scattered
  note looks odd but loses nothing. Moving them would be the rejected
  synchronisation layer.
- **The atom marker and the caret.** An inline atom can be selected as a node,
  and Backspace beside one deletes the whole marker. That is correct, but it is
  the kind of thing that needs a test rather than an assumption.
