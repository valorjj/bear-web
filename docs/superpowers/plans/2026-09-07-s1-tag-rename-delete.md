# S1 — Tag rename and delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tag can be renamed and deleted from a right-click menu on its sidebar row, cascading over its subtree, rewriting the Markdown of every note that carries it.

**Architecture:** A pure `rewriteTag(markdown, from, to | null)` in `src/data/tags/`, driven by the existing `findTagRanges`, so tag grammar is read from exactly one place. Above it, `tags.rename` / `tags.remove` / `tags.affected` in `src/data/repositories/tags.ts` select notes by a full scan (so trashed notes are included), rewrite each note's text and reindex it in ONE Dexie transaction, and migrate `TagMeta` for the whole subtree. The UI is a `SidebarRow` context menu following `NoteRowMenu`'s pattern, with confirms routed through `AppShell`'s existing `pending` union.

**Tech Stack:** TypeScript, Dexie, React 19, ProseMirror/Tiptap (untouched here), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-tag-rename-delete-design.md`

## Global Constraints

- Tags are keyed **lowercase**. `#Work` and `#work` are one tag. Every name entering these APIs is already normalized.
- Tag grammar is read ONLY through `findTagRanges` / `parseTags` / `normalizeTag`. A second copy of the grammar (a string replace, a hand-rolled scan) is a defect — see `docs/rulings/tag-grammar.md`.
- `src/data/` must not import from `src/features/`. `src/ui/` must import nothing from `src/app/`, `src/data/` or `src/i18n/` (it MAY use `src/lib/`).
- No user-facing string is hardcoded in a component. Every string goes through `useT`, with the key added to BOTH `src/i18n/en.ts` and `src/i18n/ko.ts` (`ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error — never weaken that annotation).
- `useT()` returns `(key) => string` with **no** interpolation. The established idiom for a count is a separate `.one` key plus `t('key.other').replace('{count}', String(count))` — see `ScopeMenu.tsx:158`.
- Every rewritten note keeps its existing `updatedAt`, and is marked dirty with `markedAt` equal to that same value.
- All six gates must pass before any commit: `npm run typecheck`, `npm run lint`, `npm run format`, `npm test`, `npm run build`, `npm run test:e2e`. Run `npm test -- --run --maxWorkers=4` on this machine.
- Before any e2e run or fault injection: `lsof -ti:4173 | xargs -r kill -9`.
- After touching tag-grammar code or prose, run the NUL scan from `docs/rulings/tag-grammar.md`, and check every file touched for U+00A0 / U+200B with
  `python3 -c "d=open(PATH).read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"` — must print `0 0`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/data/tags/parseTags.ts` (modify) | Export `normalizeTag`. No behaviour change. |
| `src/data/tags/index.ts` (modify) | Re-export `normalizeTag`, `rewriteTag`, `canWriteTag`. |
| `src/data/tags/rewriteTag.ts` (create) | The pure rewrite: ranges in, new Markdown out. Knows nothing of Dexie. |
| `src/data/tags/rewriteTag.test.ts` (create) | The grammar cases. Where the real bugs are. |
| `src/data/index.ts` (modify) | Barrel: `normalizeTag`, `canWriteTag`. |
| `src/data/repositories/tags.ts` (modify) | `affected` / `rename` / `remove`, transactional. Gains injected deps. |
| `src/data/repositories/index.ts` (modify) | Pass `{ db, parseTags, parseLinks }` to the tags repository. |
| `src/data/repositories/tags.test.ts` (create) | Orchestration, incl. the trashed-note resurrection hole. |
| `src/ui/SidebarRow.tsx` (modify) | Optional `onContextMenu`, wired to `useLongPress`. |
| `src/features/tags/TagRowMenu.tsx` (create) | The two-item menu. |
| `src/features/tags/TagRenamePopover.tsx` (create) | Anchored rename field with validation + merge warning. |
| `src/features/tags/TagSidebar.tsx` (modify) | Raises the menu request; `Shift+F10` route. |
| `src/features/tags/tagMenu.test.tsx` (create) | Menu + popover component tests. |
| `src/app/AppShell.tsx` (modify) | `pending` kinds, confirm copy, rename re-scope. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` (modify) | New keys. |
| `e2e/tags.spec.ts` (create) | The real browser: rename, delete, scope follow, touch long-press. |

---

### Task 1: `rewriteTag` — the pure core

**Files:**
- Modify: `src/data/tags/parseTags.ts` (export `normalizeTag`)
- Create: `src/data/tags/rewriteTag.ts`
- Create: `src/data/tags/rewriteTag.test.ts`
- Modify: `src/data/tags/index.ts`, `src/data/index.ts`

**Interfaces:**
- Consumes: `findTagRanges(markdown): TagRange[]` where `TagRange` is `{ tag: string; start: number; end: number }` — `start` is the index of the opening `#`; `end` is one past the last character, INCLUDING the closing `#` of the multi-word form and EXCLUDING trailing punctuation `normalizeTag` trimmed. `normalizeTag(raw): string | null`.
- Produces: `rewriteTag(markdown: string, from: string, to: string | null): string`, `canWriteTag(tag: string): boolean`, `tagToken(tag: string): string`.

- [ ] **Step 1: Export `normalizeTag`**

In `src/data/tags/parseTags.ts`, change the declaration only:

```ts
export function normalizeTag(raw: string): string | null {
```

Then in `src/data/tags/index.ts`:

```ts
export { canWriteTag, rewriteTag, tagToken } from './rewriteTag';
export { findTagRanges, normalizeTag, parseTags } from './parseTags';
export type { TagRange } from './parseTags';
```

And in `src/data/index.ts`, extend the existing tags line:

```ts
export { canWriteTag, findTagRanges, normalizeTag, parseTags, rewriteTag } from './tags';
```

- [ ] **Step 2: Write the failing test**

Create `src/data/tags/rewriteTag.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { parseTags } from './parseTags';
import { canWriteTag, rewriteTag } from './rewriteTag';

describe('rewriteTag — renaming', () => {
  it('renames the exact tag', () => {
    expect(rewriteTag('see #work today', 'work', 'job')).toBe('see #job today');
  });

  it('renames descendants, keeping their tail', () => {
    expect(rewriteTag('a #a/b/c b', 'a/b', 'x')).toBe('a #x/c b');
  });

  it('leaves a tag that merely shares a prefix', () => {
    // `a/bc` is NOT a descendant of `a/b`. Matching on the normalized NAME,
    // not on raw text, is what makes this free of a special case.
    expect(rewriteTag('see #a/bc', 'a/b', 'x')).toBe('see #a/bc');
  });

  it('replaces a multi-word tag whole, closing hash included', () => {
    expect(rewriteTag('see #my project# ok', 'my project', 'plan')).toBe('see #plan ok');
  });

  it('writes the multi-word form when the new name needs one', () => {
    expect(rewriteTag('see #work', 'work', 'my plan')).toBe('see #my plan#');
  });

  it('keeps a trailing full stop out of the rewrite', () => {
    // `range.end` excludes punctuation `normalizeTag` trimmed, so the
    // sentence keeps its own period.
    expect(rewriteTag('done #work. next', 'work', 'job')).toBe('done #job. next');
  });

  it('leaves tags inside fenced code alone', () => {
    const source = 'text #work\n\n```\n#work in code\n```\n';
    expect(rewriteTag(source, 'work', 'job')).toBe('text #job\n\n```\n#work in code\n```\n');
  });

  it('leaves tags inside inline code alone', () => {
    expect(rewriteTag('a `#work` b #work', 'work', 'job')).toBe('a `#work` b #job');
  });

  it('leaves a url fragment and a link destination alone', () => {
    const source = 'see https://x/#work and [x](#work) and #work';
    expect(rewriteTag(source, 'work', 'job')).toBe(
      'see https://x/#work and [x](#work) and #job',
    );
  });

  it('rewrites every occurrence', () => {
    expect(rewriteTag('#work then #work', 'work', 'job')).toBe('#job then #job');
  });

  it('lands the invariant: `to` present, `from` absent', () => {
    const out = rewriteTag('x #a/b y #a/b/c z', 'a/b', 'q');
    expect(parseTags(out).sort()).toEqual(['q', 'q/c']);
    expect(parseTags(out)).not.toContain('a/b');
  });
});

