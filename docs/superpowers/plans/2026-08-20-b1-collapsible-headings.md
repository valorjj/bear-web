# B1 — Collapsible Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold a heading's section in the editor from a gutter affordance, with a menu on that affordance for setting the heading's level, folds surviving note switches and reloads.

**Architecture:** A Tiptap `Extension` (never a `Node` or `Mark`, so it registers nothing in the schema and the document is never touched) contributes one ProseMirror plugin. Folding is `Decoration.node` with a CSS class; the gutter affordance and the inline folded marker are `Decoration.widget`s. Fold state is held as content-derived identities rather than positions, persisted in its own Dexie table keyed by note id. The menu is rendered by `RichEditor` in React through an injected callback, mirroring the existing `TagPill`/`onActivateTag` boundary.

**Tech Stack:** TypeScript, React 19, Tiptap 3 / ProseMirror, Dexie 4, Vitest, Playwright, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-20-b1-collapsible-headings-design.md`

## Global Constraints

- **`HeadingFold` is an `Extension`, never a `Node` or `Mark`.** It must add nothing to `getSchema(editorExtensions)`. Pinned by Task 3.
- **The document is never mutated by folding.** A folded note must serialize byte-identically to the same note unfolded. Pinned by Task 3.
- **Fail open.** Any fold whose heading cannot be matched is simply not applied. Never hide a section the user did not fold.
- **Only top-level headings are foldable.** A heading inside a blockquote or list item gets no affordance. This keeps the position arithmetic to `doc.forEach`'s top-level offsets and is a deliberate scope limit, not an oversight.
- **A section runs from its heading to the next top-level heading of the same or higher level**, or to the end of the document.
- **No user-facing string is hardcoded.** Every string goes through `useT`; keys are added to both `src/i18n/en.ts` and `src/i18n/ko.ts`. `ko.ts` is typed `Record<TranslationKey, string>` — a missing translation is a compile error and must be translated, never weakened.
- **Every colour comes from a `--bear-*` token.** A literal hex or `rgb()` outside `src/styles/tokens.css` fails `npm test` via `scripts/sourceLint.test.ts`. The affordance uses `--bear-faint` at rest and `--bear-muted` on hover; never `--bear-accent`, reserved for links, checkboxes, highlight, selection and focus.
- **Spacing uses the permitted scale only:** 2 4 8 12 16 24 32 48 px (Tailwind `0.5 1 2 3 4 6 8 12`). An arbitrary value needs an allowlist entry in `scripts/sourceLint.test.ts` with a stated reason.
- **Icons come from `src/ui/Icon.tsx`**, the only permitted importer of `lucide-react`, enforced by `scripts/sourceLint.test.ts`. A new glyph is added to that file's re-export block, never imported at a call site.
- **No new keyboard binding.** `Mod-Alt-1`–`Mod-Alt-6` are already bound by `@tiptap/extension-heading` and work today. Bear's `⌘1`–`⌘6` is unavailable to any web app — browsers own it and a page cannot `preventDefault` it.
- **All six gates pass before every commit:** `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run format`.
- **Before any e2e run that follows a source change, and always before a fault injection:** `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`, so a stale preview server silently tests an old build.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/features/editor/headingSections.ts` (create) | Pure functions over a ProseMirror doc: enumerate top-level headings with their section ranges, and the fold-identity scheme. No ProseMirror plugin, no React, no persistence. |
| `src/features/editor/headingSections.test.ts` (create) | Unit tests for the above, driven by real parsed documents. |
| `src/data/repositories/folds.ts` (create) | `FoldsRepository` over the `noteFolds` table. |
| `src/data/repositories/folds.test.ts` (create) | Unit tests for the repository, including purge cleanup. |
| `src/data/db.ts` (modify) | Dexie version 2 adding the `noteFolds` store. |
| `src/data/types.ts` (modify) | The `NoteFolds` record type. |
| `src/data/repositories/index.ts` (modify) | Construct and export `folds`. |
| `src/data/repositories/notes.ts` (modify) | Clear fold rows in `purge` and `emptyTrash`. |
| `src/data/index.ts` (modify) | Re-export `folds` and its types. |
| `src/features/editor/HeadingFold.ts` (create) | The Tiptap `Extension`: plugin state, fold/unfold commands, hide decorations, widget decorations, boundary key handling. |
| `src/features/editor/headingFold.test.ts` (create) | Structural assertions on decorations and plugin state; the schema assertion; the round-trip assertion. |
| `src/features/editor/extensions.ts` (modify) | Register `HeadingFold`. |
| `src/styles/editor.css` (modify) | Fold hiding, gutter positioning, overlay fallback, inline marker. |
| `src/features/editor/HeadingMenu.tsx` (create) | The React menu: levels 1–6 with shortcut hints, toggle fold, collapse all, expand all. |
| `src/features/editor/RichEditor.tsx` (modify) | Own menu open state, position it, wire commands, pass options into the extension. |
| `src/features/notes/NoteEditor.tsx` (modify) | Load folds on mount, persist on change. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` (modify) | New keys. |
| `e2e/notes.spec.ts`, `e2e/appearance.spec.ts` (modify) | Behaviour and geometry in a real browser. |
| `docs/rulings/markdown-and-schema.md`, `docs/rulings/design-tokens-and-layout.md` (modify) | The rulings this milestone establishes. |

---

### Task 1: Heading sections and fold identity

**Files:**
- Create: `src/features/editor/headingSections.ts`
- Test: `src/features/editor/headingSections.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `HeadingSection`, `FoldKey`, `headingSections(doc: Node): HeadingSection[]`, `foldKeyOf(section: HeadingSection): FoldKey`, `serializeFoldKey(key: FoldKey): string`, `hiddenRangesFor(doc: Node, folded: ReadonlySet<string>): Array<{ from: number; to: number }>`. Tasks 3 and 6 depend on all of these by name.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/headingSections.test.ts`:

```ts
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { headingSections, hiddenRangesFor, serializeFoldKey } from './headingSections';

function docFor(html: string): Editor {
  return new Editor({ extensions: editorExtensions, content: html });
}

describe('headingSections', () => {
  it('reports each top-level heading with its level and text', () => {
    const editor = docFor('<h1>One</h1><p>a</p><h2>Two</h2><p>b</p>');
    const sections = headingSections(editor.state.doc);

    expect(sections.map((s) => [s.level, s.text])).toEqual([
      [1, 'One'],
      [2, 'Two'],
    ]);
    editor.destroy();
  });

  it('ends a section at the next heading of the same or higher level', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h3>nested</h3><p>y</p><h2>B</h2><p>z</p>');
    const sections = headingSections(editor.state.doc);
    const a = sections.find((s) => s.text === 'A')!;
    const b = sections.find((s) => s.text === 'B')!;

    // A swallows the nested h3 and its paragraph, and stops at B.
    expect(a.end).toBe(b.pos);
    editor.destroy();
  });

  it('runs the last section to the end of the document', () => {
    const editor = docFor('<h1>Only</h1><p>tail</p>');
    const [only] = headingSections(editor.state.doc);

    expect(only!.end).toBe(editor.state.doc.content.size);
    editor.destroy();
  });

  it('numbers repeated headings so identical titles stay distinguishable', () => {
    const editor = docFor('<h2>Same</h2><p>a</p><h2>Same</h2><p>b</p>');
    const sections = headingSections(editor.state.doc);

    expect(sections.map((s) => s.nth)).toEqual([0, 1]);
    editor.destroy();
  });

  it('ignores a heading that is not top level', () => {
    const editor = docFor('<blockquote><h2>Quoted</h2></blockquote><p>a</p>');

    expect(headingSections(editor.state.doc)).toHaveLength(0);
    editor.destroy();
  });
});

