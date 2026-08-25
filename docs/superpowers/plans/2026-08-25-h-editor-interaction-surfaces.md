# H — Editor interaction surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the editor's controls reachable from the text the user is pointing at — a live-state toolbar, a highlight palette at the caret, a right-click editing menu, and table edge handles replacing the floating bar.

**Architecture:** One `useEditorState` selector becomes the single source of formatting state for every surface; two new ProseMirror plugins report events upward through construction-time callbacks and never reach for the `Editor`; React owns every menu's layout, focus and dismissal. `TableControls.ts` is deleted and its commands relocate.

**Tech Stack:** React 19, Tiptap v3 (`@tiptap/react` 3.29.2, `@tiptap/core`, `@tiptap/pm/{state,view,tables}`), Tailwind v4, Vitest + Testing Library, Playwright, oxlint, Prettier.

**Spec:** `docs/superpowers/specs/2026-08-25-h-editor-interaction-surfaces-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **All six gates must pass before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`. `npm run shots` and `npm run measure` are not part of the gate.
- **No user-facing string is hardcoded in a component.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `src/i18n/ko.ts` is annotated `Record<TranslationKey, string>` so a missing translation is a compile error. **Never weaken that annotation** — add the translation.
- **Every colour comes from a CSS custom property.** Literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **`lucide-react` may be imported only by `src/ui/Icon.tsx`** — enforced by `scripts/sourceLint.test.ts`. A feature file needing a new glyph adds it to `Icon.tsx`'s re-export list, not at its own call site.
- **`renderIconMarkup(glyph, size?)` takes a LIST of shapes**, not one path, and requires a verbatim `ICON_NODES` entry copied from `node_modules/lucide-react/dist/esm/icons/*.mjs` minus the render `key`s. An unregistered glyph **throws**.
- **`src/ui/` and `src/lib/` must import nothing** from `src/app/`, `src/data/`, `src/features/` or `src/i18n/`. Enforced by `scripts/sourceLint.test.ts`.
- **`erasableSyntaxOnly`** forbids `enum`, parameter properties and namespaces. **`verbatimModuleSyntax`** requires `import type` / `export type`.
- **Duck-type in tests; never `instanceof`** — `vitest.setup.ts` swaps the global `Blob` for Node's.
- **jsdom has no layout engine.** `coordsAtPos`, `posToDOMRect`, `getBoundingClientRect` on real content, and `setPointerCapture` do not work. Every positioning assertion belongs in Playwright. Editor tests that click *inside* the contenteditable need the three stubs documented at the head of `src/features/notes/NoteEditor.test.tsx`.
- **Check exit codes, not pass counts.** A missing jsdom stub throws *uncaught*, so `vitest run` exits 1 with every assertion green.
- **Before trusting any e2e result that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`, so a stale preview server silently tests a stale build. Also check `uptime` — several e2e tests fail under machine load and the failures look like regressions.
- **Do not create git worktrees under `.claude/worktrees/`** and leave them behind: Vitest globs them and silently runs extra copies of the whole suite.
- Commit messages end with the two trailer lines this repo uses (`Co-Authored-By:` and `Claude-Session:`); see recent `git log`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/features/editor/editorState.ts` | The `EditorFlags` type and the `editorFlagsSelector` used by `useEditorState`. Pure — no React, no JSX. |
| `src/features/editor/editorState.test.ts` | Selector unit tests against a constructed editor. |
| `src/features/editor/highlightChoices.ts` | The shared `HIGHLIGHT_CHOICES` roster, moved out of `HighlightMenu.tsx`. |
| `src/features/editor/HighlightPalette.tsx` | The swatch row + remove control that floats at a highlight. |
| `src/features/editor/highlightPalette.test.tsx` | Palette behaviour tests. |
| `src/features/editor/ContextMenu.ts` | The plugin owning `contextmenu` and the two keyboard openers; reports upward. |
| `src/features/editor/contextMenu.test.ts` | Plugin tests (event handling, request shape). |
| `src/features/editor/EditorContextMenu.tsx` | The menu surface: contextual rows, roving focus, edge flipping. |
| `src/features/editor/editorContextMenu.test.tsx` | Surface tests (which rows appear in which context). |
| `src/features/editor/tablePos.ts` | `tablePosAt`, shared by the handles and the menu. |
| `src/features/editor/tableCommands.ts` | `TABLE_ACTIONS`, `TableAction`, `COMMANDS` — relocated, grown to seven. |
| `src/features/editor/TableHandles.ts` | The gutter-handle widget plugin, replacing the bar. |
| `src/features/editor/tableHandles.test.ts` | Handle command dispatch + decoration presence. |
| `e2e/editorContext.spec.ts` | Right-click, keyboard open, palette tracking, handle positions, edge flipping. |

**Modified**

| File | Change |
| --- | --- |
| `src/features/editor/RichEditor.tsx` | Subscribes via `useEditorState`; owns palette and context-menu placement; wires both new plugins. |
| `src/features/editor/BottomToolbar.tsx` | Takes `EditorFlags` as a prop; `Action.active` becomes a flag key. |
| `src/features/editor/TopControls.tsx` | Takes `EditorFlags` as a prop. |
| `src/features/editor/HighlightMenu.tsx` | Imports `HIGHLIGHT_CHOICES` instead of defining `CHOICES`. |
| `src/features/editor/extensions.ts` | Registers `ContextMenu` and `TableHandles`; drops `TableControls`. |
| `src/features/editor/index.ts` | Re-exports what the app needs. |
| `src/ui/Icon.tsx` | Adds `Plus` to the re-export list and to `ICON_NODES`; adds the new menu glyphs to the re-export list. |
| `src/ui/Icon.test.tsx` | Adds `Plus` to the `it.each` roster. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | New keys; retired `editor.table.*` bar labels replaced. |
| `e2e/shots.spec.ts` | Adds a context-menu shot. |
| `docs/rulings/tables.md` | Amends the two superseded bullets. |
| `docs/rulings/accessibility.md` | Adds the context menu's keyboard contract. |
| `CLAUDE.md`, `docs/superpowers/NEXT.md` | Status rows and the H section. |

**Deleted**

| File | Reason |
| --- | --- |
| `src/features/editor/TableControls.ts` | Replaced by `TableHandles.ts` + `tablePos.ts` + `tableCommands.ts`. |
| `src/features/editor/tableControls.test.ts` | Its command assertions move to `tableCommands.test.ts` (Task 8); its decoration assertions are superseded. |

---

## Task 1: The editor-state selector

**Files:**

- Create: `src/features/editor/editorState.ts`
- Create: `src/features/editor/editorState.test.ts`

**Interfaces:**

- Consumes: `Highlight`'s `HighlightColor` type from `./Highlight`; `getMarkRange` from `@tiptap/core` (verified present in 3.29.2).
- Produces:
  - `export interface EditorFlags { bold, italic, strike, link, highlight, heading1, taskList, bulletList, orderedList, codeBlock, blockquote, table: boolean; highlightColor: HighlightColor | null; highlightRange: { from: number; to: number } | null }`
  - `export function editorFlagsSelector(snapshot: { editor: Editor }): EditorFlags`
  - `export const EMPTY_FLAGS: EditorFlags` — every boolean `false`, both nullable fields `null`. Used wherever `editor` is `null`.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/editorState.test.ts`:

```ts
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { EMPTY_FLAGS, editorFlagsSelector } from './editorState';
import { editorExtensions } from './extensions';
import { parseMarkdown } from './markdown';

function editorWith(markdown: string): Editor {
  return new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });
}

