# M7.7 Tag Pill Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mod-clicking a tag pill filters the note list by that tag.

**Architecture:** `TagPill` gains a `handleDOMEvents.mousedown` handler that hit-tests the click position against the existing tag scan, prevents the browser's own caret placement, and reports the tag name through an injected `onActivate` callback. The callback threads `AppShell` → `NoteEditor` → `RichEditor` → the extension; the plugin never learns what a scope is. `AppShell` verifies the tag exists before filtering and reveals its sidebar row.

**Tech Stack:** TypeScript 6, Tiptap 3 / ProseMirror, Tailwind v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-m7-7-tag-pill-activation-design.md`

## Global Constraints

- **The tag grammar exists in exactly one place.** `tagRangeAt` must be a view over `maskedBlockText` + `findTagRanges`, never a second scan. M7.6's whole architecture rests on this, and a second implementation is this project's signature defect class.
- **`parseTags`' observable behaviour must not change.** `src/data/` should not need touching at all in this milestone. If you believe it does, stop and report — a change there silently reorganises a user's sidebar.
- **Mod is Cmd on Apple platforms and Ctrl elsewhere, never both.** `isMacOS` is exported by `@tiptap/core` — verified present in the installed version. Ctrl-click on macOS is the context-menu gesture and must NOT activate.
- **No user-facing string is hardcoded in a component.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `ko.ts` is annotated `Record<TranslationKey, string>` so a missing translation is a compile error. Never weaken that annotation — add the translation. **`useT` returns `(key: TranslationKey) => string` with NO interpolation**, so a string that needs a value in it must be split into separate keys.
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` fails `npm test` via `scripts/sourceLint.test.ts`.
- **`src/ui/` must import nothing from `src/app/`, `src/data/` or `src/i18n/`;** `src/lib/` likewise plus `src/features/`. Enforced by `scripts/sourceLint.test.ts`.
- **`lucide-react` is imported only by `src/ui/Icon.tsx`**, enforced by `scripts/sourceLint.test.ts`.
- **A test that cannot fail is a defect.** Every behavioural assertion must be verified by fault injection — introduce the defect it guards, watch precisely that test fail, restore, report.
- **Verify visually.** Take Playwright screenshots and read `getComputedStyle` rather than inferring appearance from a green suite.
- **Watch the exit code, not the pass count.** An uncaught error in an editor test in this project makes `vitest run` exit 1 while every assertion passes. Always `npx vitest run <file>; echo "exit=$?"`.
- **All six gates pass before every commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **No literal NUL bytes in tracked files.** Write the mask character only as its six-character escape sequence, then verify the bytes — a file-writing tool's JSON string parameter silently converts the escape to a real byte, which has happened five times in this project:
  ```bash
  git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
  ```
- Known pre-existing flakes, documented and NOT findings: `src/app/AppShell.test.tsx`'s `aria-current` assertion under full-suite load, and `e2e/smoke.spec.ts`'s pane-resize test. Rerun the file alone before concluding anything.
- Stale subagent worktrees under `.claude/worktrees/` are globbed by vitest, and `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`. If a suite result looks impossible, check both before believing it.
- oxlint, not ESLint. TypeScript 6 with `erasableSyntaxOnly` (no `enum`, no parameter properties) and `verbatimModuleSyntax` (`import type` required for type-only imports).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/features/editor/TagPill.ts` (modify) | Gains `tagRangeAt`, the extension's `onActivate`/`activateHint` options, and the mousedown handler. |
| `src/features/editor/tagPill.test.ts` (modify) | Gains `tagRangeAt` unit tests and activation structural tests. |
| `src/features/editor/extensions.ts` (modify) | Gains `buildEditorExtensions(options)`; `editorExtensions` becomes `buildEditorExtensions()`. |
| `src/features/editor/RichEditor.tsx` (modify) | New `onActivateTag` prop, the fresh-callback ref, the platform-correct hint, and the modifier-held class. |
| `src/features/editor/RichEditor.test.tsx` (create if absent) | Threading and modifier-class tests. |
| `src/features/notes/NoteEditor.tsx` (modify) | Passes `onActivateTag` through. |
| `src/features/tags/useTagTree.ts` (modify) | Gains `reveal(tag)`. |
| `src/features/tags/useTagTree.test.tsx` (modify) | Its tests. |
| `src/app/AppShell.tsx` (modify) | Owns `handleActivateTag`: existence check, loading guard, `setScope` + `reveal`. |
| `src/app/AppShell.test.tsx` (modify) | Its tests. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` (modify) | Two hint keys. |
| `src/styles/editor.css` (modify) | The modifier-held affordance. |
| `e2e/notes.spec.ts` (modify) | The real-gesture tests. |
| `CLAUDE.md` (modify) | The milestone's rulings. |

---

### Task 1: `tagRangeAt` — the hit test, as a view over the one scan

**Files:**
- Modify: `src/features/editor/TagPill.ts`, `src/features/editor/tagPill.test.ts`

**Interfaces:**
- Consumes: `maskedBlockText` from `./blockText`, `findTagRanges` from `@/data` — both already imported by this file.
- Produces:
  ```ts
  export interface TagHit {
    /** The normalized tag name, exactly as `parseTags` would report it. */
    tag: string;
    /** Document position of the opening `#`. */
    from: number;
    /** Document position one past the tag's last character. */
    to: number;
  }
  export function tagRangeAt(state: EditorState, pos: number): TagHit | null
  ```

**Read `src/features/editor/TagPill.ts` in full before starting.** `tagDecorations` already walks textblocks, calls `maskedBlockText`, runs `findTagRanges`, and converts `range.start`/`range.end` into document positions with `pos + 1 + offset`. `tagRangeAt` performs the same conversion and answers which tag, if any, covers a position.

**This must not become a second scan.** Factor the shared walk if that is cleanest, or have `tagRangeAt` reuse the same helpers directly — but the arithmetic `pos + 1 + offset` and the `spec.code` skip must exist once, not twice. A reviewer will check this specifically.

**Deliberately independent of suppression.** `tagDecorations` skips a tag intersecting a focused selection; `tagRangeAt` must NOT. A tag the caret sits in has no pill, and if activation depended on the decoration set the same gesture would work or not work with nothing on screen to explain the difference.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/editor/tagPill.test.ts`. It already defines `docFor(content)` at module scope; reuse it.

