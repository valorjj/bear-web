# S4 Tag Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `#a` in the editor offers every matching tag, and a plain click on a tag pill filters the note list by it.

**Architecture:** A new `TagAutocomplete` Tiptap extension built as a sibling of the existing `LinkAutocomplete` (not a refactor of it), fed tag keys drilled down from `AppShell`'s existing `useTagTree()` and unioned with tags found in the open document. `TagPill`'s `mousedown` handler loses its modifier gate so a plain click filters. `useAutosave` gains a hold so the caret parked inside a half-typed tag does not persist intermediate tags.

**Tech Stack:** TypeScript, React 19, Tiptap v3 / ProseMirror, Dexie (IndexedDB), Tailwind v4, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-s4-tag-autocomplete-design.md`

## Global Constraints

- **All six gates must pass before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **A seventh gate for any commit touching something visual:** `npm run measure:check`. It regenerates `docs/design/measurements.md` and fails on a diff; regenerate and commit when it fails.
- **Cap workers when the machine is shared:** `npm test -- --run --maxWorkers=4`. This is a fanless Mac Mini that also hosts the API service.
- **Repetition targets FILES, never the suite:** `npx vitest run src/features/editor/tagAutocomplete.test.ts` is ~2-3s against ~80 CPU-seconds for the full suite.
- **Before trusting any e2e result that follows a source change, and ALWAYS before a fault injection:** `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`, so a stale preview server silently tests an old build.
- **No user-facing string is hardcoded.** Every string goes through `useT`; `src/i18n/en.ts` defines the key type and `ko.ts` is `Record<TranslationKey, string>`, so a missing Korean translation is a compile error. Never weaken that annotation.
- **Every colour comes from a CSS custom property.** Literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **`erasableSyntaxOnly`** forbids `enum`, parameter properties and namespaces. **`verbatimModuleSyntax`** requires `import type` / `export type`.
- **Duck-type in tests, never `instanceof`.** `vitest.setup.ts` swaps the global `Blob` for Node's.
- **Extension option and command names must be prefixed with the extension's name.** `buildEditorExtensions` spreads every extension's options into ONE flat object, so a colliding bare name is silently overwritten with no error and no type failure.
- **Every meta-only ProseMirror dispatch must carry `.setMeta(skipTrailingNodeMeta, true)`.** `TrailingNode.appendTransaction` is not gated on `docChanged`, so without it a meta-only transaction inserts a spurious trailing paragraph into any note ending in a list or table, which autosave then persists.
- **Invisible-character check on every file touched**, before every commit:
  `python3 -c "d=open(PATH).read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"` must print `0 0`.
- **Commit trailer** on every commit:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UNmYbueB3JR5WYock4Aaod
  ```

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/features/editor/TagAutocomplete.ts` | The whole feature: the match function, the ranking function, the ProseMirror plugin, the popover DOM, the keymap. Mirrors `LinkAutocomplete.ts`'s shape. |
| `src/features/editor/tagAutocomplete.test.ts` | Unit tests for all of the above. |

**Modified:**

| File | Change |
| --- | --- |
| `src/features/notes/useAutosave.ts` | Adds `defer` / `maxDeferMs`; only the debounced write defers. |
| `src/features/notes/useAutosave.test.ts` | Tests for the hold and its cap. |
| `src/features/notes/NoteEditor.tsx` | Supplies the `defer` predicate; drills `tagKeys`. |
| `src/features/editor/TagPill.ts` | Exports `tagHitsIn`; drops the modifier gate and the `isMacOS` import. |
| `src/features/editor/tagPill.test.ts` | Plain-click tests; the two platform-branch tests are deleted. |
| `src/features/editor/index.ts` | Re-exports `tagRangeAt` so `NoteEditor` can reach it. |
| `src/features/editor/extensions.ts` | Registers `TagAutocomplete` and widens the options type. |
| `src/features/editor/RichEditor.tsx` | Passes labels and the key list; single-key tag hint. |
| `src/app/AppShell.tsx` | Flattens the tag tree to keys; phone navigation in `handleActivateTag`. |
| `src/app/AppShell.test.tsx` | Phone-navigation test. |
| `src/styles/editor.css` | Popover rules gain the tag selectors; pill hover becomes unconditional. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | One new key; two collapse into one. |
| `e2e/tags.spec.ts` | Autocomplete and plain-click e2e. |
| `e2e/phoneEditor.spec.ts` | Tap-to-filter e2e. |
| `docs/rulings/*.md`, `CLAUDE.md`, `docs/superpowers/NEXT.md` | Task 5. |

---

## Task 1: The autosave hold (absorbed sub-project S2)

**Why this is first:** Task 3's descend-and-stay-open flow parks the caret at the end of `#a/b` while the user reads the next level, and `AUTOSAVE_DELAY_MS` is 300. Without this hold, every such pause writes `a/b` to the index, where it appears in the sidebar and in every future suggestion list, removable only through S1's delete.

**Files:**
- Modify: `src/features/notes/useAutosave.ts`
- Modify: `src/features/notes/NoteEditor.tsx:299-307` (the `useAutosave` call)
- Modify: `src/features/editor/index.ts`
- Test: `src/features/notes/useAutosave.test.ts`

**Interfaces:**
- Consumes: `tagRangeAt(state: EditorState, pos: number): TagHit | null` — already exported from `src/features/editor/TagPill.ts`. `RichEditorHandle` already exposes `editor: Editor | null`, so no handle change is needed.
- Produces: `AUTOSAVE_MAX_DEFER_MS = 4000`, and two new optional `AutosaveOptions` fields, `defer?: () => boolean` and `maxDeferMs?: number`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/useAutosave.test.ts`. The existing file already calls `vi.useFakeTimers()` in a `beforeEach` and drives the hook with `renderHook` + `act`; follow that shape exactly.

```ts
describe('the debounced-write hold', () => {
  it('holds the debounced write while defer() returns true', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let held = true;
    const { result } = renderHook(() =>
      useAutosave({ initial: '', read: () => 'typed', save, defer: () => held }),
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3));
    expect(save).not.toHaveBeenCalled();

    held = false;
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(save).toHaveBeenCalledWith('typed');
  });

  it('writes through the hold on an explicit flush', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({ initial: '', read: () => 'typed', save, defer: () => true }),
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(save).not.toHaveBeenCalled();

    // Blur, visibilitychange, beforeunload and the unmount flush-on-switch
    // all arrive through `flush`. Deferring those would risk real data loss
    // for a cosmetic index benefit.
    act(() => result.current.flush());
    expect(save).toHaveBeenCalledWith('typed');
  });

  it('writes anyway once the cap has elapsed', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useAutosave({ initial: '', read: () => 'typed', save, defer: () => true }),
    );

    act(() => result.current.schedule());
    act(() => void vi.advanceTimersByTime(AUTOSAVE_MAX_DEFER_MS - AUTOSAVE_DELAY_MS));
    expect(save).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS * 2));
    expect(save).toHaveBeenCalledTimes(1);
  });

  /**
   * The cap runs from the FIRST deferral, never from the latest re-arm.
   * Resetting it per re-arm would let a user typing slowly inside a long tag
   * defer forever, which is the failure the cap exists to prevent — and an
   * implementation that resets it passes the test above, because that test
   * never re-arms after the cap is reached.
   */
  it('measures the cap from the first deferral, not from each re-arm', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let text = 'a';
    const { result } = renderHook(() =>
      useAutosave({ initial: '', read: () => text, save, defer: () => true }),
    );

    // Re-schedule repeatedly, as typing does, straight through the cap.
    for (let elapsed = 0; elapsed < AUTOSAVE_MAX_DEFER_MS; elapsed += AUTOSAVE_DELAY_MS) {
      text = `${text}a`;
      act(() => result.current.schedule());
      act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    }

    act(() => void vi.advanceTimersByTime(AUTOSAVE_DELAY_MS));
    expect(save).toHaveBeenCalled();
  });
});
```

Add `AUTOSAVE_MAX_DEFER_MS` to the file's existing import from `./useAutosave`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/notes/useAutosave.test.ts`
Expected: FAIL. The first three fail because `defer` is not a recognised option, so the write happens at `AUTOSAVE_DELAY_MS` regardless; `AUTOSAVE_MAX_DEFER_MS` is also not exported, which is a TypeScript error inside the test.

- [ ] **Step 3: Add the option and the hold**

In `src/features/notes/useAutosave.ts`, beside the existing `AUTOSAVE_DELAY_MS`:

```ts
/**
 * How long the debounced write may be held before it happens anyway.
 *
 * Measured from the FIRST deferral of the current hold, never reset by a
 * re-arm: a user typing slowly inside a long tag would otherwise defer
 * indefinitely, and losing work is never the trade this hold is willing to
 * make.
 */
export const AUTOSAVE_MAX_DEFER_MS = 4000;
```

Add to `AutosaveOptions`:

```ts
  /**
   * Consulted when the DEBOUNCED timer fires. Returning `true` re-arms the
   * timer instead of writing, up to `maxDeferMs` from the first deferral.
   *
   * Never consulted by `flush()` — blur, `visibilitychange`, `beforeunload`
   * and the unmount flush-on-switch all write through a hold.
   */
  defer?: () => boolean;
  maxDeferMs?: number;
```

Destructure both in the hook's parameter list, defaulting `maxDeferMs = AUTOSAVE_MAX_DEFER_MS`.

Add the ref beside the other option refs, and register it in the existing `useEffect` that refreshes them:

```ts
  const deferRef = useRef(defer);
```

```ts
  useEffect(() => {
    readRef.current = read;
    saveRef.current = save;
    discardRef.current = discard;
    isEmptyRef.current = isEmpty;
    deferRef.current = defer;
  });
```