describe('hiddenRangesFor', () => {
  it('hides a folded section body but never its own heading', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2>');
    const [a, b] = headingSections(editor.state.doc);
    const ranges = hiddenRangesFor(
      editor.state.doc,
      new Set([serializeFoldKey({ level: a!.level, text: a!.text, nth: a!.nth })]),
    );

    expect(ranges).toHaveLength(1);
    // Starts after the heading node ends, and stops where B begins.
    expect(ranges[0]!.from).toBe(a!.pos + editor.state.doc.child(0).nodeSize);
    expect(ranges[0]!.to).toBe(b!.pos);
    editor.destroy();
  });

  it('hides nothing for a fold whose heading no longer exists — it fails open', () => {
    const editor = docFor('<h2>Renamed</h2><p>x</p>');
    const ranges = hiddenRangesFor(
      editor.state.doc,
      new Set([serializeFoldKey({ level: 2, text: 'Original', nth: 0 })]),
    );

    expect(ranges).toEqual([]);
    editor.destroy();
  });

  it('keeps a fold attached across an edit elsewhere in the document', () => {
    const editor = docFor('<h2>Keep</h2><p>x</p><h2>Other</h2><p>y</p>');
    const key = serializeFoldKey({ level: 2, text: 'Keep', nth: 0 });
    const before = hiddenRangesFor(editor.state.doc, new Set([key]));

    // Type into the OTHER section. The folded section is untouched.
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'more');
    const after = hiddenRangesFor(editor.state.doc, new Set([key]));

    expect(after).toHaveLength(1);
    expect(after[0]!.from).toBe(before[0]!.from);
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/headingSections.test.ts`
Expected: FAIL — `Failed to resolve import "./headingSections"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/editor/headingSections.ts`:

```ts
import type { Node } from '@tiptap/pm/model';

/**
 * A top-level heading and the extent of the section it owns.
 *
 * Only TOP-LEVEL headings appear here. A heading inside a blockquote or a list
 * item is deliberately not foldable: it keeps the position arithmetic to
 * `doc.forEach`'s offsets, which are absolute for a doc's direct children, and
 * a folded section nested inside another block has no sensible gutter position
 * anyway.
 */
export interface HeadingSection {
  /** Absolute document position of the heading node. */
  pos: number;
  /** Absolute position one past the heading node itself. */
  contentStart: number;
  /** Absolute position one past the last block this section owns. */
  end: number;
  level: number;
  text: string;
  /** Which occurrence this is among headings sharing `level` and `text`. */
  nth: number;
}

/**
 * How a fold names its heading, so it can survive a remount.
 *
 * Content-derived on purpose. Positions do not survive a reparse, and an
 * ordinal index ("the 3rd heading") fails CLOSED — inserting one heading near
 * the top would shift every fold below it and hide sections the user never
 * folded. This scheme fails OPEN instead: a heading that cannot be matched is
 * simply not folded and the user sees their content, which is the only
 * acceptable direction in an app with no server copy.
 */
export interface FoldKey {
  level: number;
  text: string;
  nth: number;
}

/** Stable string form, so fold sets can be a `Set<string>` and persisted as JSON. */
export function serializeFoldKey(key: FoldKey): string {
  // The level and occurrence are numeric and the text is last, so no delimiter
  // ambiguity is possible however the heading is punctuated.
  return `${key.level}:${key.nth}:${key.text}`;
}

export function foldKeyOf(section: HeadingSection): FoldKey {
  return { level: section.level, text: section.text, nth: section.nth };
}

export function headingSections(doc: Node): HeadingSection[] {
  const found: Array<Omit<HeadingSection, 'end' | 'nth'>> = [];
  const seen = new Map<string, number>();

  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    found.push({
      pos: offset,
      contentStart: offset + node.nodeSize,
      level: node.attrs.level as number,
      text: node.textContent,
    });
  });

  return found.map((heading, index) => {
    // The section ends at the next heading of the same or HIGHER level (a
    // lower `level` number is higher in the hierarchy), so an h2 swallows the
    // h3s beneath it and stops at the next h2 or h1.
    const next = found
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);

    const identity = `${heading.level}:${heading.text}`;
    const nth = seen.get(identity) ?? 0;
    seen.set(identity, nth + 1);

    return { ...heading, nth, end: next ? next.pos : doc.content.size };
  });
}

/**
 * The document ranges a fold set hides.
 *
 * A folded section hides its BODY and never its own heading — the heading is
 * what the user clicks to unfold, and hiding it would make the fold
 * unreachable. A key matching no heading contributes nothing: this is the
 * fail-open rule, and it is why an unmatched fold is silently inert rather
 * than an error.
 */