```ts
describe('tagRangeAt', () => {
  it('finds the tag covering a position inside it', () => {
    const editor = docFor('<p>a #work b</p>');
    // '#work' occupies positions 3..8: paragraph starts at 0, its text at 1,
    // so 'a ' is 1..3 and the '#' is at 3.
    const hit = tagRangeAt(editor.state, 5);
    expect(hit).toEqual({ tag: 'work', from: 3, to: 8 });
    expect(editor.state.doc.textBetween(hit!.from, hit!.to)).toBe('#work');
    editor.destroy();
  });

  it('finds the tag at each of its edges', () => {
    const editor = docFor('<p>a #work b</p>');
    expect(tagRangeAt(editor.state, 3)?.tag).toBe('work');
    expect(tagRangeAt(editor.state, 8)?.tag).toBe('work');
    editor.destroy();
  });

  it('returns null for ordinary prose', () => {
    const editor = docFor('<p>a #work b</p>');
    expect(tagRangeAt(editor.state, 1)).toBeNull();
    expect(tagRangeAt(editor.state, 10)).toBeNull();
    editor.destroy();
  });

  it('returns null inside an inline code span', () => {
    const editor = docFor('<p>a <code>#work</code> b</p>');
    expect(tagRangeAt(editor.state, 5)).toBeNull();
    editor.destroy();
  });

  it('returns null inside a code block', () => {
    const editor = docFor('<pre><code>#work</code></pre>');
    expect(tagRangeAt(editor.state, 3)).toBeNull();
    editor.destroy();
  });

  it('finds a tag in the second of two blocks', () => {
    const editor = docFor('<p>#work</p><p>#home</p>');
    const first = tagRangeAt(editor.state, 2)!;
    const second = tagRangeAt(editor.state, 9)!;
    expect(first.tag).toBe('work');
    expect(second.tag).toBe('home');
    expect(editor.state.doc.textBetween(second.from, second.to)).toBe('#home');
    editor.destroy();
  });

  // The property that makes activation independent of invisible state.
  it('finds a tag whose pill is suppressed by the selection', () => {
    const editor = docFor('<p>a #work b</p>');
    editor.commands.setTextSelection(5);
    expect(tagDecorations(editor.state, true)).toEqual([]);
    expect(tagRangeAt(editor.state, 5)?.tag).toBe('work');
    editor.destroy();
  });

  // The two must agree on extent wherever a pill IS painted — one scan, two
  // callers.
  it('agrees with the decoration a pill would paint', () => {
    const editor = docFor('<p>a #work b</p>');
    const [decoration] = tagDecorations(editor.state, false);
    const hit = tagRangeAt(editor.state, 5)!;
    expect({ from: hit.from, to: hit.to }).toEqual({
      from: decoration!.from,
      to: decoration!.to,
    });
    editor.destroy();
  });
});
```

**The literal positions above are computed, not guessed, but verify them anyway** — assert what `textBetween` returns before trusting a number. If a position is wrong, fix the test's number, not the implementation.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/editor/tagPill.test.ts; echo "exit=$?"`
Expected: FAIL — `tagRangeAt` is not exported.

- [ ] **Step 3: Implement**

In `src/features/editor/TagPill.ts`, add above `tagDecorations`:

```ts
export interface TagHit {
  /** The normalized tag name, exactly as `parseTags` would report it. */
  tag: string;
  /** Document position of the opening `#`. */
  from: number;
  /** Document position one past the tag's last character. */
  to: number;
}

/**
 * Every tag in a textblock, as document positions.
 *
 * The single place the offset arithmetic lives: `maskedBlockText` emits one
 * character per document position, so the character at index `i` inside a
 * block starting at `blockPos` sits at `blockPos + 1 + i`.
 */
function tagHitsIn(node: Node, blockPos: number): TagHit[] {
  return findTagRanges(maskedBlockText(node)).map((range) => ({
    tag: range.tag,
    from: blockPos + 1 + range.start,
    to: blockPos + 1 + range.end,
  }));
}

/**
 * The tag covering `pos`, or `null`.
 *
 * Deliberately independent of the decoration set: a tag the caret sits inside
 * has no pill (see the suppression rule in `tagDecorations`), and if
 * activation hit-tested the pills instead of the grammar, the same gesture
 * would work or not work with nothing on screen to explain the difference.
 * Behaviour must not depend on invisible state.
 */
export function tagRangeAt(state: EditorState, pos: number): TagHit | null {
  let found: TagHit | null = null;

  state.doc.descendants((node, blockPos) => {
    if (found !== null) return false;
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    for (const hit of tagHitsIn(node, blockPos)) {
      if (pos >= hit.from && pos <= hit.to) {
        found = hit;
        break;
      }
    }
    return false;
  });

  return found;
}
```

Then rewrite `tagDecorations`' inner loop to consume `tagHitsIn`, so the arithmetic and the `findTagRanges` call exist once. Its `spec.code` skip, its `isTextblock` guard and its suppression rule all stay exactly as they are — **only the range-to-position conversion moves.**

`Node` is a type-only import from `@tiptap/pm/model`; `verbatimModuleSyntax` requires `import type`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/features/editor/; echo "exit=$?"`
Expected: PASS, `exit=0`, including every M7.6 test in `tagPill.test.ts`, `blockText.test.ts` and `tagAgreement.test.ts` unchanged. **If an agreement test fails, the refactor changed the decoration extents — fix the refactor, never the test.**

- [ ] **Step 5: Falsify**

Change `blockPos + 1 + range.start` to `blockPos + range.start` inside `tagHitsIn`. Confirm both the `tagRangeAt` tests AND the M7.6 decoration tests fail — that shared failure is the proof the arithmetic is now in one place. Restore.

Then make `tagRangeAt` use `>` instead of `>=` on the lower bound and confirm `finds the tag at each of its edges` fails. Restore. Report both.