Add the hold's clock, beside `timerRef`:

```ts
  // When the current hold began, or `null` when nothing is being held. The
  // cap is measured from here rather than from the latest re-arm.
  const deferSinceRef = useRef<number | null>(null);
```

In `flush`, immediately after `cancelTimer()`, end any hold — an explicit flush is the end of the hold by definition:

```ts
    deferSinceRef.current = null;
```

Replace `schedule` with:

```ts
  const schedule = useCallback(() => {
    // `arm` is a local function declaration rather than a `useCallback`
    // because it re-arms ITSELF while the hold is on, and a `useCallback`
    // cannot reference its own binding.
    const arm = (): void => {
      cancelTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;

        if (deferRef.current?.() === true) {
          const since = deferSinceRef.current ?? Date.now();
          deferSinceRef.current = since;
          if (Date.now() - since < maxDeferMs) {
            arm();
            return;
          }
        }

        deferSinceRef.current = null;
        flush();
      }, delayMs);
    };

    arm();
  }, [cancelTimer, delayMs, flush, maxDeferMs]);
```

Note that `cancelTimer` inside `arm` is the existing debounce on the first call and a no-op on a re-arm, where `timerRef.current` is already `null`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/notes/useAutosave.test.ts`
Expected: PASS, including the pre-existing tests — the default `defer` is `undefined`, so `deferRef.current?.()` is `undefined` and every existing path is unchanged.

- [ ] **Step 5: Prove the cap test is not vacuous**

Temporarily change `const since = deferSinceRef.current ?? Date.now();` to `const since = Date.now();` — the reset-per-re-arm bug the fourth test exists to catch.

Run: `npx vitest run src/features/notes/useAutosave.test.ts`
Expected: FAIL on "measures the cap from the first deferral, not from each re-arm", and PASS on "writes anyway once the cap has elapsed" (which is why the fourth test is needed at all).

Revert the injection. Re-run: all four PASS.

- [ ] **Step 6: Wire the predicate in NoteEditor**

Add `tagRangeAt` to the editor barrel, `src/features/editor/index.ts`:

```ts
export { tagRangeAt } from './TagPill';
export type { TagHit } from './TagPill';
```

Add `tagRangeAt` to `NoteEditor.tsx`'s existing `@/features/editor` import block, then extend the `useAutosave` call at `:299`:

```ts
  const { schedule, flush, seed, failed } = useAutosave({
    initial: initialMarkdown,
    read,
    save,
    discard,
    isEmpty: (text) =>
      text === EMPTY_DOCUMENT_MARKDOWN ||
      (normalizedSeedText !== undefined && text === normalizedSeedText),
    // Holds the DEBOUNCED write while the caret sits inside a tag, so
    // descending `#a` -> `#a/b` -> `#a/b/c` through the autocomplete does not
    // persist `a` and `a/b` as real tags on the way. Every explicit flush —
    // blur included — writes through this, so leaving the tag commits it.
    //
    // `tagRangeAt` hit-tests the GRAMMAR rather than the decoration set,
    // which is what makes it correct here: a tag the caret sits inside has no
    // pill at all, and that is exactly the state being detected.
    defer: () => {
      const editor = handleRef.current?.editor ?? null;
      if (editor === null) return false;
      const { state } = editor;
      return tagRangeAt(state, state.selection.from) !== null;
    },
  });
```

- [ ] **Step 7: Run the cheap gates and the affected files**

Run: `npm run typecheck && npm run lint && npm run format`
Run: `npx vitest run src/features/notes/ src/features/editor/`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
python3 -c "
for p in ['src/features/notes/useAutosave.ts','src/features/notes/useAutosave.test.ts','src/features/notes/NoteEditor.tsx','src/features/editor/index.ts']:
    d=open(p).read(); print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
git add src/features/notes/useAutosave.ts src/features/notes/useAutosave.test.ts \
  src/features/notes/NoteEditor.tsx src/features/editor/index.ts
git commit -m "feat(autosave): hold the debounced write while the caret is inside a tag

Absorbed sub-project S2. Descending a tag hierarchy through the coming
autocomplete parks the caret inside a half-typed tag, and a 300ms debounce
would persist every intermediate level as a real tag. Only the DEBOUNCED
write defers; blur, visibilitychange, beforeunload and the unmount
flush-on-switch all write through, and a 4s cap measured from the first
deferral bounds the hold.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UNmYbueB3JR5WYock4Aaod"
```

---

## Task 2: The match and the ranking (pure functions)

**Files:**
- Create: `src/features/editor/TagAutocomplete.ts`
- Create: `src/features/editor/tagAutocomplete.test.ts`

**Interfaces:**
- Consumes: `maskedBlockText(node: Node): string` and `MASK` from `./blockText`; `normalizeTag(raw: string): string | null` from `@/data`; `buildEditorExtensions` and `parseMarkdown` in the test.
- Produces, for Task 3:
  - `MAX_RESULTS = 8`
  - `interface TagAutocompleteMatch { from: number; to: number; query: string }`
  - `tagAutocompleteMatchAt(state: EditorState): TagAutocompleteMatch | null`
  - `matchingTags(keys: readonly string[], query: string): string[]`

- [ ] **Step 1: Write the failing tests**

Create `src/features/editor/tagAutocomplete.test.ts`:

```ts
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { buildEditorExtensions } from './extensions';
import { parseMarkdown } from './markdown';
import { matchingTags, tagAutocompleteMatchAt } from './TagAutocomplete';

const KEYS = ['a', 'a/b', 'a/c', 'bear', 'bear/welcome', 'work', 'assets/sap'];

function editorWith(markdown: string): Editor {
  return new Editor({
    extensions: buildEditorExtensions(),
    content: parseMarkdown(markdown),
  });
}

/** The caret one character before the document's end, i.e. at the end of the
 * text — `doc.content.size` itself is past the closing token of the block. */
function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

describe('tagAutocompleteMatchAt', () => {
  it('finds the tag being typed before the caret', () => {
    const editor = editorWith('see #wo');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)?.query).toBe('wo');
    editor.destroy();
  });

  it('is null with no # before the caret', () => {
    const editor = editorWith('just text');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null on a bare # with nothing typed after it', () => {
    // Keeps the popover out of the way of the `# ` heading input rule, and
    // stops an eight-row list flashing whenever someone starts a heading.
    const editor = editorWith('see #');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null with the caret mid-tag, where no boundary follows', () => {
    // `#wo|rk` — accepting here would replace `#wo` and strand `rk`.
    const editor = editorWith('see #work');
    editor.commands.setTextSelection(editor.state.doc.content.size - 3);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('accepts the caret at the tag end when whitespace follows', () => {
    const editor = editorWith('see #wo more');
    editor.commands.setTextSelection(editor.state.doc.content.size - 6);
    expect(tagAutocompleteMatchAt(editor.state)?.query).toBe('wo');
    editor.destroy();
  });

  it('is null once a space has been typed inside the query', () => {
    // The multi-word form `#a b#` is out of scope BY CONSTRUCTION: whitespace
    // is a boundary, so the popover closes the moment a space arrives.
    const editor = editorWith('see #a b');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null inside inline code', () => {
    // `maskedBlockText` replaces a code span's characters with MASK, so a
    // literal `#work` typed inside backticks cannot open the list.
    const editor = editorWith('see `#wo`');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null when the # does not start a tag', () => {
    // `canStart` in the real parser: a tag begins at the block start or after
    // whitespace, never mid-word.
    const editor = editorWith('see a#wo');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null when the query cannot normalize to a tag', () => {
    const editor = editorWith('see #.');
    caretAtEnd(editor);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('is null in a code block', () => {
    const editor = editorWith('```\n#wo\n```');
    editor.commands.setTextSelection(5);
    expect(tagAutocompleteMatchAt(editor.state)).toBeNull();
    editor.destroy();
  });

  it('reports positions spanning the # through the caret', () => {
    const editor = editorWith('see #wo');
    caretAtEnd(editor);
    const match = tagAutocompleteMatchAt(editor.state);
    // 'see ' is 4 characters, and a paragraph's first text position is 1.
    expect(match?.from).toBe(5);
    expect(match?.to).toBe(8);
    editor.destroy();
  });
});