export function hiddenRangesFor(
  doc: Node,
  folded: ReadonlySet<string>,
): Array<{ from: number; to: number }> {
  return headingSections(doc)
    .filter((section) => folded.has(serializeFoldKey(foldKeyOf(section))))
    .filter((section) => section.end > section.contentStart)
    .map((section) => ({ from: section.contentStart, to: section.end }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/headingSections.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify the fail-open test can actually fail**

Temporarily change `hiddenRangesFor`'s `.filter((section) => folded.has(...))` to `.filter(() => true)` and re-run. Expected: "hides nothing for a fold whose heading no longer exists" FAILS. Revert the change and re-run to green. A test that cannot fail is worth nothing in this project.

- [ ] **Step 6: Run the full gates and commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format
git add src/features/editor/headingSections.ts src/features/editor/headingSections.test.ts
git commit -m "feat(editor): enumerate heading sections and the fold identity scheme"
```

---

### Task 2: The `noteFolds` table and its repository

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/data/db.ts:24-30`
- Create: `src/data/repositories/folds.ts`
- Modify: `src/data/repositories/index.ts`
- Modify: `src/data/repositories/notes.ts` (`purge`, `emptyTrash`)
- Modify: `src/data/index.ts`
- Test: `src/data/repositories/folds.test.ts`

**Interfaces:**
- Consumes: `serializeFoldKey` from Task 1 only as the shape of the strings stored (`string[]`); no import needed.
- Produces: `FoldsRepository` with `get(noteId): Promise<string[]>`, `set(noteId, keys: string[]): Promise<void>`, `remove(noteId): Promise<void>`; the `folds` singleton exported from `src/data`. Task 6 consumes these.

- [ ] **Step 1: Write the failing test**

Create `src/data/repositories/folds.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { BearDatabase } from '../db';
import { createFoldsRepository } from './folds';
import { createNotesRepository } from './notes';

function freshDb(): BearDatabase {
  return new BearDatabase(`folds-test-${Math.random().toString(36).slice(2)}`);
}

let db: BearDatabase;

beforeEach(() => {
  db = freshDb();
});

describe('the folds repository', () => {
  it('returns an empty list for a note that has never been folded', async () => {
    const folds = createFoldsRepository(db);

    expect(await folds.get('missing')).toEqual([]);
  });

  it('round-trips a fold set', async () => {
    const folds = createFoldsRepository(db);
    await folds.set('n1', ['2:0:Alpha', '3:1:Beta']);

    expect(await folds.get('n1')).toEqual(['2:0:Alpha', '3:1:Beta']);
  });

  it('replaces rather than merges, so unfolding everything really clears it', async () => {
    const folds = createFoldsRepository(db);
    await folds.set('n1', ['2:0:Alpha']);
    await folds.set('n1', []);

    expect(await folds.get('n1')).toEqual([]);
  });

  it('purging a note clears its folds, so the table cannot outlive its notes', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });

    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);
    await notes.purge(note.id);

    expect(await folds.get(note.id)).toEqual([]);
  });

  it('emptying the trash clears folds for every note it purges', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });

    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);
    await notes.trash(note.id);
    await notes.emptyTrash();

    expect(await folds.get(note.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/repositories/folds.test.ts`
Expected: FAIL — `Failed to resolve import "./folds"`.

- [ ] **Step 3: Add the record type**

In `src/data/types.ts`, add beside the other record interfaces:

```ts
/**
 * Which sections of a note are folded, as `serializeFoldKey` strings.
 *
 * View state, not content: deliberately absent from the backup bundle, because
 * a restore should return the user's notes and not their reading position.
 */
export interface NoteFolds {
  noteId: string;
  keys: string[];
}
```

- [ ] **Step 4: Add the store, as a version 2**

In `src/data/db.ts`, add the table field to the class beside `settings`:

```ts
  noteFolds!: EntityTable<NoteFolds, 'noteId'>;
```

add `NoteFolds` to the type import from `./types`, and add the version immediately after the existing `this.version(1).stores({...})` block:

```ts
    // Version 2 adds fold state. No `.upgrade()` hook: the table starts empty
    // and an absent row already means "nothing folded", so there is nothing to
    // backfill. Dexie multiplies declared versions by ten, so this is
    // IndexedDB version 20 — `e2e/fixtures/seed.ts` opens at the raw IndexedDB
    // number and must be moved with it, or the seeding connection blocks the
    // upgrade forever and the app boots to a bare `<div id="root">` with no
    // error at all.
    this.version(2).stores({
      noteFolds: 'noteId',
    });
```

- [ ] **Step 5: Write the repository**

Create `src/data/repositories/folds.ts`:

```ts
import type { BearDatabase } from '../db';

export interface FoldsRepository {
  /** The fold keys for a note. An absent row is an empty list, never an error. */
  get(noteId: string): Promise<string[]>;
  /** Replaces the note's whole fold set. An empty array clears it. */
  set(noteId: string, keys: string[]): Promise<void>;
  remove(noteId: string): Promise<void>;
}

export function createFoldsRepository(db: BearDatabase): FoldsRepository {
  return {
    async get(noteId) {
      const row = await db.noteFolds.get(noteId);
      return row?.keys ?? [];
    },

    async set(noteId, keys) {
      // A whole-row replace, not a merge: unfolding the last section must
      // leave nothing behind, and an empty row is cheaper to reason about
      // than a delete-when-empty special case.
      await db.noteFolds.put({ noteId, keys });
    },

    async remove(noteId) {
      await db.noteFolds.delete(noteId);
    },
  };
}
```

- [ ] **Step 6: Clear folds when notes are destroyed**

In `src/data/repositories/notes.ts`, add `db.noteFolds` to both transactions and delete the rows.

In `purge`:

```ts
      await db.transaction('rw', db.notes, db.noteTags, db.files, db.noteFolds, async () => {
        await db.noteTags.where('noteId').equals(id).delete();
        await db.files.where('noteId').equals(id).delete();
        await db.noteFolds.delete(id);
        await db.notes.delete(id);
      });
```

In `emptyTrash`, add `db.noteFolds` to the transaction table list and add, beside the sibling deletes:

```ts
        await db.noteFolds.bulkDelete(ids);
```

- [ ] **Step 7: Export it**

In `src/data/repositories/index.ts`:

```ts
import { createFoldsRepository } from './folds';
```
```ts
export const folds = createFoldsRepository(db);
```
```ts
export type { FoldsRepository } from './folds';
```

In `src/data/index.ts`, add `folds` to the `./repositories` value export, `FoldsRepository` to its type export, and `NoteFolds` to the `./types` type export.

- [ ] **Step 8: Assert fold state stays out of the backup bundle**

Fold state is view state, not content: a restore should return the user's notes,
not their reading position. `src/data/backup.ts:90` carries an explicit table
list, so exclusion is the default — but a default nobody asserts is a default
someone will change. Append to `src/data/repositories/folds.test.ts`:

```ts
import { exportDatabase } from '../backup';

describe('fold state and the backup bundle', () => {
  it('is absent from an exported bundle, because it is view state', async () => {
    const folds = createFoldsRepository(db);
    const notes = createNotesRepository({ db, parseTags: () => [] });
    const note = await notes.create('# A');
    await folds.set(note.id, ['1:0:A']);

    const bundle = await exportDatabase(db);

    expect(Object.keys(bundle)).not.toContain('noteFolds');
  });
});
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run src/data/repositories/folds.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 10: Move the e2e seed to the new IndexedDB version**

Read `e2e/fixtures/seed.ts`. It opens IndexedDB at the raw version Dexie's declared version maps to (Dexie multiplies by ten). With `version(2)` that number becomes `20`. Update it, then run the e2e suite — a wrong number here produces no error at all, only a `console.warn` about a blocked upgrade and a blank page.

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
```
Expected: 58 passed. If the app renders blank, the seed version is wrong.

- [ ] **Step 11: Run the full gates and commit**

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format
git add src/data e2e/fixtures/seed.ts
git commit -m "feat(data): add the noteFolds table and its repository"
```

---

### Task 3: The `HeadingFold` extension — state, commands, hiding

**Files:**
- Create: `src/features/editor/HeadingFold.ts`
- Modify: `src/features/editor/extensions.ts:24-77`
- Modify: `src/styles/editor.css`
- Test: `src/features/editor/headingFold.test.ts`

**Interfaces:**
- Consumes: `headingSections`, `hiddenRangesFor`, `foldKeyOf`, `serializeFoldKey`, `HeadingSection` from Task 1.
- Produces: `HeadingFold` extension; `HeadingFoldOptions`; `foldedKeys(state: EditorState): string[]`; commands `toggleHeadingFold(pos: number)`, `foldAllHeadings()`, `unfoldAllHeadings()`, `setHeadingFolds(keys: string[])`. Tasks 4, 5 and 6 consume these by name.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/headingFold.test.ts`:

```ts
import { Editor, getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { foldedKeys } from './HeadingFold';
import { headingSections } from './headingSections';
import { parseMarkdown, serializeMarkdown } from './markdown';

function docFor(html: string): Editor {
  return new Editor({ extensions: editorExtensions, content: html });
}

describe('the heading fold schema contract', () => {
  it('adds nothing to the schema, because it is an Extension', () => {
    const schema = getSchema(editorExtensions);

    expect(Object.keys(schema.nodes)).not.toContain('headingFold');
    expect(Object.keys(schema.marks)).not.toContain('headingFold');
  });

  it('leaves the document byte-identical when a section is folded', () => {
    const markdown = '## A\n\nbody\n\n## B\n\nmore';
    const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
    const before = serializeMarkdown(editor.getJSON());

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);

    expect(serializeMarkdown(editor.getJSON())).toBe(before);
    editor.destroy();
  });
});

describe('folding commands', () => {
  it('toggles one heading on and off', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);

    editor.commands.toggleHeadingFold(a!.pos);
    expect(foldedKeys(editor.state)).toEqual([]);
    editor.destroy();
  });

  it('folds every heading, and unfolds every heading', () => {
    const editor = docFor('<h1>A</h1><p>x</p><h2>B</h2><p>y</p>');

    editor.commands.foldAllHeadings();
    expect(foldedKeys(editor.state)).toEqual(['1:0:A', '2:0:B']);

    editor.commands.unfoldAllHeadings();
    expect(foldedKeys(editor.state)).toEqual([]);
    editor.destroy();
  });

  it('restores a persisted fold set', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');

    editor.commands.setHeadingFolds(['2:0:A']);
    expect(foldedKeys(editor.state)).toEqual(['2:0:A']);
    editor.destroy();
  });

  it('keeps a fold key that currently matches no heading, so it returns if the heading does', () => {
    const editor = docFor('<h2>A</h2><p>x</p>');

    editor.commands.setHeadingFolds(['2:0:Gone']);
    // Retained in state...
    expect(foldedKeys(editor.state)).toEqual(['2:0:Gone']);
    // ...but hides nothing, which is the fail-open half.
    expect(hiddenCount(editor)).toBe(0);
    editor.destroy();
  });
});

/** How many blocks the plugin is currently hiding. */
function hiddenCount(editor: Editor): number {
  const decorations = editor.view.someProp('decorations', (f) => f(editor.state));
  let count = 0;
  decorations?.find().forEach((d) => {
    if ((d.spec as { foldHidden?: boolean }).foldHidden) count += 1;
  });
  return count;
}

describe('fold decorations', () => {
  it('hides the section body and not its heading', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);

    expect(hiddenCount(editor)).toBe(1);
    editor.destroy();
  });

  it('folds nested headings along with their parent', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h3>n</h3><p>y</p><h2>B</h2>');
    const [a] = headingSections(editor.state.doc);

    editor.commands.toggleHeadingFold(a!.pos);

    // paragraph, h3, paragraph
    expect(hiddenCount(editor)).toBe(3);
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/headingFold.test.ts`
Expected: FAIL — `Failed to resolve import "./HeadingFold"`.

- [ ] **Step 3: Write the extension**

Create `src/features/editor/HeadingFold.ts`:

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { foldKeyOf, headingSections, hiddenRangesFor, serializeFoldKey } from './headingSections';

export interface HeadingFoldOptions {
  /**
   * Called when the user clicks a heading's level badge, with the heading's
   * document position and the badge's screen rectangle. `null` when nobody is
   * listening, which is the state of the schema-only `editorExtensions`
   * constant — and, as with `TagPill.onActivate`, a non-null callback is what
   * makes the plugin consume the click at all.
   */
  onOpenMenu: ((request: HeadingMenuRequest) => void) | null;
  /** Already translated; an extension has no access to `useT`. */
  foldHint: string | null;
}

export interface HeadingMenuRequest {
  /** Document position of the heading node. */
  pos: number;
  level: number;
  folded: boolean;
  /** Viewport rectangle of the badge, for anchoring the menu. */
  rect: DOMRect;
}

interface FoldState {
  keys: string[];
}

const headingFoldKey = new PluginKey<FoldState>('headingFold');

/** Transaction meta carrying the next fold set. */
interface FoldMeta {
  keys: string[];
}

/** The fold keys currently held in plugin state, in document order where they match. */
export function foldedKeys(state: EditorState): string[] {
  return headingFoldKey.getState(state)?.keys ?? [];
}

function setKeys(tr: Transaction, keys: string[]): Transaction {
  return tr.setMeta(headingFoldKey, { keys } satisfies FoldMeta);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingFold: {
      toggleHeadingFold: (pos: number) => ReturnType;
      foldAllHeadings: () => ReturnType;
      unfoldAllHeadings: () => ReturnType;
      setHeadingFolds: (keys: string[]) => ReturnType;
    };
  }
}

/**
 * Folds a heading's section.
 *
 * An `Extension`, never a `Node` or `Mark`: it registers nothing in the schema,
 * so `getSchema(editorExtensions)`, `computeRecognizedHtmlTags()` and every
 * round-trip suite are untouched by it — exactly as `TagPill` is. Folding is
 * decoration only; the document is never mutated, so a fold can never survive
 * into a note's Markdown or reach an export.
 *
 * The consequence is that every round-trip test in this project is blind to
 * whether this plugin runs at all. `headingFold.test.ts` asserts on the
 * decoration set and the plugin state, and is the only thing that can catch a
 * dead plugin.
 */
export const HeadingFold = Extension.create<HeadingFoldOptions>({
  name: 'headingFold',

  addOptions() {
    return { onOpenMenu: null, foldHint: null };
  },

  addCommands() {
    return {
      toggleHeadingFold:
        (pos: number) =>
        ({ state, dispatch }) => {
          const section = headingSections(state.doc).find((s) => s.pos === pos);
          if (!section) return false;

          const key = serializeFoldKey(foldKeyOf(section));
          const current = foldedKeys(state);
          const next = current.includes(key)
            ? current.filter((k) => k !== key)
            : [...current, key];

          if (dispatch) dispatch(setKeys(state.tr, next));
          return true;
        },

      foldAllHeadings:
        () =>
        ({ state, dispatch }) => {
          const keys = headingSections(state.doc).map((s) => serializeFoldKey(foldKeyOf(s)));
          if (dispatch) dispatch(setKeys(state.tr, keys));
          return true;
        },

      unfoldAllHeadings:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(setKeys(state.tr, []));
          return true;
        },

      setHeadingFolds:
        (keys: string[]) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(setKeys(state.tr, [...keys]));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FoldState>({
        key: headingFoldKey,

        state: {
          init: () => ({ keys: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(headingFoldKey) as FoldMeta | undefined;
            // Keys are content-derived, so a document change needs no mapping
            // — the identity is re-matched against the new document on every
            // decoration pass. An unmatched key is RETAINED rather than
            // dropped: renaming a heading and renaming it back should restore
            // the fold, and a key that matches nothing hides nothing anyway.
            return meta ? { keys: meta.keys } : value;
          },
        },

        props: {
          decorations(state) {
            const keys = new Set(headingFoldKey.getState(state)?.keys ?? []);
            if (keys.size === 0) return DecorationSet.empty;

            const decorations: Decoration[] = [];
            for (const range of hiddenRangesFor(state.doc, keys)) {
              state.doc.nodesBetween(range.from, range.to, (node, pos) => {
                // Top-level blocks only: hiding the outermost block hides its
                // descendants with it, and decorating both would double-count.
                if (pos < range.from || pos >= range.to) return false;
                if (state.doc.resolve(pos).depth !== 0) return false;
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, { class: 'bear-fold-hidden' }, {
                    foldHidden: true,
                  }),
                );
                return false;
              });
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
```

- [ ] **Step 4: Register the extension**

In `src/features/editor/extensions.ts`, import it and add it to `buildSupportedExtensions`'s returned array immediately after `TagPill.configure(options)`:

```ts
import { HeadingFold } from './HeadingFold';
```

```ts
    // An `Extension` (not a `Node` or `Mark`), so it registers nothing in the
    // schema — `computeRecognizedHtmlTags()` and every round-trip suite are
    // unaffected. It contributes one plugin that decorates folded sections;
    // the document and its Markdown are untouched. See `HeadingFold.ts` and
    // `headingFold.test.ts`.
    HeadingFold,
```

Leave `buildSupportedExtensions`'s signature alone for now — Task 5 threads options in.

- [ ] **Step 5: Add the hiding rule**

In `src/styles/editor.css`, append:

```css
/*
 * A folded section's blocks. `display: none` rather than `visibility` or a
 * height clamp: the block must take no space at all, and ProseMirror keeps the
 * positions regardless, since the document is untouched.
 */
.ProseMirror .bear-fold-hidden {
  display: none;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/headingFold.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Prove the round-trip assertion can fail**

Temporarily make `toggleHeadingFold` mutate the document — add `tr.insertText('x', section.contentStart)` before the dispatch. Re-run. Expected: "leaves the document byte-identical when a section is folded" FAILS. Revert and re-run to green. This is the assertion that the whole no-mutation guarantee rests on, and an assertion nobody has watched fail is not evidence.

- [ ] **Step 8: Run the full gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run format
git add src/features/editor/HeadingFold.ts src/features/editor/headingFold.test.ts src/features/editor/extensions.ts src/styles/editor.css
git commit -m "feat(editor): fold a heading's section with decorations, never the document"
```

---

### Task 4: The gutter affordance and the inline folded marker

**Files:**
- Modify: `src/features/editor/HeadingFold.ts`
- Modify: `src/styles/editor.css`
- Modify: `src/ui/Icon.tsx`
- Modify: `src/features/editor/headingFold.test.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: everything Task 3 produced.
- Produces: widget decorations carrying `data-fold-toggle` and `data-fold-badge` attributes on each top-level heading, and `data-fold-marker` at the end of a folded heading. Task 5 hit-tests `data-fold-badge`; `e2e/appearance.spec.ts` in Task 8 selects all three.

- [ ] **Step 1: Write the failing test**

Append to `src/features/editor/headingFold.test.ts`:

```ts
/** Widget decorations the plugin currently renders, by their marker attribute. */
function widgetKinds(editor: Editor): string[] {
  const decorations = editor.view.someProp('decorations', (f) => f(editor.state));
  const kinds: string[] = [];
  decorations?.find().forEach((d) => {
    const kind = (d.spec as { foldWidget?: string }).foldWidget;
    if (kind) kinds.push(kind);
  });
  return kinds;
}

describe('the gutter affordance', () => {
  it('renders a toggle and a badge for every top-level heading', () => {
    const editor = docFor('<h1>A</h1><p>x</p><h2>B</h2>');

    expect(widgetKinds(editor).filter((k) => k === 'toggle')).toHaveLength(2);
    expect(widgetKinds(editor).filter((k) => k === 'badge')).toHaveLength(2);
    editor.destroy();
  });

  it('renders no affordance for a heading that is not top level', () => {
    const editor = docFor('<blockquote><h2>Quoted</h2></blockquote>');

    expect(widgetKinds(editor)).toEqual([]);
    editor.destroy();
  });

  it('adds an inline marker only to a folded heading', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2>');
    expect(widgetKinds(editor).filter((k) => k === 'marker')).toHaveLength(0);

    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);

    expect(widgetKinds(editor).filter((k) => k === 'marker')).toHaveLength(1);
    editor.destroy();
  });

  it('shows the badge level, so the number is the heading level', () => {
    const editor = docFor('<h3>C</h3>');
    const decorations = editor.view.someProp('decorations', (f) => f(editor.state));
    let text = '';
    decorations?.find().forEach((d) => {
      if ((d.spec as { foldWidget?: string }).foldWidget === 'badge') {
        text = (d as unknown as { type: { toDOM: HTMLElement } }).type.toDOM.textContent ?? '';
      }
    });

    expect(text).toBe('3');
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/headingFold.test.ts -t "gutter affordance"`
Expected: FAIL — no widget decorations exist yet.

- [ ] **Step 3: Add the glyph**

In `src/ui/Icon.tsx`, add `ChevronDown` to the re-export block. `ChevronRight` is already exported and is reused for the folded state.

- [ ] **Step 4: Add the translations**

In `src/i18n/en.ts`:

```ts
  'editor.fold.toggle': 'Fold or unfold this section',
  'editor.fold.level': 'Heading level',
  'editor.fold.foldAll': 'Fold all headings',
  'editor.fold.unfoldAll': 'Unfold all headings',
  'editor.fold.folded': 'Section folded',
  'editor.fold.headingLevel': 'Heading',
```

In `src/i18n/ko.ts`, matching Bear's own Korean:

```ts
  'editor.fold.toggle': '이 섹션 접기 또는 펼치기',
  'editor.fold.level': '머리말 수준',
  'editor.fold.foldAll': '모든 머리글 접기',
  'editor.fold.unfoldAll': '모든 머리글 펼치기',
  'editor.fold.folded': '섹션 접힘',
  'editor.fold.headingLevel': '머리말',
```

- [ ] **Step 5: Build the widgets**

In `HeadingFold.ts`, extend the `decorations` prop. After the hidden-block loop, and regardless of whether any key is set — so delete the `if (keys.size === 0) return DecorationSet.empty;` early return and let an empty set simply produce no hidden blocks:

```ts
            for (const section of headingSections(state.doc)) {
              const folded = keys.has(serializeFoldKey(foldKeyOf(section)));

              decorations.push(
                Decoration.widget(section.pos, () => toggleElement(folded, foldHint), {
                  side: -1,
                  // Widgets are not document content, but say so explicitly:
                  // a widget that ProseMirror thinks is text would be included
                  // in `textBetween` and could reach the serializer.
                  ignoreSelection: true,
                  foldWidget: 'toggle',
                }),
              );

              decorations.push(
                Decoration.widget(section.pos, () => badgeElement(section.level), {
                  side: -1,
                  ignoreSelection: true,
                  foldWidget: 'badge',
                }),
              );

              if (folded) {
                decorations.push(
                  // At the END of the heading's own line, inside the measure.
                  // A persistent GUTTER mark would overlay text at rest on a
                  // narrow pane, which is exactly what the hover-only gutter
                  // rule exists to prevent.
                  Decoration.widget(section.contentStart - 1, () => markerElement(), {
                    side: 1,
                    ignoreSelection: true,
                    foldWidget: 'marker',
                  }),
                );
              }
            }
```

and add the element builders above the extension:

```ts
function button(className: string, label: string | null): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.contentEditable = 'false';
  if (label !== null) el.setAttribute('aria-label', label);
  return el;
}

function toggleElement(folded: boolean, hint: string | null): HTMLElement {
  const el = button('bear-fold-toggle', hint);
  el.setAttribute('data-fold-toggle', '');
  el.setAttribute('aria-expanded', folded ? 'false' : 'true');
  return el;
}

function badgeElement(level: number): HTMLElement {
  const el = button('bear-fold-badge', null);
  el.setAttribute('data-fold-badge', '');
  el.setAttribute('data-level', String(level));
  el.textContent = String(level);
  return el;
}

function markerElement(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'bear-fold-marker';
  el.setAttribute('data-fold-marker', '');
  el.setAttribute('contenteditable', 'false');
  el.textContent = '…';
  return el;
}
```

Read `foldHint` from options the same way `TagPill` does — capture `const { foldHint } = this.options;` in `addProseMirrorPlugins` before constructing the plugin, never as `this.options` inside a prop.

- [ ] **Step 6: Position them**

Append to `src/styles/editor.css`:

```css
/*
 * The gutter affordance.
 *
 * Absolutely positioned so it costs no layout: at 1440x900 the prose column
 * clamps to 640px inside an 816px pane, leaving 88px of gutter, but panes are
 * user-resizable and below roughly 688px of pane width there is no gutter at
 * all. Rather than reserve a lane — which would narrow a deliberately measured
 * `--bear-line-width` at every width — the controls sit in negative inline
 * space and simply overlay the text's left edge when there is none.
 *
 * Hover-only, so at rest nothing overlaps prose. The persistent "this is
 * folded" cue is `.bear-fold-marker` below, which is inline and inside the
 * measure for exactly that reason.
 */
.ProseMirror :is(h1, h2, h3, h4, h5, h6) {
  position: relative;
}

.bear-fold-toggle,
.bear-fold-badge {
  position: absolute;
  top: 0.25em;
  opacity: 0;
  color: var(--bear-faint);
  transition: opacity var(--bear-duration-fast), color var(--bear-duration-fast);
}

.bear-fold-toggle {
  inset-inline-start: -3rem;
}

.bear-fold-badge {
  inset-inline-start: -1.5rem;
}

.ProseMirror :is(h1, h2, h3, h4, h5, h6):hover .bear-fold-toggle,
.ProseMirror :is(h1, h2, h3, h4, h5, h6):hover .bear-fold-badge,
.bear-fold-toggle:focus-visible,
.bear-fold-badge:focus-visible,
.bear-fold-badge[aria-expanded='true'] {
  opacity: 1;
}

.bear-fold-toggle:hover,
.bear-fold-badge:hover {
  color: var(--bear-muted);
}

/* Inline, in flow, inside the measure: covers nothing at any pane width. */
.bear-fold-marker {
  color: var(--bear-faint);
  margin-inline-start: 0.5ch;
  user-select: none;
}

@media (prefers-reduced-motion: reduce) {
  .bear-fold-toggle,
  .bear-fold-badge {
    transition: none;
  }
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/headingFold.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 8: Run the full gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run format
git add src/features/editor src/styles/editor.css src/ui/Icon.tsx src/i18n
git commit -m "feat(editor): add the fold gutter affordance and the inline folded marker"
```

---

### Task 5: The level menu

**Files:**
- Create: `src/features/editor/HeadingMenu.tsx`
- Modify: `src/features/editor/HeadingFold.ts` (mousedown handling)
- Modify: `src/features/editor/extensions.ts` (thread options)
- Modify: `src/features/editor/RichEditor.tsx`
- Test: `src/features/editor/headingMenu.test.tsx`

**Interfaces:**
- Consumes: `HeadingMenuRequest`, the four commands from Task 3, `data-fold-badge` from Task 4.
- Produces: `HeadingMenu` component with props `{ request: HeadingMenuRequest; onSetLevel: (level: number) => void; onToggleFold: () => void; onFoldAll: () => void; onUnfoldAll: () => void; onClose: () => void }`.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/headingMenu.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { HeadingMenu } from './HeadingMenu';

function renderMenu(overrides: Partial<Parameters<typeof HeadingMenu>[0]> = {}) {
  const props = {
    request: { pos: 0, level: 2, folded: false, rect: new DOMRect(10, 10, 16, 16) },
    onSetLevel: vi.fn(),
    onToggleFold: vi.fn(),
    onFoldAll: vi.fn(),
    onUnfoldAll: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <HeadingMenu {...props} />
    </I18nProvider>,
  );
  return props;
}

describe('the heading menu', () => {
  it('marks the heading’s current level as the selected one', () => {
    renderMenu();

    expect(screen.getByRole('menuitemradio', { name: /Heading 2/ })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Heading 1/ })).not.toBeChecked();
  });

  it('sets a level when one is chosen', async () => {
    const props = renderMenu();

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Heading 4/ }));

    expect(props.onSetLevel).toHaveBeenCalledWith(4);
  });

  it('choosing the level the heading already has closes without setting it again', async () => {
    const props = renderMenu();

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Heading 2/ }));

    expect(props.onSetLevel).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('offers fold, fold all and unfold all', async () => {
    const props = renderMenu();

    await userEvent.click(screen.getByRole('menuitem', { name: /Fold all/ }));
    expect(props.onFoldAll).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('menuitem', { name: /Unfold all/ }));
    expect(props.onUnfoldAll).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const props = renderMenu();

    await userEvent.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalled();
  });

  it('names the platform-correct shortcut for each level', () => {
    renderMenu();

    // Mod-Alt-N, already bound by @tiptap/extension-heading. Never Cmd+N:
    // browsers own Cmd+1..9 and a page cannot preventDefault it.
    expect(screen.getByRole('menuitemradio', { name: /Heading 3/ })).toHaveTextContent(/⌥/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/headingMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "./HeadingMenu"`.

- [ ] **Step 3: Write the menu**

Create `src/features/editor/HeadingMenu.tsx`:

```tsx
import { isMacOS } from '@tiptap/core';
import { type ReactElement, useEffect, useRef } from 'react';

import { useT } from '@/i18n';

import type { HeadingMenuRequest } from './HeadingFold';

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Everything focusable, NOT `'button'`.
 *
 * `ConfirmDialog`'s trap queries `'button'` specifically. That is a documented
 * gap, harmless there only because it holds exactly two buttons; copying it
 * here would silently skip any future non-button item, leaving it invisible to
 * both the initial-focus effect and the Tab-wrap arithmetic.
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

export interface HeadingMenuProps {
  request: HeadingMenuRequest;
  onSetLevel: (level: number) => void;
  onToggleFold: () => void;
  onFoldAll: () => void;
  onUnfoldAll: () => void;
  onClose: () => void;
}

/**
 * The level menu on a heading's fold badge.
 *
 * Rendered by the app, never by the plugin: the editor deliberately learns
 * nothing about app concerns, the same boundary `TagPill`/`onActivateTag`
 * keeps. The plugin reports where the badge is; React draws the menu.
 *
 * The shortcut hint says `Mod-Alt-N` because that is what
 * `@tiptap/extension-heading` already binds. It is NOT Bear's `Cmd-N`:
 * browsers own `Cmd-1`..`Cmd-9` for tab switching and a page cannot
 * `preventDefault` it, so those keys are unavailable to this app at any price.
 */
export function HeadingMenu({
  request,
  onSetLevel,
  onToggleFold,
  onFoldAll,
  onUnfoldAll,
  onClose,
}: HeadingMenuProps): ReactElement {
  const t = useT();
  const ref = useRef<HTMLDivElement | null>(null);
  const modifier = isMacOS() ? '\u2318\u2325' : 'Ctrl+Alt+';

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey ? index - 1 : index + 1;
    if (next < 0 || next >= items.length) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]?.focus();
    }
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('editor.fold.level')}
      onKeyDown={onKeyDown}
      style={{ top: request.rect.bottom + 4, left: request.rect.left }}
      className="bg-surface border-border shadow-popover fixed z-20 min-w-48 rounded-md border p-1"
    >
      {LEVELS.map((level) => (
        <button
          key={level}
          type="button"
          role="menuitemradio"
          aria-checked={level === request.level}
          onClick={() => {
            // Choosing the level a heading already has is a no-op, not a
            // toggle: the check mark is radio semantics and toggling from it
            // would contradict the mark. The keyboard shortcut still toggles,
            // which is pre-existing upstream behaviour left deliberately alone.
            if (level !== request.level) onSetLevel(level);
            onClose();
          }}
          className="text-ui-sm text-text hover:bg-hover flex w-full items-center justify-between gap-4 rounded px-2 py-1 text-left"
        >
          <span>
            {t('editor.fold.headingLevel')} {level}
          </span>
          <span className="text-faint">{`${modifier}${level}`}</span>
        </button>
      ))}

      <div className="bg-border my-1 h-px" role="separator" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggleFold();
          onClose();
        }}
        className="text-ui-sm text-text hover:bg-hover w-full rounded px-2 py-1 text-left"
      >
        {t('editor.fold.toggle')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onFoldAll();
          onClose();
        }}
        className="text-ui-sm text-text hover:bg-hover w-full rounded px-2 py-1 text-left"
      >
        {t('editor.fold.foldAll')}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onUnfoldAll();
          onClose();
        }}
        className="text-ui-sm text-text hover:bg-hover w-full rounded px-2 py-1 text-left"
      >
        {t('editor.fold.unfoldAll')}
      </button>
    </div>
  );
}
```

Note `min-w-48` is on the permitted spacing scale (Tailwind `12` = 48px); if any
value you add is not, allowlist it in `scripts/sourceLint.test.ts` with a stated
reason rather than silently widening the scale.

- [ ] **Step 4: Open it from the badge**

In `HeadingFold.ts`, add a `handleDOMEvents.mousedown` to the plugin, following `TagPill`'s discipline exactly — capture `onOpenMenu` in the closure, return `false` when it is `null`, and only `preventDefault()` after deciding to act:

```ts
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const badge = target?.closest('[data-fold-badge]');
              const toggle = target?.closest('[data-fold-toggle]');
              if (!badge && !toggle) return false;
              if (event.button !== 0) return false;

              const pos = view.posAtDOM(
                (badge ?? toggle)!.parentElement as globalThis.Node,
                0,
              );
              const section = headingSections(view.state.doc).find(
                (s) => s.pos <= pos && pos < s.contentStart,
              );
              if (!section) return false;

              // `preventDefault` before dispatching, not after asking: unlike a
              // tag pill, this element is chrome the user cannot type into, so
              // there is no "behave like a plain click" fallback worth
              // preserving. What must not happen is the caret jumping to the
              // widget's position.
              event.preventDefault();

              if (toggle) {
                view.dispatch(setKeys(view.state.tr, nextKeysToggling(view.state, section)));
                return true;
              }

              if (onOpenMenu === null) return false;
              onOpenMenu({
                pos: section.pos,
                level: section.level,
                folded: foldedKeys(view.state).includes(
                  serializeFoldKey(foldKeyOf(section)),
                ),
                rect: (badge as HTMLElement).getBoundingClientRect(),
              });
              return true;
            },
          },