- [ ] **Step 6: Six gates, NUL check, commit**

```bash
git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/editor/TagPill.ts src/features/editor/tagPill.test.ts
git commit -m "refactor(editor): one place for tag position arithmetic, and a hit test"
```

---

### Task 2: activation — the gesture, and the option the app injects

**Files:**
- Modify: `src/features/editor/TagPill.ts`, `src/features/editor/tagPill.test.ts`, `src/features/editor/extensions.ts`

**Interfaces:**
- Consumes: `tagRangeAt(state, pos): TagHit | null` from Task 1.
- Produces:
  ```ts
  export interface TagPillOptions {
    /** Called with the tag name when the user Mod-clicks a tag. */
    onActivate: ((tag: string) => void) | null;
    /** Tooltip naming the gesture, already platform-correct and translated. */
    activateHint: string | null;
  }
  export const TagPill: Extension<TagPillOptions>
  ```
  and in `src/features/editor/extensions.ts`:
  ```ts
  export function buildEditorExtensions(options?: Partial<TagPillOptions>): Extensions
  export const editorExtensions: Extensions  // === buildEditorExtensions()
  ```

**Why `handleDOMEvents.mousedown` and not `handleClick`.** ProseMirror does not place the caret itself on a plain click — it lets the browser move the DOM selection natively during `mousedown` and reads it back. `handleClick` runs on `mouseup`, by which time the caret has already moved. **The only reliable point to prevent it is `mousedown`, with `event.preventDefault()`.** Getting this wrong means the caret lands inside the tag, suppression lifts the pill, and the thing the user clicked vanishes under the cursor — the spec names this as the milestone's first risk.

**Position comes from `view.posAtCoords`,** because a DOM event carries coordinates rather than a document position. jsdom has no layout engine and `posAtCoords` throws there without stubs, which is exactly why the tests below drive the handler with a minimal fake view and the real gesture is covered end to end in Task 5.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/editor/tagPill.test.ts`:

```ts
/**
 * Invokes the plugin's own mousedown handler with a fake view, so the test
 * exercises the real registered plugin without needing jsdom layout —
 * `posAtCoords` has no meaning without a layout engine.
 */
function mousedownAt(
  editor: Editor,
  pos: number,
  init: MouseEventInit,
): { handled: boolean; defaultPrevented: boolean } {
  const event = new MouseEvent('mousedown', { cancelable: true, button: 0, ...init });
  const view = { state: editor.state, posAtCoords: () => ({ pos, inside: pos }) };
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.mousedown === undefined
        ? false
        : handlers.mousedown(view as never, event as never),
    ) === true;
  return { handled, defaultPrevented: event.defaultPrevented };
}

describe('tag activation', () => {
  it('reports the tag and swallows the event on a modifier click', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 5, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(activated).toEqual(['work']);
    expect(result.handled).toBe(true);
    // Preventing the default is what stops the browser moving the caret into
    // the tag, which would lift the pill the user just clicked.
    expect(result.defaultPrevented).toBe(true);
    editor.destroy();
  });

  it('does nothing on a plain click, so the caret still moves', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 5, {});

    expect(activated).toEqual([]);
    expect(result.handled).toBe(false);
    expect(result.defaultPrevented).toBe(false);
    editor.destroy();
  });

  it('does nothing on a modifier click outside any tag', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 1, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(activated).toEqual([]);
    expect(result.handled).toBe(false);
    editor.destroy();
  });

  it('does not activate on a non-primary button', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const modifier = isMacOS() ? { metaKey: true } : { ctrlKey: true };
    expect(mousedownAt(editor, 5, { ...modifier, button: 1 }).handled).toBe(false);
    expect(mousedownAt(editor, 5, { ...modifier, button: 2 }).handled).toBe(false);
    expect(activated).toEqual([]);
    editor.destroy();
  });

  // Ctrl-click on macOS is the context-menu gesture. Getting this wrong is
  // invisible on Linux CI, so it needs its own assertion on both platforms.
  it('treats Ctrl as the modifier only off Apple platforms', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });

    const ctrl = mousedownAt(editor, 5, { ctrlKey: true });
    const meta = mousedownAt(editor, 5, { metaKey: true });

    if (isMacOS()) {
      expect(ctrl.handled).toBe(false);
      expect(meta.handled).toBe(true);
      expect(activated).toEqual(['work']);
    } else {
      expect(ctrl.handled).toBe(true);
      expect(meta.handled).toBe(false);
      expect(activated).toEqual(['work']);
    }
    editor.destroy();
  });

  // Independence from invisible state, end to end through the real plugin.
  it('activates a tag whose pill is currently suppressed', () => {
    const activated: string[] = [];
    const editor = new Editor({
      extensions: buildEditorExtensions({ onActivate: (tag) => activated.push(tag) }),
      content: '<p>a #work b</p>',
    });
    editor.commands.setTextSelection(5);
    editor.commands.focus();

    mousedownAt(editor, 5, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(activated).toEqual(['work']);
    editor.destroy();
  });

  it('is inert when no callback is injected', () => {
    const editor = new Editor({
      extensions: editorExtensions,
      content: '<p>a #work b</p>',
    });

    const result = mousedownAt(editor, 5, isMacOS() ? { metaKey: true } : { ctrlKey: true });

    expect(result.handled).toBe(false);
    editor.destroy();
  });

  it('puts the injected hint on every pill', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ activateHint: 'Cmd-click to filter' }),
      content: '<p>#work and #home</p>',
    });

    const titles = tagDecorations(editor.state, false).map(
      // A Decoration's spec is where `Decoration.inline`'s attribute object lands.
      (decoration) => (decoration as unknown as { type: { attrs: Record<string, string> } }).type
        .attrs.title,
    );
    expect(titles).toEqual(['Cmd-click to filter', 'Cmd-click to filter']);
    editor.destroy();
  });
});
```

Add `import { Editor, isMacOS } from '@tiptap/core';` and
`import { buildEditorExtensions, editorExtensions } from './extensions';` to the file's imports as needed — check what is already there rather than duplicating.

**The `title` assertion's shape is the one uncertain thing in this task.** A ProseMirror `Decoration`'s attribute object is not on a documented public property. Before writing the implementation, log one decoration in a scratch run and read where the attributes actually sit, then write the assertion against reality. If the shape differs from the guess above, use the real one and say so in your report — do not force the guess.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/editor/tagPill.test.ts; echo "exit=$?"`
Expected: FAIL — `buildEditorExtensions` is not exported.

