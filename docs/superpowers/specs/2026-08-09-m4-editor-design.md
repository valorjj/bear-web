# M4 — Rich Editor — Design Spec

**Date:** 2026-08-09
**Status:** Approved
**Parent spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Predecessor:** `docs/superpowers/specs/2026-08-08-m3-notes-design.md`

## Summary

M4 replaces M3's plain `textarea` with a Tiptap editor over ProseMirror, keeping
Markdown as the persisted format. The document serializes to Markdown on the
same debounce M3 already ships, through the same `useAutosave` hook, into the
same `notes.save`.

The milestone's real deliverable is not the widget. It is the **round-trip
suite** — the only thing standing between a user's notes and silent corruption.

## Scope

The parent spec's milestone table defines M4 as "`textarea` replaced by Tiptap,
round-trip suite green, both toolbars." Its Editor section additionally assigns
M4 a tag mark, lowlight code blocks with a language selector, tables, image blob
storage, and fold chevrons. That is three to four independent subsystems, and it
is cut here.

### Supported constructs

Headings 1–6, paragraph, hard break, bold, italic, strikethrough, inline code,
fenced code block, bullet list, ordered list, task list, blockquote, link,
horizontal rule, highlight.

The code block ships in M4 and **preserves its language string** — ` ```ts `
serializes back as ` ```ts `. Only the syntax *highlighting* and the language
*selector* are deferred. M4b therefore adds colour to data that is already
correct, rather than introducing a new serialization concern late.

### Deferred

| To  | What                                                                   |
| --- | ---------------------------------------------------------------------- |
| M4b | Tables. Images and the `files` blob path. Lowlight highlighting and the language selector. Fold chevrons on headings. |
| M5  | The tag mark                                                           |
| —   | Syntax-visible decorations (see below)                                 |

**The tag mark is moved to M5 deliberately.** It must serialize `#tag`
consistently with `parseTags`, and `parseTags` does not exist — it is still the
`noTags` stub. Building the mark first means writing a second, informal tag
grammar in the editor and reconciling it a milestone later. It belongs with the
parser.

### Dropped

**Underline.** It has no Markdown representation. Bear's own flavour uses
`_underline_`, which cannot be adopted here: `_text_` is CommonMark italic, so
it would collide with the italic mark and round-trip ambiguously. Serializing to
raw `<u>` was considered and rejected — it leaks a tag that strict readers show
literally and sanitizers strip. Bold and italic cover what the toolbar needs.

**Highlight is kept**, serialized as `==text==`. That convention is understood
by Obsidian, Bear, Notion, and others, and degrades to visible `==` rather than
to lost content anywhere else.

### Syntax visibility

Bear displays Markdown syntax and its styling simultaneously. Tiptap hides
syntax by default, and the parent spec's risk register already warns that
matching Bear requires custom ProseMirror decorations with an outcome that "may
be close rather than identical."

M4 ships Tiptap's default: syntax hidden. This is not in M4's definition of
done, it is pure presentation, and it can be added later without touching the
serializer. Pairing it with the serializer would put two hard problems in one
milestone — the arrangement M3 explicitly avoided by shipping a `textarea`
first.

## The round-trip contract

The parent spec asks the suite to prove that `markdown → document → markdown` is
**idempotent**. That word is correct and achievable, where "identity" would not
be: `* item` normalizes to `- item`, and no document-model editor can avoid it.

**Idempotence alone is not a sufficient test.** A serializer that turned every
note into the literal string `x` would be perfectly idempotent and would pass.
The suite therefore asserts three properties, and needs all three.

| #   | Property         | Input                                                                        | Assertion                            | Catches                             |
| --- | ---------------- | ---------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------- |
| 1   | **Fidelity**     | Canonical Markdown, written in the serializer's own output style             | `serialize(parse(md)) === md`        | A construct serialized wrongly      |
| 2   | **Stability**    | Non-canonical variants: `*` bullets, setext headings, `__bold__`, ragged indentation | `serialize(parse(x))` is a fixed point | Normalization that never settles    |
| 3   | **Preservation** | Constructs with no extension: tables, images, raw HTML                       | Byte-identical output                | Regression of the RawBlock guarantee |

Property 1 is what pins each construct down. Property 2 is the parent spec's
original ask. Property 3 is what makes the scope cut above safe.

### Verification is per construct, not per task

For every construct in the supported set, the implementation plan carries an
explicit step: break that construct's `renderMarkdown`, confirm its fidelity
case goes red, restore it.

This is a process requirement, not a suggestion. M3's reviews found four tests
that read as rigorous and could not fail; two of them had already passed a task
review. On a serializer that class of mistake eats notes silently and without
recovery, so the falsification is a checked step rather than a reviewer's
initiative.

## Unsupported constructs: the verbatim fallback