```

Command helpers are not reachable from inside a raw plugin, so factor the "next key set for this section" calculation into a module-level function and call it from BOTH the command and the plugin. Two copies of this logic is exactly the kind of duplication that drifts. Add above the extension:

```ts
/** The fold set that toggling `section` produces. Shared by the command and the plugin. */
function nextKeysToggling(state: EditorState, section: HeadingSection): string[] {
  const key = serializeFoldKey(foldKeyOf(section));
  const current = foldedKeys(state);
  return current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
}
```

and rewrite `toggleHeadingFold`'s body to use it:

```ts
      toggleHeadingFold:
        (pos: number) =>
        ({ state, dispatch }) => {
          const section = headingSections(state.doc).find((s) => s.pos === pos);
          if (!section) return false;
          if (dispatch) dispatch(setKeys(state.tr, nextKeysToggling(state, section)));
          return true;
        },
```

Import `HeadingSection` alongside the other `headingSections` imports.

- [ ] **Step 5: Thread the options through**

In `extensions.ts`, widen `buildSupportedExtensions` and `buildEditorExtensions` to take `Partial<TagPillOptions & HeadingFoldOptions>` and pass the heading options to `HeadingFold.configure(...)`. **`computeRecognizedHtmlTags` must keep calling `buildSupportedExtensions({})`** — an `Extension` registers nothing in the schema and the options must never be able to change what that schema build sees.

- [ ] **Step 6: Render it from `RichEditor`**

In `RichEditor.tsx`, hold `const [menu, setMenu] = useState<HeadingMenuRequest | null>(null)`, pass `onOpenMenu: setMenu` and a translated `foldHint` into `buildEditorExtensions`, and render `<HeadingMenu ... />` when `menu !== null`. Wire `onSetLevel` to `editor.chain().focus().setNode('heading', { level }).run()`, `onToggleFold` to `editor.commands.toggleHeadingFold(menu.pos)`, and the two others to `foldAllHeadings` / `unfoldAllHeadings`.

Follow the existing ref-backed wrapper pattern used for `onActivateTag`: the extension array is built once, so a callback captured at construction must be a stable function reading a ref, not the state setter directly.

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/headingMenu.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 8: Run the full gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run format
git add src/features/editor
git commit -m "feat(editor): add the heading level menu on the fold badge"
```