- [ ] **Step 3: Implement the extension options and the handler**

In `src/features/editor/TagPill.ts`:

```ts
export interface TagPillOptions {
  /**
   * Called with the tag name when the user Mod-clicks a tag. `null` when
   * nobody is listening, which is the state of the schema-only
   * `editorExtensions` constant.
   */
  onActivate: ((tag: string) => void) | null;
  /**
   * Tooltip naming the gesture. Supplied already translated and already
   * platform-correct, because an extension has no access to `useT` and
   * `useT` has no interpolation.
   */
  activateHint: string | null;
}
```

Give `Extension.create<TagPillOptions>` an `addOptions()` returning
`{ onActivate: null, activateHint: null }`, put `activateHint` on the decoration's attributes when it is non-null, and add the plugin prop:

```ts
        props: {
          decorations(state) { /* unchanged */ },

          handleDOMEvents: {
            // `mousedown`, not `handleClick`. ProseMirror does not place the
            // caret itself on a plain click — the browser moves the DOM
            // selection natively during mousedown and ProseMirror reads it
            // back. By `handleClick` (which runs on mouseup) the caret has
            // already moved, suppression has already lifted the pill, and the
            // thing the user clicked has vanished under the cursor.
            // `preventDefault()` here is the only point that stops it.
            mousedown(view, event) {
              if (onActivate === null) return false;
              if (event.button !== 0) return false;
              // Ctrl-click on macOS is the context-menu gesture, and must not
              // also change scope. Cmd there, Ctrl everywhere else — the same
              // "Mod" every keyboard shortcut in this app uses.
              if (!(isMacOS() ? event.metaKey : event.ctrlKey)) return false;

              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (at === null) return false;

              const hit = tagRangeAt(view.state, at.pos);
              if (hit === null) return false;

              event.preventDefault();
              onActivate(hit.tag);
              return true;
            },
          },
        },
```

Read `onActivate` and `activateHint` from `this.options` in `addProseMirrorPlugins()` and capture them into locals beside the existing `const { editor } = this`, for the same reason that line already gives: the props are invoked by ProseMirror's view machinery with no guarantee of `this`.

**`onActivate` is read once, at plugin construction.** That is why Task 3 threads a *ref-backed* function rather than the callback itself — the identity must be stable while the behaviour stays current.

- [ ] **Step 4: Add the factory**

In `src/features/editor/extensions.ts`, `TagPill` currently sits inside the `supportedExtensions` array. Turn that array into a function of the options and define both exports over it:

```ts
function buildSupportedExtensions(options: Partial<TagPillOptions>): Extensions {
  return [ /* ... existing entries, with TagPill.configure({ ...defaults, ...options }) ... */ ];
}

/**
 * The extension set, with the tag-pill callbacks the app injects.
 *
 * `editorExtensions` below is this with no options — so `getSchema`,
 * `computeRecognizedHtmlTags()` and every existing test keep working
 * untouched, and only `RichEditor` ever passes anything.
 */
export function buildEditorExtensions(options: Partial<TagPillOptions> = {}): Extensions {
  return [
    ...buildSupportedExtensions(options),
    RawTable,
    RawDefinition,
    RawHtmlBlock,
    RawImage,
    createRawInlineHtmlNode(computeRecognizedHtmlTags()),
  ];
}

export const editorExtensions: Extensions = buildEditorExtensions();
```

`computeRecognizedHtmlTags()` builds a schema from the supported set; call it with **no options**, since an `Extension` registers nothing in the schema and the options must not be able to change it. Keep the existing doc comments — they carry M4's underline ruling and the Raw* ordering rationale, both of which are still true.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run src/features/editor/; echo "exit=$?"`
Expected: PASS, `exit=0`.

Then: `npx vitest run src/features/editor/extensions.test.ts src/features/editor/markdown.test.ts src/features/editor/stability.test.ts src/features/editor/rawBlock.test.ts src/features/editor/tagAgreement.test.ts`
Expected: PASS, unchanged. **If any of these moved, the factory changed the schema** — an `Extension` must register nothing.

- [ ] **Step 6: Falsify**

One at a time, restoring after each, and report which test failed for each:
1. Drop `event.preventDefault()`. Confirm `reports the tag and swallows the event` fails on `defaultPrevented`.
2. Change the modifier test to `event.metaKey || event.ctrlKey`. Confirm `treats Ctrl as the modifier only off Apple platforms` fails.
3. Delete the `event.button !== 0` guard. Confirm the non-primary-button test fails.
4. Make the handler hit-test `tagDecorations` instead of `tagRangeAt`. Confirm `activates a tag whose pill is currently suppressed` fails.

- [ ] **Step 7: Six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/editor/
git commit -m "feat(editor): a modifier click on a tag reports it"
```

---

### Task 3: threading the callback, the hint, and the modifier affordance

**Files:**
- Modify: `src/features/editor/RichEditor.tsx`, `src/features/notes/NoteEditor.tsx`, `src/i18n/en.ts`, `src/i18n/ko.ts`, `src/styles/editor.css`
- Create: `src/features/editor/RichEditor.test.tsx` (check first whether it already exists; if so, extend it)

**Interfaces:**
- Consumes: `buildEditorExtensions(options)` and `TagPillOptions` from Task 2.
- Produces: `RichEditorProps` gains `onActivateTag?: (tag: string) => void`; `NoteEditorProps` gains the same.

**Two hazards, both of which have bitten this codebase before.**

*A stale callback.* `useEditor` reads its options once at mount, and the plugin reads `onActivate` once at construction. Passing the prop straight through would freeze whatever `AppShell` supplied on the first render. Thread a ref: keep `onActivateTag` in a `useRef`, update it on every render, and hand the extension a stable `(tag) => ref.current?.(tag)`.

*A re-render per keystroke.* The modifier-held affordance must NOT be React state. Setting state on every `keydown` would re-render the editor's whole subtree while the user types. Toggle the class directly on a DOM node through a ref.

- [ ] **Step 1: Add the translations**

In `src/i18n/en.ts`:

```ts
  'editor.tagPill.hint.mac': 'Cmd-click to filter by this tag',
  'editor.tagPill.hint.other': 'Ctrl-click to filter by this tag',
