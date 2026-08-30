# Tag grammar

How a `#tag` is recognized, normalized and bounded in a note's Markdown — the single grammar that `src/data/tags/parseTags.ts` implements and that both the tag index and the editor's tag pills read through.

**Trigger:** any change under `src/data/tags/` — `parseTags.ts`, `parseTags.test.ts`, `tagRanges.test.ts` — or under `src/data/markdown/mask.ts`, or to the symbols in either: `findTagRanges`, `parseTags`, `normalizeTag`, `trimTrailing`, `MASK`, `LEADING_REJECT`, `BACKTICK_OPENER`, `TILDE_OPENER`, `closesFence`, `maskCode`, `maskInlineCode`, `canStart`, `isBoundary`. Also `notes.rebuildTagIndex` and `TAG_INDEX_VERSION` in `src/data/repositories/notes.ts` and `src/data/migrations.ts`, and any prose or code introducing the literal escape sequence for the mask character.

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