---

### Task 6: Persist folds per note

**Files:**
- Modify: `src/features/notes/NoteEditor.tsx`
- Test: `src/features/notes/NoteEditor.test.tsx`

**Interfaces:**
- Consumes: `folds` from `@/data` (Task 2); `foldedKeys`, `setHeadingFolds` (Task 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to `src/features/notes/NoteEditor.test.tsx`, using the three jsdom stubs documented at the head of that file:

```tsx
describe('fold persistence', () => {
  it('applies the stored fold set when the note opens', async () => {
    const note = await notes.create('## A\n\nbody');
    await folds.set(note.id, ['2:0:A']);

    renderEditor(note);

    await waitFor(() => {
      expect(screen.getByText('body')).not.toBeVisible();
    });
  });

  it('writes the new fold set when a section is folded', async () => {
    const note = await notes.create('## A\n\nbody');
    const set = vi.spyOn(folds, 'set');

    const { handle } = renderEditor(note);
    await waitFor(() => expect(handle.current?.editor).not.toBeNull());
    const [section] = headingSections(handle.current!.editor!.state.doc);
    handle.current!.editor!.commands.toggleHeadingFold(section!.pos);

    await waitFor(() => {
      expect(set).toHaveBeenCalledWith(note.id, ['2:0:A']);
    });
  });

  it('opening a note produces no fold write', async () => {
    const note = await notes.create('## A\n\nbody');
    await folds.set(note.id, ['2:0:A']);
    const set = vi.spyOn(folds, 'set');

    renderEditor(note);
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument());

    // Mirrors the standing rule that opening a note produces no write. A
    // persistence layer that rewrites on mount churns a row on every note
    // switch, and this app switches notes constantly.
    expect(set).not.toHaveBeenCalled();
  });
});
```

Reuse whatever `renderEditor` helper that file already defines; if it does not expose the handle ref, extend it rather than writing a second helper.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/notes/NoteEditor.test.tsx -t "fold persistence"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `NoteEditor.tsx`:

```tsx
  // Folds are loaded once per mount. `NoteEditor` is keyed by `note.id`, so
  // one mounted editor serves exactly one note for its lifetime — the same
  // property that makes its autosave flush-on-unmount correct — and no
  // cross-note reconciliation is needed here.
  useEffect(() => {
    let cancelled = false;
    void folds.get(note.id).then((keys) => {
      if (cancelled || keys.length === 0) return;
      handleRef.current?.editor?.commands.setHeadingFolds(keys);
    });
    return () => {
      cancelled = true;
    };
  }, [note.id]);

  // Persisted on change, debounced, fire-and-forget. The fold has ALREADY
  // applied in plugin state by the time this runs, so a failed write costs a
  // fold and never content — which is why it is deliberately not awaited and
  // deliberately does not surface an error.
  useEffect(() => {
    const editor = handleRef.current?.editor;
    if (!editor) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = '';

    const onTransaction = (): void => {
      const keys = foldedKeys(editor.state);
      const serialized = keys.join('\u0000');
      if (serialized === last) return;
      last = serialized;
      clearTimeout(timer);
      timer = setTimeout(() => void folds.set(note.id, keys), FOLD_PERSIST_DELAY_MS);
    };

    // Seeded from the mounted editor's own reading, so restoring a stored set
    // in the effect above does not immediately write it back.
    last = foldedKeys(editor.state).join('\u0000');

    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      clearTimeout(timer);
    };
  }, [note.id]);
```

with `const FOLD_PERSIST_DELAY_MS = 300;` at module scope, matching `AUTOSAVE_DELAY_MS`.

**`'\u0000'` above must be written as that six-character escape sequence and then VERIFIED as bytes on disk.** Writing it through a file-writing tool's JSON string parameter silently produces a real NUL byte; this project has hit that five times. After editing, run:

```bash
git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
```
Expected: `none`. If you would rather not risk it, join with `'|'` instead — the value is only ever compared for equality against itself.

Because `NoteEditor` is keyed by `note.id`, one mounted editor serves exactly one note for its lifetime, so no cross-note reconciliation is needed — the same property that makes its autosave flush-on-unmount correct.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/notes/NoteEditor.test.tsx`
Expected: PASS. **Check the exit code, not the pass count** — an uncaught error in an editor test makes `vitest run` exit 1 even when every assertion passes.

- [ ] **Step 5: Run the full gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run format
git add src/features/notes
git commit -m "feat(editor): persist folds per note"
```

---

### Task 7: Editing hazards at a fold boundary

**Files:**
- Modify: `src/features/editor/HeadingFold.ts`
- Modify: `src/features/editor/headingFold.test.ts`

**Interfaces:**
- Consumes: everything above. Produces nothing new.

- [ ] **Step 1: Write the failing test**

Append to `headingFold.test.ts`:

```ts
describe('editing at a fold boundary', () => {
  it('Delete at the end of a folded heading unfolds instead of deleting hidden content', () => {
    const editor = docFor('<h2>A</h2><p>hidden</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.toggleHeadingFold(a!.pos);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const before = editor.getHTML();
    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    expect(handled).toBe(true);
    expect(foldedKeys(editor.state)).toEqual([]);
    expect(editor.getHTML()).toBe(before);
    editor.destroy();
  });

  it('leaves Delete alone when the section is not folded', () => {
    const editor = docFor('<h2>A</h2><p>visible</p>');
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.contentStart - 1);

    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
    );

    expect(handled).toBeFalsy();
    editor.destroy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/editor/headingFold.test.ts -t "fold boundary"`
Expected: FAIL — the key is not handled and the fold stays.

- [ ] **Step 3: Implement**

Add a `handleKeyDown` prop to the plugin, beside `decorations` and `handleDOMEvents`:

```ts
          handleKeyDown(view, event) {
            if (event.key !== 'Delete' && event.key !== 'Backspace') return false;

            const { selection } = view.state;
            // Only a collapsed caret. A real selection is the user pointing at
            // a range they can see the bounds of, and is left alone.
            if (!selection.empty) return false;

            const keys = new Set(foldedKeys(view.state));
            if (keys.size === 0) return false;

            const at = selection.from;
            const section = headingSections(view.state.doc).find((s) => {
              if (!keys.has(serializeFoldKey(foldKeyOf(s)))) return false;
              if (s.end <= s.contentStart) return false;
              // Delete forward from the caret at the end of the heading's own
              // line, or Backspace from the start of the first hidden block.
              return event.key === 'Delete'
                ? at === s.contentStart - 1
                : at === s.contentStart + 1;
            });
            if (!section) return false;

            // Unfold instead of deleting. A single keypress must never destroy
            // content the user cannot see. Select-all-then-delete DOES still
            // delete folded content — that is the user asking for the whole
            // document, and it is undoable.
            view.dispatch(
              setKeys(
                view.state.tr,
                foldedKeys(view.state).filter(
                  (k) => k !== serializeFoldKey(foldKeyOf(section)),
                ),
              ),
            );
            return true;
          },
```

- [ ] **Step 3b: Prove the guard is falsifiable**

Temporarily change `if (!selection.empty) return false;` to `if (false) return false;` and re-run the suite. Expected: no test fails — which tells you the empty-selection guard is currently unpinned. Add a test that a non-empty selection spanning a folded boundary is NOT intercepted, watch it fail with the injection in place, then revert. A branch no injection can break is a defect in this project.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/editor/headingFold.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run format
git add src/features/editor
git commit -m "fix(editor): unfold rather than delete hidden content at a fold boundary"
```

---

### Task 8: Browser coverage, screenshots, and the rulings

**Files:**
- Modify: `e2e/notes.spec.ts`
- Modify: `e2e/appearance.spec.ts`
- Modify: `e2e/shots.spec.ts`
- Modify: `docs/rulings/markdown-and-schema.md`
- Modify: `docs/rulings/design-tokens-and-layout.md`
- Modify: `CLAUDE.md` (status table)

- [ ] **Step 1: Write the failing e2e tests**

In `e2e/notes.spec.ts`, following that file's existing seeding and selection helpers:

```ts
test('folding a heading hides its section, and the fold survives a reload', async ({ page }) => {
  await seedDatabase(page, [{ text: '## Alpha\n\nhidden body\n\n## Beta\n\nkept' }]);
  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  const toggle = heading.locator('[data-fold-toggle]');

  // Quiet at rest, revealed on hover.
  await expect(toggle).toHaveCSS('opacity', '0');
  await heading.hover();
  await expect(toggle).toHaveCSS('opacity', '1');

  await toggle.click();
  await expect(page.locator('.ProseMirror', { hasText: 'hidden body' })).toBeHidden();
  await expect(heading.locator('[data-fold-marker]')).toBeVisible();
  // The next section is untouched.
  await expect(page.locator('.ProseMirror', { hasText: 'kept' })).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Alpha/ }).first().click();
  await expect(page.locator('.ProseMirror', { hasText: 'hidden body' })).toBeHidden();
});