```

and the Korean equivalents in `src/i18n/ko.ts` — that file is annotated `Record<TranslationKey, string>`, so a missing key is a compile error. Suggested: `'Cmd-클릭하면 이 태그로 필터링됩니다'` and `'Ctrl-클릭하면 이 태그로 필터링됩니다'`.

**The tag name is deliberately absent from the copy.** `useT` has no interpolation, and the pill already shows the tag.

- [ ] **Step 2: Write the failing tests**

Check whether `src/features/editor/RichEditor.test.tsx` exists. If it does, append; if not, create it, copying the jsdom stub header from `src/features/notes/NoteEditor.test.tsx` — mounting the editor and dispatching real events needs `Range.prototype.getBoundingClientRect`, `Range.prototype.getClientRects` and `document.elementFromPoint`. **Without a stub the error is UNCAUGHT, so `vitest run` exits 1 while every assertion passes.**

Use `renderWithI18n` from `@/i18n/testing` — this repo has no bare `<I18nProvider>` wrapper convention.

```ts
describe('RichEditor tag activation', () => {
  it('calls the CURRENT callback, not the one captured at mount', () => {
    // The plugin reads `onActivate` once, at construction. A prop passed
    // straight through would freeze the first render's closure.
    const first = vi.fn();
    const second = vi.fn();
    const handleRef = { current: null };
    const { rerender } = renderWithI18n(
      <RichEditor {...baseProps} handleRef={handleRef} onActivateTag={first} />,
    );
    rerender(<RichEditor {...baseProps} handleRef={handleRef} onActivateTag={second} />);

    // Invoke through the mounted plugin, the same way tagPill.test.ts does.
    activateFirstTag(handleRef.current!.editor!);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('work');
  });

  it('marks the editor while the modifier is held, and clears it on blur', () => {
    renderWithI18n(<RichEditor {...baseProps} onActivateTag={vi.fn()} />);
    const surface = screen.getByRole('textbox').closest('[data-mod-held]');
    expect(surface).not.toBeNull();
    expect(surface!.getAttribute('data-mod-held')).toBe('false');

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true, ctrlKey: true });
    expect(surface!.getAttribute('data-mod-held')).toBe('true');

    fireEvent.keyUp(window, { key: 'Meta', metaKey: false, ctrlKey: false });
    expect(surface!.getAttribute('data-mod-held')).toBe('false');
  });

  // Hold Cmd, press Tab to switch windows, and the keyup never arrives. The
  // pills would keep claiming to be clickable while a plain click edits.
  it('clears the modifier state when the window loses focus', () => {
    renderWithI18n(<RichEditor {...baseProps} onActivateTag={vi.fn()} />);
    const surface = screen.getByRole('textbox').closest('[data-mod-held]')!;

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true, ctrlKey: true });
    expect(surface.getAttribute('data-mod-held')).toBe('true');

    fireEvent.blur(window);
    expect(surface.getAttribute('data-mod-held')).toBe('false');
  });
});
```

Write `baseProps` and `activateFirstTag` yourself against the real signatures — `RichEditorProps` requires `initialMarkdown`, `onChange`, `onBlur`, `ariaLabel`, `handleRef`, `createdAt` and `updatedAt`, and `RichEditorHandle` exposes `editor`. `activateFirstTag` should locate the tag with `tagRangeAt` and drive the plugin's mousedown handler the way `tagPill.test.ts` does; **read that helper and reuse its shape rather than inventing a second one.**

**The attribute, not a class, is what the test reads.** `data-mod-held` is assertable without coupling the test to a Tailwind class name; the CSS selects on the same attribute. A test that asserts a class name is asserting an implementation detail — this project has ruled on that twice.

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/features/editor/RichEditor.test.tsx; echo "exit=$?"`
Expected: FAIL — no `onActivateTag` prop.

- [ ] **Step 4: Implement in `RichEditor.tsx`**

```tsx
export interface RichEditorProps {
  // ... existing props unchanged ...
  /** Called with a tag name when the user Mod-clicks its pill. */
  onActivateTag?: (tag: string) => void;
}
```

```tsx
  const t = useT();
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  // The plugin reads its callback once, at construction, and `useEditor` reads
  // its options once, at mount. A ref keeps the identity stable while the
  // behaviour stays current.
  const activateRef = useRef(onActivateTag);
  activateRef.current = onActivateTag;

  const [extensions] = useState(() =>
    buildEditorExtensions({
      onActivate: (tag) => activateRef.current?.(tag),
      activateHint: t(isMacOS() ? 'editor.tagPill.hint.mac' : 'editor.tagPill.hint.other'),
    }),
  );
```

Pass `extensions` to `useEditor`. `useState`'s initializer runs once, which matches `useEditor` reading its options once; building the array inline would rebuild it on every render for no benefit.

The affordance, as its own effect — **no React state, because setting state on every `keydown` would re-render the editor's subtree on every keystroke the user types**:

```tsx
  useEffect(() => {
    // Derived from each event's own modifier flags rather than from tracking
    // which key went down: a keyup can be missed entirely (hold Cmd, press Tab
    // to leave the window), and then the pills would go on claiming to be
    // clickable while a plain click edits. `blur` is the backstop for the case
    // where no key event arrives at all.
    const sync = (held: boolean): void => {
      surfaceRef.current?.setAttribute('data-mod-held', String(held));
    };
    const fromEvent = (event: KeyboardEvent): void => {
      sync(isMacOS() ? event.metaKey : event.ctrlKey);
    };
    const clear = (): void => sync(false);

    window.addEventListener('keydown', fromEvent);
    window.addEventListener('keyup', fromEvent);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', fromEvent);
      window.removeEventListener('keyup', fromEvent);
      window.removeEventListener('blur', clear);
    };
  }, []);
```

