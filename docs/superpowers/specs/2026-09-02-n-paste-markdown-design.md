# N — Paste Markdown as Markdown

Written 2026-09-02, the day after M shipped. The first sub-project in this
repo that came from a user hitting a wall in real use rather than from the
roadmap.

## Purpose

Pasting Markdown into a note inserts it literally. `**bold**` stays as
asterisks, a `|---|---|` table becomes one paragraph per row, and a paste from
a rich web source leaves `&gt;` and `&nbsp;` sitting in the text.

The app **is** Markdown-based, which is what makes this surprising rather than
expected. `RichEditor.tsx` loads every note with
`content: parseMarkdown(initialMarkdown)` and saves by serializing back, so the
stored file is Markdown and the round trip works. What has never existed is a
paste path into that parser: the editor's only paste handler is `ImagePaste`,
which deliberately returns `false` for a non-image clipboard so text falls
through to ProseMirror's default — and that default inserts plain text
verbatim.

The report that surfaced this was a weekly report written in Gemini's UI,
pasted into a note, and unusable. Moving a document written elsewhere into a
note is the workflow this blocks, and it is a core one.

`CLAUDE.md` already recorded "typing Markdown into the editor does not parse it
as Markdown", but as a **testing** caveat ("seed the note, never type it").
This is the same fact arriving as a user-facing defect, which is the more
important half and was not written down.

## What was measured before anything was decided

Four probes against the real `parseMarkdown`, because the design turns on what
the existing parser already does and guessing would have produced a different
spec. Run 2026-09-02 via a throwaway test file, since `markdown.ts` is only
reachable from inside Vitest.

**Entity decoding is narrower than "HTML entities".** The parser decodes
exactly four references and nothing else:

| Input        | Text node   | Round-trips to |
| ------------ | ----------- | -------------- |
| `&amp;`      | `&`         | `&amp;`        |
| `&lt;`       | `<`         | `&lt;`         |
| `&gt;`       | `>`         | `&gt;`         |
| `&quot;`     | `"`         | `"`            |
| `&nbsp;`     | `&nbsp;`    | `&amp;nbsp;`   |
| `&copy;`     | `&copy;`    | `&amp;copy;`   |
| `&mdash;`    | `&mdash;`   | `&amp;mdash;`  |
| `&hellip;`   | `&hellip;`  | `&amp;hellip;` |
| `&rsquo;`    | `&rsquo;`   | `&amp;rsquo;`  |
| `&apos;`     | `&apos;`    | `&amp;apos;`   |
| `&#160;`     | `&#160;`    | `&amp;#160;`   |
| `&#x2014;`   | `&#x2014;`  | `&amp;#x2014;` |

The set is close to, but not exactly, the inverse of what the serializer
escapes. Measured separately: the serializer escapes `&`, `<` and `>` — and
**not** `"`. So three of the four are a symmetric round-trip concern, while
`&quot;` decodes on the way in and does not come back, a lossy but harmless
normalization to a literal quote. Either way this is round-trip machinery, not
HTML entity support. Everything else survives as literal text **and corrupts on
the way out**, gaining an `&amp;`.

**This reframes the report's second half.** The literal `&gt;` the user saw is
not a separate bug: today's paste inserts characters verbatim, so `&gt;` lands
as five characters. Route the paste through `parseMarkdown` and it decodes to
`>` for free. What genuinely needs new work is the residue — `&nbsp;`,
`&mdash;`, `&rsquo;`, numeric references — which is exactly what a rich web
source emits.

**Prose is safer under an always-parse rule than feared.** This was the main
argument against the option that was chosen, and it does not hold up:

| Input                                   | Serializes to                            |
| --------------------------------------- | ---------------------------------------- |
| `prose with an under_score and a # hash mid-line` | `prose with an under\_score and a # hash mid-line` |

A lone underscore is not emphasis (markdown-it needs a pair) and the serializer
escapes it defensively, so the text survives. A mid-line `#` is not a heading.

**Tables and inline marks parse correctly**, so the payload the report was
about needs no new parser work:

