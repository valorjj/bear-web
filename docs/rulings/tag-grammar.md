# Tag grammar

How a `#tag` is recognized, normalized and bounded in a note's Markdown — the single grammar that `src/data/tags/parseTags.ts` implements and that both the tag index and the editor's tag pills read through.

**Trigger:** any change under `src/data/tags/` — `parseTags.ts`, `parseTags.test.ts`, `tagRanges.test.ts`, `rewriteTag.ts` — or under `src/data/markdown/mask.ts`, or to the symbols in either: `findTagRanges`, `parseTags`, `normalizeTag`, `trimTrailing`, `MASK`, `LEADING_REJECT`, `BACKTICK_OPENER`, `TILDE_OPENER`, `closesFence`, `maskCode`, `maskInlineCode`, `canStart`, `isBoundary`, `rewriteTag`, `canWriteTag`, `canRenameTo`, `tagToken`, `needsClosingHash`. Also `notes.rebuildTagIndex` and `TAG_INDEX_VERSION` in `src/data/repositories/notes.ts` and `src/data/migrations.ts`, and any prose or code introducing the literal escape sequence for the mask character. Also `src/features/editor/TagAutocomplete.ts`'s `tagAutocompleteMatchAt` and `matchingTags` (S4) — the popover's grammar is a consumer of this one, not a second one.

- **Tags are keyed lowercase, and that is what makes `rebuildTagIndex`
  deterministic.** `#Work` and `#work` are one tag. Bear preserves first-seen
  casing instead; that was rejected because "first" is undefined during a
  rebuild — note iteration order would decide display casing, so dropping and
  rebuilding the index could change it. The parent spec's rule that a rebuild
  is always safe depends on this.

- **A tag may only start at a `#` preceded by start-of-line or whitespace.**
  This single precondition is why `parseTags` needs no URL, link-destination or
  HTML-attribute detection: `https://x/#a`, `[x](#a)` and `<div id="#x">` are
  all excluded by the preceding character alone. Removing it means adding all
  three.

- **Content beginning with `.,;:!?` is rejected whole, not trimmed** —
  otherwise a shebang in an unmasked indented code block becomes a tag named
  `bin/sh`. A leading slash is rejected by the empty-segment rule instead:
  `#/bin/sh` splits on `/` and produces an empty first segment. The set is
  deliberately narrow: `#-lead` is a legitimate tag.

- **The mask character is `\u0000`, deliberately not a space.** Masked code
  must terminate a tag without permitting one to start — with a space,
  `` `x`#work `` becomes a tag. `src/data/tags/parseTags.test.ts` pins this.

- **A tag's closing `#` must be followed by a boundary and preceded by a
  non-whitespace character.** The multi-word form originally required only that
  the character after the closer be a boundary; a lone `#` later on the same
  line — unrelated prose, not a second tag — would then act as the first
  tag's closer and swallow every word between the two hashes.
  `Fix #bug then see item # 5` produced the tag `bug then see item` instead
  of `bug`, silently destroying the user's actual tag. Fixed by also
  requiring the character before the closing `#` to be non-whitespace,
  symmetric with the existing rule.

- **Indented code blocks and raw HTML blocks are deliberately unmasked.**
  `#define FOO` inside indented C yields one junk tag. That is the accepted
  price of not hand-rolling CommonMark's list-aware indentation rules; the
  obvious cases (`# comment`, `#!/bin/sh`) reject on the grammar alone. Do not
  "fix" this with more masking.

- **The masker moved to `src/data/markdown/mask.ts` in L2 (Task 1) and is now
  shared between tag and link parsing** — `src/data/links/parseLinks.ts`'s
  `findLinkRanges` calls the exact same `maskCode` this file's grammar uses,
  rather than re-implementing fence and inline-code detection a second time.
  A second copy of this grammar anywhere else (a new parser masking code by
  hand, rather than importing `maskCode`) is the duplicated-grammar defect
  this project forbids, not a legitimate variation. The move was verified
  byte-identical against the pre-move file (`git show` diffed against the new
  module) after review caught a first attempt that silently turned a
  doubled-backslash escape into a literal tab byte and retyped three em dashes
  as `--` — a "pure move" is only safe when it is proven byte-verbatim, not
  merely behaviourally equivalent today.

- **Fenced-code recognition needs tail assertions on the fence regex.**
  Without them, `'```code``` is inline'` opens a fence that never closes,
  silently deleting every tag in the rest of the note; and a closer carrying an
  info string inverts fence state, inventing tags from inside code blocks.

