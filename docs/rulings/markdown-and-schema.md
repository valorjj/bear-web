# Markdown round-trip and the editor schema

Governs how a note's Markdown is parsed, serialized and normalized, which
constructs the editor schema may claim, and what the round-trip suite is and is
not able to prove.

**Trigger:** any change under `src/features/editor/` touching `markdown.ts`,
`extensions.ts` (`buildEditorExtensions`, `editorExtensions`, `StarterKit.configure`),
`RawBlock.ts` (`createRawBlock`, `RawDefinition`, `RawHtmlBlock`, `RawImage`,
`createRawInlineHtmlNode`), `toolbarSelection.ts`, or `taskItemPromotion.ts`; any edit
to `markdown.test.ts`'s `CANONICAL`, `stability.test.ts`'s `NON_CANONICAL`,
`rawBlock.test.ts`, `characterization.test.ts` or `extensions.test.ts`; a new import of
`@tiptap/markdown` anywhere; a new or removed Tiptap extension, input rule or
`markdownTokenName`; and any `normalizeMarkdown` / `parseMarkdown` /
`serializeMarkdown` call site.

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