describe('matchingTags', () => {
  it('puts the typed text first, always', () => {
    // Substring matching means the highest-ranked EXISTING tag is routinely
    // unrelated to what is being typed (`#a` matches `bear`), so accepting
    // row 0 must be the safe default rather than a rewrite.
    expect(matchingTags(KEYS, 'a')[0]).toBe('a');
    expect(matchingTags(KEYS, 'zzz')).toEqual(['zzz']);
  });

  it('offers descendants of the tag just accepted', () => {
    expect(matchingTags(KEYS, 'a/')).toEqual(['a/', 'a/b', 'a/c']);
  });

  it('ranks prefix matches before substring matches', () => {
    expect(matchingTags(KEYS, 'a')).toEqual([
      'a',
      'a/b',
      'a/c',
      'assets/sap',
      'bear',
      'bear/welcome',
    ]);
  });

  it('dedupes an exact existing tag into row 0', () => {
    const rows = matchingTags(KEYS, 'work');
    expect(rows).toEqual(['work']);
    expect(rows.filter((row) => row === 'work')).toHaveLength(1);
  });

  it('matches case-insensitively while keeping the typed text in row 0', () => {
    // Row 0 stands for the tag the text will produce: `#Work` indexes as
    // `work`, so the existing `work` dedupes into it.
    expect(matchingTags(KEYS, 'Work')).toEqual(['Work']);
    expect(matchingTags(KEYS, 'BEA')).toEqual(['BEA', 'bear', 'bear/welcome']);
  });

  it('caps the list at MAX_RESULTS', () => {
    const many = Array.from({ length: 40 }, (_, i) => `t/${i}`);
    expect(matchingTags(many, 't')).toHaveLength(8);
  });

  it('returns only the query when it cannot normalize', () => {
    expect(matchingTags(KEYS, '.')).toEqual(['.']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: FAIL — `Cannot find module './TagAutocomplete'`.

- [ ] **Step 3: Write the two functions**

Create `src/features/editor/TagAutocomplete.ts`:

```ts
import type { EditorState } from '@tiptap/pm/state';

import { normalizeTag } from '@/data';

import { MASK, maskedBlockText } from './blockText';

/** No result list is ever longer than this. Prefix and substring matching
 * only, deliberately — the same ruling `LinkAutocomplete`'s `matchingTitles`
 * rests on: a fuzzy ranker is a tuning problem with no end. */
export const MAX_RESULTS = 8;

export interface TagAutocompleteMatch {
  /** Document position of the opening `#`. */
  from: number;
  /** Document position of the caret, one past the last typed character. */
  to: number;
  /** The typed tag text, without the leading `#`. */
  query: string;
}

/** Whitespace, a masked character, or the edge of the block — the same
 * boundary set `parseTags`' own `isBoundary` uses. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === MASK || /\s/.test(ch);
}

/**
 * The live, unclosed tag immediately before the caret, or `null`.
 *
 * Walks the same shape of guard as `linkAutocompleteMatchAt`, and reuses
 * `maskedBlockText` for the same two reasons: masking turns an inline-code
 * span's characters into `MASK`, so a literal `#work` inside backticks cannot
 * open this list, and the one-character-per-position invariant keeps
 * `parentOffset` a valid index into the masked string with no separate offset
 * arithmetic for non-text children.
 *
 * The rule that differs from the link grammar is the REQUIRED BOUNDARY AFTER
 * THE CARET, and it does three jobs at once. It refuses `#wo|rk`, where
 * accepting a suggestion would replace `#wo` and strand `rk`. It excludes the
 * multi-word form `#a b#` by construction rather than by a guard, because
 * whitespace is a boundary. And it leaves the repair path intact, because
 * deleting-to-the-end is how a mistyped tag is fixed.
 */
export function tagAutocompleteMatchAt(state: EditorState): TagAutocompleteMatch | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  // The same two-fold guard `tagRangeAt` documents: rejects everywhere this
  // grammar cannot apply, and keeps `before()` below from throwing at depth 0,
  // where the parent is the document itself.
  if (!$from.parent.isTextblock || $from.parent.type.spec.code) return null;

  const text = maskedBlockText($from.parent);
  const before = text.slice(0, $from.parentOffset);
  const openAt = before.lastIndexOf('#');
  if (openAt === -1) return null;

  // `canStart` in the real parser: a tag begins at the block start or after
  // whitespace, never mid-word and never after a mask.
  const preceding = openAt === 0 ? undefined : before[openAt - 1];
  if (preceding !== undefined && !/\s/.test(preceding)) return null;

  const query = before.slice(openAt + 1);
  // At least one character, which keeps this out of the way of the `# `
  // heading input rule. A second `#` would be the multi-word form's closer,
  // which this control does not offer.
  if (query === '' || query.includes(MASK) || query.includes('#')) return null;
  if (/\s/.test(query)) return null;

  // The caret must sit at the tag's END. See the docblock above.
  if (!isBoundary(text[$from.parentOffset])) return null;

  // Not a tag at all (`#.`, `#!/bin/sh`), so there is nothing to complete.
  if (normalizeTag(query) === null) return null;

  const blockStart = $from.before() + 1;
  return { from: blockStart + openAt, to: blockStart + before.length, query };
}

/**
 * The rows to show for `query`: the typed text first, then existing tags.
 *
 * Row 0 is ALWAYS the query itself, and that is the load-bearing difference
 * from `matchingTitles`. Matching is substring-anywhere, so the
 * highest-ranked existing tag is routinely unrelated to what the user is
 * typing (`#a` matches `bear`); with existing tags ranked first, accepting
 * the default would silently rewrite `#a` to `#bear`. Row 0 stands for the
 * tag the text will produce, so an exact existing match dedupes INTO it
 * rather than appearing twice.
 *
 * `keys` are already normalized: `noteTags.tag` is written through
 * `normalizeTag`, and the synthesized ancestors Task 3 adds are built by
 * splitting an already-normalized key.
 *
 * A query ending in `/` narrows to that tag's subtree — see `prefix` below.
 */
export function matchingTags(keys: readonly string[], query: string): string[] {
  const q = normalizeTag(query);
  if (q === null) return [query];

  // A TRAILING SLASH means "show me what is under this tag", so the string
  // matched against is the slash-terminated path rather than the normalized
  // key it trims to. `normalizeTag('a/')` is `'a'` — the parser strips
  // trailing slashes — so without this, `#a/` would behave exactly like `#a`
  // and offer `assets/sap` and `bear` again instead of `a/b` and `a/c`. This
  // is what makes descend-and-stay-open show descendants: accepting `a/b`
  // leaves the caret after it, and typing `/` then narrows to that subtree.
  const prefix = query.endsWith('/') ? `${q}/` : q;

  const startsWith: string[] = [];
  const contains: string[] = [];
  for (const key of keys) {
    // Deduped against row 0 on the NORMALIZED key, not on `prefix`: typing
    // `#work` must not list `work` twice, and typing `#a/` must not list the
    // parent `a` at all when what was asked for is its children.
    if (key === q) continue;
    if (key.startsWith(prefix)) startsWith.push(key);
    else if (key.includes(prefix)) contains.push(key);
  }
  startsWith.sort();
  contains.sort();

  return [query, ...startsWith, ...contains].slice(0, MAX_RESULTS);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: PASS, all nineteen.

If `reports positions spanning the # through the caret` fails on the exact numbers, print the real values with a temporary `console.log(match)` and correct the TEST's expectation — the position arithmetic under assertion is `blockStart + openAt`, and the literal 5/8 are this fixture's arithmetic, not a rule.

- [ ] **Step 5: Prove the boundary rule is load-bearing**

Temporarily delete the line `if (!isBoundary(text[$from.parentOffset])) return null;`.

Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: FAIL on both "is null with the caret mid-tag, where no boundary follows" and "is null once a space has been typed inside the query".

Revert. Re-run: PASS.

- [ ] **Step 6: Commit**

```bash
python3 -c "
for p in ['src/features/editor/TagAutocomplete.ts','src/features/editor/tagAutocomplete.test.ts']:
    d=open(p).read(); print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
npm run typecheck && npm run lint && npm run format
git add src/features/editor/TagAutocomplete.ts src/features/editor/tagAutocomplete.test.ts
git commit -m "feat(tags): the tag autocomplete grammar and ranking

The caret must sit at the tag's end with a boundary after it, which refuses
'#wo|rk' (where accepting would strand 'rk') and excludes the multi-word
form by construction rather than by a guard.

Row 0 is always the typed text. Matching is substring-anywhere, so the
top-ranked existing tag is routinely unrelated to what is being typed — with
existing tags first, accepting the default would rewrite '#a' to '#bear'.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UNmYbueB3JR5WYock4Aaod"
```

---

## Task 3: The plugin, the popover, and the wiring

**Files:**
- Modify: `src/features/editor/TagAutocomplete.ts`
- Modify: `src/features/editor/TagPill.ts` (export `tagHitsIn`)
- Modify: `src/features/editor/extensions.ts:26-44,147-149,228-232`
- Modify: `src/features/editor/RichEditor.tsx:258-300` (options) and `:470-486` (the push effect)
- Modify: `src/features/notes/NoteEditor.tsx` (drill `tagKeys`)
- Modify: `src/app/AppShell.tsx` (flatten the tree to keys)
- Modify: `src/styles/editor.css:1456-1519`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Test: `src/features/editor/tagAutocomplete.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produced; `tagHitsIn(node: Node, blockPos: number): TagHit[]` from `./TagPill`; `skipTrailingNodeMeta` from `@tiptap/extensions`; `renderIconMarkup` from `@/ui/Icon`.
- Produces:
  - `TagAutocompleteOptions { tagAutocompleteLabels: { listLabel: string } | null }`
  - `tagAutocompleteKey: PluginKey<TagAutocompleteState>`
  - The `TagAutocomplete` extension
  - Command `setTagAutocompleteKeys(keys: string[]) => ReturnType`
  - Prop `tagKeys?: string[]` on `RichEditorProps` and `NoteEditorProps`

- [ ] **Step 1: Export `tagHitsIn`**

In `src/features/editor/TagPill.ts`, change `function tagHitsIn(` to `export function tagHitsIn(` and extend its docblock:

```ts
/**
 * Every tag in a textblock, as document positions.
 *
 * The single place the offset arithmetic lives: `maskedBlockText` emits one
 * character per document position, so the character at index `i` inside a
 * block starting at `blockPos` sits at `blockPos + 1 + i`.
 *
 * Three consumers share it — `tagRangeAt`, `tagDecorations`, and
 * `TagAutocomplete`'s live-document key union. That sharing is the point:
 * activation, the pills and the suggestion list must agree about where a tag
 * is, and a second implementation of this arithmetic is how they would stop
 * agreeing.
 */
```

- [ ] **Step 2: Write the failing plugin tests**

Append to `src/features/editor/tagAutocomplete.test.ts`. Extend the imports:

```ts
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { TextSelection } from '@tiptap/pm/state';

import { tagAutocompleteKey } from './TagAutocomplete';
```

Add the harness, mirroring `linkAutocomplete.test.ts`'s:

```ts
const LABELS = { listLabel: 'Tag' };

function pluginEditorWith(
  markdown: string,
  tagAutocompleteLabels: typeof LABELS | null = LABELS,
  keys: string[] = KEYS,
): Editor {
  const editor = new Editor({
    extensions: buildEditorExtensions({ tagAutocompleteLabels }),
    content: parseMarkdown(markdown),
  });
  if (tagAutocompleteLabels !== null) editor.commands.setTagAutocompleteKeys(keys);
  return editor;
}

function popover(editor: Editor): HTMLElement | null {
  return editor.view.dom.querySelector('.bear-tag-autocomplete-popover');
}

function options(editor: Editor): string[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>('[role="option"]')].map(
    (el) => el.textContent ?? '',
  );
}

function activeOption(editor: Editor): string | null {
  return editor.view.dom.querySelector('[role="option"].is-active')?.textContent ?? null;
}

/** Invokes the plugin's own `handleKeyDown` against the REAL mounted view —
 * `linkAutocomplete.test.ts:47`'s approach, which needs no layout engine,
 * only the plugin actually being registered. */
function keydown(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true });
  return (
    editor.view.someProp('handleKeyDown', (f) => (f(editor.view, event) ? true : undefined)) === true
  );
}

/** Types at the caret through a real command, one character at a time, so
 * the match function is driven off the real document exactly as keystrokes
 * would drive it — and no click is simulated, so jsdom's missing
 * `posAtCoords` is never reached. */
function type(editor: Editor, text: string): void {
  for (const ch of text) editor.commands.insertContent(ch);
}

function markdownOf(editor: Editor): string {
  return editor.storage.markdown.getMarkdown();
}
```

Then the suites:

```ts
describe('the popover', () => {
  it('opens with the typed text first once a character follows the #', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(popover(editor)).not.toBeNull();
    expect(options(editor)[0]).toBe('a');
    expect(activeOption(editor)).toBe('a');
    editor.destroy();
  });

  it('registers no plugin at all without labels', () => {
    const editor = pluginEditorWith('see ', null);
    caretAtEnd(editor);
    type(editor, '#a');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  it('closes when a space commits the tag', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(popover(editor)).not.toBeNull();
    type(editor, ' ');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  it('offers tags present in the document but not yet in the index', () => {
    // The index is written by autosave, which Task 1 now HOLDS while the
    // caret is inside a tag — so a tag typed moments ago is not in `keys`,
    // and that is exactly when the user is most likely to type it again.
    const editor = pluginEditorWith('#project/alpha here\n\nsee ', LABELS, []);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, '#project/');
    expect(options(editor)).toContain('project/alpha');
    editor.destroy();
  });

  it('offers a synthesized ancestor of a document tag', () => {
    // `parseTags` indexes only the exact tag; `buildTagTree` is what
    // synthesizes `a` from `a/b`, so the union must do the same.
    const editor = pluginEditorWith('#deep/nested/leaf here\n\nsee ', LABELS, []);
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, '#deep/n');
    expect(options(editor)).toContain('deep/nested');
    editor.destroy();
  });
});

describe('the keyboard', () => {
  it('accepts an existing tag with Tab and leaves the popover open on its descendants', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(keydown(editor, 'ArrowDown')).toBe(true);
    expect(activeOption(editor)).toBe('a/b');
    expect(keydown(editor, 'Tab')).toBe(true);

    expect(markdownOf(editor)).toContain('#a/b');
    // Descend-and-stay-open: no trailing space is inserted, so the match rule
    // re-evaluates and the list reopens on what lives under the tag.
    expect(popover(editor)).not.toBeNull();
    expect(options(editor)[0]).toBe('a/b');
    editor.destroy();
  });

  it('commits the typed text and closes when Tab lands on row 0', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#new');
    expect(keydown(editor, 'Tab')).toBe(true);
    expect(markdownOf(editor)).toContain('#new');
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  /**
   * The assertion most likely to rot, and the reason `Tab` accepts rather
   * than `Enter`: with row 0 pre-selected there is nothing for `Enter` to
   * insert, so intercepting it would only swallow a keystroke that means
   * "new paragraph" everywhere else in the editor.
   */
  it('does NOT consume Enter or space', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(keydown(editor, 'Enter')).toBe(false);
    expect(keydown(editor, ' ')).toBe(false);
    editor.destroy();
  });

  it('dismisses on Escape and stays dismissed while the same tag is edited', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(keydown(editor, 'Escape')).toBe(true);
    expect(popover(editor)).toBeNull();
    editor.destroy();
  });

  it('reopens on the next document change after a dismissal', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    keydown(editor, 'Escape');
    type(editor, 'b');
    expect(popover(editor)).not.toBeNull();
    editor.destroy();
  });

  it('wraps the active row at both ends', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    const rows = options(editor);
    keydown(editor, 'ArrowUp');
    expect(activeOption(editor)).toBe(rows[rows.length - 1]);
    keydown(editor, 'ArrowDown');
    expect(activeOption(editor)).toBe(rows[0]);
    editor.destroy();
  });

  it('leaves Tab to the list keymap when the popover is closed', () => {
    // `@tiptap/extension-list-keymap` binds Tab to indent a list item. The
    // collision is resolved by the popover's open state alone.
    const editor = pluginEditorWith('- one\n- two');
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(keydown(editor, 'Tab')).toBe(false);
    editor.destroy();
  });

  it('consumes Tab for a tag typed inside a list item', () => {
    const editor = pluginEditorWith('- one');
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    type(editor, ' #a');
    expect(keydown(editor, 'Tab')).toBe(true);
    editor.destroy();
  });
});

