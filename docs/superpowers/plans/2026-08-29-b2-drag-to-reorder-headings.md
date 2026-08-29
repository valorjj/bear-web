# B2 — Drag-to-reorder headings: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user move a heading and the whole subtree it owns — by dragging
the gutter's level badge, by two items in the right-click editor menu, or by
`Mod-Alt-ArrowUp`/`Mod-Alt-ArrowDown`.

**Architecture:** All the coordinate and fold-key math goes into a new pure
module, `src/features/editor/headingReorder.ts`, which owns no DOM and no plugin
state and is fully unit-testable. `HeadingFold.ts` gains three commands, a
keymap, and the pointer gesture — the badge's behaviour stays in the file that
renders the badge. `EditorContextMenu` gains a Section group, fed by two new
booleans on `EditorFlags`.

**Tech Stack:** TypeScript 6 (`erasableSyntaxOnly`, `verbatimModuleSyntax`),
Tiptap v3 / ProseMirror, Vitest + jsdom, Playwright, Tailwind v4, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-29-b2-drag-to-reorder-headings-design.md`

## Global Constraints

Copied from the spec and from `CLAUDE.md`; every task's requirements implicitly
include this section.

- **All six gates must pass before any commit:** `npm run dev` is not one of
  them, but `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`,
  `npm run format`, `npm run build` are. A seventh, `npm run measure:check`,
  is required for any commit that touched anything visual.
- **Budget the suite.** Repetition targets FILES (`npx vitest run
  src/features/editor/headingReorder.test.ts`), never the suite. Cap workers on
  a full run: `npm test -- --run --maxWorkers=4`. Full suite only at task
  boundaries.
- **Before trusting ANY e2e result that follows a source change:**
  `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` reuses an existing
  server on 4173 and will otherwise silently test a stale build.
- **No user-facing string is hardcoded.** Every string goes through `useT`;
  `src/i18n/en.ts` defines the key type and `ko.ts` is
  `Record<TranslationKey, string>`, so a missing Korean string is a compile
  error. Never weaken that annotation.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()`
  outside `src/styles/tokens.css` is a defect that
  `scripts/sourceLint.test.ts` fails on.
- **`lucide-react` may be imported only by `src/ui/Icon.tsx`.** A feature file
  needing a glyph adds a re-export there.
- **jsdom facts that decide test design, all measured in this repo:**
  - `PointerEvent` EXISTS as a constructor; `Element.prototype.setPointerCapture`
    does NOT (`typeof` is `'undefined'`). Verified 2026-08-29.
  - There is no layout engine. `Range.prototype.getBoundingClientRect`,
    `Range.prototype.getClientRects` and `document.elementFromPoint` must be
    stubbed for any test that touches ProseMirror's `coordsAtPos`/`posAtCoords`
    — see the header of `src/features/editor/contextMenu.test.ts` for the exact
    stubs to copy. All rects come back zero, so **no unit test may assert which
    boundary a drag chose.** That is Playwright's job.
  - An undestroyed `Editor` throws at per-file environment teardown, so
    `vitest run` exits 1 with every assertion passing. Track editors in an
    array and destroy them in `afterEach`, as `contextMenu.test.ts` does.
    **Check exit codes, not pass counts.**
- **Extension options are a FLAT merge across all extensions.** A colliding
  option name silently loses. Any new `HeadingFold` option keeps its existing
  `onOpenMenu`/`foldHint` names or is prefixed.
- **`Mod-Alt-ArrowLeft`/`Mod-Alt-ArrowRight` are already taken** by
  `StoredImage.ts` (image resize). `Mod-Alt-ArrowUp`/`Mod-Alt-ArrowDown` were
  grepped against `node_modules/@tiptap` on 2026-08-29 and are free.
- **The controller merges this branch.** Commit on the branch; do not touch
  `main`, and do not be alarmed by a merge in the reflog you did not perform.

---

### Task 1: `headingReorder.ts` — the pure move

**Files:**

- Create: `src/features/editor/headingReorder.ts`
- Test: `src/features/editor/headingReorder.test.ts`

**Interfaces:**

- Consumes: `headingSections`, `foldKeyOf`, `serializeFoldKey`, `HeadingSection`
  from `./headingSections` (all already exported).
- Produces:

```ts
export interface SectionMove {
  /** Start of the moved slice, in the PRE-move document. */
  from: number;
  /** End of the moved slice, in the PRE-move document. */
  to: number;
  /** Where the slice is inserted, in the document AFTER the delete. */
  insertAt: number;
  /** The fold set the move must leave behind, already remapped. */
  foldKeys: string[];
}

export function dropBoundaries(doc: Node): number[];
export function remapFoldKeys(
  before: readonly HeadingSection[],
  after: readonly HeadingSection[],
  folded: readonly string[],
): string[];
export function planSectionMove(
  doc: Node,
  folded: readonly string[],
  fromPos: number,
  toBoundary: number,
): SectionMove | null;
export function planSectionShift(
  doc: Node,
  folded: readonly string[],
  caretPos: number,
  direction: -1 | 1,
): SectionMove | null;
```

