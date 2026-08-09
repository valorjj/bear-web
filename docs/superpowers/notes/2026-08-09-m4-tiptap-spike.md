# M4 Task 1 spike: Tiptap ground truth

Versions installed (exact, matches the brief's `^3.29.2` range):

```
@tiptap/core@3.29.2
@tiptap/markdown@3.29.2
  └── marked@17.0.6
@tiptap/react@3.29.2
@tiptap/starter-kit@3.29.2
```

All four packages resolved to `3.29.2` with no deduping surprises; `marked@17.0.6`
came along as `@tiptap/markdown`'s dependency, confirming markdown parsing goes
through `marked`, not a bespoke tokenizer.

## Standalone MarkdownManager

Yes — `MarkdownManager` parses and serializes with no `Editor` and no DOM,
**but only when constructed correctly**. The brief's suggested test helper:

```ts
const instance = new MarkdownManager();
for (const extension of StarterKit.configure().extensions ?? []) {
  instance.registerExtension(extension);
}
```

registers **zero** extensions. `StarterKit.configure()` returns an object whose
own keys are `['type', 'parent', 'child', 'name', 'config']` — there is no
`.extensions` property at all; it is `undefined`, so `?? []` silently produces
an empty array. StarterKit, like every Tiptap "combined" extension, declares
its children through the `addExtensions()` lifecycle hook, which is only
invoked by an extension manager's flatten/sort pass (normally triggered by
constructing a real `Editor`). With the brief's helper, `serialize()` returns
`''` unconditionally for every input, while `parse()` still looks like it
works for common node types (heading, paragraph, ...) because
`parseFallbackToken` hardcodes fallback cases for those regardless of
registration. This made the harness bug easy to miss by eyeballing `parse()`
output alone — the divergence only shows up in `serialize()`.

The correct standalone construction passes the extensions to the constructor,
which internally calls the same `flattenExtensions` → `sortExtensions` →
`registerExtension` pipeline that the real `Markdown` Tiptap extension uses
when there is a live editor (`extensions: this.editor.extensionManager.baseExtensions`):

```ts
function manager(): MarkdownManager {
  return new MarkdownManager({ extensions: [StarterKit.configure()] });
}
```

With this construction, `md.parse('# Hello')` → `md.serialize(doc)` correctly
round-trips to `'# Hello'`. The committed `characterization.test.ts` uses this
corrected helper, with the observed harness bug documented in a comment above
it. **Action item for later tasks:** any code that builds a `MarkdownManager`
outside of a live `Editor` (e.g. for import/export tooling) must construct it
via the `extensions` constructor option, never by reading `.extensions` off a
configured extension.

## Empty document

`md.serialize(md.parse(''))` is the empty string `''`.

Internally, `serialize()` calls `isEmptyOutput()` on the rendered result and
collapses anything that trims to `''` (including strings that are only
`&nbsp;`/` `, used internally to preserve blank paragraphs) down to the
literal `''`. This is the exact value that should back `EMPTY_DOCUMENT_MARKDOWN`
in Task 6 — there is no synthetic placeholder (e.g. no leading marker, no
single newline) to account for.

## Trailing newline

No. `serialize()` does not emit a trailing newline. `md.serialize(md.parse('#
Hello'))` is exactly `'# Hello'` — no `\n` appended. This is the canonical form
for every case in Tasks 2–6: outputs should be compared/stored without an
assumed trailing newline, and any code that manually appends `'\n'` for
"POSIX-style" file endings is adding it on top of this dependency's behaviour,
not preserving something it already does.

## Unhandled tokens

**Table content is silently and completely destroyed — confirmed with actual
output, not paraphrase.** This is the load-bearing finding for the milestone's
scope cut.

Input:

```
| item | qty |
| ---- | --- |
| bread | 2 |
```

`marked`'s lexer correctly tokenizes this as a single `type: "table"` token
with `header`/`align`/`rows` (verified directly against `marked.lexer(source)`
— the token's `raw`, `header`, and `rows` all contain the real cell text,
including `"bread"`).

But with no table extension registered, `md.parse(source)` produces:

```json
{ "type": "doc", "content": [] }
```

`md.serialize(doc)` produces the string `""`.

The word "bread" does not appear anywhere in the parsed document or the
serialized output. The mechanism: `parseToken` finds no registered handler for
token type `"table"` and falls through to `parseFallbackToken`, whose default
case is:

```js
default:
  if (token.tokens) {
    return this.parseTokens(token.tokens, parseImplicitEmptyParagraphs);
  }
  return null;
```