describe('accessibility', () => {
  it('mirrors combobox state onto the focused editable host', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    const host = editor.view.dom;
    expect(host.getAttribute('role')).toBe('combobox');
    expect(host.getAttribute('aria-expanded')).toBe('true');
    expect(host.getAttribute('aria-controls')).not.toBeNull();
    const active = host.getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(editor.view.dom.querySelector(`#${active}`)?.textContent).toBe('a');
    editor.destroy();
  });

  it('restores the host role when the popover closes', () => {
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    type(editor, ' ');
    expect(editor.view.dom.getAttribute('aria-expanded')).toBeNull();
    editor.destroy();
  });
});

describe('the widget key', () => {
  it('rebuilds the list on every keystroke', () => {
    // `WidgetType.eq` matches two widgets sharing a `key` WITHOUT re-invoking
    // `toDOM`, so a key that stayed constant while the same tag is typed
    // would leave a STALE list on screen. The query and the active index are
    // baked into the key for exactly this reason.
    const editor = pluginEditorWith('see ');
    caretAtEnd(editor);
    type(editor, '#a');
    expect(options(editor)).toContain('bear');
    type(editor, '/');
    expect(options(editor)).not.toContain('bear');
    expect(options(editor)).toContain('a/b');
    editor.destroy();
  });
});