test('the badge menu changes a heading level, and the change reaches the Markdown', async ({
  page,
}) => {
  await seedDatabase(page, [{ text: '## Alpha\n\nbody' }]);
  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  await heading.hover();
  await heading.locator('[data-fold-badge]').click();
  await page.getByRole('menuitemradio', { name: /Heading 3/ }).click();

  await expect(page.locator('.ProseMirror h3', { hasText: 'Alpha' })).toBeVisible();
});
```

In `e2e/appearance.spec.ts`, two RELATIVE assertions in that file's own style:

```ts
test('the fold badge sits in the gutter when the pane is wide, and overlays the prose when it is not', async ({
  page,
}) => {
  await seedDatabase(page, [{ text: '## Alpha\n\nbody' }]);
  await page.goto('/');
  await page.getByRole('button', { name: /Alpha/ }).first().click();

  const heading = page.locator('.ProseMirror h2', { hasText: 'Alpha' });
  await heading.hover();

  const badge = heading.locator('[data-fold-badge]');
  const column = page.locator('.ProseMirror');

  const wideBadge = (await badge.boundingBox())!;
  const wideColumn = (await column.boundingBox())!;
  expect(wideBadge.x + wideBadge.width).toBeLessThanOrEqual(wideColumn.x);

  // Narrow the editor pane past the point where the measure clamp engages.
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 900, height: viewport.height });
  await heading.hover();

  const narrowBadge = (await badge.boundingBox())!;
  const narrowColumn = (await column.boundingBox())!;
  expect(narrowBadge.x).toBeGreaterThanOrEqual(narrowColumn.x - narrowBadge.width);
  await page.setViewportSize(viewport);
});
```

Adjust the seeding call to match `e2e/fixtures/seed.ts`'s actual signature — read it first rather than assuming this shape.

- [ ] **Step 2: Run them to verify they fail**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
```
Expected: the new tests FAIL. If they pass before implementation, the preview server is stale — kill 4173 and re-run.