| Input                              | Serializes to                                       |
| ---------------------------------- | --------------------------------------------------- |
| `\| a \| b \|` + `\|---\|---\|` + `\| 1 \| 2 \|` | a real table, columns padded |
| `**bold** and _em_`                | `**bold** and *em*`                                 |
| `## Heading` + `- one` + `- two`   | heading and list, unchanged                         |

## What was decided, and why

Four decisions, taken before any design.

### 1. Every `text/plain` paste is parsed as Markdown

No heuristic on this path. The app is Markdown; a paste of Markdown should
become the thing it describes.

The alternative — a conservative trigger that parses only on strong signals —
was rejected because **the boundary would be invisible to the user**. They
could not tell why one paste became a table and another stayed literal, and a
rule nobody can predict is worse than a rule that is occasionally wrong. The
measured prose behaviour above removes most of the risk that motivated the
heuristic, and `⌘Z` reverses a paste in one step.

### 2. Plain text wins over `text/html` only when it looks like Markdown — REVERSED, see below

A clipboard from Gemini, ChatGPT or Notion carries both flavours, and this is
the decision the actual bug report came through.

The detector does **not** disappear under decision 1 — it moves to the one
place it is safe. Here it chooses between **two structured readings** of the
same content, never between structure and literal characters, so being wrong
costs formatting fidelity rather than mangling a document.

- Plain text carries Markdown signals → parse it. The reported case, fixed.
- Plain text is bare prose → ProseMirror's HTML path runs, as it does today.
  Copying a paragraph with a link from a news site keeps the link.

Ignoring `text/html` entirely was rejected for exactly that second row: it
would regress something that works.

**REVERSED 2026-09-03, by the user, after real use.** The rule above is
backwards and the reported clipboard is what proved it. `htmlCarriesStructure`
replaces `looksLikeMarkdown` (which is deleted, having no caller left): the
source's `text/html` now wins whenever it declares structure, and the plain
flavour is read as Markdown only when there is no HTML at all or the HTML is
pure wrappers — `div`, `span`, `p`, `br` and the document scaffolding a
payload arrives in.

What the reversal cost to establish, measured off the user's real clipboard —
both flavours are committed as `src/features/editor/fixtures/geminiAnswer.*`:

- The plain flavour wraps the whole answer in a ```` ```markdown ```` fence,
  and the answer itself contains a NESTED fence. Fences land on lines 5, 63,
  69 and 93, so the inner fence closes the outer one early. Parsing it yields
  3 paragraphs and 2 code blocks with an ASCII diagram stranded between them
  — and `looksLikeMarkdown` returned `true`, so that broken path was taken.
- The HTML flavour of the same clipboard counts `h1`-`h6`: 0, `ul`/`ol`/`li`:
  0, `table`: 0, `pre`: 2. Letting ProseMirror have it yields prose plus one
  clean code block, which is what the source meant.
- An earlier answer from the same source carried real headings and a real
  table in its HTML. Bear renders that correctly; we did not.

The general error in decision 2 was treating the two flavours as peers to be
judged on appearance. They are not: a source's HTML is its **considered
rendering**, and its plain text is a lossy serialisation whose re-parsing is a
second interpretation that fences make actively wrong.

The second row above survives, and is now the reason `<a>` counts as
structure: a copied paragraph has its link in the HTML and nothing in the
plain text, so treating that payload as trivial would drop the link. The
`STRUCTURAL_HTML` pattern's `[\s/>]` lookahead is what keeps `<article>` from
matching `a` and `<tablet>` from matching `table`.

### 3. Entities are decoded on the paste path only

The paste handler decodes entities before handing text to `parseMarkdown`.

This fixes the reported symptom completely, touches nothing that already works,
and leaves notes on disk alone. Fixing it inside `markdown.ts` instead would
also repair typed and existing notes, but it edits the one component whose
failure corrupts notes silently, needs `CANONICAL` and `NON_CANONICAL` entries,
and is only partly N's problem.

The cost is that a paste and a hand-typed `&nbsp;` behave differently. That is
defensible: **a paste is an import, typing is authoring.**

### 4. No escape hatch ships with N

`⌘Z` is the escape hatch. A `Paste as Plain Text` command was considered and
deferred.

The real argument for shipping one now is that `⌘⇧V` is the browser's own
"paste without formatting" shortcut, which strips to `text/plain` — the flavour
this design **parses** — so the native shortcut becomes misleading unless we
claim it. That is a genuine cost, accepted deliberately: it is a small
surprise, and if real use turns up a case that needs literal characters the
command can be added then, designed against an actual example instead of a
guess.

## Design

### Where the handler hooks in

A new extension `MarkdownPaste` in `src/features/editor/`, registered in
`buildEditorExtensions` alongside `ImagePaste`. It uses ProseMirror's dedicated
`handlePaste(view, event, slice)` prop rather than `handleDOMEvents.paste`.

That choice does real work. `ImagePaste` already claims image pastes through
`handleDOMEvents.paste` and calls `preventDefault`, and ProseMirror consults
`handleDOMEvents` **before** `handlePaste`. So an image paste never reaches
`MarkdownPaste`: no duplicated file-sniffing, and no ordering dependency
between the two entries in the extension array.

**That ordering is an assertion, not a verified fact, and it is Task 1.** It is
proved by injection — paste an image, assert `MarkdownPaste` did not run — not
by reading ProseMirror's documentation. If it is wrong, the fallback is a
single `handleDOMEvents.paste` registered after `ImagePaste`'s, which then has
to sniff `clipboardData.files` itself.

Unlike `ImagePaste`, `MarkdownPaste` needs no options and no callback: it
depends on nothing but the clipboard and the schema. So it registers
unconditionally and `editorExtensions` carries it too — there is no
"schema-only, plugin disabled" state to reason about, which is the state
`ImagePaste.onImage === null` exists to express.

It imports `parseMarkdown` from `./markdown`, never `@tiptap/markdown`
directly. The ruling that `markdown.ts` is the only importer of that package
stands.

### Two pure functions, in their own module

`src/features/editor/pastedMarkdown.ts`. No ProseMirror import, no DOM event,
unit-testable standalone — which matters because this is where the bugs will
be.

**`looksLikeMarkdown(text: string): boolean`** — used **only** for decision 2,
and its docblock must say so. (Deleted 2026-09-03 with decision 2's reversal;
`htmlCarriesStructure` took its place. Kept here as the design as shipped.)
Signals, any one of which is enough:

- a fenced code block (```` ``` ````)
- a table delimiter row (`|---|`)
- an ATX heading at line start (`#` to `######` followed by a space)
- a list marker at line start (`-`, `*`, `+`, or `1.`)
- a blockquote marker at line start (`>`)
- a link (`[x](y)`) or image (`![x](y)`)

Deliberately **not** signals: `**bold**` and `_em_`. A rich web source's
`text/html` renders those faithfully, and a plain-text flavour containing
asterisks is weaker evidence than any structural marker.

**`decodeEntities(text: string): string`** — decodes named and numeric
character references **except** `&amp;`, `&lt;`, `&gt;` and `&quot;`.

Skipping those four is the whole subtlety, and it buys two things. It avoids a
double-decode: `&amp;amp;` must reach the parser intact so it becomes `&amp;`,
not `&`. And it preserves today's semantics for `&lt;div&gt;`, which the parser
decodes to `<div>` and then claims as a raw-HTML node — a behaviour change
there would be a silent schema surprise, not an improvement.

Decoding goes through a detached `<textarea>`'s `innerHTML` / `value` pair, per
match, **not a library**. `scripts/bundleSize.test.ts` reports **1,884 B of
headroom** after L3, so an entity package is not affordable; the DOM costs
nothing, and jsdom implements it, so these stay ordinary unit tests rather than
Playwright ones.

A textarea is the right element specifically because its content model is
RCDATA: assigning `innerHTML` decodes references without parsing tags and
without any possibility of script execution.

### Insertion

`parseMarkdown` already returns a schema-valid document — it runs `sanitize`
and `wrapTopLevelInline`, the latter existing precisely because a top-level
inline node makes an invalid document and an editor that silently refuses to be
typed into. So the handler does not need to repair anything:

1. `Node.fromJSON(schema, parseMarkdown(decodeEntities(text)))`
2. wrap its content in a `Slice`
3. `view.dispatch(tr.replaceSelection(slice))`

**Open depth is the one real subtlety.** A result that is a single paragraph
must insert *inline* — `openStart` and `openEnd` of 1 — so pasting `**bold**`
into the middle of a sentence does not split the paragraph. A multi-block
result inserts as blocks, 0 and 0.

Work through the `view.state` / `view.dispatch` the handler is given, never
`editor.commands.*`: a command opens its own outer transaction, and dispatching
inside one throws `RangeError: Applying a mismatched transaction`. `ImagePaste`
carries the same note for the same reason.

### Data flow

```
paste event
  │
  ├─ ImagePaste (handleDOMEvents.paste)
  │    files present? → store, insert storedImage node, preventDefault
  │    otherwise      → return false
  │
  └─ MarkdownPaste (handlePaste)
       text/plain empty?                        → false (default runs)
       text/html present AND !looksLikeMarkdown  → false (HTML path runs)
         [reversed 2026-09-03 to: text/html present AND
          htmlCarriesStructure → false (HTML path runs)]
       otherwise:
         decodeEntities → parseMarkdown → Node.fromJSON → Slice
         → tr.replaceSelection → true
```

Returning `false` rather than claiming the event is the important half of every
branch. `ImagePaste`'s own comment names it: "Claiming every paste is the easy
regression here."

## Testing, and what each layer can actually prove

- **`pastedMarkdown.test.ts`** — table-driven over both pure functions. The
  entity table measured above becomes the fixture, including the four that must
  be left alone and the `&amp;amp;` double-decode case.

- **`markdownPaste.test.ts`** — synthesised paste against a mounted editor.
  jsdom has no `DataTransfer` and no `ClipboardEvent` that accepts one, so the
  payload is hand-built — and it **must** carry a working `getData`.
  `@tiptap/core`'s own `handleDOMEvents.paste` calls `clipboardData.getData`
  before ours is reached, and without it the throw stops our handler running at
  all, presenting as "my plugin does nothing" rather than as an error. It took
  a stack trace to tell those apart once already.

- **An invariant test.** For Markdown `m`, pasting `m` into an empty note and
  serializing must equal `normalizeMarkdown(m)`. Cheap, and it catches
  slice-depth mistakes that no eye will see.

- **One e2e test.** jsdom cannot build a two-flavour clipboard, so decision 2 —
  the HTML-vs-plain choice, and the one the bug report came through — is only
  provable in a real browser.

Every new test must be demonstrated failing against a deliberately sabotaged
implementation before it is trusted. Sub-project H produced three
near-vacuous assertions that passed against broken code, and this repo treats
that as the default risk rather than an unlucky exception.

## Out of scope, named rather than forgotten

- **Dropping text.** `ImagePaste` handles `drop` for images; text dropped into
  a note keeps today's behaviour. Rare enough not to widen N for.
- **The `&amp;nbsp;` round-trip corruption for typed and existing notes.**
  Found by the probe above, real, and untouched by decision 3. It belongs to
  `markdown.ts`, needs round-trip suite entries, and is its own piece of work.

Both go to `NEXT.md` as named residue.

## Documentation this must update

- **`CLAUDE.md`** — the "Typing Markdown into the editor does not parse it as
  Markdown" bullet becomes wrong by half once this ships. Pasting will parse;
  typing still will not. The testing rule it exists to protect ("SEED the note,
  never type it") is unchanged and must survive the edit. Plus a status-table
  row for N.
- **`docs/rulings/markdown-and-schema.md`** — the always-parse rule, the
  `looksLikeMarkdown`-gates-only-the-HTML-choice rule, the four-entity
  exclusion, and the `handlePaste`-not-`handleDOMEvents` ordering. Its
  `**Trigger:**` line gains `MarkdownPaste.ts` and `pastedMarkdown.ts` so the
  index and the file stay in step.
- **`NEXT.md`** — N marked shipped, and the two residue items recorded.

No new user-facing strings: decision 4 means N ships no UI, so `en.ts` and
`ko.ts` are untouched.