describe('the trailing-node hazard', () => {
  /**
   * `TrailingNode.appendTransaction` runs on EVERY dispatched transaction,
   * not only ones that changed the document, so a meta-only dispatch inserts
   * a spurious trailing paragraph into a note ending in a list — which
   * autosave then persists.
   *
   * The vulnerability flag is computed once at plugin `init` and burned
   * permanently by the FIRST untagged transaction dispatched afterwards,
   * INCLUDING one a test uses only to set up its own fixture. So this fixture
   * reaches the dispatch under test using only TAGGED transactions from the
   * very first one; L2's first version of this test typed its setup and
   * passed with the fix removed.
   */
  function quietlySelect(editor: Editor, pos: number): void {
    const tr = editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, pos))
      .setMeta(skipTrailingNodeMeta, true);
    editor.view.dispatch(tr);
  }

  it('does not append a paragraph when the key list is pushed', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ tagAutocompleteLabels: LABELS }),
      content: parseMarkdown('- one\n- two'),
    });
    const before = markdownOf(editor);

    editor.commands.setTagAutocompleteKeys(KEYS);

    expect(markdownOf(editor)).toBe(before);
    editor.destroy();
  });

  it('does not append a paragraph when the active row moves', () => {
    const editor = new Editor({
      extensions: buildEditorExtensions({ tagAutocompleteLabels: LABELS }),
      content: parseMarkdown('#a here\n\n- one\n- two'),
    });
    editor.commands.setTagAutocompleteKeys(KEYS);
    quietlySelect(editor, 3);
    const before = markdownOf(editor);

    keydown(editor, 'ArrowDown');
    keydown(editor, 'Escape');

    expect(markdownOf(editor)).toBe(before);
    editor.destroy();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: FAIL — `tagAutocompleteLabels` is not a recognised option and `setTagAutocompleteKeys` does not exist, so these are TypeScript errors surfaced as failures. Task 2's suites still pass.

- [ ] **Step 4: Add the i18n key**

`src/i18n/en.ts`, beside the existing `editor.linkAutocomplete.*` keys:

```ts
  'editor.tagAutocomplete.listLabel': 'Tag',
```

`src/i18n/ko.ts`, in the same position:

```ts
  'editor.tagAutocomplete.listLabel': '태그',
```

There is deliberately no `empty` key: row 0 is always the typed text, so the list can never be empty.

- [ ] **Step 5: Build the plugin**

Append to `src/features/editor/TagAutocomplete.ts`. Extend its imports:

```ts
import { Extension } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { renderIconMarkup } from '@/ui/Icon';

import { tagHitsIn } from './TagPill';
```

Then:

```ts
export interface TagAutocompleteOptions {
  /**
   * `null` when nobody supplied them — the state of the schema-only
   * `editorExtensions` constant — and in that state NO PLUGIN is registered
   * at all, the same contract `LinkAutocompleteOptions.linkAutocompleteLabels`
   * and `TableHandlesOptions.labels` carry. A control with blank text would
   * be worse than no control.
   *
   * There is no `empty` label, unlike the link popover's: row 0 is always the
   * typed text, so an empty list is unreachable.
   */
  tagAutocompleteLabels: { listLabel: string } | null;
}

export const tagAutocompleteKey = new PluginKey<TagAutocompleteState>('tagAutocomplete');

interface TagAutocompleteState {
  /** Normalized tag keys from the tag index, pushed by `RichEditor`. */
  indexed: readonly string[];
  /**
   * Tags found in the OPEN DOCUMENT, plus their synthesized ancestors.
   *
   * Cached rather than recomputed per keystroke, and keyed on the `from` of
   * the tag being typed: a full-document tag parse is O(doc), and the
   * document's tag set does not meaningfully change while one tag is being
   * typed. `parseTags` has a measured quadratic history here (a 900 KB line
   * of `'#a '` took 2.1s before it was fixed), so a per-keystroke whole-note
   * parse is not a cost to take casually.
   */
  docKeys: readonly string[];
  docKeysFrom: number | null;
  /** The keyboard-highlighted row, before clamping to the row count. */
  activeIndex: number;
  /**
   * The `from` of the match most recently dismissed, or `null`. Compared
   * against the CURRENT match's `from` — the position of the `#`, which stays
   * fixed while the same tag is typed — so the list stays closed while that
   * tag is edited and reopens the moment the document changes.
   */
  dismissedFrom: number | null;
}

type Meta =
  | { type: 'keys'; keys: readonly string[] }
  | { type: 'move'; direction: 'next' | 'prev' | 'first' | 'last' }
  | { type: 'dismiss'; from: number };

/**
 * Every tag in the document, plus every ancestor of each.
 *
 * The ancestors matter: `parseTags` writes one `noteTags` row per exact tag,
 * so `a` exists only as a node `buildTagTree` synthesizes from `a/b`. A
 * suggestion list built from exact tags alone could never offer `#a`.
 */
function documentTagKeys(state: EditorState): string[] {
  const keys = new Set<string>();
  state.doc.descendants((node: Node, pos: number) => {
    // `spec.code` first: a code block IS a textblock, so the combined guard
    // would descend into its text for nothing.
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;
    for (const hit of tagHitsIn(node, pos)) {
      const segments = hit.tag.split('/');
      for (let i = 1; i <= segments.length; i += 1) keys.add(segments.slice(0, i).join('/'));
    }
    // A textblock has no textblock children, so there is nothing below to
    // descend into.
    return false;
  });
  return [...keys];
}

function allKeys(value: TagAutocompleteState): string[] {
  return [...new Set([...value.indexed, ...value.docKeys])];
}

function widgetKey(match: TagAutocompleteMatch, activeIndex: number): string {
  // The volatile parts of the popover's content are baked INTO the key rather
  // than left in a closure: `WidgetType.eq` matches two widgets sharing a
  // `key` WITHOUT re-invoking `toDOM`, so a key constant across keystrokes
  // would leave a stale list on screen. `HeadingFold`'s drop indicator keys
  // on `dropAt` for the same reason.
  return `tag-autocomplete-${match.from}-${match.query}-${activeIndex}`;
}

/** Stable across keystrokes typing the same tag, unlike `widgetKey`: these
 * are read back by the `view()` lifecycle to point `aria-activedescendant` at
 * a real element, which must not change out from under a screen reader
 * mid-selection the way the widget's rebuild-every-keystroke key deliberately
 * does. */
function listboxId(from: number): string {
  return `bear-tag-autocomplete-listbox-${from}`;
}

function optionId(from: number, index: number): string {
  return `bear-tag-autocomplete-option-${from}-${index}`;
}

function renderPopover(
  labels: NonNullable<TagAutocompleteOptions['tagAutocompleteLabels']>,
  matches: readonly string[],
  activeIndex: number,
  from: number,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'bear-tag-autocomplete';
  container.contentEditable = 'false';

  const popover = document.createElement('div');
  popover.className = 'bear-tag-autocomplete-popover';
  popover.contentEditable = 'false';

  const list = document.createElement('ul');
  list.id = listboxId(from);
  list.className = 'bear-tag-autocomplete-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', labels.listLabel);
  list.tabIndex = -1;

  matches.forEach((key, index) => {
    const item = document.createElement('li');
    item.id = optionId(from, index);
    item.setAttribute('role', 'option');
    item.setAttribute('data-tag-autocomplete-option', String(index));
    item.setAttribute('aria-selected', String(index === activeIndex));
    item.classList.toggle('is-active', index === activeIndex);

    const icon = document.createElement('span');
    icon.className = 'bear-tag-autocomplete-icon';
    icon.setAttribute('aria-hidden', 'true');
    // A ProseMirror widget cannot render React, which is why this goes
    // through `renderIconMarkup` rather than through `Icon`.
    icon.innerHTML = renderIconMarkup('Hash');
    item.append(icon);

    const text = document.createElement('span');
    text.textContent = key;
    item.append(text);

    list.appendChild(item);
  });

  popover.append(list);
  container.append(popover);
  return container;
}

/**
 * Replaces the typed tag with `#<key>` and leaves the caret at its end,
 * WITHOUT a trailing space — so `tagAutocompleteMatchAt` immediately matches
 * again and the popover reopens on that tag's descendants. Tab descends
 * another level; a space commits and closes at any depth.
 */
function insertTag(view: EditorView, match: TagAutocompleteMatch, key: string): void {
  const text = `#${key}`;
  const tr = view.state.tr.insertText(text, match.from, match.to);
  // Set explicitly rather than relying on selection mapping, because the
  // reopened popover's position depends on exactly where this lands.
  tr.setSelection(TextSelection.create(tr.doc, match.from + text.length));
  view.dispatch(tr);
  view.focus();
}

/** Accepting row 0 changes no text — it means "keep what I typed" — so all it
 * does is close the list, and remember that it closed, so it does not
 * immediately reopen on the tag the user just settled on. */
function commitTypedText(view: EditorView, match: TagAutocompleteMatch): void {
  view.dispatch(
    view.state.tr
      .setMeta(tagAutocompleteKey, { type: 'dismiss', from: match.from })
      .setMeta(skipTrailingNodeMeta, true),
  );
}

function clampedActiveIndex(activeIndex: number, matchCount: number): number {
  if (matchCount === 0) return -1;
  return Math.max(0, Math.min(activeIndex, matchCount - 1));
}

/** The open popover's rows, or `null` when it is not open. The one place the
 * three "is it open" conditions live, so `decorations`, `handleKeyDown`,
 * `mousedown` and the aria mirror cannot drift apart. */
function openRows(
  state: EditorState,
): { match: TagAutocompleteMatch; rows: string[]; activeIndex: number } | null {
  const match = tagAutocompleteMatchAt(state);
  if (match === null) return null;

  const pluginState = tagAutocompleteKey.getState(state);
  if (pluginState === undefined) return null;
  if (pluginState.dismissedFrom === match.from) return null;

  const rows = matchingTags(allKeys(pluginState), match.query);
  return { match, rows, activeIndex: clampedActiveIndex(pluginState.activeIndex, rows.length) };
}

/**
 * Offers every matching tag while the user types one, so a tag never has to
 * be remembered exactly or spelled twice.
 *
 * A sibling of `LinkAutocomplete` rather than a refactor of it: the two now
 * differ in three of their four behaviours — the always-present literal row,
 * `Tab` rather than `Enter`, and descend-and-stay-open — so a shared core
 * would be mostly injected difference, and L2's rulings are attached to that
 * file's exact lines.
 *
 * An `Extension`, not a `Node`: it registers nothing in the schema and
 * mutates no document merely by existing.
 */