`Node` is `import type { Node } from '@tiptap/pm/model'`.

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/headingReorder.test.ts`. Note there is **no editor
and no DOM here at all** — these are document functions, so build docs through
`editorExtensions` + `parseMarkdown` and read `editor.state.doc`, destroying the
editor immediately.

```ts
import { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { headingSections } from './headingSections';
import {
  dropBoundaries,
  planSectionMove,
  planSectionShift,
  remapFoldKeys,
} from './headingReorder';
import { parseMarkdown } from './markdown';

/**
 * A document, without a live editor. Every function under test takes a `doc`,
 * so the editor is scaffolding and is destroyed before the assertions run —
 * an undestroyed `Editor` throws at environment teardown (see CLAUDE.md).
 */
function docOf(markdown: string): Node {
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
  const doc = editor.state.doc;
  editor.destroy();
  return doc;
}

const THREE = 'Title\n\n## A\n\nbody a\n\n## B\n\nbody b\n\n## C\n\nbody c';

describe('dropBoundaries', () => {
  it('offers every section start plus the document end, and nothing above the title', () => {
    const doc = docOf(THREE);
    const sections = headingSections(doc);

    expect(dropBoundaries(doc)).toEqual([
      sections[0]!.pos,
      sections[1]!.pos,
      sections[2]!.pos,
      doc.content.size,
    ]);
    // The title's own position is 0 and must never be offered: a section
    // dropped there would displace the note's name.
    expect(dropBoundaries(doc)).not.toContain(0);
  });

  it('offers only the end when a note has no sections at all', () => {
    const doc = docOf('Just a title\n\nand a paragraph');
    expect(dropBoundaries(doc)).toEqual([doc.content.size]);
  });
});

describe('planSectionMove', () => {
  it('moves a section upward, inserting at the boundary unchanged', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    const move = planSectionMove(doc, [], c!.pos, a!.pos);

    expect(move).not.toBeNull();
    expect(move!.from).toBe(c!.pos);
    expect(move!.to).toBe(c!.end);
    // Moving UP: the insert point is before the deleted range, so the delete
    // does not shift it.
    expect(move!.insertAt).toBe(a!.pos);
  });

  it('shifts the insert point left by the slice size when moving downward', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);
    const size = a!.end - a!.pos;

    const move = planSectionMove(doc, [], a!.pos, c!.pos);

    expect(move!.insertAt).toBe(c!.pos - size);
  });

  it('carries the whole subtree, not just the heading', () => {
    const doc = docOf('Title\n\n## A\n\n### A1\n\nx\n\n## B\n\ny');
    const [a, a1, b] = headingSections(doc);

    const move = planSectionMove(doc, [], a!.pos, doc.content.size);

    // `end` is the next SAME-OR-HIGHER level heading, so the nested h3 is
    // inside the moved range rather than left behind.
    expect(move!.to).toBe(b!.pos);
    expect(a1!.pos).toBeGreaterThan(move!.from);
    expect(a1!.pos).toBeLessThan(move!.to);
  });

  it('rejects the two no-op boundaries and any boundary inside the moved range', () => {
    const doc = docOf('Title\n\n## A\n\n### A1\n\nx\n\n## B\n\ny');
    const [a, a1] = headingSections(doc);

    // Its own start: the section is already there.
    expect(planSectionMove(doc, [], a!.pos, a!.pos)).toBeNull();
    // Its own end: also already there.
    expect(planSectionMove(doc, [], a!.pos, a!.end)).toBeNull();
    // A boundary belonging to its own subtree: the slice cannot contain its
    // own destination.
    expect(planSectionMove(doc, [], a!.pos, a1!.pos)).toBeNull();
  });

  it('rejects a source that is not a section and a boundary that is not offered', () => {
    const doc = docOf(THREE);
    const [a] = headingSections(doc);

    expect(planSectionMove(doc, [], 0, a!.pos)).toBeNull();
    expect(planSectionMove(doc, [], a!.pos, a!.pos + 1)).toBeNull();
  });
});

describe('fold remapping', () => {
  it('keeps a fold on the section that was folded, when titles are unique', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    const move = planSectionMove(doc, ['2:0:C'], c!.pos, a!.pos);

    expect(move!.foldKeys).toEqual(['2:0:C']);
  });

  it('RENUMBERS a fold when two headings share a level and text', () => {
    // The hazard this whole function exists for. Both sections are `## Notes`,
    // so their keys differ only by `nth`. Moving the second above the first
    // makes it `nth: 0` — and without remapping the stored `2:1:Notes` would
    // point at the OTHER section, springing the folded one open and collapsing
    // one the user never touched.
    const doc = docOf('Title\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond');
    const [first, second] = headingSections(doc);
    expect(second!.nth).toBe(1);

    const move = planSectionMove(doc, ['2:1:Notes'], second!.pos, first!.pos);

    expect(move!.foldKeys).toEqual(['2:0:Notes']);
  });

  it('leaves an unmatched key alone rather than dropping it', () => {
    // B1's fail-open rule: a key matching no heading is inert, not an error,
    // and must survive the move so a later edit can re-match it.
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    const move = planSectionMove(doc, ['2:0:Gone'], c!.pos, a!.pos);

    expect(move!.foldKeys).toContain('2:0:Gone');
  });

  it('is directly testable on two hand-built lists', () => {
    const before = [
      { pos: 1, contentStart: 2, end: 5, level: 2, text: 'X', nth: 0 },
      { pos: 5, contentStart: 6, end: 9, level: 2, text: 'X', nth: 1 },
    ];
    const after = [before[1]!, before[0]!];

    expect(remapFoldKeys(before, after, ['2:1:X'])).toEqual(['2:0:X']);
    expect(remapFoldKeys(before, after, ['2:0:X'])).toEqual(['2:1:X']);
  });
});