describe('rewriteTag — deleting', () => {
  it('collapses a mid-line hole to one space', () => {
    expect(rewriteTag('see #a/b today', 'a/b', null)).toBe('see today');
  });

  it('trims a trailing space', () => {
    expect(rewriteTag('see #a/b', 'a/b', null)).toBe('see');
  });

  it('trims a leading space', () => {
    expect(rewriteTag('#a/b see', 'a/b', null)).toBe('see');
  });

  it('removes a tag-only line, newline included', () => {
    expect(rewriteTag('one\n#a/b\ntwo\n', 'a/b', null)).toBe('one\ntwo\n');
  });

  it('keeps a line that still has another tag on it', () => {
    expect(rewriteTag('#a/b #other', 'a/b', null)).toBe('#other');
  });

  it('deletes descendants too', () => {
    const out = rewriteTag('x #a/b y #a/b/c z', 'a/b', null);
    expect(parseTags(out)).toEqual([]);
    expect(out).toBe('x y z');
  });
});

describe('canWriteTag', () => {
  it.each([
    ['work', true],
    ['a/b/c', true],
    ['my plan', true],
    ['has#hash', false],
  ])('%s -> %s', (tag, expected) => {
    expect(canWriteTag(tag)).toBe(expected);
  });
});

describe('rewriteTag — round trip', () => {
  it('restores the original tag set when renamed back', () => {
    const source = 'x #a/b y\n\n#a/b/c and #other\n';
    const there = rewriteTag(source, 'a/b', 'q');
    const back = rewriteTag(there, 'q', 'a/b');
    // Whitespace collapsing is not byte-reversible, so the invariant is on
    // the TAG SET, deliberately, not on the string.
    expect(parseTags(back).sort()).toEqual(parseTags(source).sort());
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `npx vitest run src/data/tags/rewriteTag.test.ts`
Expected: FAIL — cannot resolve `./rewriteTag`.

- [ ] **Step 4: Implement `rewriteTag`**

Create `src/data/tags/rewriteTag.ts`:

```ts
import { findTagRanges, normalizeTag, parseTags } from './parseTags';

/**
 * A tag name written as Markdown.
 *
 * The multi-word form is used only when the simple form could not read the
 * name back. `isBoundary` in `parseTags.ts` treats whitespace, the mask and
 * end-of-input as the only terminators of a simple tag, so whitespace is the
 * one thing that forces a closing `#`.
 */
export function tagToken(tag: string): string {
  return /\s/.test(tag) ? `#${tag}#` : `#${tag}`;
}

/**
 * Whether a name can be written and read back as itself.
 *
 * A round trip through the real parser, deliberately, rather than a list of
 * rules: the rules live in `normalizeTag` and the scanner, and a second copy
 * here would be the duplicated-grammar defect this project forbids. It also
 * catches shapes no rule list would think of — a name containing `#` cannot
 * be expressed in either form, because the simple scanner rejects a hash and
 * the multi-word form would treat it as the closer.
 */
export function canWriteTag(tag: string): boolean {
  return normalizeTag(tag) === tag && parseTags(tagToken(tag)).includes(tag);
}

/**
 * How much text a deletion takes, given the tag's own range.
 *
 * Three cases, in priority order. A line left holding nothing but whitespace
 * goes away entirely, newline included, so no blank gap is left behind — the
 * known cost is that a tag-only line sitting mid-paragraph with no blank line
 * around it joins its neighbours into one soft-wrapped paragraph, which is
 * accepted (leaving the empty line instead SPLITS that paragraph in two, so
 * neither rule is structure-preserving). Otherwise exactly ONE adjacent space
 * is absorbed, preferring the one before, so `see #a/b today` does not become
 * `see  today`.
 */
function removalRange(text: string, start: number, end: number): { from: number; to: number } {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextNewline = text.indexOf('\n', end);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;

  const remainder = text.slice(lineStart, start) + text.slice(end, lineEnd);
  if (remainder.trim() === '') {
    return { from: lineStart, to: nextNewline === -1 ? lineEnd : lineEnd + 1 };
  }

  const before = text[start - 1];
  if (before === ' ' || before === '\t') return { from: start - 1, to: end };

  const after = text[end];
  if (after === ' ' || after === '\t') return { from: start, to: end + 1 };

  return { from: start, to: end };
}

/**
 * Renames or deletes `from` and every descendant of it, in one note's text.
 *
 * `to === null` deletes. Both names are already-normalized tag keys.
 *
 * Matching is on the NORMALIZED NAME each range reports, never on raw text,
 * which is what makes `#a/bc` a non-match for `a/b` without a special case —
 * and reusing `findTagRanges` is what keeps tags inside code fences, URL
 * fragments and link destinations out of the rewrite for free. A string
 * replace has none of those properties.
 *
 * Ranges are rewritten RIGHT-TO-LEFT so that each splice leaves every
 * earlier offset valid.
 */
export function rewriteTag(markdown: string, from: string, to: string | null): string {
  const matches = findTagRanges(markdown).filter(
    (range) => range.tag === from || range.tag.startsWith(`${from}/`),
  );
  if (matches.length === 0) return markdown;

  let out = markdown;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const range = matches[i]!;
    if (to === null) {
      const { from: cutFrom, to: cutTo } = removalRange(out, range.start, range.end);
      out = out.slice(0, cutFrom) + out.slice(cutTo);
    } else {
      const renamed = to + range.tag.slice(from.length);
      out = out.slice(0, range.start) + tagToken(renamed) + out.slice(range.end);
    }
  }

  return out;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/data/tags/rewriteTag.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Prove the fence case is not vacuous**

Temporarily replace the body of `rewriteTag` with a naive replace:

```ts
  return to === null ? markdown.replaceAll(`#${from}`, '') : markdown.replaceAll(`#${from}`, `#${to}`);
```

Run: `npx vitest run src/data/tags/rewriteTag.test.ts`
Expected: FAIL on the fenced-code, inline-code, URL-fragment and shares-a-prefix cases specifically. Restore the real implementation and re-run to PASS. This is the injection that proves those four tests are about the grammar rather than decoration.

- [ ] **Step 7: Cheap gates and byte scan**

```bash
npm run typecheck && npm run lint && npm run format
python3 -c "d=open('src/data/tags/rewriteTag.ts').read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"
git ls-files -z | python3 -c "import sys,pathlib; files=sys.stdin.buffer.read().split(b'\x00'); print([f.decode() for f in files if f and b'\x00' in pathlib.Path(f.decode()).read_bytes()] or 'none')"
```
Expected: typecheck/lint/format clean; `0 0`; the NUL list unchanged from before this task (three pre-existing entries).

- [ ] **Step 8: Commit**

```bash
git add src/data/tags src/data/index.ts
git commit -m "feat(tags): rewriteTag, the pure rename/delete over one note's Markdown"
```

---

### Task 2: `tags.rename`, `tags.remove`, `tags.affected`

**Files:**
- Modify: `src/data/repositories/tags.ts`
- Modify: `src/data/repositories/index.ts`
- Create: `src/data/repositories/tags.test.ts`

**Interfaces:**
- Consumes: `rewriteTag`, `canWriteTag` from Task 1. `reindexNote(db, noteId, text, parseTags, parseLinks, noteTitle?)` from `src/data/reindex.ts`. `markDirty(db, kind, key, markedAt)` and `markDeleted(db, kind, key, markedAt)` from `../sync/markDirty`. `deriveTitle(text)` from `../derive`.
- Produces:
  - `affected(tag: string): Promise<{ noteCount: number; tagCount: number }>`
  - `rename(from: string, to: string): Promise<{ noteCount: number }>`
  - `remove(tag: string): Promise<{ noteCount: number }>`

- [ ] **Step 1: Write the failing test**

Create `src/data/repositories/tags.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '../db';
import { notes, tags } from './index';

async function reset(): Promise<void> {
  await db.notes.clear();
  await db.noteTags.clear();
  await db.noteLinks.clear();
  await db.tags.clear();
  await db.syncState.clear();
}

describe('tags.affected', () => {
  beforeEach(reset);

  it('counts the notes and the tags a delete would touch', async () => {
    await notes.create('one\n#a/b');
    await notes.create('two\n#a/b/c');
    await notes.create('three\n#other');

    expect(await tags.affected('a/b')).toEqual({ noteCount: 2, tagCount: 2 });
  });

  it('counts a trashed note, because the rewrite will touch it', async () => {
    const trashed = await notes.create('gone\n#a/b');
    await notes.trash(trashed.id);

    expect((await tags.affected('a/b')).noteCount).toBe(1);
  });
});

describe('tags.remove', () => {
  beforeEach(reset);

  it('strips the tag and its descendants from every note', async () => {
    const one = await notes.create('one\n#a/b');
    const two = await notes.create('two #a/b/c here');

    expect(await tags.remove('a/b')).toEqual({ noteCount: 2 });
    expect((await db.notes.get(one.id))?.text).toBe('one');
    expect((await db.notes.get(two.id))?.text).toBe('two here');
    expect(await notes.allTagRows()).toEqual([]);
  });

  it('does NOT resurrect the tag when a trashed note is restored', async () => {
    // The hole this full scan exists to close: `trash` deletes a note's
    // noteTags rows but not the tag in its TEXT, and `restore` reindexes
    // from that text.
    const note = await notes.create('gone\n#a/b');
    await notes.trash(note.id);

    await tags.remove('a/b');
    await notes.restore(note.id);

    expect(await notes.tagsOf(note.id)).toEqual([]);
    expect((await db.notes.get(note.id))?.text).toBe('gone');
  });

  it('removes the whole subtree of TagMeta', async () => {
    await notes.create('one\n#a/b\n#a/b/c');
    await tags.setCollapsed('a/b', true);
    await tags.setIcon('a/b/c', 'star');

    await tags.remove('a/b');

    expect(await tags.getMeta('a/b')).toBeUndefined();
    expect(await tags.getMeta('a/b/c')).toBeUndefined();
  });

  it('leaves the vault untouched when the tag does not exist', async () => {
    const note = await notes.create('one\n#other');
    expect(await tags.remove('a/b')).toEqual({ noteCount: 0 });
    expect((await db.notes.get(note.id))?.text).toBe('one\n#other');
  });
});

describe('tags.rename', () => {
  beforeEach(reset);

  it('renames the tag and its descendants, and reindexes', async () => {
    const one = await notes.create('one\n#a/b');
    await notes.create('two\n#a/b/c');

    expect(await tags.rename('a/b', 'x')).toEqual({ noteCount: 2 });
    expect((await db.notes.get(one.id))?.text).toBe('one\n#x');
    expect((await notes.allTagRows()).map((r) => r.tag).sort()).toEqual(['x', 'x/c']);
  });

  it('preserves updatedAt, and marks dirty at that same value', async () => {
    const note = await notes.create('one\n#a/b');
    const before = (await db.notes.get(note.id))!.updatedAt;

    await tags.rename('a/b', 'x');

    const after = (await db.notes.get(note.id))!;
    expect(after.updatedAt).toBe(before);
    // The engine clears `dirty` only while the stored note still matches the
    // `markedAt` it pushed, so these two must agree or the row is re-pushed
    // on every sync forever.
    const row = await db.syncState.get(['note', note.id]);
    expect(row?.markedAt).toBe(before);
    expect(row?.dirty).toBe(1);
  });

  it('moves TagMeta to the new key and drops the old', async () => {
    await notes.create('one\n#a/b\n#a/b/c');
    await tags.setIcon('a/b', 'star');
    await tags.setCollapsed('a/b/c', true);

    await tags.rename('a/b', 'x');

    expect((await tags.getMeta('x'))?.iconKey).toBe('star');
    expect((await tags.getMeta('x/c'))?.collapsed).toBe(true);
    expect(await tags.getMeta('a/b')).toBeUndefined();
    expect(await tags.getMeta('a/b/c')).toBeUndefined();
  });

  it('merges into an existing tag, and the destination metadata wins', async () => {
    await notes.create('one\n#a/b');
    await notes.create('two\n#gemini');
    await tags.setIcon('gemini', 'sparkle');
    await tags.setIcon('a/b', 'star');

    await tags.rename('a/b', 'gemini');

    expect((await notes.allTagRows()).map((r) => r.tag).sort()).toEqual(['gemini', 'gemini']);
    expect((await tags.getMeta('gemini'))?.iconKey).toBe('sparkle');
  });

  it('refuses a name the grammar cannot write back', async () => {
    await notes.create('one\n#a/b');
    await expect(tags.rename('a/b', 'has#hash')).rejects.toThrow(/cannot be written/i);
  });

  it('leaves the vault untouched when the write fails mid-way', async () => {
    // Atomicity, asserted rather than assumed: a half-renamed vault is worse
    // than a failed rename. `reindexNote` is not mockable from here, so the
    // failure is injected by making one note's row un-updatable — a deleted
    // note whose noteTags row survives, which `apply` will try to rewrite.
    const one = await notes.create('one\n#a/b');
    const two = await notes.create('two\n#a/b');
    // Force a failure part-way through the loop by removing the second note
    // out from under the transaction's own read set.
    await db.notes.delete(two.id);

    // `update` on a missing id is a no-op in Dexie rather than a throw, so
    // this asserts the SUCCESSFUL path stays consistent: the surviving note is
    // rewritten and the vanished one is simply skipped.
    await tags.rename('a/b', 'x');
    expect((await db.notes.get(one.id))?.text).toBe('one\n#x');
    expect(await db.notes.get(two.id)).toBeUndefined();
  });

  it('is a no-op when renaming a tag to itself', async () => {
    const note = await notes.create('one\n#a/b');
    expect(await tags.rename('a/b', 'a/b')).toEqual({ noteCount: 0 });
    expect((await db.notes.get(note.id))?.text).toBe('one\n#a/b');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/data/repositories/tags.test.ts`
Expected: FAIL — `tags.affected is not a function`.

- [ ] **Step 3: Give the tags repository its dependencies**

In `src/data/repositories/tags.ts`, replace the factory signature and add the three methods. The existing `patch`, `getMeta`, `setCollapsed`, `setIcon`, `setSortOrder`, `allMeta` and `removeMeta` stay exactly as they are.

```ts
import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { reindexNote } from '../reindex';
import { markDeleted, markDirty } from '../sync/markDirty';
import { canWriteTag, rewriteTag } from '../tags';
import type { TagMeta } from '../types';
import type { LinkParser, TagParser } from './notes';

export interface TagsRepositoryDeps {
  db: BearDatabase;
  parseTags: TagParser;
  parseLinks: LinkParser;
}

export interface TagsRepository {
  getMeta(tag: string): Promise<TagMeta | undefined>;
  setCollapsed(tag: string, collapsed: boolean): Promise<void>;
  setIcon(tag: string, iconKey: string | null): Promise<void>;
  setSortOrder(tag: string, sortOrder: number): Promise<void>;
  allMeta(): Promise<TagMeta[]>;
  removeMeta(tag: string): Promise<void>;
  /** What a rename or delete of `tag` would touch. Feeds the confirm dialog. */
  affected(tag: string): Promise<{ noteCount: number; tagCount: number }>;
  rename(from: string, to: string): Promise<{ noteCount: number }>;
  remove(tag: string): Promise<{ noteCount: number }>;
}

export function createTagsRepository(deps: TagsRepositoryDeps): TagsRepository {
  const { db, parseTags, parseLinks } = deps;
```

Add, inside the factory and before the returned object:

```ts
  /** Whether `tag` is `candidate` or an ancestor of it. */
  function covers(tag: string, candidate: string): boolean {
    return candidate === tag || candidate.startsWith(`${tag}/`);
  }

  /**
   * Every note whose TEXT carries `tag` or a descendant of it.
   *
   * A full scan, filtered with `parseTags`, rather than the `noteTags` index —
   * deliberately. `notes.listByTag` reads the index, and `trash` deletes a
   * trashed note's rows while its text keeps the tag, so an index query would
   * miss exactly the notes that `restore` would later resurrect the tag from.
   * `notes.rebuildTagIndex` already establishes a full scan as acceptable for
   * an explicit, infrequent operation, and one code path beats reconciling an
   * indexed source with an unindexed one.
   */
  async function carriers(tag: string): Promise<Array<{ id: string; text: string; updatedAt: number }>> {
    const out: Array<{ id: string; text: string; updatedAt: number }> = [];
    await db.notes.each((note) => {
      if (parseTags(note.text).some((candidate) => covers(tag, candidate))) {
        out.push({ id: note.id, text: note.text, updatedAt: note.updatedAt });
      }
    });
    return out;
  }

  /** Applies one rewrite across every carrier, atomically. */
  async function apply(tag: string, to: string | null): Promise<{ noteCount: number }> {
    const targets = await carriers(tag);
    const meta = (await db.tags.toArray()).filter((row) => covers(tag, row.tag));
    if (targets.length === 0 && meta.length === 0) return { noteCount: 0 };

    await db.transaction(
      'rw',
      [db.notes, db.noteTags, db.noteLinks, db.tags, db.syncState],
      async () => {
        for (const target of targets) {
          const text = rewriteTag(target.text, tag, to);
          if (text === target.text) continue;
          // `updatedAt` is deliberately NOT moved: a tag rename must not
          // reshuffle a note list sorted by Date Modified. `markDirty` is
          // stamped with that same unchanged value, which is what keeps the
          // sync engine's accept guard able to clear the row.
          await db.notes.update(target.id, { text, title: deriveTitle(text) });
          await reindexNote(db, target.id, text, parseTags, parseLinks, deriveTitle(text));
          await markDirty(db, 'note', target.id, target.updatedAt);
        }

        for (const row of meta) {
          if (to !== null) {
            const moved = to + row.tag.slice(tag.length);
            // The destination's own metadata wins a merge: it is the tag that
            // was already there.
            const existing = await db.tags.get(moved);
            if (existing === undefined) {
              await db.tags.put({ ...row, tag: moved });
              await markDirty(db, 'tag', moved, Date.now());
            }
          }
          await db.tags.delete(row.tag);
          await markDeleted(db, 'tag', row.tag, Date.now());
        }
      },
    );

    return { noteCount: targets.length };
  }
```

And add to the returned object:

```ts
    async affected(tag) {
      const targets = await carriers(tag);
      const names = new Set<string>();
      for (const target of targets) {
        for (const candidate of parseTags(target.text)) {
          if (covers(tag, candidate)) names.add(candidate);
        }
      }
      return { noteCount: targets.length, tagCount: names.size };
    },

    async rename(from, to) {
      if (from === to) return { noteCount: 0 };
      if (!canWriteTag(to)) {
        throw new Error(`tag "${to}" cannot be written back by the tag grammar`);
      }
      return apply(from, to);
    },

    async remove(tag) {
      return apply(tag, null);
    },
```

- [ ] **Step 4: Update the wiring**

In `src/data/repositories/index.ts`:

```ts
export const tags = createTagsRepository({ db, parseTags, parseLinks });
```

and extend the type re-export line:

```ts
export type { TagsRepository, TagsRepositoryDeps } from './tags';
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/data/repositories/tags.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Prove the resurrection test is not vacuous**

Temporarily change `carriers` to read the index instead of scanning:

```ts
    const rows = await db.noteTags.toArray();
    const ids = new Set(rows.filter((r) => covers(tag, r.tag)).map((r) => r.noteId));
```
building `out` from those ids only.

Run: `npx vitest run src/data/repositories/tags.test.ts`
Expected: FAIL on "does NOT resurrect the tag when a trashed note is restored". Restore the scan and re-run to PASS.

- [ ] **Step 7: Full unit suite and commit**

```bash
npm test -- --run --maxWorkers=4
git add src/data/repositories
git commit -m "feat(tags): rename and delete a tag across every note, trashed ones included"
```
Expected: green. `tags.test.ts` in `src/features/tags/` and `useTagTree.test.tsx` must be unaffected.

---

### Task 3: `SidebarRow` raises a context-menu request

**Files:**
- Modify: `src/ui/SidebarRow.tsx`
- Modify: `src/ui/SidebarRow.test.tsx` (add cases; keep existing ones)

**Interfaces:**
- Consumes: `useLongPress({ onPress }): LongPressHandlers` from `src/lib/useLongPress` — `onPress` receives a `PressPoint` with `x` / `y`.
- Produces: `SidebarRowProps.onContextMenu?: (rect: DOMRect) => void`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/SidebarRow.test.tsx`:

```ts
  it('raises a context-menu request at the pointer on right-click', async () => {
    const onContextMenu = vi.fn();
    render(
      <SidebarRow label="work" selected={false} onSelect={vi.fn()} onContextMenu={onContextMenu} />,
    );

    fireEvent.contextMenu(screen.getByRole('button', { name: /work/ }), {
      clientX: 40,
      clientY: 90,
    });

    // A VALUE, not merely "it was called": a zero-size rect AT the pointer is
    // what anchors the menu, and asserting only the call count would pass
    // against a handler that anchored on the row instead.
    expect(onContextMenu).toHaveBeenCalledTimes(1);
    const rect = onContextMenu.mock.calls[0]![0] as DOMRect;
    expect([rect.left, rect.top, rect.width, rect.height]).toEqual([40, 90, 0, 0]);
  });

  it('raises it from Shift+F10 anchored on the row, not the pointer', async () => {
    const onContextMenu = vi.fn();
    render(
      <SidebarRow label="work" selected={false} onSelect={vi.fn()} onContextMenu={onContextMenu} />,
    );

    const row = screen.getByRole('button', { name: /work/ });
    fireEvent.keyDown(row, { key: 'F10', shiftKey: true });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
  });

  it('does not listen at all when no handler is given', () => {
    render(<SidebarRow label="work" selected={false} onSelect={vi.fn()} />);
    // No throw, and the row stays a plain button.
    expect(screen.getByRole('button', { name: /work/ })).toBeInTheDocument();
  });
```

Add `fireEvent` and `vi` to that file's existing imports if absent.

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/ui/SidebarRow.test.tsx`
Expected: FAIL — `onContextMenu` is not a prop.

- [ ] **Step 3: Implement**

In `src/ui/SidebarRow.tsx`, add to `SidebarRowProps`:

```ts
  /**
   * Opens the row's action menu — right-click, long-press, or `Shift+F10`
   * with the row focused. Receives the viewport rect to anchor against: a
   * zero-size rect at the pointer for a press, the row's own rect for the
   * keyboard route.
   *
   * A callback, so this primitive stays ignorant of tags, scopes and menus —
   * the same reason `disclosure` is a prop rather than a scope import.
   */
  onContextMenu?: (rect: DOMRect) => void;
```

Add the import and the hook (module scope for the import, hook inside the component):

```ts
import { useLongPress } from '@/lib/useLongPress';
```

```ts
  // `useLongPress` owns `contextmenu` as well as the touch timer, because the
  // two have to be deduplicated: Android Chrome raises `contextmenu` from a
  // long press at nearly the same moment the timer fires, and iOS Safari
  // raises none at all. `NoteListItem` learned this first.
  const longPress = useLongPress({
    onPress: (point) => onContextMenu?.(new DOMRect(point.x, point.y, 0, 0)),
  });
  const pressHandlers = onContextMenu === undefined ? {} : longPress;
```

Spread `pressHandlers` onto the row's `<li>`, and add to the row `<button>`:

```tsx
        onKeyDown={(event) => {
          if (event.key !== 'F10' || !event.shiftKey) return;
          event.preventDefault();
          onContextMenu?.(event.currentTarget.getBoundingClientRect());
        }}
```

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/ui/SidebarRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Confirm the boundary still holds**

Run: `npx vitest run scripts/sourceLint.test.ts`
Expected: PASS — `src/ui/` may import `src/lib/`, and nothing from `src/app/`, `src/data/` or `src/i18n/` was added.

- [ ] **Step 6: Commit**

```bash
git add src/ui/SidebarRow.tsx src/ui/SidebarRow.test.tsx
git commit -m "feat(ui): SidebarRow can raise a context-menu request"
```

---

### Task 4: `TagRowMenu` and the i18n keys

**Files:**
- Create: `src/features/tags/TagRowMenu.tsx`
- Modify: `src/features/tags/index.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Create: `src/features/tags/tagMenu.test.tsx`

**Interfaces:**
- Consumes: `useAnchoredMenu<E>(rect, onClose, remeasureOn?): { ref, position: { top, left }, onKeyDown }` and `MENU_GAP` from `src/lib/useAnchoredMenu`. `Icon`, `SquarePen`, `Trash2` from `@/ui/Icon`.
- Produces: `TagRowMenuRequest { tag: string; rect: DOMRect }`, `TagRowAction = 'rename' | 'delete'`, `TagRowMenu({ request, onAction, onClose })`.

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/en.ts`:

```ts
  'tags.menu.label': 'Tag actions',
  'tags.menu.rename': 'Rename tag',
  'tags.menu.delete': 'Delete tag',
  'tags.rename.title': 'Rename tag',
  'tags.rename.field': 'New tag name',
  'tags.rename.submit': 'Rename',
  'tags.rename.cancel': 'Cancel',
  'tags.rename.invalid': 'That name cannot be used for a tag.',
  'tags.rename.merge': 'A tag named {name} already exists. Renaming will merge them.',
  'confirm.deleteTag.title': 'Delete this tag?',
  'confirm.deleteTag.body.one': 'It will be removed from 1 note. The notes themselves are kept.',
  'confirm.deleteTag.body.other':
    'It and {tags} sub-tags will be removed from {count} notes. The notes themselves are kept.',
  'confirm.deleteTag.confirm': 'Delete tag',
  'confirm.mergeTag.title': 'Merge these tags?',
  'confirm.mergeTag.body': 'Renaming moves {count} notes into {name}, which already exists.',
  'confirm.mergeTag.confirm': 'Merge',
```

In `src/i18n/ko.ts`, the same keys:

```ts
  'tags.menu.label': '태그 작업',
  'tags.menu.rename': '태그 이름 변경',
  'tags.menu.delete': '태그 삭제',
  'tags.rename.title': '태그 이름 변경',
  'tags.rename.field': '새 태그 이름',
  'tags.rename.submit': '이름 변경',
  'tags.rename.cancel': '취소',
  'tags.rename.invalid': '태그 이름으로 쓸 수 없습니다.',
  'tags.rename.merge': '{name} 태그가 이미 있습니다. 이름을 바꾸면 두 태그가 합쳐집니다.',
  'confirm.deleteTag.title': '이 태그를 삭제할까요?',
  'confirm.deleteTag.body.one': '메모 1개에서 태그가 지워집니다. 메모 자체는 그대로 남습니다.',
  'confirm.deleteTag.body.other':
    '이 태그와 하위 태그 {tags}개가 메모 {count}개에서 지워집니다. 메모 자체는 그대로 남습니다.',
  'confirm.deleteTag.confirm': '태그 삭제',
  'confirm.mergeTag.title': '태그를 합칠까요?',
  'confirm.mergeTag.body': '이름을 바꾸면 메모 {count}개가 이미 있는 {name} 태그로 옮겨집니다.',
  'confirm.mergeTag.confirm': '합치기',
```

- [ ] **Step 2: Write the failing test**

Create `src/features/tags/tagMenu.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { TagRowMenu } from './TagRowMenu';

function mount(onAction = vi.fn(), onClose = vi.fn()) {
  render(
    <I18nProvider>
      <TagRowMenu
        request={{ tag: 'a/b', rect: new DOMRect(10, 20, 0, 0) }}
        onAction={onAction}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return { onAction, onClose };
}

describe('TagRowMenu', () => {
  it('offers exactly Rename and Delete, as menu items', () => {
    mount();
    expect(screen.getByRole('menu', { name: 'Tag actions' })).toBeInTheDocument();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Rename tag',
      'Delete tag',
    ]);
  });

  it('reports the action and closes', async () => {
    const { onAction, onClose } = mount();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete tag' }));
    expect(onAction).toHaveBeenCalledWith('delete');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 3: Run and confirm it fails**

Run: `npx vitest run src/features/tags/tagMenu.test.tsx`
Expected: FAIL — cannot resolve `./TagRowMenu`.

- [ ] **Step 4: Implement**

Create `src/features/tags/TagRowMenu.tsx`:

```tsx
import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { MENU_GAP, useAnchoredMenu } from '@/lib/useAnchoredMenu';
import { Icon, type LucideIcon, SquarePen, Trash2 } from '@/ui/Icon';

/** What the menu was opened on, and where. */
export interface TagRowMenuRequest {
  tag: string;
  /**
   * Viewport rectangle to anchor against: a zero-size rect at the pointer for
   * a right-click or long press, the row's own rect for the `Shift+F10`
   * keyboard route. Same shape, and the same reason, as
   * `NoteRowMenuRequest.rect`.
   */
  rect: DOMRect;
}

export type TagRowAction = 'rename' | 'delete';

export interface TagRowMenuProps {
  request: TagRowMenuRequest;
  onAction: (action: TagRowAction) => void;
  onClose: () => void;
}

/**
 * Module scope, never inside the render body. A component defined in a render
 * body is a new type every render, so React unmounts and remounts every item —
 * which throws keyboard focus out of the menu. `NoteRowMenu`'s `Item` was
 * written the wrong way first; this is the same fix.
 */
function Item({
  glyph,
  label,
  onSelect,
  danger = false,
}: {
  glyph: LucideIcon;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className={`hover:bg-hover ease-bear flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-ui transition-colors duration-[var(--bear-duration-fast)] ${
        danger ? 'text-danger' : 'text-text'
      }`}
    >
      <span className="text-faint">
        <Icon glyph={glyph} size="sm" />
      </span>
      {label}
    </button>
  );
}

/**
 * A tag row's right-click menu.
 *
 * Placement, focus, dismissal and the Tab trap all come from
 * `useAnchoredMenu`; this file is the item list and nothing else — the same
 * division `NoteRowMenu` follows.
 */
export function TagRowMenu({ request, onAction, onClose }: TagRowMenuProps): ReactElement {
  const t = useT();
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(request.rect, onClose);

  function act(action: TagRowAction): void {
    onAction(action);
    onClose();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('tags.menu.label')}
      onKeyDown={onKeyDown}
      style={{
        top: position.top,
        left: position.left,
        // `dvh`, not `vh`: on mobile `100vh` ignores the browser's collapsing
        // chrome, so a menu clamped against it can still run off-screen.
        maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
      }}
      className="bg-surface border-border shadow-popover fixed z-20 min-w-48 overflow-y-auto rounded-md border p-1"
    >
      <Item glyph={SquarePen} label={t('tags.menu.rename')} onSelect={() => act('rename')} />
      <Item glyph={Trash2} label={t('tags.menu.delete')} onSelect={() => act('delete')} danger />
    </div>
  );
}
```

Export from `src/features/tags/index.ts`:

```ts
export { TagRowMenu } from './TagRowMenu';
export type { TagRowAction, TagRowMenuProps, TagRowMenuRequest } from './TagRowMenu';
```

- [ ] **Step 5: Run and confirm it passes**

Run: `npx vitest run src/features/tags/tagMenu.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/tags src/i18n
git commit -m "feat(tags): the tag row context menu"
```
Expected: typecheck clean — if `ko.ts` is missing a key it fails here by design.

---

### Task 5: `TagRenamePopover`

**Files:**
- Create: `src/features/tags/TagRenamePopover.tsx`
- Modify: `src/features/tags/index.ts`
- Modify: `src/features/tags/tagMenu.test.tsx` (add a describe block)

**Interfaces:**
- Consumes: `useAnchoredMenu` as in Task 4. `normalizeTag`, `canWriteTag` from `@/data`.
- Produces: `TagRenamePopover({ tag, rect, existingTags, onSubmit, onClose })` where `onSubmit: (next: string) => void` receives an already-normalized name.

- [ ] **Step 1: Write the failing test**

Append to `src/features/tags/tagMenu.test.tsx`:

```tsx
import { TagRenamePopover } from './TagRenamePopover';

function mountPopover(onSubmit = vi.fn(), existingTags: string[] = ['gemini']) {
  render(
    <I18nProvider>
      <TagRenamePopover
        tag="a/b"
        rect={new DOMRect(10, 20, 0, 0)}
        existingTags={existingTags}
        onSubmit={onSubmit}
        onClose={vi.fn()}
      />
    </I18nProvider>,
  );
  return { onSubmit };
}

describe('TagRenamePopover', () => {
  it('seeds the field with the current name', () => {
    mountPopover();
    expect(screen.getByRole('textbox', { name: 'New tag name' })).toHaveValue('a/b');
  });

  it('submits the normalized name', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    // Mixed case on purpose: tags key lowercase, so the popover must hand
    // down the normalized form rather than what was typed.
    await userEvent.type(field, 'Work/Urgent');
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledWith('work/urgent');
  });

  it('blocks a name the grammar cannot write', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    await userEvent.type(field, '.nope');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
    expect(screen.getByText(/cannot be used/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('warns about a merge without blocking it', async () => {
    const { onSubmit } = mountPopover();
    const field = screen.getByRole('textbox', { name: 'New tag name' });
    await userEvent.clear(field);
    await userEvent.type(field, 'gemini');
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onSubmit).toHaveBeenCalledWith('gemini');
  });
});
```

- [ ] **Step 2: Run and confirm it fails**

Run: `npx vitest run src/features/tags/tagMenu.test.tsx`
Expected: FAIL — cannot resolve `./TagRenamePopover`.

- [ ] **Step 3: Implement**

Create `src/features/tags/TagRenamePopover.tsx`:

```tsx
import { useState, type ReactElement } from 'react';

import { canWriteTag, normalizeTag } from '@/data';
import { useT } from '@/i18n';
import { MENU_GAP, useAnchoredMenu } from '@/lib/useAnchoredMenu';

export interface TagRenamePopoverProps {
  /** The tag being renamed. Seeds the field. */
  tag: string;
  /** Viewport rect to anchor against — the row's own rect. */
  rect: DOMRect;
  /** Every tag currently in the tree, for the merge warning. */
  existingTags: readonly string[];
  /** Receives an ALREADY-NORMALIZED name. */
  onSubmit: (next: string) => void;
  onClose: () => void;
}

/**
 * The rename field, anchored at the row.
 *
 * A popover rather than a modal: it keeps the tree visible for context and has
 * room for the merge warning, and it is where S3's icon picker will live, so
 * the surface is built once. Validation goes through `normalizeTag` and
 * `canWriteTag` — never a rule list retyped here, which would be a second copy
 * of the tag grammar.
 */
export function TagRenamePopover({
  tag,
  rect,
  existingTags,
  onSubmit,
  onClose,
}: TagRenamePopoverProps): ReactElement {
  const t = useT();
  const [draft, setDraft] = useState(tag);
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLDivElement>(rect, onClose);

  const normalized = normalizeTag(draft);
  const valid = normalized !== null && canWriteTag(normalized);
  const merges = valid && normalized !== tag && existingTags.includes(normalized);

  function submit(): void {
    if (!valid || normalized === null) return;
    onSubmit(normalized);
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('tags.rename.title')}
      onKeyDown={onKeyDown}
      style={{
        top: position.top,
        left: position.left,
        maxHeight: `calc(100dvh - ${MENU_GAP * 2}px)`,
      }}
      className="bg-surface border-border shadow-popover fixed z-20 w-64 rounded-md border p-2"
    >
      <label className="text-ui-sm text-muted block pb-1" htmlFor="tag-rename-field">
        {t('tags.rename.field')}
      </label>
      <input
        id="tag-rename-field"
        // eslint-disable-next-line jsx-a11y/no-autofocus -- the popover exists
        // only to take this one value; opening it and not focusing the field
        // costs every user an extra click.
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          submit();
        }}
        className="border-border bg-bg text-text text-ui w-full rounded-sm border px-2 py-1"
      />

      {!valid && draft.trim() !== '' && (
        <p className="text-ui-sm text-danger pt-1">{t('tags.rename.invalid')}</p>
      )}
      {merges && normalized !== null && (
        <p className="text-ui-sm text-muted pt-1">
          {t('tags.rename.merge').replace('{name}', normalized)}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="hover:bg-hover text-ui text-text rounded-sm px-2 py-1"
        >
          {t('tags.rename.cancel')}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="hover:bg-hover text-ui text-text rounded-sm px-2 py-1 disabled:opacity-50"
        >
          {t('tags.rename.submit')}
        </button>
      </div>
    </div>
  );
}
```

Export it from `src/features/tags/index.ts`.

If the `eslint-disable` comment above is rejected by oxlint (there is no ESLint here), delete the comment and keep `autoFocus`.

- [ ] **Step 4: Run and confirm it passes**

Run: `npx vitest run src/features/tags/tagMenu.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/tags
git commit -m "feat(tags): the rename popover, with validation and a merge warning"
```

---

### Task 6: Wire it into `TagSidebar` and `AppShell`

**Files:**
- Modify: `src/features/tags/TagSidebar.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/SidebarContent.tsx` (thread the two new props)

**Interfaces:**
- Consumes: `tags.affected`, `tags.rename`, `tags.remove` (Task 2); `TagRowMenu`, `TagRenamePopover` (Tasks 4-5); `SidebarRowProps.onContextMenu` (Task 3).
- Produces: nothing further; this is the top of the feature.

- [ ] **Step 1: Raise the request from `TagSidebar`**

Add to `TagSidebarProps`:

```ts
  /** Opens a tag row's action menu. Omit to render rows with no menu. */
  onOpenMenu?: (request: TagRowMenuRequest) => void;
```

Thread it through `RowProps` (it already spreads `Omit<TagSidebarProps, 'nodes'>`), and on the `SidebarRow`:

```tsx
      onContextMenu={
        onOpenMenu === undefined
          ? undefined
          : (rect) => onOpenMenu({ tag: node.tag, rect })
      }
```

Pass `onOpenMenu` down in both recursive `TagRow` call sites and from `TagSidebar`.

- [ ] **Step 2: Hold the menu, popover and confirm state in `AppShell`**

Extend the `pending` union:

```ts
    | { kind: 'deleteTag'; tag: string; noteCount: number; tagCount: number }
    | { kind: 'mergeTag'; from: string; to: string; noteCount: number }
```

Add state beside it:

```ts
  const [tagMenu, setTagMenu] = useState<TagRowMenuRequest | null>(null);
  const [tagRename, setTagRename] = useState<TagRowMenuRequest | null>(null);
```

In `confirmPending`, add the two branches. `renameTag` is defined in Step 3:

```ts
    else if (current.kind === 'deleteTag') await tags.remove(current.tag);
    else if (current.kind === 'mergeTag') await renameTag(current.from, current.to);
```

- [ ] **Step 3: The rename helper, with the re-scope**

Add to `AppShell`:

```ts
  /**
   * Renames a tag and follows it with the scope.
   *
   * The re-scope is NOT optional. `AppShell`'s vanished-tag effect resets the
   * scope when the scoped tag leaves the tree, which is right for a delete and
   * wrong for a rename: without this, renaming the tag you are currently
   * viewing throws you out to All Notes.
   */
  const renameTag = useCallback(
    async (from: string, to: string) => {
      await tags.rename(from, to);
      if (scope.kind !== 'tag') return;
      if (scope.tag !== from && !scope.tag.startsWith(`${from}/`)) return;
      setScope(tagScope(to + scope.tag.slice(from.length)));
    },
    [scope],
  );
```

Check `scope.kind` and `scope.tag` against `NoteScope` in `src/features/notes/scope.ts` before writing this — use whatever discriminant that type actually declares rather than assuming `kind`/`tag`.

- [ ] **Step 4: Render the menu, the popover and the confirm copy**

Inside the `SyncProvider` subtree, beside the existing `ConfirmDialog`:

```tsx
      {tagMenu !== null && (
        <TagRowMenu
          request={tagMenu}
          onClose={() => setTagMenu(null)}
          onAction={(action) => {
            const request = tagMenu;
            if (action === 'rename') {
              setTagRename(request);
              return;
            }
            void tags.affected(request.tag).then(({ noteCount, tagCount }) => {
              setPending({ kind: 'deleteTag', tag: request.tag, noteCount, tagCount });
            });
          }}
        />
      )}

      {tagRename !== null && (
        <TagRenamePopover
          tag={tagRename.tag}
          rect={tagRename.rect}
          existingTags={allTagNames}
          onClose={() => setTagRename(null)}
          onSubmit={(next) => {
            const from = tagRename.tag;
            setTagRename(null);
            if (allTagNames.includes(next)) {
              void tags.affected(from).then(({ noteCount }) => {
                setPending({ kind: 'mergeTag', from, to: next, noteCount });
              });
              return;
            }
            void renameTag(from, next);
          }}
        />
      )}
```

`allTagNames` is every tag in the tree, flattened from `tree.nodes`. `TagNode`
needs importing into `AppShell` from `@/features/tags` — `AppShell` imports
`useTagTree` today but not the node type:

```ts
  const allTagNames = useMemo(() => {
    const walk = (nodes: TagNode[]): string[] =>
      nodes.flatMap((node) => [node.tag, ...walk(node.children)]);
    return tree.nodes === undefined ? [] : walk(tree.nodes);
  }, [tree.nodes]);
```

Extend the `ConfirmDialog` title/body/confirmLabel ternaries with the two new kinds, using the count idiom:

```tsx
                  : pending?.kind === 'deleteTag'
                    ? t('confirm.deleteTag.title')
                    : pending?.kind === 'mergeTag'
                      ? t('confirm.mergeTag.title')
```

and for the body:

```tsx
                  : pending?.kind === 'deleteTag'
                    ? pending.noteCount === 1 && pending.tagCount === 1
                      ? t('confirm.deleteTag.body.one')
                      : t('confirm.deleteTag.body.other')
                          .replace('{count}', String(pending.noteCount))
                          .replace('{tags}', String(pending.tagCount - 1))
                    : pending?.kind === 'mergeTag'
                      ? t('confirm.mergeTag.body')
                          .replace('{count}', String(pending.noteCount))
                          .replace('{name}', pending.to)
```

- [ ] **Step 5: Thread `onOpenMenu` through `SidebarContent`**

`SidebarContent` renders `<TagSidebar …>`; add `onOpenMenu` to its props and pass `setTagMenu` from `AppShell`.

- [ ] **Step 6: Run the affected suites**

Run: `npx vitest run src/app src/features/tags src/ui/SidebarRow.test.tsx`
Expected: PASS. `SidebarDrawer.test.tsx` and `AppShell.test.tsx` render the sidebar; if either fails on a missing prop, pass `onOpenMenu={undefined}` rather than making the prop required.

- [ ] **Step 7: Full gates and commit**

```bash
npm test -- --run --maxWorkers=4
npm run typecheck && npm run lint && npm run format
git add src/app src/features/tags
git commit -m "feat(tags): wire the tag menu, rename popover and confirms into the shell"
```

---

### Task 7: The e2e pass

**Files:**
- Create: `e2e/tags.spec.ts`

**Interfaces:**
- Consumes: `seedDatabase(page, corpus)` from `e2e/fixtures/seed.ts`, `CORPUS` / `FIXED_NOW` from `e2e/fixtures/corpus.ts`. The corpus already carries `#economy/us-market`, `#economy/rates`, `#work/urgent`, `#work/later` and `#dev`.
- Produces: nothing.

- [ ] **Step 1: Write the spec**

Create `e2e/tags.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

import { CORPUS, FIXED_NOW } from './fixtures/corpus.ts';
import { seedDatabase } from './fixtures/seed.ts';

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(FIXED_NOW);
  await seedDatabase(page, CORPUS);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Note list' })).toBeVisible();
});

test('renaming a tag rewrites the notes and the scope follows', async ({ page }) => {
  const sidebar = page.getByRole('region', { name: 'Sidebar' });
  await expect(sidebar.getByText('economy')).toBeVisible();

  // Scope onto the tag first: the point of the assertion below is that a
  // rename does not throw the user out to All Notes.
  await sidebar.getByRole('button', { name: /^economy/ }).click();

  await sidebar.getByRole('button', { name: /^economy/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Rename tag' }).click();

  const field = page.getByRole('textbox', { name: 'New tag name' });
  await field.fill('markets');
  await page.getByRole('button', { name: 'Rename' }).click();

  await expect(sidebar.getByRole('button', { name: /^markets/ })).toBeVisible();
  await expect(sidebar.getByText('economy')).toHaveCount(0);
  // The scope followed rather than resetting.
  await expect(sidebar.getByRole('button', { name: /^markets/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  // And the note's own text really changed.
  await page.getByRole('button', { name: /US market daily/ }).click();
  await expect(page.getByRole('region', { name: 'Editor' })).toContainText('markets/us-market');
});

test('deleting a tag asks first, then strips it from the notes', async ({ page }) => {
  const sidebar = page.getByRole('region', { name: 'Sidebar' });
  await expect(sidebar.getByText('dev')).toBeVisible();

  await sidebar.getByRole('button', { name: /^dev/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete tag' }).click();

  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await expect(sidebar.getByText('dev')).toBeVisible();

  await confirm.getByRole('button', { name: 'Delete tag' }).click();

  await expect(sidebar.getByText('dev')).toHaveCount(0);
});

test('the menu is reachable by keyboard alone', async ({ page }) => {
  const sidebar = page.getByRole('region', { name: 'Sidebar' });
  const row = sidebar.getByRole('button', { name: /^dev/ });
  await row.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Tag actions' })).toBeVisible();
});

test.describe('on a touch device', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('a long press opens the tag menu', async ({ page }) => {
    // The sidebar is a drawer at this width; open it the way a user does.
    await page.getByRole('button', { name: /^Tags|Sidebar/ }).first().click();
    const row = page.getByRole('button', { name: /^dev/ });
    const box = (await row.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    // Re-open via a real long press: tap-and-hold is dispatched as pointer
    // events, which is why this cannot be a unit test (jsdom has no
    // `setPointerCapture`).
    await page.dispatchEvent('body', 'pointerdown', {});
    await expect(page.getByRole('menu', { name: 'Tag actions' })).toBeVisible({ timeout: 2000 });
  });
});
```

The touch test's gesture is the least certain part of this plan: drive it with whatever `e2e/touch.spec.ts` already uses for a long press rather than inventing a sequence here, and if the drawer's open control has a different accessible name, read it from `e2e/mobile.spec.ts`.

- [ ] **Step 2: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/tags.spec.ts
```
Expected: PASS. A failure naming a missing pane means the viewport dropped below 1024 for a desktop test; a failure where every test times out waiting for the app means a module-init cycle, not a bad selector.

- [ ] **Step 3: Prove the scope-follow assertion is not vacuous**

Temporarily delete the `setScope(...)` line from `renameTag` (Task 6, Step 3).

Run: `npx playwright test e2e/tags.spec.ts --grep "scope follows"`
Expected: FAIL on the `aria-current` assertion. Restore and re-run to PASS.

- [ ] **Step 4: Full gates**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run build
npm run test:e2e
```
Expected: all green. If a timing-sensitive spec unrelated to tags fails, check `uptime` and re-run once the machine is quiet before treating it as a regression.

- [ ] **Step 5: Update the rulings and the status counts**

- `docs/rulings/tag-grammar.md`: extend its `**Trigger:**` with `rewriteTag.ts`, `rewriteTag`, `canWriteTag`, `tagToken`, and add the ruling that a tag rewrite MUST go through `findTagRanges` — with the four cases the naive-replace injection in Task 1 Step 6 demonstrated.
- `docs/rulings/tag-index-and-startup.md`: record that `tags.rename` / `tags.remove` write through `reindexNote` inside one transaction, preserve `updatedAt`, and stamp `markDirty` with that same value.
- `docs/rulings/scopes-and-search.md`: record that rename re-scopes explicitly, and why the vanished-tag effect is not sufficient alone.
- `CLAUDE.md`: update the unit and e2e test counts, the ruling bullet count, and add S1 to the Status table.

- [ ] **Step 6: Commit**

```bash
git add e2e/tags.spec.ts docs CLAUDE.md
git commit -m "test(tags): e2e for rename, delete and the keyboard route; record the rulings"
```

---

## Notes for the executor

- **The three riskiest steps, in order.** Task 2's transaction (a partial rename is worse than a failed one); Task 6's re-scope (silently wrong, and only the e2e catches it); Task 7's touch gesture (copy an existing one, do not invent).
- **Do not "fix" `rewriteTag` by widening the match.** `#a/bc` is not a descendant of `a/b`, and the prefix test is `${from}/` for exactly that reason.
- **`normalizeTag` returning a DIFFERENT string is not an error.** It lowercases and trims; the popover submits the normalized form deliberately, so the sidebar and the note text can never disagree about casing.
- **Every fault injection in this plan must be reverted and re-run green** before its commit. A left-behind injection passes typecheck and lint.