export const TagAutocomplete = Extension.create<TagAutocompleteOptions>({
  name: 'tagAutocomplete',

  addOptions() {
    return { tagAutocompleteLabels: null };
  },

  addCommands() {
    return {
      setTagAutocompleteKeys:
        (keys: string[]) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            // `skipTrailingNodeMeta` is load-bearing: this is a meta-only
            // transaction and `TrailingNode.appendTransaction` is not gated
            // on `docChanged`, so without it this inserts and autosaves a
            // spurious trailing paragraph into any note ending in a list, the
            // instant this command fires on mount.
            dispatch(
              tr
                .setMeta(tagAutocompleteKey, { type: 'keys', keys })
                .setMeta(skipTrailingNodeMeta, true),
            );
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { tagAutocompleteLabels } = this.options;
    if (tagAutocompleteLabels === null) return [];
    const labels = tagAutocompleteLabels;

    return [
      new Plugin<TagAutocompleteState>({
        key: tagAutocompleteKey,

        state: {
          init: () => ({
            indexed: [],
            docKeys: [],
            docKeysFrom: null,
            activeIndex: 0,
            dismissedFrom: null,
          }),

          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(tagAutocompleteKey) as Meta | undefined;

            if (meta?.type === 'keys') return { ...value, indexed: meta.keys };
            if (meta?.type === 'dismiss') return { ...value, dismissedFrom: meta.from };

            if (meta?.type === 'move') {
              const match = tagAutocompleteMatchAt(newState);
              const rows = match === null ? [] : matchingTags(allKeys(value), match.query);
              if (rows.length === 0) return value;
              const count = rows.length;
              let next: number;
              switch (meta.direction) {
                case 'next':
                  next = (value.activeIndex + 1) % count;
                  break;
                case 'prev':
                  next = (value.activeIndex - 1 + count) % count;
                  break;
                case 'first':
                  next = 0;
                  break;
                case 'last':
                  next = count - 1;
                  break;
              }
              return { ...value, activeIndex: next };
            }

            let next = value;

            // Refresh the document's tag keys when a DIFFERENT tag starts
            // being typed, never on every keystroke within one — see
            // `docKeys`' own docblock for the cost this avoids.
            const match = tagAutocompleteMatchAt(newState);
            if (match !== null && match.from !== value.docKeysFrom) {
              next = { ...next, docKeys: documentTagKeys(newState), docKeysFrom: match.from };
            } else if (match === null && value.docKeysFrom !== null) {
              next = { ...next, docKeysFrom: null };
            }

            // A fresh keystroke lands on row 0 — the typed text — never on a
            // stale index left over from before the list narrowed, and any
            // dismissal is forgotten so continuing to type reopens the list.
            if (tr.docChanged) next = { ...next, activeIndex: 0, dismissedFrom: null };

            return next;
          },
        },

        props: {
          decorations(state) {
            const open = openRows(state);
            if (open === null) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.widget(
                open.match.to,
                () => renderPopover(labels, open.rows, open.activeIndex, open.match.from),
                { side: 1, ignoreSelection: true, key: widgetKey(open.match, open.activeIndex) },
              ),
            ]);
          },

          handleKeyDown(view, event) {
            const open = openRows(view.state);
            // Everything falls through when the popover is closed, which is
            // the whole of the `Tab` collision's resolution:
            // `@tiptap/extension-list-keymap` never stops seeing `Tab`
            // except while this list is open.
            if (open === null) return false;

            switch (event.key) {
              case 'Escape':
                commitTypedText(view, open.match);
                return true;

              case 'ArrowDown':
              case 'ArrowUp':
              case 'Home':
              case 'End': {
                if (open.rows.length === 0) return false;
                const direction =
                  event.key === 'ArrowDown'
                    ? 'next'
                    : event.key === 'ArrowUp'
                      ? 'prev'
                      : event.key === 'Home'
                        ? 'first'
                        : 'last';
                view.dispatch(
                  view.state.tr
                    .setMeta(tagAutocompleteKey, { type: 'move', direction })
                    .setMeta(skipTrailingNodeMeta, true),
                );
                return true;
              }

              case 'Tab': {
                const chosen = open.rows[open.activeIndex];
                if (chosen === undefined) return false;
                // Row 0 is the typed text, so accepting it changes nothing
                // and only closes the list; any other row is an existing tag
                // to insert and descend into.
                if (open.activeIndex === 0) commitTypedText(view, open.match);
                else insertTag(view, open.match, chosen);
                return true;
              }

              // `Enter` and `space` are deliberately absent. With row 0
              // pre-selected `Enter` has nothing to insert, so intercepting
              // it could only swallow a keystroke that means "new paragraph"
              // everywhere else; `space` is how a tag is committed.
              default:
                return false;
            }
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;

              const option = target?.closest<HTMLElement>('[data-tag-autocomplete-option]');
              if (option) {
                if (event.button !== 0) return false;
                event.preventDefault();

                const open = openRows(view.state);
                if (open === null) return true;

                const index = Number(option.getAttribute('data-tag-autocomplete-option'));
                const chosen = open.rows[index];
                if (chosen === undefined) return true;
                // Identical per-row behaviour to `Tab`, so a click and a
                // keypress on the same row cannot diverge.
                if (index === 0) commitTypedText(view, open.match);
                else insertTag(view, open.match, chosen);
                return true;
              }

              // A click anywhere else inside the widget must not fall through
              // and move the caret.
              if (target?.closest('.bear-tag-autocomplete')) {
                event.preventDefault();
                return true;
              }

              return false;
            },
          },
        },

        // Mirrors the open/active state onto `view.dom` as
        // `role`/`aria-expanded`/`aria-controls`/`aria-activedescendant`: the
        // editable-combobox pattern, applied to the ALREADY-FOCUSED host,
        // because this control has no input of its own to carry the ARIA.
        // Without it a keyboard user watches the list move with nothing a
        // screen reader can announce. `originalRole` is captured once so
        // closing restores whatever the host carried before.
        view(editorView) {
          const originalRole = editorView.dom.getAttribute('role');

          const clear = (view: EditorView): void => {
            if (originalRole === null) view.dom.removeAttribute('role');
            else view.dom.setAttribute('role', originalRole);
            view.dom.removeAttribute('aria-expanded');
            view.dom.removeAttribute('aria-controls');
            view.dom.removeAttribute('aria-activedescendant');
          };

          const sync = (view: EditorView): void => {
            const open = openRows(view.state);
            if (open === null) {
              clear(view);
              return;
            }

            view.dom.setAttribute('role', 'combobox');
            view.dom.setAttribute('aria-expanded', 'true');
            view.dom.setAttribute('aria-controls', listboxId(open.match.from));
            if (open.activeIndex >= 0) {
              view.dom.setAttribute(
                'aria-activedescendant',
                optionId(open.match.from, open.activeIndex),
              );
            } else {
              view.dom.removeAttribute('aria-activedescendant');
            }
          };

          sync(editorView);

          return {
            update: sync,
            destroy() {
              clear(editorView);
            },
          };
        },
      }),
    ];
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tagAutocomplete: {
      /**
       * Replaces the normalized tag keys this plugin suggests from.
       *
       * Fed from `AppShell`'s existing `useTagTree()` rather than a query of
       * this plugin's own: `notes.allTagRows()` is a full table scan, so a
       * second live query would double the sidebar's cost on every tag write,
       * and this plugin would then have to re-derive the tree's synthesized
       * ancestors itself.
       *
       * These are only half the suggestion source. The plugin unions them
       * with tags in the OPEN DOCUMENT (`docKeys`), because the index is
       * written by autosave — which is now deliberately HELD while the caret
       * sits inside a tag — so a tag typed moments ago is not in this list.
       */
      setTagAutocompleteKeys: (keys: string[]) => ReturnType;
    };
  }
}
```

If `renderIconMarkup('Hash')` fails because no `Hash` glyph is registered, add lucide's `Hash` `__iconNode` array verbatim to `ICON_NODES` in `src/ui/Icon.tsx` and a row to `Icon.test.tsx`'s `it.each`. Check the real export list first — do not guess a glyph name.

- [ ] **Step 6: Register the extension**

In `src/features/editor/extensions.ts`: import the type and the extension beside the `LinkAutocomplete` pair at `:26-27`, add `TagAutocompleteOptions` to both options intersections (`:44` and `:232`), and register `TagAutocomplete.configure(options)` immediately after `LinkAutocomplete.configure(options)` at `:149`.

- [ ] **Step 7: Run the unit tests**

Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: PASS.

Run: `npx vitest run src/features/editor/`
Expected: PASS — in particular `extensions.test.ts`, `importCycle.test.ts` and `stability.test.ts`, which are the files a new extension is most likely to disturb.

- [ ] **Step 8: Prove two tests are not vacuous**

**(a) The widget key.** Change `widgetKey` to `return \`tag-autocomplete-${match.from}\`;`.
Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: FAIL on "rebuilds the list on every keystroke".
Revert.

**(b) `Enter` passes through.** Add a `case 'Enter': return true;` to `handleKeyDown`.
Run: `npx vitest run src/features/editor/tagAutocomplete.test.ts`
Expected: FAIL on "does NOT consume Enter or space".
Revert. Re-run: PASS.

- [ ] **Step 9: Wire the key list through the app**

`src/app/AppShell.tsx` — derive the flat key list beside the existing `tree`:

```ts
  // The suggestion source for the editor's tag autocomplete. Flattened from
  // the tree rather than read from `notes.allTagRows()` directly, because the
  // tree is where ANCESTORS exist: `parseTags` writes one row per exact tag,
  // so `a` is a node `buildTagTree` synthesizes from `a/b` and a list built
  // from rows alone could never suggest `#a`.
  //
  // `undefined` while the live query is unresolved, never coerced to `[]`.
  const tagKeys = useMemo(() => {
    if (tree.nodes === undefined) return undefined;
    const keys: string[] = [];
    const walk = (nodes: TagNode[]): void => {
      for (const node of nodes) {
        keys.push(node.tag);
        walk(node.children);
      }
    };
    walk(tree.nodes);
    return keys;
  }, [tree.nodes]);
```

Import `type TagNode` from `@/features/tags` (check the real export path and the real child-property name in `src/features/tags/tagTree.ts` before writing this — `children` is the expected name but verify it), and confirm `useMemo` is already in `AppShell.tsx`'s React import before using it.

A plan's component-usage sketch is not a signature reference: an earlier plan in this repo guessed `Icon`'s prop as `of` when it is `glyph`, invented a provider that does not exist, and named `lucide-react` icons absent from the package. Check the real signature before writing code from any sketch here, including this one.

Pass `tagKeys={tagKeys}` to `NoteEditor` beside the existing `onActivateTag`.

`src/features/notes/NoteEditor.tsx` — add to the props interface:

```ts
  /** Normalized tag keys the editor's autocomplete suggests from. */
  tagKeys?: string[];
```

Destructure it and forward `tagKeys={tagKeys}` to `RichEditor` beside `onActivateTag`.

`src/features/editor/RichEditor.tsx` — add the same prop to `RichEditorProps`, add the label to the `buildEditorExtensions` options:

```ts
      tagAutocompleteLabels: { listLabel: t('editor.tagAutocomplete.listLabel') },