Put `ref={surfaceRef}` and `data-mod-held="false"` on the component's outermost `<div>`.

- [ ] **Step 5: Style the affordance**

In `src/styles/editor.css`, beside the existing `.bear-tag` rule:

```css
/*
 * While Mod is held, pills read as controls. Someone holding Cmd on the way to
 * Cmd-B sees every pill in the note answer, which teaches the gesture without
 * a word of copy — and it is the only affordance there is, since plain click
 * deliberately still edits.
 */
[data-mod-held='true'] .ProseMirror .bear-tag {
  cursor: pointer;
  background-color: var(--bear-selected);
}
```

`--bear-selected` is Paper 0.11 / Ink 0.18 while `--bear-tag-fill` is Paper 0.16 / Ink 0.18, so **this rule would make Paper's held state LIGHTER and Ink's identical** — the opposite of an affordance. Do not ship the snippet above as written: add a `--bear-tag-fill-strong` to all three blocks of `src/styles/tokens.css` (`:root`, `:root[data-theme='dark']`, and the `prefers-color-scheme: dark` block) at an alpha above each theme's `--bear-tag-fill`, and use it here. `scripts/sourceLint.test.ts` compares the two dark blocks value-for-value, so a token in one and not the other fails the suite. Then **look at both themes in a browser** and say what you saw.

- [ ] **Step 6: Thread through `NoteEditor`**

Add `onActivateTag?: (tag: string) => void` to `NoteEditorProps` and pass it to `<RichEditor>`. Nothing else in that component changes.

- [ ] **Step 7: Run and falsify**

Run: `npx vitest run src/features/; echo "exit=$?"`
Expected: PASS, `exit=0`.

Then, restoring after each: remove the `blur` listener and confirm `clears the modifier state when the window loses focus` fails; replace the ref indirection with the raw prop and confirm `calls the CURRENT callback` fails. Report both.

- [ ] **Step 8: Six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/editor/ src/features/notes/NoteEditor.tsx src/i18n/ src/styles/
git commit -m "feat(editor): thread tag activation, and show the modifier"
```

---

### Task 4: the app decides what activation means

**Files:**
- Modify: `src/features/tags/useTagTree.ts`, `src/features/tags/useTagTree.test.tsx`, `src/app/AppShell.tsx`, `src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `NoteEditorProps.onActivateTag` from Task 3.
- Produces: `TagTreeState` gains `reveal: (tag: string) => void`.

**Two rulings this task implements.**

*An unknown tag activates nothing.* M7.6 ships two documented classes of **lying pill** — a tag ending link text, and a mark applied over leading whitespace the serializer hoists. In both the pill is painted and the tag is not in the index. Setting a scope for it would trip `AppShell`'s existing vanished-tag effect and bounce the user to All Notes: a click that visibly throws them somewhere they did not ask to go.

*The loading guard.* `useTagTree` returns `undefined` before its live query resolves, and treating that as "no tags" is the same mistake the vanished-tag effect already guards against. While the tree is `undefined`, activation does nothing.

*Revealing the row.* The note list has no header naming the current scope; the only on-screen indication is the `aria-current` sidebar row, and a nested tag whose parent is collapsed has no rendered row at all. `reveal` clears the collapsed flag on the tag's ancestors, reusing the same durable per-tag setting `toggle` already writes.

- [ ] **Step 1: Write the failing tests for `reveal`**

In `src/features/tags/useTagTree.test.tsx` — read the file first and follow its existing setup for seeding tags and awaiting the live query.

```tsx
describe('reveal', () => {
  it('expands every collapsed ancestor of a nested tag', async () => {
    // seed notes carrying #work/urgent, collapse 'work', render the hook
    await act(async () => result.current.toggle('work'));
    expect(result.current.isCollapsed('work')).toBe(true);

    await act(async () => result.current.reveal('work/urgent'));
    expect(result.current.isCollapsed('work')).toBe(false);
  });

  it('leaves the tag itself collapsed — only its ancestors open', async () => {
    // A tag with children of its own keeps its own disclosure state: the user
    // asked to see the row, not to expand what hangs off it.
    await act(async () => result.current.toggle('work'));
    await act(async () => result.current.reveal('work'));
    expect(result.current.isCollapsed('work')).toBe(true);
  });

  it('is a no-op for a top-level tag', async () => {
    await act(async () => result.current.reveal('home'));
    expect(result.current.isCollapsed('home')).toBe(false);
  });
});
```

- [ ] **Step 2: Implement `reveal`**

```ts
  /**
   * Opens every collapsed ancestor of `tag`, so its row is actually rendered.
   *
   * The tag itself keeps its own disclosure state: activating `#work` means
   * "show me that row", not "expand what hangs off it".
   */
  const reveal = useCallback(
    (tag: string) => {
      const segments = tag.split('/');
      for (let i = 1; i < segments.length; i += 1) {
        const ancestor = segments.slice(0, i).join('/');
        if (collapsed.has(ancestor)) void tags.setCollapsed(ancestor, false);
      }
    },
    [collapsed],
  );