- [ ] **Step 3: Make them pass**

Fix whatever they surface. No new production behaviour should be needed; these tests exist because nothing in the unit suite can see "renders wrong".

- [ ] **Step 4: Add a folded-editor screenshot**

In `e2e/shots.spec.ts`, add a shot of a folded, heading-dense note, taken in every theme in the roster the way the existing shots are. Run `npm run shots` and look at the output for every theme — this is the only step that can catch a badge that is invisible in High Contrast.

- [ ] **Step 5: Record the rulings**

Add to `docs/rulings/markdown-and-schema.md`:
- `HeadingFold` is an `Extension`, so it registers nothing in the schema; folding is decoration only and the document is never mutated. Every round-trip test is blind to whether the plugin runs, which is why `headingFold.test.ts` asserts on the decoration set — the same blind spot that let a dead `==highlight==` tokenizer and a live-but-banned underline mark ship in M4.
- Fold identity is content-derived and fails open. An ordinal index fails closed on the commonest edit; an id in the document is rejected as view state in the user's Markdown.
- `Mod-Alt-1`–`6` come from `@tiptap/extension-heading` and are not ours. Bear's `⌘1`–`⌘6` is unavailable to any web app; do not "fix" the menu copy to match Bear's screenshot.
- The menu SETS a level while the shortcut TOGGLES. Pre-existing upstream behaviour, deliberately not overridden, because the menu's check mark is radio semantics.

Add to `docs/rulings/design-tokens-and-layout.md`:
- The gutter affordance is hover-only and absolutely positioned, overlaying the prose when the pane is too narrow for a gutter. Reserving a lane would narrow a measured `--bear-line-width` at every width; hiding it below a threshold would make behaviour depend on invisible state.
- The persistent folded cue is INLINE, at the end of the heading's line, precisely so it never overlays text at rest. A gutter version of it would contradict the hover-only rule.

- [ ] **Step 6: Update the status table**

In `CLAUDE.md`, change the `B collapsible headings + level badge` row's state from `queued` to `complete`, and add a `B2 drag-to-reorder headings` row marked `queued`.

- [ ] **Step 7: Run the full gates and commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run lint && npm run typecheck && npm test && npm run test:e2e && npm run build && npm run format
git add e2e docs CLAUDE.md
git commit -m "test(e2e): cover folding in a real browser, and record B1's rulings"
```