```

and push the keys from an effect beside the existing `noteTitles` one at `:470-486`:

```ts
  // Rides a command rather than an option for the same reason the note-title
  // list does: options are read once at mount, and this list changes while
  // the editor is alive. `undefined` means the live query has not resolved —
  // never pushed as an empty list, which would read as "no tags exist".
  useEffect(() => {
    if (editor === null || tagKeys === undefined) return;
    editor.commands.setTagAutocompleteKeys(tagKeys);
  }, [editor, tagKeys]);
```

- [ ] **Step 10: Style the popover**

In `src/styles/editor.css`, add the tag selectors to each of the link popover's rules at `:1456-1514` — a selector list, not a new base class, so `LinkAutocomplete.ts`'s emitted markup needs no change:

```css
.bear-link-autocomplete,
.bear-tag-autocomplete {
  position: relative;
  display: inline-block;
}
```

Do the same for `-popover`, `.ProseMirror …-list`, `…-list [role='option']`, its `:hover`, and its `.is-active`. The `-empty` rule stays link-only — the tag list can never be empty.

Then add one rule of its own, for the row icon:

```css
/* The row's tag glyph, drawn by `renderIconMarkup` because a ProseMirror
 * widget cannot render React. Sized to the row's own text rather than to a
 * fixed pixel value so it tracks the UI type scale. */