```

Add `reveal` to `TagTreeState` and to the returned object.

- [ ] **Step 3: Write the failing tests for `AppShell`**

In `src/app/AppShell.test.tsx` — read its existing helpers for seeding notes and rendering.

```tsx
describe('activating a tag from the editor', () => {
  it('filters the note list by a tag the sidebar knows', async () => {
    // Seed two notes, one carrying #work. Open the #work note, Mod-click its
    // pill via the mounted plugin, and assert the list narrows and the sidebar
    // row reads as current.
  });

  it('does nothing for a tag that is not in the index', async () => {
    // A lying pill: the decoration is painted, `parseTags` yields nothing.
    // The scope must be unchanged — NOT changed and then bounced back by the
    // vanished-tag effect, which would look like a click throwing the user
    // somewhere they did not ask to go.
  });

  it('does nothing while the tag tree is still loading', async () => {
    // `useTagTree` returns `undefined` before its live query resolves.
    // Treating that as "no tags" is the mistake the vanished-tag guard exists
    // to avoid.
  });
});
```

Write the bodies against the real helpers in that file. **Driving the gesture from `AppShell`'s test is the awkward part**: the editor is deep inside. Prefer reaching the mounted editor through the DOM the way the file already reaches other components, and if that proves unworkable, test `handleActivateTag`'s three behaviours by invoking the prop `AppShell` passes to `NoteEditor` — say in your report which you did and why.

- [ ] **Step 4: Implement in `AppShell.tsx`**

```tsx
  const handleActivateTag = useCallback(
    (tag: string) => {
      // `undefined` means the live query has not resolved. Treating it as "no
      // tags" would make activation silently fail on a slow first paint —
      // the same mistake the vanished-tag effect above already guards.
      if (tree.nodes === undefined) return;

      const exists = (nodes: TagNode[]): boolean =>
        nodes.some((node) => node.tag === tag || exists(node.children));
      // M7.6 ships two documented classes of pill whose tag is not in the
      // index. Setting a scope for one would trip the vanished-tag effect and
      // bounce the user to All Notes — a click that visibly throws them
      // somewhere they did not ask to go. Doing nothing is the honest answer.
      if (!exists(tree.nodes)) return;

      setScope({ kind: 'tag', tag });
      tree.reveal(tag);
    },
    [tree],
  );
```

Pass `onActivateTag={handleActivateTag}` to `<NoteEditor>`.

The `exists` walk duplicates the one in the vanished-tag effect. **Extract it** to a named helper in `src/features/tags/tagTree.ts` (`hasTag(nodes, tag)`) and use it from both — a verbatim second copy of a logic block is a review finding in this project, and the two must agree by construction or the guard and the check can drift apart.

Confirm `{ kind: 'tag', tag }` is the correct `NoteScope` shape by reading `src/features/notes/scope.ts` rather than trusting this snippet.

- [ ] **Step 5: Run and falsify**

Run: `npx vitest run src/features/tags/ src/app/; echo "exit=$?"`
Expected: PASS, `exit=0`.

Then, restoring after each: delete the `tree.nodes === undefined` guard and confirm the loading test fails; delete the `exists` check and confirm the unknown-tag test fails; delete `tree.reveal(tag)` and confirm a `reveal` test fails. Report all three.

- [ ] **Step 6: Six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/tags/ src/app/
git commit -m "feat(tags): activating a tag filters by it and reveals its row"
```

---

### Task 5: the real gesture, in a real browser, and the rulings

**Files:**
- Modify: `e2e/notes.spec.ts`, `CLAUDE.md`

**Interfaces:** none produced.

**Why this task carries the weight.** Every test so far drives the mousedown handler with a fake view, because jsdom has no layout engine and `posAtCoords` is meaningless there. **Nothing yet proves the real gesture works** — that a genuine Mod-click at genuine coordinates reaches the handler, that `preventDefault()` actually stops the caret, or that the note list actually narrows. That is this task's job, and it is the same reason pointer-drag paths in this project live in Playwright.

- [ ] **Step 1: Look at it**

Build and preview on a port that is **not** 4173 (`playwright.config.ts` hardcodes that one with `reuseExistingServer`, so a concurrent run would measure your tree). Create a note containing `Ship #work/urgent today`, then:

1. Hold Cmd (or Ctrl off macOS) and confirm the pill visibly changes — cursor and fill — in **both** light and dark `colorScheme` emulations.
2. Mod-click the pill and confirm the note list narrows and the sidebar row for `urgent` reads as current.
3. Plain-click the pill and confirm the caret lands in the tag and the scope does not change.
4. Collapse `work` in the sidebar, then Mod-click a `#work/urgent` pill, and confirm the row is revealed.

**Say what you actually saw at each step.** If the caret moves on a Mod-click, stop — that is the milestone's named first risk and it means `preventDefault()` is not reaching the right point.

Write scratch scripts **outside the repo**, under `/private/tmp/claude-501/-Users-jeongjin-Documents-bear-web/`. A scratch spec left in `e2e/` silently broke `npm run format` in an earlier session. Confirm `git status` is clean before committing.

- [ ] **Step 2: Add the end-to-end tests**

Append to `e2e/notes.spec.ts`. Playwright's modifier is `ControlOrMeta`, which resolves per platform exactly as `isMacOS()` does.

```ts
test('a modifier click on a tag pill filters by that tag', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Ship #work today');
  await page.keyboard.press('Escape');

  const pill = editor.locator('.bear-tag');
  await expect(pill).toHaveText('#work');

  await pill.click({ modifiers: ['ControlOrMeta'] });

  await expect(page.getByRole('button', { name: /^work / })).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('a plain click on a tag pill places the caret and does not filter', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('Ship #work today');
  await page.keyboard.press('Escape');

  await editor.locator('.bear-tag').click();

  // The caret landed in the tag, so its pill is suppressed — that is the
  // observable proof the click was an edit rather than an activation.
  await expect(editor.locator('.bear-tag')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notes' })).toHaveAttribute(
    'aria-current',
    'true',
  );
});
```

**Verify the accessible names and the `aria-current` value against the real DOM before trusting them** — read `src/ui/SidebarRow.tsx` and the existing assertions in `e2e/` rather than assuming `'true'` or the `/^work /` shape. The `Escape` keypress is there to move focus off the editor so the pill is not suppressed; confirm it actually does that in this app and use whatever does if it does not.

- [ ] **Step 3: Run, then falsify**

Run: `npm run test:e2e -- notes.spec.ts`
Expected: PASS.

Then, one at a time and restoring after each: remove `event.preventDefault()` from the mousedown handler and confirm the plain-click test's sibling — the modifier test — still passes while the caret misbehaviour shows up; remove `onActivateTag` from `AppShell`'s `<NoteEditor>` and confirm the modifier test fails. Report both, and say plainly if an injection does **not** produce a failure — an assertion that cannot fail does not stay in the file.

- [ ] **Step 4: Update `CLAUDE.md`**