Deferring tables and images means M4's editor has no node type for them. A note
containing a Markdown table can already exist: written by hand in M3's
`textarea`, or restored through M1's JSON import. Parsed into a document with no
table node and serialized back by autosave, that table would be **silently
destroyed** — the spec's worst-consequence failure mode arriving through the
back door of a scope cut.

M4 closes the class with a single extension rather than construct by construct.

**`RawBlock`** is an inert node holding the raw source of any token with no
matching extension. It renders as dimmed monospace, is not editable as
structured content, and serializes back byte-identically. Its content survives
every edit to the rest of the note.

This is worth more than the deferral it protects. It holds for every construct
`marked` can tokenize, not only the two that were cut, and it lets the round-trip
suite assert identity for unsupported input — a far stronger claim than "we did
not test it." M4b's tables and images replace fallbacks with real nodes; nothing
is thrown away.

## Architecture

```
src/features/editor/
  RichEditor.tsx      Tiptap instance; renders the document, reports Markdown up
  extensions.ts       The extension set — single source of truth for constructs
  markdown.ts         parse / serialize; the ONLY module importing @tiptap/markdown
  RawBlock.ts         Fallback node: unknown token to verbatim source, inert
  Highlight.ts        The == mark: tokenizer and renderMarkdown
  BottomToolbar.tsx   Heading, checkbox, list, bold, italic, highlight, link, overflow
  TopControls.tsx     Bold, italic, info, overflow
  InfoPanel.tsx       Word count, character count, created date, modified date

src/features/notes/
  NoteEditor.tsx      Unchanged role: owns useAutosave; renders RichEditor
                      in place of the textarea

src/app/
  useFlushTriggers.ts Extracted from useAutosave; used by useAutosave AND usePaneWidths
```

`markdown.ts` being the sole importer of `@tiptap/markdown` is deliberate. The
round-trip suite tests that module rather than the editor component, so it runs
without a DOM and stays fast enough to be exhaustive.

`NoteEditor` keeps `key={note.id}` and keeps owning autosave. The editor swap
does not touch the structure M3's reviews hardened.

The existing boundaries hold: `src/ui/` imports nothing from `src/app/`,
`src/data/`, or `src/i18n/`; components reach persistence only through
`src/data/index.ts`; every user-facing string goes through `useT` with keys added
to both `en.ts` and `ko.ts`; every colour comes from a CSS custom property.

### Dependencies

`@tiptap/markdown` 3.29.2 is MIT-licensed, on the public registry, and built on
`marked` ^17. It provides per-extension `parseMarkdown`, `renderMarkdown`, and
`markdownTokenizer` hooks, which is what makes `RawBlock` and the `==` mark
tractable.

This is a change in circumstances since the parent spec was written, which
assumed a community package or a hand-rolled serializer. It lowers the
round-trip risk. It does not remove it: the specification for every construct is
still ours, and the suite is still the only thing that can detect drift.

## Data flow

Mount parses `note.text` into a document. **`savedRef` is then seeded with
`serialize(document)`, not with `note.text`.**

This is not a micro-optimization. Seeded the obvious way, every non-canonical
note in the database would differ from its own serialization the instant it
opened, and autosave would write it back — churning `updatedAt`, reordering the
note list, and re-running the tag reindex, for a note the user only looked at.

With the rule as stated, **opening a note writes nothing, ever.** The first
genuine keystroke writes normalized Markdown. A note stays byte-identical on
disk until the user actually edits it.

The rule is falsifiable and is tested as such: seeding from `note.text` instead
must turn the test red.

The rest of the editing loop is M3's, unchanged: 300ms debounce, flush on blur,
`visibilitychange`, `beforeunload`, and unmount; a flush whose text equals the
last-saved text is skipped; the editor is the sole writer of its note while
open.

### The blank-note rule

The discard condition becomes `markdown === EMPTY_DOCUMENT_MARKDOWN`, a named
constant whose exact value is pinned by its own test.

M3's rule was `buffer === ''` and its guarantee was that it is one comparison,
trivially testable. That guarantee survives the editor swap: it is still one
comparison against a constant, not a trim, a dirty flag, or a heuristic.

## Failure handling

The parent spec covers this in one sentence. There are two distinct paths and
they are separated here.

**Serialization throws.** This happens *before* any write. The flush is
abandoned and `notes.save` is never called, so the stored Markdown is untouched
by construction rather than by discipline. The document stays in memory, an
inline message appears, and the debounce retries on the next edit.

**The save throws.** M3's behaviour, unchanged: retryable, with an inline
message. The message uses `role="status"` and **never** `role="alert"` — the
degraded-storage banner owns that role and the e2e suite asserts on it.

**IndexedDB unavailable.** Still M2's degraded mode. M4 adds nothing.

## Carried-forward items from M3