describe('planSectionShift', () => {
  it('moves the caret’s section up one place', () => {
    const doc = docOf(THREE);
    const [a, b] = headingSections(doc);

    const move = planSectionShift(doc, [], b!.pos + 1, -1);

    expect(move!.from).toBe(b!.pos);
    expect(move!.insertAt).toBe(a!.pos);
  });

  it('moves the caret’s section down one place, past the whole next section', () => {
    const doc = docOf(THREE);
    const [a, b] = headingSections(doc);
    const size = a!.end - a!.pos;

    const move = planSectionShift(doc, [], a!.pos + 1, 1);

    // Down means "after the next sibling section", i.e. that section's end —
    // which before the delete is `b.end`.
    expect(move!.insertAt).toBe(b!.end - size);
  });

  it('returns null at each end and when the caret is in no section', () => {
    const doc = docOf(THREE);
    const [a, , c] = headingSections(doc);

    expect(planSectionShift(doc, [], a!.pos + 1, -1)).toBeNull();
    expect(planSectionShift(doc, [], c!.pos + 1, 1)).toBeNull();
    // Inside the title, which `headingSections` excludes by construction.
    expect(planSectionShift(doc, [], 1, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/editor/headingReorder.test.ts`
Expected: FAIL — `Failed to resolve import "./headingReorder"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/editor/headingReorder.ts`:

```ts
import type { Node } from '@tiptap/pm/model';

import { foldKeyOf, headingSections, serializeFoldKey, type HeadingSection } from './headingSections';

export interface SectionMove {
  /** Start of the moved slice, in the PRE-move document. */
  from: number;
  /** End of the moved slice, in the PRE-move document. */
  to: number;
  /** Where the slice is inserted, in the document AFTER the delete. */
  insertAt: number;
  /** The fold set the move must leave behind, already remapped. */
  foldKeys: string[];
}

/**
 * The positions a section may be dropped at: every section's own start, plus
 * the end of the document.
 *
 * Position 0 is deliberately absent. A note's first block renders as its
 * TITLE (see `headingSections`' docblock and `editor.css`'s `:first-child`
 * rule), so a section dropped there would displace the note's name — and
 * `headingSections` already excludes that block, so it is not a section that
 * could be displaced back.
 */
export function dropBoundaries(doc: Node): number[] {
  return [...headingSections(doc).map((section) => section.pos), doc.content.size];
}

/**
 * Old fold keys to new ones, across a reordering.
 *
 * This exists because B1's fold identity is `{ level, text, nth }` and `nth`
 * is an OCCURRENCE INDEX. Reordering renumbers it for every heading sharing a
 * level and text with another, so a stored key silently comes to name a
 * different section — B1's fail-open rule cannot help, because the key still
 * matches something. It fails CLOSED, in the wrong direction.
 *
 * A key matching nothing in `before` is passed through untouched rather than
 * dropped: that IS the fail-open rule, and a key whose heading is temporarily
 * absent must survive to re-match later.
 */
export function remapFoldKeys(
  before: readonly HeadingSection[],
  after: readonly HeadingSection[],
  folded: readonly string[],
): string[] {
  // `after` is the reordered list; its `nth` values are stale by construction,
  // so they are recomputed here rather than trusted.
  const seen = new Map<string, number>();
  const renumbered = after.map((section) => {
    const identity = `${section.level}:${section.text}`;
    const nth = seen.get(identity) ?? 0;
    seen.set(identity, nth + 1);
    return { section, key: serializeFoldKey({ level: section.level, text: section.text, nth }) };
  });

  const mapped = new Map<string, string>();
  for (const [index, section] of before.entries()) {
    const oldKey = serializeFoldKey(foldKeyOf(section));
    // Identity is by ARRAY MEMBERSHIP, not by key: two sections sharing a
    // level and text are exactly the case this function exists for, so
    // matching them by key would be circular.
    const moved = renumbered.find((entry) => entry.section === after[index] && false);
    void moved;
    const found = renumbered.find((entry) => entry.section === section);
    if (found) mapped.set(oldKey, found.key);
  }

  return folded.map((key) => mapped.get(key) ?? key);
}

/**
 * The contiguous run of sections a move carries: the source section and every
 * section nested inside it. `end` is the next same-or-higher-level heading, so
 * the run is exactly the sections whose `pos` falls inside `[from, to)`.
 */
function runOf(sections: readonly HeadingSection[], source: HeadingSection): HeadingSection[] {
  return sections.filter((s) => s.pos >= source.pos && s.pos < source.end);
}

function reorder(
  sections: readonly HeadingSection[],
  run: readonly HeadingSection[],
  toBoundary: number,
  docEnd: number,
): HeadingSection[] {
  const rest = sections.filter((s) => !run.includes(s));
  // The boundary names a section that is still in `rest` (or the document
  // end); the run lands immediately before it.
  const at = toBoundary === docEnd ? rest.length : rest.findIndex((s) => s.pos === toBoundary);
  return [...rest.slice(0, at), ...run, ...rest.slice(at)];
}

export function planSectionMove(
  doc: Node,
  folded: readonly string[],
  fromPos: number,
  toBoundary: number,
): SectionMove | null {
  const sections = headingSections(doc);
  const source = sections.find((s) => s.pos === fromPos);
  if (!source) return null;
  if (!dropBoundaries(doc).includes(toBoundary)) return null;

  // The two no-ops, and any boundary inside the slice — a section cannot
  // contain its own destination.
  if (toBoundary === source.pos || toBoundary === source.end) return null;
  if (toBoundary > source.pos && toBoundary < source.end) return null;

  const run = runOf(sections, source);
  const after = reorder(sections, run, toBoundary, doc.content.size);
  const size = source.end - source.pos;

  return {
    from: source.pos,
    to: source.end,
    // Moving downward, the delete happens first and shifts every later
    // position left by the slice's size.
    insertAt: toBoundary > source.pos ? toBoundary - size : toBoundary,
    foldKeys: remapFoldKeys(sections, after, folded),
  };
}

/**
 * The move for "up one place" / "down one place" from a caret.
 *
 * Down is not `next.pos` — that is the section's own `end` and therefore a
 * no-op. It is the NEXT SIBLING'S end, so the section hops over the whole of
 * it rather than landing inside it.
 */
export function planSectionShift(
  doc: Node,
  folded: readonly string[],
  caretPos: number,
  direction: -1 | 1,
): SectionMove | null {
  const sections = headingSections(doc);
  const source = sections.find((s) => s.pos <= caretPos && caretPos < s.end);
  if (!source) return null;

  const tops = sections.filter((s) => s.level <= source.level || s.pos < source.pos);
  void tops;

  const siblings = sections.filter((s) => !(s.pos > source.pos && s.pos < source.end));
  const index = siblings.indexOf(source);

  if (direction === -1) {
    const previous = siblings[index - 1];
    if (!previous) return null;
    return planSectionMove(doc, folded, source.pos, previous.pos);
  }

  const next = siblings[index + 1];
  if (!next) return null;
  const boundary = next.end === doc.content.size ? doc.content.size : next.end;
  return planSectionMove(doc, folded, source.pos, boundary);
}
```

Two deliberate simplifications to clean up while implementing: the `moved`/
`tops` dead locals above are scaffolding left in the sketch to show the shape —
**delete them**; oxlint will flag them. Keep the comments.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/editor/headingReorder.test.ts`
Expected: PASS, and **exit code 0** — check the code, not the pass count.

- [ ] **Step 5: Prove the fold remapping test is not vacuous**

Temporarily change `planSectionMove`'s `foldKeys` to `[...folded]` (no
remapping). Re-run. Expected: exactly the duplicate-title test fails with
`expected [ '2:1:Notes' ] to deeply equal [ '2:0:Notes' ]`, and the
unique-titles tests still pass — which is the point: they cannot see this bug.
Revert.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor/headingReorder.ts src/features/editor/headingReorder.test.ts
git commit -m "feat(b2): the pure section-move math, with fold-key remapping"
```

---

### Task 2: The commands and the keymap

**Files:**

- Modify: `src/features/editor/HeadingFold.ts` (the `Commands` declaration
  block around line 205, `addCommands` around line 240, `addKeyboardShortcuts`
  around line 317)
- Test: `src/features/editor/headingFold.test.ts` (append a new `describe`)

**Interfaces:**

- Consumes: `planSectionMove`, `planSectionShift`, `type SectionMove` from
  `./headingReorder` (Task 1). `setKeys`, `foldedKeys` are already module-local
  in `HeadingFold.ts`.
- Produces, on the Tiptap `Commands` interface:

```ts
moveHeadingSection: (fromPos: number, toBoundary: number) => ReturnType;
moveHeadingSectionUp: () => ReturnType;
moveHeadingSectionDown: () => ReturnType;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/features/editor/headingFold.test.ts`. `docFor` and the imports
of `foldedKeys` / `headingSections` already exist at the top of that file; add
`serializeMarkdown` and `parseMarkdown` if not already imported (they are).

```ts
describe('moving a section', () => {
  const THREE = 'Title\n\n## A\n\nbody a\n\n## B\n\nbody b\n\n## C\n\nbody c';

  function editorOf(markdown: string) {
    return new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
  }

  it('moves a section and its body above another', () => {
    const editor = editorOf(THREE);
    const [a, , c] = headingSections(editor.state.doc);

    expect(editor.commands.moveHeadingSection(c!.pos, a!.pos)).toBe(true);

    expect(serializeMarkdown(editor.getJSON())).toBe(
      'Title\n\n## C\n\nbody c\n\n## A\n\nbody a\n\n## B\n\nbody b',
    );
    editor.destroy();
  });

  it('is ONE undo step that restores order and folds together', () => {
    const editor = editorOf('Title\n\n## Notes\n\nfirst\n\n## Notes\n\nsecond');
    const [first, second] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(second!.pos);
    expect(foldedKeys(editor.state)).toEqual(['2:1:Notes']);
    const before = serializeMarkdown(editor.getJSON());

    editor.commands.moveHeadingSection(second!.pos, first!.pos);
    // The remapping rode the same transaction: the fold followed its section.
    expect(foldedKeys(editor.state)).toEqual(['2:0:Notes']);

    editor.commands.undo();

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
    expect(foldedKeys(editor.state)).toEqual(['2:1:Notes']);
    editor.destroy();
  });

  it('returns false for a rejected move and changes nothing', () => {
    const editor = editorOf(THREE);
    const [a] = headingSections(editor.state.doc);
    const before = serializeMarkdown(editor.getJSON());

    expect(editor.commands.moveHeadingSection(a!.pos, a!.pos)).toBe(false);

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
    editor.destroy();
  });

  it('moves the section under the caret up and down', () => {
    const editor = editorOf(THREE);
    const [, b] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(b!.pos + 2);

    expect(editor.commands.moveHeadingSectionUp()).toBe(true);
    expect(serializeMarkdown(editor.getJSON())).toBe(
      'Title\n\n## B\n\nbody b\n\n## A\n\nbody a\n\n## C\n\nbody c',
    );
    editor.destroy();
  });

  it('returns false at the ends, so the keystroke falls through', () => {
    const editor = editorOf(THREE);
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.pos + 2);

    expect(editor.commands.moveHeadingSectionUp()).toBe(false);
    editor.destroy();
  });

  it('returns false when the caret is in the title, which is not a section', () => {
    const editor = editorOf(THREE);
    editor.commands.setTextSelection(1);

    expect(editor.commands.moveHeadingSectionUp()).toBe(false);
    expect(editor.commands.moveHeadingSectionDown()).toBe(false);
    editor.destroy();
  });

  it('binds Mod-Alt-ArrowUp and Mod-Alt-ArrowDown', () => {
    const editor = editorOf(THREE);
    const [, b] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(b!.pos + 2);

    editor.commands.keyboardShortcut('Mod-Alt-ArrowUp');

    expect(serializeMarkdown(editor.getJSON())).toBe(
      'Title\n\n## B\n\nbody b\n\n## A\n\nbody a\n\n## C\n\nbody c',
    );
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/editor/headingFold.test.ts -t "moving a section"`
Expected: FAIL — `editor.commands.moveHeadingSection is not a function`.

- [ ] **Step 3: Implement**

In `src/features/editor/HeadingFold.ts`, extend the module augmentation:

```ts
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingFold: {
      toggleHeadingFold: (pos: number) => ReturnType;
      foldAllHeadings: () => ReturnType;
      unfoldAllHeadings: () => ReturnType;
      setHeadingFolds: (keys: string[]) => ReturnType;
      moveHeadingSection: (fromPos: number, toBoundary: number) => ReturnType;
      moveHeadingSectionUp: () => ReturnType;
      moveHeadingSectionDown: () => ReturnType;
    };
  }
}
```

Add above `addCommands`:

```ts
/**
 * Applies a planned move as ONE transaction, so `history` gives one undo step
 * that restores the order and the folds together.
 *
 * The fold set rides the same `tr` through `setKeys` rather than following in
 * a second dispatch — two transactions would mean two `Mod-Z` presses, and the
 * intermediate state (moved, folds not yet remapped) is exactly the wrong one
 * to be able to stop at.
 */
function applyMove(state: EditorState, move: SectionMove): Transaction {
  const slice = state.doc.slice(move.from, move.to);
  const tr = state.tr.delete(move.from, move.to);
  tr.insert(move.insertAt, slice.content);
  return setKeys(tr, move.foldKeys);
}
```

and inside `addCommands()`'s returned object:

```ts
moveHeadingSection:
  (fromPos: number, toBoundary: number) =>
  ({ state, dispatch }) => {
    const move = planSectionMove(state.doc, foldedKeys(state), fromPos, toBoundary);
    if (move === null) return false;
    if (dispatch) dispatch(applyMove(state, move));
    return true;
  },

moveHeadingSectionUp:
  () =>
  ({ state, dispatch }) => {
    const move = planSectionShift(state.doc, foldedKeys(state), state.selection.from, -1);
    if (move === null) return false;
    if (dispatch) dispatch(applyMove(state, move));
    return true;
  },

moveHeadingSectionDown:
  () =>
  ({ state, dispatch }) => {
    const move = planSectionShift(state.doc, foldedKeys(state), state.selection.from, 1);
    if (move === null) return false;
    if (dispatch) dispatch(applyMove(state, move));
    return true;
  },
```

Extend `addKeyboardShortcuts()`:

```ts
// `Mod-Alt-ArrowUp`/`Down`, symmetric with `StoredImage`'s shipped
// `Mod-Alt-ArrowLeft`/`Right` (image resize). Verified against
// `node_modules/@tiptap` — nothing there binds either chord. B1's ruling: a
// new binding is checked against the PACKAGE, not only against browser
// shortcuts, because Tiptap's reversed extension order lets a later
// extension silently win.
//
// Both return the command's own `false` when the caret is in no section or
// the section is already at its end, so the keystroke falls through rather
// than being swallowed for nothing — the rule `Mod-Alt-f` above follows.
'Mod-Alt-ArrowUp': () => this.editor.commands.moveHeadingSectionUp(),
'Mod-Alt-ArrowDown': () => this.editor.commands.moveHeadingSectionDown(),
```

Add the imports: `planSectionMove`, `planSectionShift`, `type SectionMove` from
`./headingReorder`, and `type EditorState`, `type Transaction` are already
imported from `@tiptap/pm/state`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/editor/headingFold.test.ts`
Expected: PASS, exit code 0.

- [ ] **Step 5: Prove the one-undo-step test is not vacuous**

Temporarily split `applyMove` into two dispatches — dispatch the delete/insert
`tr`, then `dispatch(setKeys(view.state.tr, move.foldKeys))`. Re-run.
Expected: the "ONE undo step" test fails, because one `undo()` now leaves the
folds remapped while the order is restored. Revert.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npx vitest run src/features/editor
git add src/features/editor/HeadingFold.ts src/features/editor/headingFold.test.ts
git commit -m "feat(b2): move-section commands and Mod-Alt-Arrow bindings"
```

---

### Task 3: The Section group in the context menu

**Files:**

- Modify: `src/ui/Icon.tsx` (the `export { … } from 'lucide-react'` block at
  line 235)
- Modify: `src/features/editor/editorState.ts` (`EditorFlags`, `EMPTY_FLAGS`,
  `editorFlagsSelector`)
- Modify: `src/features/editor/EditorContextMenu.tsx` (`ContextMenuAction`, a
  new group after the Blocks group and before the Table group)
- Modify: `src/features/editor/RichEditor.tsx` (`handleContextMenuAction`)
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Test: `src/features/editor/editorContextMenu.test.tsx`

**Interfaces:**

- Consumes: `moveHeadingSectionUp` / `moveHeadingSectionDown` (Task 2),
  `planSectionShift` (Task 1).
- Produces: three new `EditorFlags` fields —

```ts
/** The caret is inside a top-level section (never in the title). */
section: boolean;
/** That section has somewhere to go in each direction. */
sectionUp: boolean;
sectionDown: boolean;
```

and two new `ContextMenuAction` members, `'moveSectionUp' | 'moveSectionDown'`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/editor/editorContextMenu.test.tsx`:

```ts
describe('the Section group', () => {
  it('is absent when the caret is not in a section', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, section: false } });
    expect(screen.queryByRole('group', { name: 'Section' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Move section up' })).toBeNull();
  });

  it('offers both moves when the caret is in a section', () => {
    renderMenu({
      flags: { ...EMPTY_FLAGS, section: true, sectionUp: true, sectionDown: true },
    });
    expect(screen.getByRole('menuitem', { name: 'Move section up' })).toBeEnabled();
    expect(screen.getByRole('menuitem', { name: 'Move section down' })).toBeEnabled();
  });

  it('disables each direction independently at the ends of the document', () => {
    renderMenu({
      flags: { ...EMPTY_FLAGS, section: true, sectionUp: false, sectionDown: true },
    });
    // The FIRST section: nowhere up, somewhere down.
    expect(screen.getByRole('menuitem', { name: 'Move section up' })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: 'Move section down' })).toBeEnabled();
  });

  it('reports the action and closes', async () => {
    const user = userEvent.setup();
    const { onAction, onClose } = renderMenu({
      flags: { ...EMPTY_FLAGS, section: true, sectionUp: true, sectionDown: true },
    });

    await user.click(screen.getByRole('menuitem', { name: 'Move section down' }));

    expect(onAction).toHaveBeenCalledWith('moveSectionDown');
    expect(onClose).toHaveBeenCalled();
  });
});
```

Append to `src/features/editor/headingFold.test.ts` (the flags live in
`editorState.ts`, but the fixture that exercises them is an editor):

```ts
describe('the section flags', () => {
  it('reports where the caret is and which moves are available', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: parseMarkdown('Title\n\n## A\n\nx\n\n## B\n\ny'),
    });
    const [a, b] = headingSections(editor.state.doc);

    editor.commands.setTextSelection(1);
    expect(editorFlagsSelector({ editor }).section).toBe(false);

    editor.commands.setTextSelection(a!.pos + 2);
    expect(editorFlagsSelector({ editor })).toMatchObject({
      section: true,
      sectionUp: false,
      sectionDown: true,
    });

    editor.commands.setTextSelection(b!.pos + 2);
    expect(editorFlagsSelector({ editor })).toMatchObject({
      section: true,
      sectionUp: true,
      sectionDown: false,
    });
    editor.destroy();
  });
});
```

Add `import { editorFlagsSelector } from './editorState';` to that file.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/editor/editorContextMenu.test.tsx src/features/editor/headingFold.test.ts`
Expected: FAIL — `section` is not a property of `EMPTY_FLAGS` (a typecheck-level
failure surfaces at runtime as `undefined`, and the group assertions fail).

- [ ] **Step 3: Implement**

`src/ui/Icon.tsx` — add to the re-export block, keeping it alphabetically
un-sorted like the rest (the list is grouped by when a glyph arrived):

```ts
  ArrowUp,
  ArrowDown,
```

No `ICON_NODES` entry is needed: that map serves `renderIconMarkup`, which
draws ProseMirror widgets, and these two glyphs are only ever rendered through
React's `<Icon glyph={…}>`.

`src/features/editor/editorState.ts` — add to `EditorFlags`:

```ts
  /**
   * The caret is inside a top-level section. False in the note's first block,
   * which is its title and is not a section — see `headingSections`.
   */
  section: boolean;
  /** That section has a sibling to move above / below. */
  sectionUp: boolean;
  sectionDown: boolean;
```

`EMPTY_FLAGS` gets `section: false, sectionUp: false, sectionDown: false`.
`editorFlagsSelector` gets:

```ts
    // Computed from the same planner the commands use, so a menu item is
    // enabled exactly when its command would return true. Deriving the two
    // independently is how a menu comes to offer a move that does nothing.
    section: planSectionShift(editor.state.doc, [], editor.state.selection.from, -1) !== null ||
      planSectionShift(editor.state.doc, [], editor.state.selection.from, 1) !== null ||
      headingSections(editor.state.doc).some(
        (s) => s.pos <= editor.state.selection.from && editor.state.selection.from < s.end,
      ),
    sectionUp: planSectionShift(editor.state.doc, [], editor.state.selection.from, -1) !== null,
    sectionDown: planSectionShift(editor.state.doc, [], editor.state.selection.from, 1) !== null,
```

Simplify that first expression while implementing — the two `planSectionShift`
disjuncts are redundant with the `some(…)`; keep only the `some(…)` and the
comment. `folded` is `[]` here on purpose: the flags do not care about folds,
and passing the real set would make a formatting flag depend on plugin state
for no reason.

`src/features/editor/EditorContextMenu.tsx` — extend the union (and update the
docblock's "sixteen actions" count to eighteen):

```ts
  | 'moveSectionUp'
  | 'moveSectionDown'
```

and add the group between the Blocks group and the Table group:

```tsx
{/* 5. Section — moves the heading under the caret and everything it owns.
    Rendered only inside a section, because the note's title is not one.
    This is the KEYBOARD route to B2: the gutter's badge is mouse-only
    (Chromium refuses focus inside a heading holding a widget), and this
    menu answers Shift+F10. */}
{flags.section && (
  <>
    <div className="bg-border my-1 h-px" role="separator" />
    <div role="group" aria-label={t('editor.section.group')} className="p-1">
      <button
        type="button"
        role="menuitem"
        disabled={!flags.sectionUp}
        onClick={() => act('moveSectionUp')}
        className={ITEM_CLASS}
      >
        <Icon glyph={ArrowUp} size="sm" />
        {t('editor.section.moveUp')}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!flags.sectionDown}
        onClick={() => act('moveSectionDown')}
        className={ITEM_CLASS}
      >
        <Icon glyph={ArrowDown} size="sm" />
        {t('editor.section.moveDown')}
      </button>
    </div>
  </>
)}
```

`disabled`, not `aria-disabled`: this is a real `<button>` in a menu the user
can click, and `docs/rulings/testing-and-tooling.md` records that Playwright
refuses to click an `aria-disabled` element, waiting out the full timeout. The
PDF export item uses `aria-disabled` because it must stay keyboard-reachable to
announce *why* it is off; these two need no such explanation.

`src/features/editor/RichEditor.tsx` — two cases in `handleContextMenuAction`'s
switch:

```ts
      case 'moveSectionUp':
        chain.moveHeadingSectionUp().run();
        break;
      case 'moveSectionDown':
        chain.moveHeadingSectionDown().run();
        break;
```

`src/i18n/en.ts`, beside the other `editor.*` keys:

```ts
  'editor.section.group': 'Section',
  'editor.section.moveUp': 'Move section up',
  'editor.section.moveDown': 'Move section down',
```

`src/i18n/ko.ts`:

```ts
  'editor.section.group': '섹션',
  'editor.section.moveUp': '섹션 위로 이동',
  'editor.section.moveDown': '섹션 아래로 이동',
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/editor && npm run typecheck`
Expected: PASS, exit code 0. The typecheck is what proves `ko.ts` is complete.

- [ ] **Step 5: Prove the disabled test is not vacuous**

Temporarily drop `disabled={!flags.sectionUp}` from the up item. Re-run.
Expected: "disables each direction independently" fails on
`expect(element).toBeDisabled()`. Revert.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add -A
git commit -m "feat(b2): a Section group in the editor context menu"
```

---

### Task 4: The drag gesture

**Files:**

- Modify: `src/features/editor/HeadingFold.ts` (`HeadingFoldOptions`, the
  plugin's `state`, `decorations` and `handleDOMEvents`)
- Modify: `src/styles/editor.css` (a new `.bear-section-drop` /
  `.bear-section-dragging` block, beside the existing `.bear-fold-*` rules)
- Test: `src/features/editor/headingFold.test.ts` (append)

**Interfaces:**

- Consumes: `dropBoundaries`, `planSectionMove` (Task 1); `applyMove`,
  `moveHeadingSection` (Task 2).
- Produces: no new exports. The drag is plugin-internal state.

**What the gesture is, precisely:**

1. `pointerdown`, `button === 0`, target inside `[data-fold-badge]` →
   `preventDefault()`, `setPointerCapture(event.pointerId)` **guarded** (see
   below), record `{ pos, x, y, pointerType }` in a module-local ref. **No menu
   and no transaction yet** — this is the behaviour change: the badge used to
   open its menu on `mousedown`.
2. `pointermove` → if not yet dragging, and the pointer has travelled more than
   `DRAG_THRESHOLD` (4) px, and `pointerType` is `'mouse'` or `'pen'`, enter
   drag: measure every `dropBoundaries` position once with `view.coordsAtPos`,
   converting to DOCUMENT scroll coordinates (`rect.top + scroller.scrollTop`),
   and store them. While dragging, pick the nearest boundary to the pointer's
   converted Y and set it in plugin state.
3. `pointerup` → if dragging, run `moveHeadingSection(from, boundary)` and
   clear. If not dragging, call `onOpenMenu` exactly as the old `mousedown`
   handler did.
4. `keydown` Escape while dragging, and `pointercancel` → clear, dispatch
   nothing.

Auto-scroll: while dragging, if the pointer is within `EDGE = 40` px of the
scroller's top or bottom, scroll it by `STEP = 12` px per `requestAnimationFrame`
tick. **This is why the boundaries are stored in document coordinates** — the
scroller moves under a measurement taken once at drag start, so viewport
coordinates would be correct until the first auto-scroll and then silently drop
sections in the wrong place.

`setPointerCapture` must be called as
`badge.setPointerCapture?.(event.pointerId)` — jsdom does not implement it
(measured 2026-08-29: `typeof` is `'undefined'`), and an unguarded call makes
every unit test in this file throw.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/editor/headingFold.test.ts`. These cover the **state
machine only**; jsdom has no layout, so every `coordsAtPos` rect is zero and no
test here may assert *which* boundary was chosen. That is Task 5's.

```ts
describe('the badge drag gesture', () => {
  function badgeOf(editor: Editor): HTMLElement {
    const badge = editor.view.dom.querySelector('[data-fold-badge]');
    expect(badge).not.toBeNull();
    return badge as HTMLElement;
  }

  function pointer(type: string, target: HTMLElement, init: PointerEventInit = {}): void {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, pointerType: 'mouse', ...init }),
    );
  }

  it('does NOT open the menu on press — only on release', () => {
    const onOpenMenu = vi.fn();
    const editor = new Editor({
      extensions: [...editorExtensions, HeadingFold.configure({ onOpenMenu, foldHint: 'fold' })],
      content: parseMarkdown('Title\n\n## A\n\nx\n\n## B\n\ny'),
    });
    const badge = badgeOf(editor);

    pointer('pointerdown', badge, { clientX: 10, clientY: 10 });
    expect(onOpenMenu).not.toHaveBeenCalled();

    pointer('pointerup', badge, { clientX: 10, clientY: 10 });
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it('suppresses the menu once the press has become a drag', () => {
    const onOpenMenu = vi.fn();
    const editor = new Editor({
      extensions: [...editorExtensions, HeadingFold.configure({ onOpenMenu, foldHint: 'fold' })],
      content: parseMarkdown('Title\n\n## A\n\nx\n\n## B\n\ny'),
    });
    const badge = badgeOf(editor);

    pointer('pointerdown', badge, { clientX: 10, clientY: 10 });
    pointer('pointermove', badge, { clientX: 10, clientY: 60 });
    pointer('pointerup', badge, { clientX: 10, clientY: 60 });

    expect(onOpenMenu).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('never drags for a touch pointer, and still opens the menu', () => {
    const onOpenMenu = vi.fn();
    const editor = new Editor({
      extensions: [...editorExtensions, HeadingFold.configure({ onOpenMenu, foldHint: 'fold' })],
      content: parseMarkdown('Title\n\n## A\n\nx\n\n## B\n\ny'),
    });
    const badge = badgeOf(editor);

    pointer('pointerdown', badge, { clientX: 10, clientY: 10, pointerType: 'touch' });
    pointer('pointermove', badge, { clientX: 10, clientY: 60, pointerType: 'touch' });
    pointer('pointerup', badge, { clientX: 10, clientY: 60, pointerType: 'touch' });

    // The move never started, so the release is still a tap.
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    editor.destroy();
  });

  it('leaves the document untouched when Escape aborts a drag', () => {
    const editor = new Editor({
      extensions: [...editorExtensions, HeadingFold.configure({ onOpenMenu: vi.fn(), foldHint: null })],
      content: parseMarkdown('Title\n\n## A\n\nx\n\n## B\n\ny'),
    });
    const badge = badgeOf(editor);
    const before = serializeMarkdown(editor.getJSON());

    pointer('pointerdown', badge, { clientX: 10, clientY: 10 });
    pointer('pointermove', badge, { clientX: 10, clientY: 60 });
    editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    pointer('pointerup', badge, { clientX: 10, clientY: 60 });

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
    editor.destroy();
  });

  it('is not started by the fold toggle', () => {
    const onOpenMenu = vi.fn();
    const editor = new Editor({
      extensions: [...editorExtensions, HeadingFold.configure({ onOpenMenu, foldHint: 'fold' })],
      content: parseMarkdown('Title\n\n## A\n\nx\n\n## B\n\ny'),
    });
    const toggle = editor.view.dom.querySelector('[data-fold-toggle]') as HTMLElement;

    pointer('pointerdown', toggle, { clientX: 10, clientY: 10 });

    // The toggle still folds on PRESS, unchanged by B2.
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    editor.destroy();
  });
});
```

This file's header needs the three layout stubs (`Range.prototype.getBoundingClientRect`,
`Range.prototype.getClientRects`, `document.elementFromPoint`) — copy them
verbatim from `src/features/editor/contextMenu.test.ts`'s header, comment
included. Without them `coordsAtPos` throws and the errors are **uncaught**, so
`vitest run` exits 1 with every assertion passing.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/editor/headingFold.test.ts -t "badge drag"`
Expected: FAIL — the first test fails because the menu still opens on press.

- [ ] **Step 3: Implement the gesture**

In `HeadingFold.ts`, replace `handleDOMEvents.mousedown` with `pointerdown` /
`pointermove` / `pointerup` / `pointercancel`, keeping the toggle branch on
`pointerdown` exactly as it is today. Add to the plugin's `state`:

```ts
interface FoldState {
  keys: string[];
  /** The boundary a live drag is currently over, or `null` when not dragging. */
  dropAt: number | null;
  /** The section being dragged, for the dimming decoration. */
  dragFrom: number | null;
}
```

Both new fields are set through the same `headingFoldKey` meta the fold set
already uses; extend `FoldMeta` to a discriminated shape rather than adding a
second plugin. Add to `decorations`:

```ts
// The drop indicator: a rule at the target boundary, drawn OUTSIDE any
// block. B1's `pos + 1` widget rule does not apply — that rule exists so a
// fold widget becomes a child of its heading element, and this widget sits
// at a top-level boundary between blocks on purpose.
if (drag.dropAt !== null) {
  decorations.push(
    Decoration.widget(drag.dropAt, () => {
      const el = document.createElement('div');
      el.className = 'bear-section-drop';
      el.setAttribute('contenteditable', 'false');
      el.setAttribute('aria-hidden', 'true');
      return el;
    }, { side: -1, key: `drop-${drag.dropAt}` }),
  );
}
```

`key` is required: without it `decorations(state)` rebuilds the widget on every
pass, which is the same cost the module-level `renderIconMarkup` constants at
the top of this file exist to avoid.

Add to `src/styles/editor.css`, after the `.bear-fold-marker` rule:

```css
/*
 * B2's drop indicator: where the dragged section will land.
 *
 * A rule across the measure rather than a gap that opens up — reflowing the
 * document under a live drag moves the very boundaries the pointer is being
 * compared against, and the measurement is taken once at drag start.
 */
.bear-section-drop {
  height: 2px;
  margin-block: -1px;
  background: var(--bear-accent);
  border-radius: 999px;
  pointer-events: none;
}

/* The section being carried, dimmed so the indicator reads as the answer. */
.ProseMirror .bear-section-dragging {
  opacity: 0.4;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/features/editor/headingFold.test.ts`
Expected: PASS, **exit code 0**.

- [ ] **Step 5: Prove the touch test is not vacuous**

Temporarily drop the `pointerType` check from the threshold branch. Re-run.
Expected: "never drags for a touch pointer" fails — `onOpenMenu` was not
called, because the release was treated as a drop. Revert.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run measure:check   # editor.css changed
git add -A
git commit -m "feat(b2): drag the level badge to move a section"
```

If `measure:check` fails, regenerate with `npm run measure`, **and run
`measure` on `main` too before blaming this branch** — that file has silently
drifted three times.

---

### Task 5: End-to-end coverage

**Files:**

- Create: `e2e/headingReorder.spec.ts`
- Modify: `e2e/fixtures/corpus.ts` only if no existing note has three
  same-level sections; check first and prefer reusing what is there.

**Interfaces:**

- Consumes: everything from Tasks 1–4. No new source symbols.

This is the **only** harness that can see the gesture: jsdom has no
`setPointerCapture`, and no unit test in this repo may assert which boundary a
drag chose because every rect there is zero.

- [ ] **Step 1: Write the spec**

```ts
import { expect, test } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

/**
 * B2's gesture. Everything here is unreachable from Vitest: jsdom implements
 * no `setPointerCapture` and no layout, so the threshold, the boundary
 * choice, the indicator and the auto-scroll can only be driven in a real
 * browser.
 */
test.describe('drag-to-reorder headings', () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(FIXED_NOW);
    await seedDatabase(page, CORPUS);
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
  });

  // … open the heading-dense corpus note, then:

  test('dragging a badge upward moves the section and its body', async ({ page }) => {
    const editor = page.getByRole('region', { name: 'Editor' });
    const headings = editor.locator('.ProseMirror h2');
    const before = await headings.allInnerTexts();

    const third = headings.nth(2);
    await third.hover();
    const badge = third.locator('[data-fold-badge]');
    const source = await badge.boundingBox();
    const target = await headings.nth(0).boundingBox();

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    // Past the 4px threshold in one step, then to the target.
    await page.mouse.move(source!.x + source!.width / 2, source!.y + 20);
    await page.mouse.move(target!.x + target!.width / 2, target!.y - 2, { steps: 10 });
    await expect(page.locator('.bear-section-drop')).toBeVisible();
    await page.mouse.up();

    await expect(page.locator('.bear-section-drop')).toHaveCount(0);
    // Assert the ORDER changed to the specific expected order, not merely
    // that it differs — a value that changes with the behaviour, per
    // `docs/rulings/testing-and-tooling.md`.
    expect(await headings.allInnerTexts()).toEqual([before[2], before[0], before[1]]);
  });

  test('Escape mid-drag leaves the document untouched', async ({ page }) => { /* … */ });

  test('a folded section moves with its hidden body and stays folded', async ({ page }) => { /* … */ });

  test('a drag near the pane edge scrolls the editor', async ({ page }) => { /* … */ });

  test('the context menu moves a section by keyboard alone', async ({ page }) => {
    // Shift+F10 opens the menu; arrow to "Move section down"; Enter.
    // This is the route the gutter can never provide.
  });
});

test.describe('on a touch device', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('tapping the badge opens the menu and never drags', async ({ page }) => { /* … */ });
});
```

Fill every `/* … */` in with a real body during implementation — the shapes
above name what each must assert, and a body left as a comment is a plan
failure, not a deliverable.

- [ ] **Step 2: Kill any stale preview server, then run**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/headingReorder.spec.ts --reporter=line
```

Expected: FAIL at first, then PASS once the bodies are written. **A pass before
the feature works means the server was stale** — this repo has been bitten twice.

- [ ] **Step 3: Prove the order assertion is not vacuous**

Temporarily make `planSectionMove` always return `null`. Re-run.
Expected: the drag test fails on the order comparison, not on a missing
element. Revert. (`lsof -ti:4173 | xargs -r kill -9` before and after — a
fault injection against a stale build is the exact failure M9a hit.)

- [ ] **Step 4: Gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
git add e2e/headingReorder.spec.ts
git commit -m "test(b2): end-to-end coverage for the section drag"
```

---

### Task 6: Documentation and the rulings

**Files:**

- Modify: `docs/rulings/markdown-and-schema.md` (the new keybinding)
- Modify: `docs/rulings/accessibility.md` (the Section group as the keyboard
  route; `disabled` vs `aria-disabled`)
- Modify: `docs/rulings/design-tokens-and-layout.md` (the drop indicator)
- Modify: `docs/rulings/testing-and-tooling.md` (the jsdom pointer split)
- Modify: `CLAUDE.md` (status table: B2 → complete; test counts)
- Modify: `docs/superpowers/NEXT.md` (B2 → shipped, with what diverged)

- [ ] **Step 1: Write the rulings**

Each must be a **live constraint with its trigger visible in a diff**, not a
summary. At minimum:

- `markdown-and-schema.md`: `Mod-Alt-ArrowUp`/`Down` are taken by
  `HeadingFold`; `Mod-Alt-ArrowLeft`/`Right` by `StoredImage`. A new binding is
  checked against `node_modules/@tiptap`, not only against browser shortcuts.
- `accessibility.md`: the badge is mouse-only by Chromium's measured
  widget-focus behaviour, so **the Section group in `EditorContextMenu` is
  B2's only keyboard and screen-reader route** and must not be moved to the
  badge menu, which has no keyboard route to open it. The two items use
  `disabled`, not `aria-disabled`, because Playwright refuses to click the
  latter — and unlike the PDF export item they have no reason to explain.
- `design-tokens-and-layout.md`: the drop indicator is a rule, not a gap that
  opens — reflowing under a live drag moves the boundaries being compared
  against, and they are measured once at drag start.
- `testing-and-tooling.md`: **jsdom has `PointerEvent` but not
  `setPointerCapture`** (measured 2026-08-29), so a pointer gesture's STATE
  MACHINE is unit-testable and its GEOMETRY is not. Call
  `setPointerCapture?.()` optionally. Also: `npm run shots` cannot photograph
  the drop indicator, because it exists only during a live drag — so this is
  a visual change with no screenshot coverage by construction.

- [ ] **Step 2: Update the status table**

`CLAUDE.md`'s row `B2 drag-to-reorder headings | queued` → `complete`, and
refresh the unit/e2e test counts from the real run output.

- [ ] **Step 3: Rewrite `NEXT.md`'s B2 section**

Replace the "SPECCED" body with what actually shipped and, more importantly,
**what diverged from this plan and why** — that is the section's whole job.

- [ ] **Step 4: Full gates**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
npm run build
npm run measure:check
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs(b2): rulings, status table, and what diverged"
```

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: the pure move and
the fold remapping → Task 1; one-transaction undo and the binding → Task 2; the
context-menu route → Task 3; the handle, threshold, indicator, auto-scroll and
the touch exclusion → Task 4; the Playwright-only coverage → Task 5; the
rulings → Task 6.

**One thing the plan settles that the spec left open.** The spec said jsdom's
missing `setPointerCapture` made the gesture Playwright-only. Measured on
2026-08-29, that is half right: `PointerEvent` exists, so the *state machine*
(press does not open the menu, release does, a drag suppresses it, touch never
drags, Escape aborts) is unit-testable, and only the *geometry* is not. Task 4
takes the cheap coverage and Task 5 takes the rest.

**Signatures checked against the real code, not from memory** — the rule
`CLAUDE.md` records after a plan invented `Icon`'s prop, a nonexistent
`TestI18nProvider`, and lucide icons that do not exist: `Icon` takes `glyph`;
the test helper is `I18nProvider` with an explicit `locale="en"`;
`lucide-react` really exports `ArrowUp` and `ArrowDown` (checked in
`node_modules`); `ICON_NODES` is needed only by `renderIconMarkup`, so neither
glyph needs an entry.