Update the Status table: M7.7 as its own `complete` row, and the test counts to what `npm test` and `npm run test:e2e` **actually print** — run them and read the numbers.

Add to "Rules that must not be silently reversed":

```markdown
- **Plain click on a tag pill edits; Mod-click activates.** Bear filters on a
  plain click, and this is a deliberate divergence: Bear can afford it because
  its tag autocomplete makes mistyped tags rare, while this app has none, so
  editing a tag in place is the normal repair path and a pill that defended
  itself against being edited would be worse than an inert one. **If
  autocomplete ever ships, revisit this ruling** — it is the premise the
  divergence rests on.
- **Mod is Cmd on Apple platforms and Ctrl elsewhere, never `metaKey ||
  ctrlKey`.** Ctrl-click on macOS is the context-menu gesture; accepting both
  means one gesture opens a menu AND changes scope. `isMacOS` from
  `@tiptap/core` decides. Getting this wrong is invisible on Linux CI, so
  `tagPill.test.ts` asserts both branches.
- **Activation is handled in `handleDOMEvents.mousedown`, not `handleClick`.**
  ProseMirror does not place the caret itself on a plain click — the browser
  moves the DOM selection natively during `mousedown` and ProseMirror reads it
  back. By `handleClick` (which runs on `mouseup`) the caret has already moved,
  suppression has already lifted the pill, and the thing the user clicked has
  vanished under the cursor. `event.preventDefault()` on mousedown is the only
  point that stops it.
- **`tagRangeAt` hit-tests the grammar, never the decoration set.** A tag the
  caret sits inside has no pill; if activation followed the pills, the same
  gesture would work or not work with nothing on screen to explain the
  difference. Behaviour must not depend on invisible state. It shares
  `tagHitsIn` with `tagDecorations`, so the `blockPos + 1 + offset` arithmetic
  exists once — perturbing it fails both suites, which is the proof.
- **Activating a tag the index does not hold does nothing.** M7.6 ships two
  classes of lying pill. Setting a scope for one would trip the vanished-tag
  effect and bounce the user to All Notes — a click that visibly throws them
  somewhere they did not ask to go. The same handler returns early while
  `tree.nodes` is `undefined`, because that means "loading", not "no tags".
- **The modifier affordance is a DOM attribute set through a ref, never React
  state.** `data-mod-held` on the editor's outer element; setting state on
  every `keydown` would re-render the editor subtree on every keystroke the
  user types. It is derived from each event's own modifier flags on both
  `keydown` and `keyup`, and cleared on window `blur` — hold Cmd, press Tab to
  leave the window, and the `keyup` never arrives, leaving pills claiming to
  be clickable while a plain click edits.
- **`editorExtensions` is `buildEditorExtensions()` with no options**, so
  `getSchema(editorExtensions)` and `computeRecognizedHtmlTags()` are
  unaffected by anything the app injects. An `Extension` registers nothing in
  the schema, and the options must never be able to change that.
```

Then, under "Carried into M5b and M6", replace the M7.7 line — click-to-filter is now done — while keeping tag rename/delete and syntax-visibility toggling, both still carried and unscheduled. Add:

```markdown
- **A tag pill has no keyboard activation, deliberately.** Making a span inside
  a contenteditable focusable fights the editor for the selection and for Tab,
  and the tag sidebar is already a complete keyboard route to every filter.
  Recorded as a ruling rather than an omission.
- **The note list has no header naming the current scope.** Bear has one. The
  only on-screen indication of an active filter is the `aria-current` sidebar
  row, which is why activation reveals collapsed ancestors. A real header
  belongs with M8's polish.
```

- [ ] **Step 5: Six gates, NUL check, commit**

```bash
git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add e2e/notes.spec.ts CLAUDE.md
git commit -m "feat(editor): prove the gesture in a browser, and M7.7 docs"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-14-m7-7-tag-pill-activation-design.md`:

- **Every spec ruling maps to a task.** Plain-click-edits (2), Mod resolution (2), grammar hit test (1), plugin-reports-app-decides (2 and 4), the modifier affordance (3), unknown tag does nothing (4), reveal (4). Testing section: `tagRangeAt` units (1), structural click assertions including the macOS Ctrl case and suppression independence (2), the component tests (3 and 4), the affordance's blur test (3), end to end (5).
- **Out-of-scope items appear in no task**: keyboard activation, a note-list scope header, tag rename/delete, autocomplete, syntax-visibility toggling. The first two are recorded in `CLAUDE.md` by Task 5 with their reasons, since both are rulings rather than mere absences.
- **One correction to the spec, made here rather than silently.** The spec's testing section says a Mod-click test "belongs in `e2e/` because jsdom cannot drive a real modifier-click through ProseMirror's coordinate mapping". That is true of the *real* gesture, but it would leave the modifier logic itself — the macOS Ctrl branch above all — covered only by a browser running on one platform. Task 2 therefore also asserts the branches directly against a fake view, and Task 5 proves the real gesture. Both are needed; neither substitutes for the other.
- **Two things the plan deliberately leaves to the implementer, with the requirement stated.** The shape of a `Decoration`'s attribute object (Task 2, Step 1) is not a documented public property, so the plan says to read it from a real decoration before writing the assertion. And the exact seam for driving activation inside `AppShell.test.tsx` (Task 4, Step 3) depends on helpers the plan cannot see; the three behaviours to prove are named, the mechanism is not.
- **One hazard the plan flags rather than assumes away.** Task 3 Step 5's CSS snippet uses `--bear-selected`, which would make Paper's held state *lighter* than its resting state and Ink's identical. The step says so explicitly and requires a new token in all three blocks instead. Shipping that snippet as written would produce an affordance that reads as the absence of one.
- **Type consistency:** `TagHit { tag, from, to }` from Task 1 is what Task 2's handler consumes; `TagPillOptions { onActivate, activateHint }` from Task 2 is what Task 3 supplies; `onActivateTag` is the prop name in both `RichEditorProps` and `NoteEditorProps`; `reveal(tag)` is named identically in `TagTreeState`, its tests and `AppShell`.