Three of the five items M3 deferred are folded into M4, because M4 rewrites the
code that owns them.

**The `useAutosave` rollback redesign.** Today `previous` is an optimistic
marker that may name text never actually written; with three saves in flight
where a superseded one also fails, the rollback can target that text, and a
later coincidental string match then skips a needed write. M4 splits the state:
`persistedRef` advances only on a *resolved* success, and a failure rolls the
dedupe baseline back to `persistedRef` rather than to a guess. The monotonic
sequence token stays — that part is already correct, and comparing text instead
of tokens remains unsound for the reason `CLAUDE.md` records.

**The shared flush pair.** `usePaneWidths` fires `void settings.set(...)` with
no flush, so dragging a separator and reloading immediately can lose the width.
`useAutosave` already carries the `beforeunload` / `visibilitychange` pair. M3
deferred the extraction waiting for a second caller; M4 is that caller.
`useFlushTriggers` is extracted once and used by both.

**The `format.test.ts` midnight case.** The documented reason for choosing
`hourCycle: 'h23'` over `hour12: false` — that the latter renders midnight as
24:00 under some ICU builds — is currently asserted in a comment and verified by
nothing. One test case.

Not folded in: **deleting a blank note purges rather than trashes it.** M3 ruled
this defensible and assigned the decision to M6, which owns trash management.
Deciding it here would set trash policy a milestone early.

Also unchanged: **a blank note open across a reload is never discarded**,
because `beforeunload` only flushes and does not unmount. A startup sweep of
empty notes would close it and remains deferred.

## Testing

| Layer      | Coverage                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit       | The three-property round-trip suite over every supported construct. `RawBlock`. The `==` tokenizer. `useAutosave`'s redesigned rollback under fake timers. `useFlushTriggers`. `format.ts`'s midnight case. |
| Components | Opening a note produces no write. Toolbar buttons toggle marks. The info panel counts correctly. Keyed remount still isolates one note per editor instance.                |
| End-to-end | **The existing 14 tests must pass unmodified.** Plus one new flow: type Markdown, reload, and assert both the rendering and the stored bytes.                              |

The existing e2e suite is the regression net for the swap, and it is frozen with
one enumerated exception.

**`toHaveValue()` throws on a `contenteditable`.** A `<textarea>` has a `value`;
a ProseMirror document does not. Four assertions in `e2e/notes.spec.ts` depend on
it and cannot survive the swap unchanged. They become text assertions on the same
locators. `getByRole('textbox', { name: 'Note text' })` and `.fill()` both work
against a `contenteditable` and are not affected.

Those four lines are the complete permitted change. Any other e2e edit that
appears necessary is evidence of a behaviour change and must be escalated rather
than made. The migrated assertions are re-falsified — by removing `NoteEditor`'s
`key` prop and confirming they go red — because a weakened assertion that passes
forever protects nothing, and two of these four exist to catch the "wrote note
A's text over note B" class that the keyed remount removes.

### The open unknown

How much of ProseMirror runs under jsdom is not established. `contenteditable`,
`Range`, and `getClientRects` are all thin there, and this project already
carries a standing rule that pointer-drag paths cannot be unit tested and belong
in Playwright. If editor *interaction* cannot be driven in jsdom, the Components
row above shifts substantially into end-to-end.

This is not guessed at. **The first task of the implementation plan is a spike**
that stands up Tiptap under jsdom and establishes empirically what can be tested
where, before a single construct is implemented. Writing a component suite that
silently no-ops is the precise failure this project keeps finding, and the spike
exists to prevent it.

### Existing test-harness constraints

`vitest.setup.ts` swaps the global `Blob` for Node's, so `instanceof Blob` and
`instanceof ArrayBuffer` are false under test and true in a browser. Duck-type
in tests; never use `instanceof`. `useT` throws without a provider, so component
tests use `renderWithI18n`, which supplies the provider through RTL's `wrapper`
option — passing it as a top-level element breaks `rerender`.

## Carried-forward debt

`parseTags` remains the `noTags` stub. **Every note edited during M4 continues
to accumulate an empty tag index**, and M4 increases the rate at which that
happens. M5 must rebuild the index on upgrade. Nothing in M4 may paper over this
with a temporary regex.

## Definition of done

- The `textarea` is gone; notes render and edit as rich text.
- All three round-trip properties are green for every supported construct, each
  with a recorded falsification.
- A note containing a table survives editing byte-for-byte.
- Opening a note produces no write.
- Both toolbars and the info panel ship.
- The three folded M3 items are closed.
- New user-facing strings exist in both `en.ts` and `ko.ts`.
- All 14 existing e2e tests pass, changed only by the four enumerated
  `toHaveValue` migrations, each re-falsified.
- `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`,
  `npm run format`, and `npm run build` all pass.