- **The mask character must never reach disk as a literal NUL byte, and
  writing the escape sequence is not sufficient by itself.** A raw NUL byte
  looks identical to the escape sequence in most editors, but `grep` and
  `diff` both silently mangle it. Worse: writing `\u0000` through a
  file-writing tool's JSON string parameter silently produces a REAL NUL byte
  on disk anyway, because the JSON layer interprets the escape before the
  bytes reach the filesystem — this happened twice during M7.6's Task 2 alone,
  four times across this project. The rule is not "write the escape sequence",
  it is "write it, then verify the bytes". The scan must be scoped to tracked
  files: `.rglob('*')` over the repo root also walks `node_modules`, `dist`
  and Playwright artifacts, which are full of binary NUL bytes and drown the
  one hit that matters under a thousand that don't.
  ```
  git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
  ```
  Run this before every commit that touches tag-grammar prose or code.

  **For a single file, do not reach for `grep -c $'\0' <file>`.** It reports
  the file's LINE COUNT on a clean file (3 on a 3-line file with no NUL
  anywhere), not zero — bash truncates the `$'\0'` pattern at the NUL byte,
  so the regex `grep` actually receives is empty, and an empty pattern
  matches every line. It can never detect a NUL; a broken verification that
  reports success is worse than no verification, because the next person
  believes the bytes were checked. This was invented and caught during L2 the
  same way the earlier four incidents were: measure it (0 hits on a NUL-free
  file, 1 on a file with one NUL) rather than trust that it reads correctly.
  The command that actually works:
  ```
  python3 -c "import sys;print(open(sys.argv[1],'rb').read().count(b'\0'))" <file>
  ```

- **A tag rewrite (`rewriteTag`, S1) MUST go through `findTagRanges` rather
  than a string replace over the raw text.** `rewriteTag`'s body was
  temporarily swapped for `markdown.replaceAll('#'+from, ...)` as a
  falsification (Task 1, Step 6), and it broke four of the grammar's own
  guarantees at once: it rewrote a tag sitting inside a fenced code block, one
  inside inline code, one inside a URL fragment (`https://x/#work`) — all
  three exist only because `parseTags` masks code and requires a boundary
  before `#`, neither of which a substring replace knows about — and it wrongly
  matched `#a/bc` when renaming `a/b`, because a plain substring match has no
  notion of a tag boundary and `a/bc` is not a descendant of `a/b` (the real
  prefix test is `${from}/`, checked against the tag `findTagRanges` already
  parsed, for exactly this reason). Restoring the real implementation — walk
  `findTagRanges`' ranges and rewrite only the ones whose parsed tag equals
  `from` or starts with `${from}/` — made all four pass again. Do not "fix" a
  rewrite bug by widening the match; widening a substring match is how this
  defect comes back.

- **A rename TARGET may not contain whitespace, and `canWriteTag` is NOT the
  predicate that decides it.** `canWriteTag` round-trips a token IN ISOLATION;
  a rename inserts it into text that already exists around it, and the two are
  not the same question. `parseTags` accepts the multi-word form's closing `#`
  only when the next character is a boundary (`isBoundary(text[close + 1])`),
  and `range.end` for the simple form deliberately excludes trailing
  punctuation — so renaming `work` to `my plan` in `done #work. next` writes
  `done #my plan#. next`, which re-parses as the tag `my` and strands a
  literal `plan#.` in the user's prose. One rename splits the tag in two and no
  second rename can undo it. Verified by execution, not by reading, during
  S1's final review. `canRenameTo` = `canWriteTag` minus the names that need a
  closer, and BOTH `TagRenamePopover` and `tags.rename` refuse through it — the
  repository does not delegate this to the UI. Emitting a separating space
  instead was rejected: it only helps the punctuation-adjacent case and leaves
  a floating `#my plan# . next`, which is its own corruption. **This restricts
  renaming TO a multi-word name only.** `tagToken`'s multi-word branch and
  `canWriteTag`'s meaning are unchanged, and a multi-word tag a user types into
  a note is still fully supported — do not "simplify" the two predicates back
  into one.

- **The tag autocomplete requires a boundary immediately AFTER the caret, and
  that single rule is what excludes the multi-word form `#a b#` from
  autocomplete by construction, not by a guard written against it.**
  `tagAutocompleteMatchAt` (`TagAutocomplete.ts`) walks the same masked-text
  grammar `findTagRanges` does, but adds one condition beyond what the parser
  itself requires: the caret must sit at the tag's END, with whitespace,
  `MASK`, or the block edge immediately after it. Whitespace is a boundary,
  so the instant a space is typed after `#a` — which is what starts the
  multi-word form's first word — the match rule stops matching and the
  popover closes. There is no separate check anywhere that says "refuse the
  multi-word form"; nothing in the autocomplete's code even names it. The
  same rule also refuses `#wo|rk` (accepting a suggestion there would replace
  `#wo` and strand `rk`) and keeps the ordinary repair path open, because
  deleting forward to the end of a mistyped tag is exactly how a typo is
  fixed today.

- **A query ending in `/` narrows suggestions to that tag's subtree, and the
  reason is that `normalizeTag` strips trailing slashes.** `matchingTags`
  would otherwise treat `#a/` identically to `#a` — `normalizeTag('a/')` is
  `'a'` — and offer every tag containing `a` anywhere, including unrelated
  ones, rather than `a`'s own children. So when the query itself ends in
  `/`, matching runs against the slash-terminated string (`` `${normalized}/`
  ``) instead of the normalized form it would otherwise trim to. This is what
  makes descend-and-stay-open (accepting a tag leaves the caret at its end,
  no trailing space, and the popover reopens on the same match) actually show
  descendants once the user types the next `/`.