describe('editorFlagsSelector', () => {
  it('reports bold when the caret sits inside a bold run', () => {
    const editor = editorWith('plain **bold** plain');
    // "plain " is 6 characters; position 1 is the start of the paragraph's
    // content, so position 9 is inside "bold".
    editor.commands.setTextSelection(9);

    expect(editorFlagsSelector({ editor }).bold).toBe(true);
  });

  it('reports no bold when the caret sits outside it', () => {
    const editor = editorWith('plain **bold** plain');
    editor.commands.setTextSelection(2);

    expect(editorFlagsSelector({ editor }).bold).toBe(false);
  });

  it('reports the highlight colour under the caret', () => {
    const editor = editorWith('a <mark class="hl-green">green</mark> b');
    editor.commands.setTextSelection(4);

    const flags = editorFlagsSelector({ editor });
    expect(flags.highlight).toBe(true);
    expect(flags.highlightColor).toBe('green');
  });

  it('reports null colour for the default tint, distinct from no highlight', () => {
    const editor = editorWith('a ==plain== b');
    editor.commands.setTextSelection(4);

    const flags = editorFlagsSelector({ editor });
    expect(flags.highlight).toBe(true);
    expect(flags.highlightColor).toBeNull();
  });

  it('reports the highlight range so the palette can anchor to it', () => {
    const editor = editorWith('ab ==hl== cd');
    editor.commands.setTextSelection(5);

    const range = editorFlagsSelector({ editor }).highlightRange;
    expect(range).not.toBeNull();
    // The mark covers exactly "hl": two characters.
    expect(range!.to - range!.from).toBe(2);
  });

  it('reports a null range when no highlight is active', () => {
    const editor = editorWith('nothing here');
    editor.commands.setTextSelection(2);

    expect(editorFlagsSelector({ editor }).highlightRange).toBeNull();
  });

  it('reports table when the caret is inside one and not otherwise', () => {
    const editor = editorWith('| a | b |\n| --- | --- |\n| c | d |');
    editor.commands.setTextSelection(8);
    expect(editorFlagsSelector({ editor }).table).toBe(true);
  });

  it('EMPTY_FLAGS has every boolean false and every nullable null', () => {
    expect(EMPTY_FLAGS.bold).toBe(false);
    expect(EMPTY_FLAGS.table).toBe(false);
    expect(EMPTY_FLAGS.highlightColor).toBeNull();
    expect(EMPTY_FLAGS.highlightRange).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/features/editor/editorState.test.ts`
Expected: FAIL — `Failed to resolve import "./editorState"`.

- [ ] **Step 3: Write the implementation**

Create `src/features/editor/editorState.ts`:

```ts
import { getMarkRange } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

import type { HighlightColor } from './Highlight';

/**
 * Everything the editor's chrome needs to know about the caret, as one flat
 * object.
 *
 * Flat and primitive-valued on purpose: `useEditorState` compares the selected
 * slice with `fast-deep-equal` and re-renders only when it differs, so a
 * selector returning a fresh `Selection` or a node instance would re-render on
 * every transaction and defeat the whole point. Every field here is a boolean,
 * a string-union, or a two-number object.
 */
export interface EditorFlags {
  bold: boolean;
  italic: boolean;
  strike: boolean;
  link: boolean;
  highlight: boolean;
  heading1: boolean;
  taskList: boolean;
  bulletList: boolean;
  orderedList: boolean;
  codeBlock: boolean;
  blockquote: boolean;
  table: boolean;
  /** `null` means the DEFAULT tint (`==text==`), NOT "no highlight". */
  highlightColor: HighlightColor | null;
  /** Document range of the highlight under the caret; the palette's anchor. */
  highlightRange: { from: number; to: number } | null;
}

/**
 * The flags for "there is no editor". Used wherever `editor` is `null`, so no
 * consumer has to branch on nullability to read a flag.
 */
export const EMPTY_FLAGS: EditorFlags = {
  bold: false,
  italic: false,
  strike: false,
  link: false,
  highlight: false,
  heading1: false,
  taskList: false,
  bulletList: false,
  orderedList: false,
  codeBlock: false,
  blockquote: false,
  table: false,
  highlightColor: null,
  highlightRange: null,
};

/**
 * The single source of formatting state for every editor surface.
 *
 * This exists because `useEditor` does NOT re-render on transactions in Tiptap
 * v3 — `shouldRerenderOnTransaction` defaults to `false`. Every `isActive()`
 * call made during a React render is therefore stale from the moment the caret
 * moves, which is the bug that shipped in M4 and survived to H.
 *
 * `shouldRerenderOnTransaction: true` is the one-line alternative and is
 * rejected: it re-renders the editor's whole subtree on every keystroke.
 */
export function editorFlagsSelector({ editor }: { editor: Editor }): EditorFlags {
  const highlight = editor.isActive('highlight');
  const highlightType = editor.schema.marks.highlight;

  // Resolved from the caret rather than from the selection's own `from`/`to`,
  // so a collapsed cursor anywhere inside the mark yields the whole mark.
  const range =
    highlight && highlightType !== undefined
      ? (getMarkRange(editor.state.selection.$from, highlightType) ?? null)
      : null;

  return {
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    strike: editor.isActive('strike'),
    link: editor.isActive('link'),
    highlight,
    heading1: editor.isActive('heading', { level: 1 }),
    taskList: editor.isActive('taskList'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    codeBlock: editor.isActive('codeBlock'),
    blockquote: editor.isActive('blockquote'),
    table: editor.isActive('table'),
    highlightColor: highlight
      ? ((editor.getAttributes('highlight').color as HighlightColor | null) ?? null)
      : null,
    // Rebuilt as a plain object, never passed through: `getMarkRange` returns a
    // fresh object each call, and `fast-deep-equal` compares by value, so a
    // plain `{from, to}` compares equal across transactions that did not move
    // the mark. Returning the library's object would work too; stating the
    // shape here is what pins it as two numbers and nothing more.
    highlightRange: range === null ? null : { from: range.from, to: range.to },
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/features/editor/editorState.test.ts`
Expected: PASS, 8 tests, **exit code 0**.

If any position-based expectation is off by one, fix the *test's* position, not the implementation — the positions above were derived by reading, and ProseMirror offsets are easy to miscount. Verify with `editor.state.doc.textBetween(from, to)` in a scratch assertion before changing anything else.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/editorState.ts src/features/editor/editorState.test.ts
git commit -m "feat(editor): add the editor-state selector"
```

---

## Task 2: Wire the flags into both toolbars

This task ends the stale-state bug. It carries the **falsification test** — the thing that must exist so this defect cannot ship a second time.

**Files:**

- Modify: `src/features/editor/BottomToolbar.tsx`
- Modify: `src/features/editor/TopControls.tsx`
- Modify: `src/features/editor/RichEditor.tsx:162` (the `useEditor` call and both render sites)
- Modify: `src/features/editor/toolbars.test.tsx`

**Interfaces:**

- Consumes: `EditorFlags`, `EMPTY_FLAGS`, `editorFlagsSelector` from Task 1.
- Produces:
  - `BottomToolbarProps` gains `flags: EditorFlags`; `Action.active` changes from `(editor: Editor) => boolean` to `active: keyof EditorFlags`.
  - `TopControlsProps` gains `flags: EditorFlags`.
  - `RichEditor` holds `const flags = useEditorState({ editor, selector: editorFlagsSelector }) ?? EMPTY_FLAGS`.

- [ ] **Step 1: Write the failing falsification test**

Append to `src/features/editor/toolbars.test.tsx`. Read the file's existing imports and render helper first and reuse them rather than inventing a new one — the file already mounts a `RichEditor` with the required jsdom stubs.

```tsx
it('repaints the toolbar when the selection moves, with no React state change', async () => {
  // The regression this pins: `useEditor` does not re-render on transactions
  // in Tiptap v3, so a toolbar reading `editor.isActive()` during render
  // reports whatever was true when React last rendered for a reason of its
  // own. Nothing in this test touches React state — the ONLY thing that can
  // repaint the button is the editor-state subscription.
  const { editor } = await mountEditor('plain **bold** plain');

  const bold = screen.getByRole('toolbar', { name: 'Formatting toolbar' });
  const boldButton = within(bold).getByRole('button', { name: 'Bold' });

  act(() => {
    editor.commands.setTextSelection(2);
  });
  await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'false'));

  act(() => {
    editor.commands.setTextSelection(9);
  });
  await waitFor(() => expect(boldButton).toHaveAttribute('aria-pressed', 'true'));
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/features/editor/toolbars.test.tsx`
Expected: FAIL — the second `waitFor` times out with `aria-pressed="false"`, because nothing re-rendered.

**This failure is the whole point of the task.** If it passes before the implementation, stop and find out why: either the helper is forcing a render, or the assertion is not reading the attribute you think it is.

- [ ] **Step 3: Change `BottomToolbar` to read flags**

In `src/features/editor/BottomToolbar.tsx`:

Add to the imports:

```tsx
import type { EditorFlags } from './editorState';
```

Change the `Action` interface's `active` field:

```tsx
  /**
   * The `EditorFlags` key this action's pressed state reads.
   *
   * A KEY, not a predicate. A predicate would take an `Editor` and be called
   * during render, which is exactly the shape that let this toolbar report
   * stale state from M4 to H: `useEditor` does not re-render on transactions
   * in Tiptap v3, so a render-time read is only as fresh as React's last
   * unrelated reason to run. Reading a key off a subscribed object makes that
   * mistake unavailable rather than merely discouraged.
   */
  active: keyof EditorFlags;
```

Replace each action's `active` line with its key — `bold: 'bold'`, `italic: 'italic'`, `strike: 'strike'`, `highlight: 'highlight'`, `link: 'link'`, `code: 'codeBlock'`, `quote: 'blockquote'`, `table: 'table'`, `heading: 'heading1'`, `checklist: 'taskList'`, `bulletList: 'bulletList'`, `orderedList: 'orderedList'`.

Add `flags` to the props interface:

```tsx
  /** Live formatting state at the caret. See `editorState.ts`. */
  flags: EditorFlags;
```

Destructure `flags` in the signature, and change the button's pressed attribute:

```tsx
            aria-pressed={flags[action.active] === true}
```

The `=== true` is not redundant: `EditorFlags` also holds `highlightColor` and `highlightRange`, whose types are not `boolean`, and `keyof EditorFlags` admits them. It coerces a non-boolean field to `false` rather than rendering `aria-pressed` from a truthy object.

- [ ] **Step 4: Change `TopControls` the same way**

In `src/features/editor/TopControls.tsx`: add `flags: EditorFlags` to `TopControlsProps`, destructure it, and replace both

```tsx
        aria-pressed={editor?.isActive('bold') ?? false}
```

with `aria-pressed={flags.bold}` and `aria-pressed={flags.italic}` respectively.

- [ ] **Step 5: Subscribe in `RichEditor`**

In `src/features/editor/RichEditor.tsx`, add to the `@tiptap/react` import:

```tsx
import { useEditor, useEditorState, EditorContent } from '@tiptap/react';
```

(Match the file's existing import shape — read it rather than pasting this line blindly.)

Immediately after the `const editor = useEditor({...})` call, add:

```tsx
  /**
   * The single source of formatting state for every surface below.
   *
   * `useEditorState` subscribes to transactions but re-renders only when the
   * SELECTED SLICE changes by `fast-deep-equal`. The alternative —
   * `shouldRerenderOnTransaction: true` on the `useEditor` call above — is one
   * line and is rejected: it re-renders this whole subtree on every keystroke
   * the user types, and this is a notes app.
   *
   * `?? EMPTY_FLAGS` rather than a nullable: the overload that accepts a
   * possibly-null editor returns `TSelectorResult | null`, and letting that
   * null reach the toolbars would put a `?.` on every flag read — which is the
   * kind of optionality that quietly turns back into "assume false".
   */
  const flags = useEditorState({ editor, selector: editorFlagsSelector }) ?? EMPTY_FLAGS;
```

Pass `flags={flags}` to both `<TopControls>` and `<BottomToolbar>`.

- [ ] **Step 6: Run the falsification test and verify it now passes**

Run: `npx vitest run src/features/editor/toolbars.test.tsx`
Expected: PASS, **exit code 0**.

- [ ] **Step 7: Verify the fault injection**

Temporarily change the `aria-pressed` line in `BottomToolbar.tsx` back to `editor !== null && editor.isActive('bold')` for the bold action only, re-run, and confirm the new test goes RED. Then revert.

This is not optional. The test's entire value is that it can see the defect; a test that passes both ways is worse than no test.

- [ ] **Step 8: Run the full unit suite**

Run: `npm test -- --run`
Expected: all green, **exit code 0**. Existing `toolbars.test.tsx` and `RichEditor.test.tsx` cases will need the new required props added at their render sites — add `flags={EMPTY_FLAGS}` where a toolbar is rendered in isolation.

- [ ] **Step 9: Commit**

```bash
git add -A src/features/editor
git commit -m "fix(editor): repaint the toolbars when the selection moves"
```

---

## Task 3: Extract the shared highlight roster

Small, mechanical, and separated only because Tasks 4 and 7 both depend on it and neither should be the one to move it.

**Files:**

- Create: `src/features/editor/highlightChoices.ts`
- Modify: `src/features/editor/HighlightMenu.tsx`

**Interfaces:**

- Produces: `export interface HighlightChoice { color: HighlightColor | null; label: TranslationKey; swatch: string }` and `export const HIGHLIGHT_CHOICES: readonly HighlightChoice[]`.

- [ ] **Step 1: Create the module**

Create `src/features/editor/highlightChoices.ts` and move `Choice` and `CHOICES` from `HighlightMenu.tsx` **verbatim, comments included**, renaming the exports to `HighlightChoice` and `HIGHLIGHT_CHOICES`:

```ts
import type { TranslationKey } from '@/i18n';

import type { HighlightColor } from './Highlight';

export interface HighlightChoice {
  color: HighlightColor | null;
  label: TranslationKey;
  /**
   * The Tailwind utility for this swatch's fill. Written out rather than
   * interpolated from the colour name: Tailwind scans source text for whole
   * class names, so a `bg-hl-${color}` template would compile to nothing at
   * all — the same silent-no-output failure mode `--color-hover`'s two-
   * milestone absence had.
   */
  swatch: string;
}

/**
 * The one highlight roster, shared by the toolbar's colour menu, the palette
 * that floats at a highlight, and the context menu's swatch row. Three copies
 * of a colour list is three places for it to drift.
 */
export const HIGHLIGHT_CHOICES: readonly HighlightChoice[] = [
  // The default leads, because it is what every existing `==text==` already
  // is and the colours are the addition.
  { color: null, label: 'editor.highlight.default', swatch: 'bg-selected' },
  { color: 'blue', label: 'editor.highlight.blue', swatch: 'bg-hl-blue' },
  { color: 'green', label: 'editor.highlight.green', swatch: 'bg-hl-green' },
  { color: 'pink', label: 'editor.highlight.pink', swatch: 'bg-hl-pink' },
  { color: 'purple', label: 'editor.highlight.purple', swatch: 'bg-hl-purple' },
];
```

- [ ] **Step 2: Update `HighlightMenu.tsx`**

Delete the local `Choice` interface and `CHOICES` constant. Import instead:

```tsx
import { HIGHLIGHT_CHOICES } from './highlightChoices';
```

Change the map to `HIGHLIGHT_CHOICES.map(...)`. Nothing else in the file changes.

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run src/features/editor/toolbars.test.tsx`
Expected: PASS, exit 0 — the menu's rendered output is unchanged, so its existing tests are the regression check.

- [ ] **Step 4: Commit**

```bash
git add src/features/editor/highlightChoices.ts src/features/editor/HighlightMenu.tsx
git commit -m "refactor(editor): share the highlight roster"
```

---

## Task 4: The highlight palette component

**Files:**

- Create: `src/features/editor/HighlightPalette.tsx`
- Create: `src/features/editor/highlightPalette.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Modify: `src/ui/Icon.tsx` (re-export `Ban` for the remove control)

**Interfaces:**

- Consumes: `HIGHLIGHT_CHOICES` (Task 3), `HighlightColor`.
- Produces:
  - `export type HighlightChoiceResult = HighlightColor | null | 'remove'`
  - `export interface HighlightPaletteProps { current: HighlightColor | null; onChoose: (result: HighlightChoiceResult) => void; onDismiss: () => void }`
  - `export function HighlightPalette(props): ReactElement`

**Critical semantics — do not collapse these:** `null` sets the **default tint** (the uncoloured `==text==` mark); `'remove'` **unsets the mark entirely**. They are different outcomes. `Highlight.ts` represents the uncoloured mark as `color: null` deliberately rather than as a sixth roster entry, so `null` is a real, valid colour choice.

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/en.ts`, beside the existing `editor.highlight.*` block:

```ts
  'editor.highlight.palette': 'Highlight colour',
  'editor.highlight.remove': 'Remove highlight',
```

In `src/i18n/ko.ts`, at the matching position:

```ts
  'editor.highlight.palette': '형광펜 색상',
  'editor.highlight.remove': '형광펜 지우기',
```

`ko.ts` is annotated `Record<TranslationKey, string>`, so omitting either is a compile error. Never weaken that annotation.

- [ ] **Step 2: Re-export the `Ban` glyph**

In `src/ui/Icon.tsx`, add `Ban` to the `lucide-react` import at the top **and** to the `export { ... } from 'lucide-react'` list at the bottom. Verified present at `node_modules/lucide-react/dist/esm/icons/ban.mjs`.

No `ICON_NODES` entry is needed: `ICON_NODES` serves `renderIconMarkup`, which draws plain-DOM widgets only, and the palette is React.

- [ ] **Step 3: Write the failing test**

Create `src/features/editor/highlightPalette.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { HighlightPalette } from './HighlightPalette';

// `I18nProvider` is the real helper — there is no `TestI18nProvider`. Its
// verified signature is `{ children: ReactNode; locale?: Locale }`, exported
// from `@/i18n`. `locale="en"` is passed EXPLICITLY: the default detects from
// `navigator.languages`, and every assertion below matches on an English
// accessible name.
function renderPalette(props: Partial<Parameters<typeof HighlightPalette>[0]> = {}) {
  const onChoose = vi.fn();
  const onDismiss = vi.fn();
  render(
    <I18nProvider locale="en">
      <HighlightPalette current={null} onChoose={onChoose} onDismiss={onDismiss} {...props} />
    </I18nProvider>,
  );
  return { onChoose, onDismiss };
}

describe('HighlightPalette', () => {
  it('marks the current colour as checked', () => {
    renderPalette({ current: 'green' });
    expect(screen.getByRole('menuitemradio', { name: 'Green' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Blue' })).not.toBeChecked();
  });

  it('treats the default tint as a real choice, checked when no colour is set', () => {
    renderPalette({ current: null });
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toBeChecked();
  });

  it('reports a colour choice', async () => {
    const { onChoose } = renderPalette({ current: null });
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pink' }));
    expect(onChoose).toHaveBeenCalledWith('pink');
  });

  it('reports the default tint as null, not as remove', async () => {
    const { onChoose } = renderPalette({ current: 'blue' });
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Default' }));
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('reports remove as a distinct outcome from the default tint', async () => {
    const { onChoose } = renderPalette({ current: 'blue' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
    expect(onChoose).toHaveBeenCalledWith('remove');
  });

  it('dismisses on Escape', async () => {
    const { onDismiss } = renderPalette();
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run it and verify it fails**

Run: `npx vitest run src/features/editor/highlightPalette.test.tsx`
Expected: FAIL — `Failed to resolve import "./HighlightPalette"`.

- [ ] **Step 5: Write the implementation**

Create `src/features/editor/HighlightPalette.tsx`:

```tsx
import { type ReactElement, useEffect } from 'react';

import { useT } from '@/i18n';
import { Ban, Icon } from '@/ui/Icon';

import type { HighlightColor } from './Highlight';
import { HIGHLIGHT_CHOICES } from './highlightChoices';

/**
 * Three outcomes, and the middle one is the easy mistake.
 *
 * A `HighlightColor` sets that colour. `null` sets the DEFAULT tint — the
 * uncoloured `==text==` mark, which `Highlight.ts` deliberately represents as
 * `color: null` rather than as a sixth roster entry. `'remove'` unsets the
 * mark entirely. Collapsing `null` and `'remove'` would make the remove
 * control paint grey instead of clearing.
 */
export type HighlightChoiceResult = HighlightColor | null | 'remove';

export interface HighlightPaletteProps {
  /** The colour of the highlight under the caret; `null` is the default tint. */
  current: HighlightColor | null;
  onChoose: (result: HighlightChoiceResult) => void;
  /** Escape. Placement and outside-click dismissal are the caller's. */
  onDismiss: () => void;
}

/**
 * The highlight colours as a horizontal swatch row, floated at the highlight
 * the caret is inside.
 *
 * Distinct from `HighlightMenu`, which is the vertical labelled menu under the
 * toolbar's colour chevron: this one is reached by pointing at the text, is
 * icon-dense, and carries a remove control the menu deliberately does not
 * (`HighlightMenu`'s five choices all SET, so none of them can clear).
 *
 * `menuitemradio` for the same reason `HighlightMenu` uses it: the choices are
 * mutually exclusive and one is always in effect, which is what `aria-checked`
 * means. Remove is a plain `button` because it is not one of the alternatives —
 * it leaves the set entirely.
 *
 * This component does NOT position itself; `RichEditor` owns placement, the
 * same division `TopControls` and `BottomToolbar` already keep.
 */
export function HighlightPalette({
  current,
  onChoose,
  onDismiss,
}: HighlightPaletteProps): ReactElement {
  const t = useT();

  // On `window`, not a React `onKeyDown`: the caret is in the editor, not in
  // this palette, so a handler bound to this subtree would never fire. Same
  // reasoning as `HighlightMenu`'s own Escape listener.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);

  return (
    <div
      role="menu"
      aria-label={t('editor.highlight.palette')}
      className="flex items-center gap-1 rounded-full bg-surface px-2 py-1 shadow-popover"
    >
      {HIGHLIGHT_CHOICES.map((choice) => (
        <button
          key={choice.color ?? 'default'}
          type="button"
          role="menuitemradio"
          aria-checked={choice.color === current}
          aria-label={t(choice.label)}
          // `onMouseDown` with `preventDefault` would be wrong here: the
          // caret must STAY in the highlight, and it does — the editor keeps
          // its selection across a click on chrome outside it, which is what
          // every existing toolbar button relies on.
          onClick={() => onChoose(choice.color)}
          className={`size-5 shrink-0 rounded-full border border-border transition-[outline] duration-[var(--bear-duration-fast)] ease-bear aria-checked:outline-2 aria-checked:outline-offset-2 aria-checked:outline-accent ${choice.swatch}`}
        />
      ))}
      <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <button
        type="button"
        aria-label={t('editor.highlight.remove')}
        onClick={() => onChoose('remove')}
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:bg-hover hover:text-text"
      >
        <Icon glyph={Ban} size="sm" />
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `npx vitest run src/features/editor/highlightPalette.test.tsx`
Expected: PASS, 6 tests, **exit code 0**.

If `I18nProvider`'s props differ from the sketch above, read `src/i18n/index.ts` and match the real signature. A plan's component-usage sketch is not a signature reference — this project has been bitten by exactly that.

- [ ] **Step 7: Commit**

```bash
git add -A src/features/editor src/i18n src/ui
git commit -m "feat(editor): add the highlight palette"
```

---

## Task 5: Float the palette at the caret's highlight

**Files:**

- Modify: `src/features/editor/RichEditor.tsx`
- Create/extend: `e2e/editorContext.spec.ts`

**Interfaces:**

- Consumes: `HighlightPalette`, `HighlightChoiceResult` (Task 4); `flags.highlightRange`, `flags.highlightColor` (Tasks 1–2); `posToDOMRect` from `@tiptap/core` (verified exported in 3.29.2).
- Produces: no new exports.

- [ ] **Step 1: Add the placement state and effect**

In `RichEditor.tsx`, add to the `@tiptap/core` import (or create one):

```tsx
import { isMacOS, posToDOMRect } from '@tiptap/core';
```

Add below the `flags` line:

```tsx
  /**
   * Viewport position of the palette, measured off the highlight itself.
   *
   * `fixed` chrome anchored to a document range has one hazard `HeadingMenu`
   * does not: that menu closes on the next click, so it cannot outlive its
   * anchor's position. This one stays up for as long as the caret is inside
   * the mark, so it MUST re-measure on scroll and on resize or it drifts away
   * from its own text. That is the accepted cost of not being a widget — an
   * inline widget would be laid out in the text flow and shove the sentence
   * sideways.
   */
  const [paletteAt, setPaletteAt] = useState<{ top: number; left: number } | null>(null);

  const range = flags.highlightRange;

  useEffect(() => {
    if (editor === null || range === null) {
      setPaletteAt(null);
      return;
    }

    const measure = (): void => {
      const rect = posToDOMRect(editor.view, range.from, range.to);
      setPaletteAt({ top: rect.top, left: rect.left + rect.width / 2 });
    };

    measure();

    // `capture: true` on scroll: the editor's own scroller is a descendant,
    // and scroll does not bubble. Without capture the palette tracks window
    // scroll only, which in a three-pane app is the case that never happens.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
    // `range.from`/`range.to` rather than `range`: the selector rebuilds the
    // object each call, so depending on its identity would re-run this effect
    // on every transaction.
  }, [editor, range?.from, range?.to]);
```

- [ ] **Step 2: Render it**

Add near the other floating surfaces, **outside** the two `pointer-events-none` positioning wrappers (it is anchored to the viewport, not to a pane edge):

```tsx
      {paletteAt !== null && editor !== null && (
        <div
          className="fixed z-20 -translate-x-1/2 -translate-y-full pt-0 pb-2"
          style={{ top: paletteAt.top, left: paletteAt.left }}
        >
          <HighlightPalette
            current={flags.highlightColor}
            onChoose={(result) => {
              // The document mutation runs against the caret's own mark. No
              // `setTextSelection` is needed and none should be added: the
              // selection never left the highlight, because clicking chrome
              // outside the editor does not move it.
              const chain = editor.chain().command(pinAllSelectionStep).focus();
              if (result === 'remove') {
                chain.extendMarkRange('highlight').unsetMark('highlight').run();
              } else {
                chain.setHighlightColor(result).run();
              }
            }}
            onDismiss={() => editor.commands.focus()}
          />
        </div>
      )}
```

`extendMarkRange('highlight')` before `unsetMark` is load-bearing: with a collapsed caret, `unsetMark` alone affects the stored marks and not the existing range, so the visible highlight would survive the click.

- [ ] **Step 3: Verify in the real app**

Run `npm run dev`, create a note, highlight some text, click away, then click back into the highlight. Confirm the palette appears above it, that clicking a swatch recolours without moving the caret, that ✕ clears the mark, and that scrolling the editor pane keeps the palette attached.

**This step is not optional and cannot be replaced by a test.** `useSession`'s StrictMode bug passed all six gates and was found only by running the app; this surface has the same shape — an effect whose cleanup interacts with a double-mount.

- [ ] **Step 4: Write the e2e test**

Create `e2e/editorContext.spec.ts`. Read `e2e/editorAffordances.spec.ts` first and reuse its seeding helper and corpus fixture rather than inventing new ones.

```ts
test('the highlight palette follows the caret into and out of a highlight', async ({ page }) => {
  // seed a note containing `plain ==marked== plain`, open it
  const palette = page.getByRole('menu', { name: 'Highlight colour' });

  await expect(palette).toBeHidden();

  // click inside the highlighted word
  await page.getByText('marked').click();
  await expect(palette).toBeVisible();

  const markBox = await page.getByText('marked').boundingBox();
  const paletteBox = await palette.boundingBox();
  // Anchored above its own text, horizontally centred on it.
  expect(paletteBox!.y + paletteBox!.height).toBeLessThanOrEqual(markBox!.y + 4);

  // click outside it
  await page.getByText('plain').first().click();
  await expect(palette).toBeHidden();
});
```

- [ ] **Step 5: Run the gates**

```bash
lsof -ti:4173 | xargs -r kill -9
npm test -- --run && npm run typecheck && npm run lint && npm run test:e2e
```

Expected: all green, **exit code 0** on each.

- [ ] **Step 6: Commit**

```bash
git add -A src/features/editor e2e
git commit -m "feat(editor): float the highlight palette at the caret"
```

---

## Task 6: The context-menu plugin

**Files:**

- Create: `src/features/editor/ContextMenu.ts`
- Create: `src/features/editor/contextMenu.test.ts`

**Interfaces:**

- Produces:
  - `export interface ContextMenuRequest { pos: number; rect: DOMRect }`
  - `export interface ContextMenuOptions { onOpen: ((request: ContextMenuRequest) => void) | null }`
  - `export const ContextMenu: Extension<ContextMenuOptions>`
  - `export const contextMenuKey: PluginKey`

`rect` rather than raw client coordinates, so the surface's flip/clamp code is identical to `HeadingMenu`'s and the keyboard opener (which has no pointer position) can supply the caret's own rect through the same field.

- [ ] **Step 1: Write the failing test**

Create `src/features/editor/contextMenu.test.ts`:

```ts
import { Editor } from '@tiptap/core';
import { describe, expect, it, vi } from 'vitest';

import { ContextMenu } from './ContextMenu';
import { editorExtensions } from './extensions';
import { parseMarkdown } from './markdown';

function editorWith(onOpen: ContextMenuOptions['onOpen'], markdown = 'hello world'): Editor {
  return new Editor({
    extensions: [...editorExtensions, ContextMenu.configure({ onOpen })],
    content: parseMarkdown(markdown),
  });
}

describe('ContextMenu', () => {
  it('registers no plugin when nobody is listening', () => {
    const editor = editorWith(null);
    expect(editor.state.plugins.some((p) => p.spec.key === contextMenuKey)).toBe(false);
  });

  it('suppresses the browser menu and reports a request', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

    editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toHaveProperty('pos');
  });

  it('opens on Shift-F10', () => {
    const onOpen = vi.fn();
    const editor = editorWith(onOpen);

    expect(editor.commands.openContextMenu()).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('declines to open when nobody is listening', () => {
    const editor = editorWith(null);
    expect(editor.commands.openContextMenu()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/features/editor/contextMenu.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/features/editor/ContextMenu.ts`:

```ts
import { Extension, posToDOMRect } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export interface ContextMenuRequest {
  /** Document position the menu acts on. */
  pos: number;
  /**
   * Viewport rectangle to anchor against — the click point as a zero-size
   * rect for a pointer open, the caret's own rect for a keyboard open.
   *
   * A rect rather than raw coordinates so the surface's flip/clamp arithmetic
   * is byte-identical to `HeadingMenu`'s, and so the keyboard opener (which
   * has no pointer position at all) feeds the same field.
   */
  rect: DOMRect;
}

export interface ContextMenuOptions {
  /**
   * `null` when nobody is listening, which is the state of the schema-only
   * `editorExtensions` constant — and in that state the plugin is not
   * registered at all, so the browser's own menu is untouched.
   *
   * Absent rather than inert, the same rule `TagPillOptions.onActivate` and
   * `TableControlsOptions.labels` both follow: an affordance that does nothing
   * is worse than no affordance, and here "does nothing" would mean silently
   * suppressing the browser menu and offering nothing in its place.
   */
  onOpen: ((request: ContextMenuRequest) => void) | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    contextMenu: {
      /** Opens the menu at the caret. The keyboard route; returns false if unwired. */
      openContextMenu: () => ReturnType;
    };
  }
}

export const contextMenuKey = new PluginKey('contextMenu');

/**
 * The editor's right-click menu, as an event source only.
 *
 * The plugin owns the DOM event and hands a request UP through a callback
 * captured at construction; React draws the menu. A ProseMirror plugin has a
 * `view`, and therefore a `state`/`dispatch` pair, but no `Editor` — reaching
 * for one from in here would be the editor learning about the layer above it,
 * the boundary `TagPill.onActivate` and `HeadingFold.onOpenMenu` both keep.
 *
 * An `Extension`, not a `Node` or `Mark`: it registers nothing in the schema
 * and mutates no document, so every Markdown round-trip suite is blind to
 * whether it runs at all. `contextMenu.test.ts` is the only thing that can see
 * it.
 *
 * KNOWN COST, accepted deliberately: calling `preventDefault()` on
 * `contextmenu` also removes the browser's spellcheck suggestions, Look Up and
 * Services from the writing surface. There is no way to keep half of a native
 * menu.
 */
export const ContextMenu = Extension.create<ContextMenuOptions>({
  name: 'contextMenu',

  addOptions() {
    return { onOpen: null };
  },

  addKeyboardShortcuts() {
    return {
      // The two conventional keyboard routes to a context menu. Required by
      // `docs/rulings/accessibility.md`: the pointer route is the only other
      // one, and a keyboard user would otherwise have no path to these
      // commands at all.
      'Shift-F10': () => this.editor.commands.openContextMenu(),
      ContextMenu: () => this.editor.commands.openContextMenu(),
    };
  },

  addCommands() {
    const { onOpen } = this.options;
    return {
      openContextMenu:
        () =>
        ({ state, view }) => {
          if (onOpen === null) return false;
          const { from, to } = state.selection;
          onOpen({ pos: from, rect: posToDOMRect(view, from, to) });
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    if (onOpen === null) return [];

    return [
      new Plugin({
        key: contextMenuKey,
        props: {
          handleDOMEvents: {
            contextmenu(view, event) {
              // Resolved from the pointer, NOT from the current selection: a
              // right-click does not move the caret in every browser, so
              // acting on the selection would target whatever the user last
              // clicked instead of what they just pointed at.
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              const pos = at?.pos ?? view.state.selection.from;

              event.preventDefault();
              onOpen({
                pos,
                // A zero-size rect at the pointer. `HeadingMenu`'s flip/clamp
                // arithmetic reads `.top`, `.bottom`, `.left` and nothing
                // else, so a degenerate rect anchors the menu exactly at the
                // click point with no special case.
                rect: new DOMRect(event.clientX, event.clientY, 0, 0),
              });
              return true;
            },
          },
        },
      }),
    ];
  },
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/features/editor/contextMenu.test.ts`
Expected: PASS, 4 tests, **exit code 0**.

`posToDOMRect` in jsdom returns a zero rect rather than throwing — the tests above assert only on `pos` and call counts for that reason. If it does throw in this environment, assert on the plugin's presence and the `preventDefault` instead and move the rect assertions to the e2e file; do not stub layout into a unit test.

- [ ] **Step 5: Commit**

```bash
git add src/features/editor/ContextMenu.ts src/features/editor/contextMenu.test.ts
git commit -m "feat(editor): add the context-menu plugin"
```

---

## Task 7: The context-menu surface

**Files:**

- Create: `src/features/editor/EditorContextMenu.tsx`
- Create: `src/features/editor/editorContextMenu.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Modify: `src/ui/Icon.tsx` (re-export the glyphs this menu draws)

**Interfaces:**

- Consumes: `ContextMenuRequest` (Task 6), `EditorFlags` (Task 1), `HIGHLIGHT_CHOICES` (Task 3), `TABLE_ACTIONS` (created in Task 8 — **this task defines the table section's rows against the seven action names listed below, and Task 8 supplies the commands**).
- Produces:
  - `export type ContextMenuAction = 'bold' | 'italic' | 'strike' | 'link' | 'bulletList' | 'orderedList' | 'taskList' | 'codeBlock' | 'blockquote' | 'addRowBefore' | 'addRowAfter' | 'addColumnBefore' | 'addColumnAfter' | 'deleteRow' | 'deleteColumn' | 'deleteTable'`
  - `export interface EditorContextMenuProps { request: ContextMenuRequest; flags: EditorFlags; onAction: (action: ContextMenuAction) => void; onSetHeading: (level: 0 | 1 | 2 | 3 | 4 | 5 | 6) => void; onSetHighlight: (result: HighlightChoiceResult) => void; onClose: () => void }`
  - `export function EditorContextMenu(props): ReactElement`

`onSetHeading`'s `0` means "paragraph" — the row that turns a heading back into body text. A seventh glyph is not needed for it; it is a labelled row.

- [ ] **Step 1: Add the i18n keys**

`src/i18n/en.ts`:

```ts
  'editor.context.menu': 'Editing options',
  'editor.context.paragraph': 'Body text',
  'editor.context.table': 'Table',
  'editor.table.addRowBefore': 'Insert row above',
  'editor.table.addRowAfter': 'Insert row below',
  'editor.table.addColumnBefore': 'Insert column before',
  'editor.table.addColumnAfter': 'Insert column after',
```

`src/i18n/ko.ts`:

```ts
  'editor.context.menu': '편집 옵션',
  'editor.context.paragraph': '본문',
  'editor.context.table': '표',
  'editor.table.addRowBefore': '위에 행 추가',
  'editor.table.addRowAfter': '아래에 행 추가',
  'editor.table.addColumnBefore': '앞에 열 추가',
  'editor.table.addColumnAfter': '뒤에 열 추가',
```

The existing `editor.table.deleteRow`, `deleteColumn` and `deleteTable` keys are reused; their values change in Task 9 from the bar's terse `− Row` to full sentences, since they are now menu rows. `editor.table.addRow`, `editor.table.addColumn` and `editor.table.controls` are deleted in Task 9.

- [ ] **Step 2: Re-export the glyphs**

In `src/ui/Icon.tsx`, add to both the `lucide-react` import and the bottom `export { ... }` list: `Pilcrow`, `Rows3`, `Columns3` — all three verified present in `lucide-react` 1.31.0 as `pilcrow.mjs`, `rows-3.mjs` and `columns-3.mjs`. `Trash2`, `Bold`, `Italic`, `Strikethrough`, `Link`, `Code`, `Quote`, `List`, `ListOrdered`, `ListTodo`, `Highlighter` and `Heading1`–`Heading6` are already exported.

- [ ] **Step 3: Write the failing test**

Create `src/features/editor/editorContextMenu.test.tsx`. The essential assertions — write them all:

```tsx
describe('EditorContextMenu', () => {
  it('shows no table section when the caret is not in a table', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, table: false } });
    expect(screen.queryByRole('group', { name: 'Table' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete table' })).toBeNull();
  });

  it('shows the table section when the caret is in a table', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, table: true } });
    expect(screen.getByRole('menuitem', { name: 'Insert row above' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Delete table' })).toBeVisible();
  });

  it('carries no clipboard rows', () => {
    renderMenu();
    for (const name of ['Cut', 'Copy', 'Paste']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
  });

  it('has no nested submenus', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, table: true } });
    expect(screen.queryByRole('menuitem', { expanded: false })).toBeNull();
    expect(document.querySelectorAll('[aria-haspopup="menu"]')).toHaveLength(0);
  });

  it('reflects active formatting from the flags', () => {
    renderMenu({ flags: { ...EMPTY_FLAGS, bold: true } });
    expect(screen.getByRole('menuitemcheckbox', { name: 'Bold' })).toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Italic' })).not.toBeChecked();
  });

  it('reports a format action', async () => {
    const { onAction } = renderMenu();
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Bold' }));
    expect(onAction).toHaveBeenCalledWith('bold');
  });

  it('reports a heading level from the inline row', async () => {
    const { onSetHeading } = renderMenu();
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Heading 2' }));
    expect(onSetHeading).toHaveBeenCalledWith(2);
  });

  it('reports paragraph as level 0', async () => {
    const { onSetHeading } = renderMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Body text' }));
    expect(onSetHeading).toHaveBeenCalledWith(0);
  });

  it('closes on Escape', async () => {
    const { onClose } = renderMenu();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('focuses its first item on open', () => {
    renderMenu();
    expect(document.activeElement).toHaveAttribute('role', expect.stringContaining('menuitem'));
  });
});
```

- [ ] **Step 4: Run it and verify it fails**

Run: `npx vitest run src/features/editor/editorContextMenu.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Write the implementation**

Create `src/features/editor/EditorContextMenu.tsx`. Structure it on `HeadingMenu.tsx` — copy its `FOCUSABLE` constant, its two-stage position state (`useState` seeded from `request.rect`, corrected by a post-mount flip/clamp effect), and its window-level `keydown`/`mousedown` dismissal listeners, all with their comments. That file is the worked precedent for every one of these problems and re-deriving them is how they get re-broken.

Sections, in order, each a `role="group"` with an `aria-label`:

1. **Heading** — an inline row of `Heading1`…`Heading6` glyph buttons (`role="menuitemradio"`, `aria-checked` from the level under the caret, `aria-label` from `editor.fold.headingLevel` plus the digit), then a labelled `Body text` row (`role="menuitem"`) calling `onSetHeading(0)`.
2. **Inline format** — Bold, Italic, Strikethrough, Link. `role="menuitemcheckbox"` with `aria-checked` from `flags`.
3. **Highlight** — an inline swatch row built from `HIGHLIGHT_CHOICES` plus the remove control, exactly as `HighlightPalette` renders it, calling `onSetHighlight`.
4. **Blocks** — Bullet list, Numbered list, Checklist, Code block, Quote. `role="menuitemcheckbox"`.
5. **Table** — rendered **only when `flags.table` is true**: Insert row above/below, Insert column before/after, Delete row, Delete column, Delete table. `role="menuitem"`; the three deletes carry `data-destructive` and the danger token, matching what the old bar did.

Every section is flat. **No `aria-haspopup`, no nested menus** — the test above asserts their absence, and the reason is in the spec: hover-intent on a flyout is a large class of bugs bought for one saved click.

- [ ] **Step 6: Run the test and verify it passes**

Run: `npx vitest run src/features/editor/editorContextMenu.test.tsx`
Expected: PASS, **exit code 0**.

- [ ] **Step 7: Commit**

```bash
git add -A src/features/editor src/i18n src/ui
git commit -m "feat(editor): add the context-menu surface"
```

---

## Task 8: Relocate the table commands

Pure move, done before Task 9 so the deletion of `TableControls.ts` is a clean removal rather than a rewrite in place.

**Files:**

- Create: `src/features/editor/tablePos.ts`
- Create: `src/features/editor/tableCommands.ts`
- Create: `src/features/editor/tableCommands.test.ts`
- Modify: `src/features/editor/TableControls.ts` (import from the new modules, so both are exercised before the file is deleted)

**Interfaces:**

- Produces:
  - `tablePos.ts`: `export function tablePosAt(state: EditorState): number | null` — moved verbatim, docblock included.
  - `tableCommands.ts`: `export const TABLE_ACTIONS = ['addRowBefore','addRowAfter','addColumnBefore','addColumnAfter','deleteRow','deleteColumn','deleteTable'] as const`, `export type TableAction`, and `export const COMMANDS: Record<TableAction, (state, dispatch?) => boolean>` mapping to `prosemirror-tables`' `addRowBefore`, `addRowAfter`, `addColumnBefore`, `addColumnAfter`, `deleteRow`, `deleteColumn`, `deleteTable`.

- [ ] **Step 1: Move `tablePosAt`**

Create `src/features/editor/tablePos.ts` and move the function and its full docblock out of `TableControls.ts` verbatim. Have `TableControls.ts` import it.

- [ ] **Step 2: Create `tableCommands.ts` with all seven**

Move `TABLE_ACTIONS`, `TableAction` and `COMMANDS` out of `TableControls.ts`, growing the list from five to seven. Replace the old "adds land AFTER, no before pair" comment with:

```ts
/**
 * The seven table actions.
 *
 * Grew from five to seven in H. The old set had no "before" pair, and the
 * stated reason was bar width — "ten buttons on a bar that floats over the
 * user's prose is a worse trade than one extra keystroke". There is no bar
 * any more: adds are edge handles that insert adjacent to the edge the user
 * pointed at (so they need no direction at all), and the named directions
 * live in the context menu, where a seventh row costs nothing.
 *
 * `prosemirror-tables`' own commands, not Tiptap's wrappers: a plugin has a
 * `state`/`dispatch` pair but no `Editor`, and reaching for one from inside a
 * plugin would be the editor learning about the layer above it.
 */
```

- [ ] **Step 3: Write the test**

Create `src/features/editor/tableCommands.test.ts`. Port every assertion from `tableControls.test.ts` that tests a COMMAND (not a decoration), keeping its pinned Markdown strings **exactly as they are** — they are padded with a three-dash alignment row because that is the serializer's real output, and `docs/rulings/tables.md` forbids tidying them. Add cases for the two new commands:

```ts
it('addRowBefore inserts above the caret row, leaving the header alone', () => {
  // caret in the first BODY cell, as every case in this file has it
  // → the new row lands between the header and the old body row
});

it('addColumnBefore inserts to the left of the caret column', () => {
  // caret in column 0 → the new column lands FIRST
});
```

Both expectations must be the serializer's real padded output. Produce them by running the command and printing `serializeMarkdown(editor.getJSON())` once, then pinning what it actually emits — do not hand-write a prettier table.

- [ ] **Step 4: Run and verify**

Run: `npx vitest run src/features/editor/tableCommands.test.ts src/features/editor/tableControls.test.ts`
Expected: both PASS, **exit code 0**. `tableControls.test.ts` still passing is the proof that the move was faithful.

- [ ] **Step 5: Commit**

```bash
git add -A src/features/editor
git commit -m "refactor(editor): relocate the table commands and add the before pair"
```

---

## Task 9: Table edge handles

The largest task. Read `docs/rulings/tables.md` before starting.

**Files:**

- Create: `src/features/editor/TableHandles.ts`
- Create: `src/features/editor/tableHandles.test.ts`
- Delete: `src/features/editor/TableControls.ts`, `src/features/editor/tableControls.test.ts`
- Modify: `src/features/editor/extensions.ts`, `src/features/editor/RichEditor.tsx`
- Modify: `src/ui/Icon.tsx` (add `Plus` to `ICON_NODES`), `src/ui/Icon.test.tsx`
- Modify: `src/styles/editor.css` (replace `.bear-table-controls` with the handle styles)
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `tablePosAt` (Task 8), `COMMANDS` (Task 8), `renderIconMarkup` from `@/ui/Icon`.
- Produces:
  - `export interface TableHandlesOptions { labels: { addRow: string; addColumn: string } | null }`
  - `export const TableHandles: Extension<TableHandlesOptions>`
  - `export const tableHandlesKey: PluginKey`

- [ ] **Step 1: Register the `Plus` glyph**

In `src/ui/Icon.tsx`, add `Plus` to the `lucide-react` import, to the bottom re-export list, and to `ICON_NODES` — copied **verbatim** from `node_modules/lucide-react/dist/esm/icons/plus.mjs` minus the render `key`s:

```ts
  [
    Plus,
    [
      ['path', { d: 'M5 12h14' }],
      ['path', { d: 'M12 5v14' }],
    ],
  ],
```

Add `Plus` to `src/ui/Icon.test.tsx`'s `it.each` roster so the copy is checked against the real component. A missing entry makes `renderIconMarkup` **throw** at runtime, and the test is what catches a future lucide bump changing the shape.

- [ ] **Step 2: Write the failing test**

Create `src/features/editor/tableHandles.test.ts`. jsdom has no layout engine, so this file asserts **decoration presence and command dispatch only** — never a position:

```ts
describe('TableHandles', () => {
  it('registers no plugin without labels', () => { /* labels: null → no decorations */ });

  it('decorates a table the caret is inside', () => { /* DecorationSet is non-empty */ });

  it('decorates nothing outside a table', () => { /* DecorationSet.empty */ });

  it('a row handle dispatches addRowAfter for its own row', () => {
    // build the widget, click its button, assert the serialized Markdown
    // gained a row in the right place — pinned to the serializer's real
    // padded output, per docs/rulings/tables.md
  });

  it('a column handle dispatches addColumnAfter for its own column', () => { /* ditto */ });

  it('resolves the innermost table when one is nested in a blockquote', () => {
    // the case `tablePosAt`'s outward walk exists for
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run src/features/editor/tableHandles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the implementation**

Create `src/features/editor/TableHandles.ts`. Design:

- A single `Decoration.widget` at the table position, `side: -1`, `ignoreSelection: true`, `key: \`table-handles-${pos}\`` — the same four options the old bar used and for the same reasons; keep those comments.
- The widget renders one `position: absolute` overlay layer, `contentEditable = 'false'`, `pointer-events: none` on itself and `auto` on each handle button.
- A `measure()` closure reads the table element via `view.nodeDOM(pos)`, walks its `<tr>` elements and the first row's `<td>`/`<th>` elements, and positions one `⊕` button per row at the row's vertical centre just left of the table, and one per column at the column's horizontal centre just above it. Each button carries `data-table-handle="row|column"` and `data-index`.
- `measure()` runs on widget creation and from the plugin's `view()` `update` hook, so it re-runs when the document changes. **Also on `resize`**, registered and torn down in the same `view()` return.
- `handleDOMEvents.mousedown` mirrors the old bar's handler exactly: `event.button !== 0` returns false, `preventDefault()` stops the caret entering the widget, then it sets the selection into the target row/column's first cell and runs `COMMANDS.addRowAfter` / `COMMANDS.addColumnAfter` before `view.focus()`.

The selection move is the part the old bar never needed: the bar acted on wherever the caret already was, but a handle names a *specific* row or column that is usually not the caret's. Resolve the target cell's position from the measured index by walking the table node's children, and `dispatch(tr.setSelection(TextSelection.near(...)))` before the command.

Write the docblock to say **why this is not the bar** — that the widget shape was originally chosen so the bar would need no geometry code, that edge handles require exactly that geometry, and that this was an accepted trade for putting the control where the thing is.

- [ ] **Step 5: Style the handles**

In `src/styles/editor.css`, delete the `.bear-table-controls` and `.bear-table-control` rules and add `.bear-table-handles` / `.bear-table-handle`. Every colour is a `--bear-*` token; a literal hex here is a defect. Handles are `opacity: 0` by default and `opacity: 1` when the table or the handle itself is hovered or the handle is `:focus-visible` — the focus case is what keeps them keyboard-reachable.

- [ ] **Step 6: Swap the registration**

In `src/features/editor/extensions.ts`, replace the `TableControls` import and its entry with `TableHandles`, and add `ContextMenu`. Extend the options union in `buildSupportedExtensions`'s signature to include `TableHandlesOptions` and `ContextMenuOptions`, and drop `TableControlsOptions`.

In `RichEditor.tsx`, replace the six `labels: { toolbar, addRow, ... }` entries with the two `TableHandles` labels, and wire `ContextMenu`'s `onOpen` through a ref-held callback exactly like `onOpenMenu` — read-once identity, current behaviour.

- [ ] **Step 7: Delete the old files and retire the old keys**

```bash
git rm src/features/editor/TableControls.ts src/features/editor/tableControls.test.ts
```

In `en.ts`/`ko.ts`: delete `editor.table.controls`, `editor.table.addRow`, `editor.table.addColumn`. Rewrite the three delete keys as full menu sentences (`'Delete row'`, `'Delete column'`, `'Delete table'` / `'행 삭제'`, `'열 삭제'`, `'표 삭제'`). Add `editor.table.addRowHandle` / `editor.table.addColumnHandle` (`'Insert row here'`, `'Insert column here'` / `'여기에 행 추가'`, `'여기에 열 추가'`) for the handles' `aria-label`s.

- [ ] **Step 8: Run the unit suite**

Run: `npm test -- --run`
Expected: green, **exit code 0**. `scripts/sourceLint.test.ts` will flag any leftover reference to the deleted module or keys.

- [ ] **Step 9: Verify in the real app**

`npm run dev`, insert a table, and confirm: handles appear on hover, each `⊕` inserts adjacent to *its own* row or column (not the caret's), nothing appears outside a table, and the handles track the table after an insert and after resizing the pane.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(editor): replace the table bar with edge handles"
```

---

## Task 10: Wire the context menu into the app

**Files:**

- Modify: `src/features/editor/RichEditor.tsx`
- Modify: `e2e/editorContext.spec.ts`

- [ ] **Step 1: Hold the request and render the menu**

Add `const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null);` and a ref-held `onOpen` callback matching `openMenuRef`'s shape. Render `<EditorContextMenu>` when non-null, wiring:

- `onAction` → a switch dispatching the matching chain. Format actions run `editor.chain().command(pinAllSelectionStep).focus().toggle*()`. Table actions run `COMMANDS[action](editor.state, editor.view.dispatch)` — **but first** `editor.commands.setTextSelection(request.pos)`, because a right-click does not move the caret and the command would otherwise act on the wrong cell.
- `onSetHeading` → `setTextSelection(request.pos)` then `setNode('heading', { level })`, or `setNode('paragraph')` for `0`.
- `onSetHighlight` → the same three-outcome switch Task 5's palette uses. Do not write a second copy of that logic; extract it to a small local helper in this file and call it from both.
- `onClose` → `setContextMenu(null)` then `editor?.commands.focus()`.

- [ ] **Step 2: Verify in the real app**

`npm run dev`. Right-click in prose, in a table, and on a highlight. Confirm the browser's menu never appears over the editor, that it **still does** over the sidebar and note list, that `Shift+F10` opens the menu at the caret, and that Escape returns focus to the text.

- [ ] **Step 3: Write the e2e tests**

Extend `e2e/editorContext.spec.ts`:

```ts
test('right-click opens ours and suppresses the browser menu', async ({ page }) => { /* ... */ });
test('Shift+F10 opens the menu at the caret', async ({ page }) => { /* ... */ });
test('the table section appears only inside a table', async ({ page }) => { /* ... */ });
test('the menu flips above the pointer near the bottom edge', async ({ page }) => { /* ... */ });
test('a table row inserts from the menu at the right-clicked cell', async ({ page }) => { /* ... */ });
```

- [ ] **Step 4: Run all six gates**

```bash
lsof -ti:4173 | xargs -r kill -9
uptime   # confirm the machine is quiet before trusting e2e
npm test -- --run && npm run typecheck && npm run lint && npm run format && npm run build && npm run test:e2e
```

Expected: **exit code 0** on every one.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(editor): wire the right-click menu into the app"
```

---

## Task 11: Shots, rulings, and documentation

**Files:**

- Modify: `e2e/shots.spec.ts`
- Modify: `docs/rulings/tables.md`, `docs/rulings/accessibility.md`
- Modify: `CLAUDE.md`, `docs/superpowers/NEXT.md`

- [ ] **Step 1: Add the context-menu shot**

In `e2e/shots.spec.ts`, add a shot that right-clicks inside the corpus note's table so the menu's longest form is captured. Do not touch the theme-list regex that derives the roster from `themes.ts` — it requires `id`, `labelKey` and `group` on ONE line in that order, and a Prettier reflow makes it match nothing with no error.

- [ ] **Step 2: Run the shots and COUNT THE FILES**

```bash
npm run shots
ls docs/design/shots | wc -l
```

Expected: **224** (14 shots × 16 themes). Do not trust the exit code — an empty theme list renders the default theme sixteen times and exits 0.

- [ ] **Step 3: Amend `docs/rulings/tables.md`**

Rewrite the two superseded bullets **in place**, keeping the original reasoning visible and stating what replaced it:

- "Words, not glyphs…" → record that the bar is gone, that the destructive three are now named rows in the context menu, and that this strengthens rather than reverses the destructive-control rule.
- "Adds land AFTER … no 'before' pair" → record that the stated reason was bar width, that the bar no longer exists, and that the menu now carries both directions while the handles need none.

Add a new bullet for the handles' geometry: that the widget shape was chosen to avoid geometry, that edge handles reintroduce it deliberately, and that consequently **no unit test can assert a handle's position** — the positions live in `e2e/editorContext.spec.ts` and nowhere else.

Update the file's `**Trigger:**` line to name `TableHandles.ts`, `tablePos.ts` and `tableCommands.ts` instead of `TableControls.ts`.

- [ ] **Step 4: Amend `docs/rulings/accessibility.md`**

Add the context menu's contract: `Shift+F10` and the `ContextMenu` key are its keyboard route and are not optional; `menuitemcheckbox` for toggles, `menuitemradio` for the mutually-exclusive heading and colour rows, plain `menuitem` for one-shot actions; and the recorded cost that overriding `contextmenu` removes the browser's spellcheck suggestions from the writing surface.

Update its `**Trigger:**` line to name `EditorContextMenu.tsx` and `HighlightPalette.tsx`.

- [ ] **Step 5: Update `CLAUDE.md`**

Add an `H editor interaction surfaces` row to the status table marked `complete`. Update the test counts and the shots arithmetic (`14 shots × 16 themes = 224 files, up from 208`). Add a Toolchain-surprises bullet for the defect this sub-project fixed:

> **`useEditor` does not re-render on transactions in Tiptap v3.** `shouldRerenderOnTransaction` defaults to `false`, so any `editor.isActive()` call made during a React render reports whatever was true the last time React ran for a reason of its own. The bottom toolbar's pressed states were stale from M4 to H and no test could see it, because the component tests click a button and assert the *document* — clicking never goes through React state. Read formatting state through `editorState.ts`'s selector, never with `isActive` in a render body.

- [ ] **Step 6: Update `docs/superpowers/NEXT.md`**

Add an `### H. Editor interaction surfaces — SHIPPED` section with the spec and plan paths, the rulings touched, and the findings worth carrying forward. Record that **G (PDF export) is next and was deliberately held**, and the user's stated motivation for it: Bear's PDF export ignores the selected theme, and closing that gap is the point of G.

- [ ] **Step 7: Final gate run**

```bash
lsof -ti:4173 | xargs -r kill -9
uptime
npm test -- --run && npm run typecheck && npm run lint && npm run format && npm run build && npm run test:e2e
```

Expected: **exit code 0** on all six.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "docs(h): record the interaction-surface rulings"
```

---

## Self-review notes

Checked against the spec on 2026-08-25:

- **Coverage.** Spec §"The defect" → Tasks 1–2. §"selector not shouldRerenderOnTransaction" → Task 2 Step 5. §"palette is fixed React" → Task 5. §"no open/close state" → Task 5 Step 1 (derived from `flags`, no boolean). §"REMOVE affordance" → Task 4. §"CHOICES moves" → Task 3. §"flat, no submenus" → Task 7 Step 5 + its asserting test. §"no clipboard rows" → Task 7 test. §"keyboard route" → Task 6. §"bar deleted, handles, deletes to menu" → Tasks 8–10. §"two rulings amended" → Task 11. §"plugins hand events up" → Tasks 6 and 9. §Testing → every task; the falsification test is Task 2 Steps 1–2 and 7. §Risks → Task 5 Step 1's scroll/resize effect, Task 9's measure hook.
- **Signatures verified against the installed packages, not from memory:** `useEditorState({editor, selector, equalityFn?})` and its two overloads, `getMarkRange($pos, type, attrs?)`, `posToDOMRect`, `Icon`'s prop is `glyph` (not `of`), the real i18n helper is `I18nProvider` (there is no `TestI18nProvider`), and `plus`/`ban`/`rows-3`/`columns-3`/`trash-2` all exist in `lucide-react` 1.31.0. `pilcrow` is present too. Every glyph named in this plan was checked against `node_modules/lucide-react/dist/esm/icons/` rather than recalled.
- **Known deliberate forward reference:** Task 7 renders table rows named against the seven `TABLE_ACTIONS` that Task 8 creates. Task 7's tests assert on rendered rows and callback arguments only, so it is independently testable; only Task 10 needs both.