A marked `table` token has no `.tokens` property (its content lives in
`.header`/`.rows` instead), so this returns `null`, and the containing
`flatMap` drops it entirely. This is not a rendering nicety being lost — the
row data disappears at the **parse** step, before serialization ever runs, so
there is no round-trip path that recovers it later. This confirms the
milestone's central risk: **without RawBlock (Task 5) or a real table
extension, saving a note containing a table would silently delete it on the
next parse/serialize round-trip.**

Separately, we also characterized whether a single extension can claim
multiple markdown token names (relevant to whether RawBlock (Task 5) can cover
`table`, `image`, and `html` from one Node). `markdownTokenName` is declared
`string | undefined` — a single value, not an array. Registering an extension
with `markdownTokenName: ['table', 'image']` does not error, but
`registerExtension` uses that value directly as the `Map` key
(`this.registry.set(tokenName, ...)`), so the registry key becomes the array
object itself. `marked`'s tokens carry string type names (`'table'`), and
`registry.get('table')` never matches an array-keyed entry — confirmed by
constructing exactly this fake extension and parsing the same table source:
the result is still `{ "type": "doc", "content": [] }`, `"bread"` still
missing. **One extension cannot claim several markdown token names this way;
each token type Task 5 needs to preserve (`table`, `image`, `html`) needs its
own registration.**

## jsdom capability

A real Tiptap React editor (`useEditor` + `StarterKit`, no `Markdown`
extension) was mounted in jsdom via `@testing-library/react`. Results for
(a)–(e):

- **(a) Mounting without throwing — works.** `render()` completes and the
  editor instance becomes available.
- **(b) Reading `editor.getJSON()` — works.** Returns the expected ProseMirror
  JSON (e.g. `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello"}]}]}`).
- **(c) `editor.commands.setContent('# Hi')` — works, but note the caveat.**
  The command returns `true` and `getJSON()` afterwards shows the text node
  `"# Hi"` verbatim inside a paragraph — i.e. this is Tiptap's default HTML/text
  content command, not markdown parsing (no `Markdown` extension was
  registered in this experiment), so `'# Hi'` is treated as literal text, not
  parsed into a heading. Command execution itself does not throw or need real
  layout.
- **(d) `editor.commands.toggleBold()` — works.** Returns `true`, no throw.
- **(e) Typing a character through `@testing-library/user-event` — partially
  works, but throws uncaught exceptions from missing jsdom APIs.** The
  `contenteditable` element is found and `user.click()` + `user.keyboard('X')`
  do not throw *synchronously*, and the resulting `getJSON()` does show the
  typed character applied (`"XHello"`). However, the test run also produces
  two **uncaught exceptions** during this interaction, both from jsdom's
  incomplete DOM implementation, surfaced asynchronously by ProseMirror's view
  layer:

  ```
  TypeError: (intermediate value)(intermediate value)(intermediate value).elementFromPoint is not a function
    at posAtCoords (node_modules/prosemirror-view/dist/index.js:468:10)
    at EditorView.posAtCoords (.../prosemirror-view/dist/index.js:5757:16)
    at handlers.mousedown (.../prosemirror-view/dist/index.js:3354:20)
  ```

  ```
  TypeError: target.getClientRects is not a function
    at singleRect (node_modules/prosemirror-view/dist/index.js:524:24)
    at coordsAtPos (.../prosemirror-view/dist/index.js:572:29)
    at EditorView.coordsAtPos (.../prosemirror-view/dist/index.js:5768:16)
    at EditorView.scrollToSelection (.../prosemirror-view/dist/index.js:5626:43)
  ```

  jsdom does not implement `Document.elementFromPoint` or
  `Range.getClientRects`, both of which ProseMirror's view needs to resolve a
  DOM coordinate to a document position on `mousedown` (click-to-place-cursor)
  and to scroll the caret into view after a transaction. These surface as
  **unhandled exceptions** in the Vitest run (not caught by the interaction's
  own try/catch, since they fire from event listener callbacks and a later
  microtask), even though the calling test is reported as "passed."

  **Plain conclusion:** command-driven editor operations — mount, read state,
  `setContent`, mark/toggle commands — are safe to unit-test in jsdom. Anything
  that drives the editor through real pointer/keyboard DOM interaction
  (click-to-focus, then type) is not reliable in jsdom: it doesn't throw
  synchronously, so a naive test could look green, but it leaves unhandled
  exceptions from missing `elementFromPoint`/`getClientRects` polyfills in the
  run. This is the same category of limitation this project already has on
  record for `setPointerCapture` (CLAUDE.md: "jsdom has no
  `setPointerCapture`. Pointer-drag paths cannot be unit tested; they belong in
  Playwright."). **Tasks 9 and 11, to the extent they exercise real
  click-then-type user interaction with the editor, must be Playwright (e2e)
  tests, not component tests; command-level assertions (content after
  `setContent`, commands, `getJSON()`) can stay as Vitest component tests.**