.bear-tag-autocomplete-list [role='option'] {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.bear-tag-autocomplete-icon {
  display: inline-flex;
  flex: none;
  color: var(--bear-faint);
}

.bear-tag-autocomplete-icon svg {
  width: 0.875em;
  height: 0.875em;
}
```

- [ ] **Step 11: Run the app and look at it**

Run: `npm run dev`, open a note, type `#` plus a character.

This step is not optional and cannot be replaced by a test. Two classes of bug in this repo's history were found ONLY by running the app: `useSession`'s StrictMode double-mount (every gate passed) and sub-project N's circular import, which rendered a blank page while `build`, `typecheck`, `lint`, `format` and 2473 unit tests all passed.

Check: the popover appears below the caret, row 0 is the typed text and is highlighted, `Tab` descends, a space closes it, the icon renders, and the list is legible in a dark theme as well as a light one.

- [ ] **Step 12: Run the full gates**

Run: `npm test -- --run --maxWorkers=4`
Run: `npm run typecheck && npm run lint && npm run format && npm run build`
Run: `lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e`
Expected: all pass. If an e2e test unrelated to this change fails, check `uptime` before concluding this diff broke it, and re-run once the machine is quiet.

- [ ] **Step 13: Measure the bundle**

Run: `npx vitest run scripts/bundleSize.test.ts`
Expected: PASS, with headroom against the 340,000 B ceiling.

Headroom before this task was **1,884 B**, so this may fail. If it does, raise the ceiling in `scripts/bundleSize.test.ts` to the measured value plus a stated margin, and put the reason in the commit message. Do NOT read the number off Vite's build log — that estimate runs ~3 kB pessimistic against what the guard actually measures. Do not disable `build.manifest` in `vite.config.ts`.

- [ ] **Step 14: Commit**

```bash
python3 -c "
for p in ['src/features/editor/TagAutocomplete.ts','src/features/editor/tagAutocomplete.test.ts','src/features/editor/TagPill.ts','src/features/editor/extensions.ts','src/features/editor/RichEditor.tsx','src/features/notes/NoteEditor.tsx','src/app/AppShell.tsx','src/styles/editor.css','src/i18n/en.ts','src/i18n/ko.ts']:
    d=open(p).read(); print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
git add -A
git commit -m "feat(tags): suggest matching tags while typing one

A sibling of LinkAutocomplete rather than a refactor of it: the two differ
in three of their four behaviours (the always-present literal row, Tab
rather than Enter, descend-and-stay-open), so a shared core would be mostly
injected difference.

Suggestions come from the tag TREE's keys, not the index rows — parseTags
writes one row per exact tag, so 'a' exists only as an ancestor buildTagTree
synthesizes from 'a/b' — unioned with tags in the open document, because
autosave is now held while the caret sits inside a tag.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UNmYbueB3JR5WYock4Aaod"
```

---

## Task 4: A plain click filters

**Files:**
- Modify: `src/features/editor/TagPill.ts:1,229-250`
- Modify: `src/features/editor/RichEditor.tsx:282`
- Modify: `src/app/AppShell.tsx:297-320,559`
- Modify: `src/styles/editor.css:908-926`
- Modify: `src/i18n/en.ts:227-228`, `src/i18n/ko.ts:211-212`
- Test: `src/features/editor/tagPill.test.ts`, `src/app/AppShell.test.tsx`

**Interfaces:**
- Consumes: `handleActivateTag`'s existing boolean contract — it returns whether it acted, and the plugin gates `preventDefault()` on that.
- Produces: no new exports. One i18n key replaces two.

- [ ] **Step 1: Write the failing tests**

In `src/features/editor/tagPill.test.ts`, find the two tests asserting the platform branches of the modifier (they exercise `metaKey` on macOS and `ctrlKey` elsewhere via `isMacOS`). **Delete them** — they assert a gesture that no longer exists. Then add, using the file's existing faked-view helper at `:386-400`:

```ts
  it('filters on a plain left click, with no modifier', () => {
    const onActivate = vi.fn().mockReturnValue(true);
    const editor = editorWith('#work here', { onActivate });
    const event = new MouseEvent('mousedown', { button: 0, cancelable: true });

    const consumed = fireMousedown(editor, 2, event);

    expect(onActivate).toHaveBeenCalledWith('work');
    expect(consumed).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    editor.destroy();
  });

  it('places the caret instead when the app declines', () => {
    // Ask first, consume second. A decline costs the user a filter but never
    // the caret — falling through with no preventDefault leaves ProseMirror's
    // own mousedown handling to place it, which is the honest answer for a
    // pill that cannot do what it promises. A tag typed within the last few
    // hundred milliseconds reaches this path, and so do M7.6's two documented
    // classes of pill whose tag is not in the index.
    const onActivate = vi.fn().mockReturnValue(false);
    const editor = editorWith('#work here', { onActivate });
    const event = new MouseEvent('mousedown', { button: 0, cancelable: true });

    const consumed = fireMousedown(editor, 2, event);

    expect(onActivate).toHaveBeenCalledWith('work');
    expect(consumed).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    editor.destroy();
  });

  it('ignores a non-left button, so right-click still reaches the context menu', () => {
    const onActivate = vi.fn().mockReturnValue(true);
    const editor = editorWith('#work here', { onActivate });
    const event = new MouseEvent('mousedown', { button: 2, cancelable: true });

    expect(fireMousedown(editor, 2, event)).toBe(false);
    expect(onActivate).not.toHaveBeenCalled();
    editor.destroy();
  });
```

Adapt the helper names to whatever the file actually calls them — read `:380-400` first rather than assuming `editorWith`/`fireMousedown`.

**One trap in that helper, already documented at `tagPill.test.ts:593`:**
`EditorView.someProp` SHORT-CIRCUITS on the first handler that returns a
truthy value, so a helper that stops at the first `handleDOMEvents.mousedown`
silently exercises whichever plugin happens to run first — and Task 3 just
added a second `mousedown` consumer to this editor. The existing helper
already walks every handler for this reason; do not simplify it, and do not
write a new one that stops early.

In `src/app/AppShell.test.tsx`, add:

```ts
  it('shows the filtered list when a tag is activated on a phone', async () => {
    globalThis.__setViewportWidth(390);
    // Seed a note carrying the tag, select it, activate the tag, and assert
    // the note list is showing and scoped. Follow the file's existing
    // phone-layout test for the seeding and query helpers — `AppShell.test.tsx`
    // already documents that `handleActivateTag` lives deep inside the tree
    // and how its own tests reach it.
  });
```

Write that body against the file's existing phone test, whatever shape it takes. Do not invent helpers.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/editor/tagPill.test.ts src/app/AppShell.test.tsx`
Expected: FAIL — the plain click is currently ignored, so `onActivate` is never called and nothing is consumed.

- [ ] **Step 3: Drop the modifier gate**

In `src/features/editor/TagPill.ts`, delete these lines from the `mousedown` handler:

```ts
              // Ctrl-click on macOS is the context-menu gesture, and must
              // not also change scope. Cmd there, Ctrl everywhere else — the
              // same "Mod" every keyboard shortcut in this app uses.
              if (!(isMacOS() ? event.metaKey : event.ctrlKey)) return false;
```

Change line 1 to `import { Extension } from '@tiptap/core';`, and update the handler's own docblock:

```ts
            // A PLAIN left click filters, as Bear's does. `mousedown`, not
            // `handleClick`: ProseMirror does not place the caret itself on a
            // plain click — the browser moves the DOM selection natively
            // during mousedown and ProseMirror reads it back. By
            // `handleClick` (which runs on mouseup) the caret has already
            // moved, suppression has already lifted the pill, and the thing
            // the user clicked has vanished under the cursor.
            // `preventDefault()` here is the only point that stops it.
            //
            // Two gestures regress as a result, both accepted: a selection
            // drag that STARTS inside a pill filters instead of selecting,
            // and a double-click on a tag filters on its first mousedown so
            // no word selection happens. Deferring to mouseup to rescue them
            // reintroduces exactly the failure described above.
```

- [ ] **Step 4: Collapse the hint to one key**

`src/i18n/en.ts`: replace the two `editor.tagPill.hint.mac` / `.other` entries with

```ts
  'editor.tagPill.hint': 'Filter by this tag',
```

`src/i18n/ko.ts`: replace its two with

```ts
  'editor.tagPill.hint': '이 태그로 필터링',
```

`src/features/editor/RichEditor.tsx:282`: replace the branch with

```ts
      activateHint: t('editor.tagPill.hint'),
```

Leave `editor.linkPill.hint.mac` / `.other` and the `isMacOS()` call that reads them exactly as they are — `[[links]]` keep Mod-click.

- [ ] **Step 5: Navigate on a phone**

In `src/app/AppShell.tsx`, move `const mode = useLayoutMode();` (currently `:559`) up so it is declared before `handleActivateTag` — it depends on nothing between the two points, and reading it from a function defined earlier would be a use-before-define lint failure.

Then extend `handleActivateTag`:

```ts
    setScope(tagScope(tag));
    tree.reveal(tag);

    // On a phone the list and the editor are separate screens and
    // `phoneScreen` is DERIVED from the selection, so showing the filtered
    // list means deselecting — there is no screen variable to set. The note
    // just left cannot be filtered out of the list that appears, because it
    // carries the tag that was tapped, so it is one visible tap away.
    //
    // `useOverlayHistory`'s cleanup calls `history.back()` when `isOpen`
    // flips false, consuming its own entry, so this leaves the history stack
    // correct rather than desynced. It also means the platform Back gesture
    // has nothing to return to; accepted, per the spec.
    if (mode === 'phone') select(null);

    return true;
```

- [ ] **Step 6: Make the pill look clickable unconditionally**

In `src/styles/editor.css`, replace the `[data-mod-held='true']` tag rule at `:922` with a plain hover rule, and rewrite the comment above it, which currently justifies itself with "it is the only affordance there is, since plain click deliberately still edits":

```css
/*
 * A tag pill lights up on hover because a plain click FILTERS by it — the
 * affordance is unconditional now, where it used to require the modifier the
 * gesture no longer needs. `--bear-tag-fill-strong` sits at an alpha above
 * `--bear-tag-fill` in both themes; `--bear-selected` was rejected here
 * because it is FAINTER than a resting pill in Paper and identical to it in
 * Ink, which would make hovering look like the pill fading rather than
 * lighting up.
 */
.ProseMirror .bear-tag:not(.bear-tag__hash):hover {
  cursor: pointer;
  background-color: var(--bear-tag-fill-strong);
}
```

Leave the `[data-mod-held='true']` LINK rules at `:976` and `:981` untouched, and leave `data-mod-held` and its key listener in `RichEditor` alone — the link pills still need both.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/features/editor/tagPill.test.ts src/app/AppShell.test.tsx src/features/editor/richEditor.test.tsx`
Expected: PASS. Other tests referencing the deleted i18n keys will fail to typecheck — fix each by using `editor.tagPill.hint`.

- [ ] **Step 8: Prove the click test is not vacuous**

Restore the deleted modifier gate temporarily.
Run: `npx vitest run src/features/editor/tagPill.test.ts`
Expected: FAIL on "filters on a plain left click, with no modifier".
Delete it again. Re-run: PASS.

- [ ] **Step 9: Run the app and click a tag**

Run: `npm run dev`. Click a tag pill in a note: the list re-scopes. Hover it: it lights up and the cursor is a pointer. Right-click it: the editor context menu opens, not a filter. Narrow the window to phone width and tap a pill: the list screen appears, scoped.

- [ ] **Step 10: Full gates plus the visual one**

Run: `npm test -- --run --maxWorkers=4`
Run: `npm run typecheck && npm run lint && npm run format && npm run build`
Run: `npm run measure:check`
Expected: `measure:check` may FAIL — the pill's hover state changed. If it does, run `npm run measure` on `main` first to confirm the baseline is clean, then regenerate and commit `docs/design/measurements.md` and `.json` with this task.

- [ ] **Step 11: Commit**

```bash
python3 -c "
for p in ['src/features/editor/TagPill.ts','src/features/editor/tagPill.test.ts','src/features/editor/RichEditor.tsx','src/app/AppShell.tsx','src/app/AppShell.test.tsx','src/styles/editor.css','src/i18n/en.ts','src/i18n/ko.ts']:
    d=open(p).read(); print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
git add -A
git commit -m "feat(tags): a plain click on a tag pill filters by it

Collects on tag-pills.md:204, which named tag autocomplete as the premise of
the Mod-click divergence from Bear and asked to be revisited once it shipped.
Two gestures regress and are accepted with reasons: a selection drag starting
inside a pill, and double-click to select a word.

On a phone the tap navigates to the filtered list, because phoneScreen is
derived from the selection and changing the scope behind the editor would
look like the tap did nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UNmYbueB3JR5WYock4Aaod"
```

---

## Task 5: End-to-end coverage, and the record

**Files:**
- Modify: `e2e/tags.spec.ts`
- Modify: `e2e/phoneEditor.spec.ts`
- Modify: `docs/rulings/tag-pills.md`, `markdown-and-schema.md`, `notes-lifecycle.md`, `tag-grammar.md`, `accessibility.md`
- Modify: `CLAUDE.md`, `docs/superpowers/NEXT.md`

**Interfaces:**
- Consumes: `e2e/fixtures/seed.ts`'s `seedDatabase`, and the corpus in `e2e/fixtures/corpus.ts`.

- [ ] **Step 1: Write the e2e tests**

In `e2e/tags.spec.ts`, following `e2e/backlinks.spec.ts:161`'s shape for the popover:

```ts
test('the tag autocomplete completes and descends', async ({ page }) => {
  // A real Tab keypress and a real caret; neither belongs in jsdom.
});

test('a plain click on a tag pill re-scopes the note list', async ({ page }) => {
  // Assert the note-list scope header, not just that some notes changed.
});
```

In `e2e/phoneEditor.spec.ts`:

```ts
test('tapping a tag pill shows the filtered list', async ({ page }) => {
  // Phone viewport; tap the pill; assert the list screen is showing AND
  // scoped to that tag.
});
```

Write the bodies against each file's existing helpers. Two constraints from
the rulings: do not lower the configured viewport (seven assertions across
`codePalette`, `contrast` and `appearance` depend on it being at least 1024),
and prefer a named assertion that fails honestly over a `[role="…"]` selector
inside `page.evaluate`.

- [ ] **Step 2: Run them, and prove one can fail**

Run: `lsof -ti:4173 | xargs -r kill -9 && npx playwright test e2e/tags.spec.ts e2e/phoneEditor.spec.ts`
Expected: PASS.

Then break `insertTag`'s inserted text (`#${key}` -> `#x${key}`), kill 4173 again, and re-run. Expected: FAIL. Revert.

This second run is the point of the step: `reuseExistingServer` on a hardcoded port means a fault injection can silently pass against a stale build, and M9a hit exactly that.

- [ ] **Step 3: Rewrite the rulings**

`docs/rulings/tag-pills.md`: REPLACE the "Plain click on a tag pill edits; Mod-click activates" bullet — do not caveat it, do not leave it with a note. The replacement records that a plain click filters, the two accepted gesture regressions and why, and that `mousedown` is still the only workable interception point. Narrow the "Mod is Cmd on Apple platforms" bullet to `LinkPill`, and strike its claim that `tagPill.test.ts` asserts both branches.

`docs/rulings/markdown-and-schema.md`: add the new extension and its `Tab` binding. Record that `Enter` and `space` are deliberately NOT intercepted, why (row 0 has nothing to insert), and that the `Tab` collision with `@tiptap/extension-list-keymap` is resolved by the popover's open state alone.

`docs/rulings/notes-lifecycle.md`: the autosave hold — only the debounced write defers, every explicit flush writes through, the cap runs from the first deferral and is not reset by a re-arm.

`docs/rulings/tag-grammar.md`: the required-boundary-after-the-caret rule, and that it excludes the multi-word form from autocomplete by construction rather than by a guard.

`docs/rulings/accessibility.md`: the listbox's stable-id versus volatile-widget-key split, and the editable-combobox ARIA riding the already-focused host.

Extend each file's own `**Trigger:**` line so it names the new symbols, and add `TagAutocomplete.ts` / `tagAutocomplete.test.ts` to the matching rows of `CLAUDE.md`'s rulings index.

- [ ] **Step 4: Update the status record**

`CLAUDE.md`: add a row to the status table — `S4 tag autocomplete + plain-click filtering | complete` — and update the test counts to the real numbers from the final run. Do not retell the narrative here; this file routes.

`docs/superpowers/NEXT.md`: add the S4 section — what shipped, what diverged from this plan and why — and mark S2 as absorbed rather than pending, with a pointer to why (the descend-and-stay-open flow made it load-bearing).

- [ ] **Step 5: Final full verification**

Run: `npm test -- --run --maxWorkers=4`
Run: `npm run typecheck && npm run lint && npm run format && npm run build`
Run: `lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e`
Run: `npm run measure:check`
Run: `npx vitest run scripts/bundleSize.test.ts`

Then the two harnesses that assert nothing and must be counted rather than trusted:

Run: `npm run shots` — expect **272** files under `docs/design/shots/`. Count them:
`find docs/design/shots -maxdepth 1 -name '*.png' | wc -l`

Report every number. Do not claim a gate passed without its output.

- [ ] **Step 6: Commit and merge**

```bash
git add -A
git commit -m "docs(s4): record the rulings, the status and the e2e coverage

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01UNmYbueB3JR5WYock4Aaod"
```

Then hand back to the controller. Do NOT merge to `main` yourself — the controller merges, after a whole-branch review. (Said explicitly because a previous subagent read a merge it had not performed in the reflog and reported a second actor in the repo; it was the controller.)

Note for whoever integrates: `ci.yml` triggers on `pull_request` and on pushes to `main` only, and `gh pr create` fails here because `gh` is authenticated as the work account. So a PR must be opened in the browser at
`https://github.com/valorjj/bear-web/compare/main...<branch>`, or the branch merged directly — which deploys at the same time rather than before.
