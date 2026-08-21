# A — Note-list header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the note list a header that names the current scope and opens a flat menu carrying a note count, sort order, preview density, a sub-tag filter, and every scope with a `⇧⌘`+digit shortcut.

**Architecture:** Ordering becomes a value the data layer accepts (`NoteOrder`) rather than a constant it hardcodes, so `scope.ts`'s "ordering comes from the repository and is never re-sorted here" ruling stands unchanged. Three preferences persist as rows in the existing `settings` table, read through a new `useSetting` hook. The header button and its flat `role="menu"` popover live in `src/features/notes/`; the global key handling moves out of `AppShell` into `src/app/useScopeShortcuts.ts`.

**Tech Stack:** React 19, TypeScript 6, Dexie + `dexie-react-hooks`, Tailwind v4, Vitest + Testing Library, Playwright, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-21-a-note-list-header-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **All six gates pass before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`. `npm run shots` and `npm run measure` are not part of the gate.
- **No hardcoded user-facing strings.** Every string goes through `useT`. Add the key to `src/i18n/en.ts` **and** `src/i18n/ko.ts`. `ko.ts` is `Record<TranslationKey, string>`; a missing translation is a compile error and the fix is to add the translation, never to weaken the annotation.
- **No literal colours.** Every colour comes from a `--bear-*` custom property via a Tailwind theme key. Literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **Components reach persistence only through `src/data/index.ts`**, never a repository module directly.
- **`src/ui/` imports nothing from `src/app/`, `src/data/`, `src/i18n/`.** `src/lib/` additionally imports nothing from `src/features/`. Enforced by `scripts/sourceLint.test.ts`, which resolves both `@/` and relative specifiers.
- **`erasableSyntaxOnly`:** no `enum`, no parameter properties, no namespaces. `verbatimModuleSyntax`: use `import type` / `export type`.
- **Duck-type in tests, never `instanceof`** — `vitest.setup.ts` swaps the global `Blob`.
- **Before any e2e run that follows a source change, and always before a fault injection:** `lsof -ti:4173 | xargs -r kill -9`. `playwright.config.ts` hardcodes port 4173 with `reuseExistingServer`, and a stale preview server makes the suite silently test an old build.
- **Express "not this utility" as a prop that omits the class**, never as an overriding utility. Stylesheet order decides the cascade, not class-attribute order.
- **Digit mapping, used verbatim wherever it appears:** `⇧⌘1` all, `⇧⌘2` untagged, `⇧⌘3` todo, `⇧⌘4` today, `⇧⌘5` pinned, `⇧⌘6` locked, `⇧⌘0` trash. `⇧⌘7`, `⇧⌘8`, `⇧⌘9` are unbound — 7/8/9 belong to `@tiptap` list and blockquote extensions.
- **Settings keys, verbatim:** `noteOrder`, `previewSize`, `hideSubTagNotes`.

---

### Task 1: `NoteOrder` and its comparator

**Files:**

- Create: `src/data/order.ts`
- Create: `src/data/order.test.ts`
- Modify: `src/data/index.ts`

**Interfaces:**

- Consumes: `Note` from `src/data/types.ts`.
- Produces: `NoteOrderField = 'updated' | 'created' | 'title'`; `NoteOrder = { field: NoteOrderField; newestFirst: boolean }`; `DEFAULT_NOTE_ORDER`; `compareNotes(order: NoteOrder): (a: Note, b: Note) => number`; `isNoteOrder(value: unknown): value is NoteOrder`. Tasks 2, 3, 4, 6, 7 all rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `src/data/order.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { compareNotes, DEFAULT_NOTE_ORDER, isNoteOrder, type NoteOrder } from './order';
import type { Note } from './types';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: 'Alpha',
    text: 'Alpha',
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/** Sorting a copy, because `.sort` mutates and a shared fixture would leak between tests. */
function sorted(notes: Note[], order: NoteOrder): string[] {
  return [...notes].sort(compareNotes(order)).map((n) => n.id);
}

describe('compareNotes', () => {
  const a = makeNote({ id: 'a', title: 'Apple', createdAt: 300, updatedAt: 100 });
  const b = makeNote({ id: 'b', title: 'Cherry', createdAt: 100, updatedAt: 300 });
  const c = makeNote({ id: 'c', title: 'Banana', createdAt: 200, updatedAt: 200 });
  const all = [a, b, c];

  it('orders by updatedAt, newest first', () => {
    expect(sorted(all, { field: 'updated', newestFirst: true })).toEqual(['b', 'c', 'a']);
  });

  it('orders by updatedAt, oldest first', () => {
    expect(sorted(all, { field: 'updated', newestFirst: false })).toEqual(['a', 'c', 'b']);
  });

  it('orders by createdAt independently of updatedAt', () => {
    expect(sorted(all, { field: 'created', newestFirst: true })).toEqual(['a', 'c', 'b']);
  });

  it('orders by title A to Z when newestFirst is false', () => {
    expect(sorted(all, { field: 'title', newestFirst: false })).toEqual(['a', 'c', 'b']);
  });

  it('inverts the title order too, not only the dates', () => {
    expect(sorted(all, { field: 'title', newestFirst: true })).toEqual(['b', 'c', 'a']);
  });

  it('orders Hangul titles by locale, not by codepoint', () => {
    // 하 (U+D558) precedes 한 (U+D55C) by codepoint, but `가` must come first
    // alphabetically. A `<` comparison happens to agree here; the case that
    // matters is that localeCompare is what decides.
    const ga = makeNote({ id: 'ga', title: '가나다' });
    const ha = makeNote({ id: 'ha', title: '하나' });
    const na = makeNote({ id: 'na', title: '나비' });
    expect(sorted([ha, na, ga], { field: 'title', newestFirst: false })).toEqual(['ga', 'na', 'ha']);
  });

  it('sorts untitled notes together under the empty title', () => {
    const untitled = makeNote({ id: 'z', title: '' });
    const titled = makeNote({ id: 'y', title: 'Anything' });
    expect(sorted([titled, untitled], { field: 'title', newestFirst: false })).toEqual(['z', 'y']);
  });

  it('breaks a title tie by id so the order is total and stable', () => {
    const first = makeNote({ id: 'a1', title: 'Same' });
    const second = makeNote({ id: 'a2', title: 'Same' });
    expect(sorted([second, first], { field: 'title', newestFirst: false })).toEqual(['a1', 'a2']);
  });
});

describe('isNoteOrder', () => {
  it('accepts the default', () => {
    expect(isNoteOrder(DEFAULT_NOTE_ORDER)).toBe(true);
  });

  it('rejects an unknown field, so a future settings row cannot reach the comparator', () => {
    expect(isNoteOrder({ field: 'size', newestFirst: true })).toBe(false);
  });

  it('rejects a non-boolean direction', () => {
    expect(isNoteOrder({ field: 'title', newestFirst: 'yes' })).toBe(false);
  });

  it('rejects null and non-objects', () => {
    expect(isNoteOrder(null)).toBe(false);
    expect(isNoteOrder('updated')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/order.test.ts`
Expected: FAIL — `Failed to resolve import "./order"`.

- [ ] **Step 3: Write the implementation**

Create `src/data/order.ts`:

```ts
import type { Note } from './types';

/**
 * The three orderings a user can choose. Deliberately NOT including the
 * trash's own `trashedAt` ordering: `listTrashed` keeps that, and offering it
 * as a fourth field would put a scope-specific concept in a global preference.
 */
export type NoteOrderField = 'updated' | 'created' | 'title';

export interface NoteOrder {
  field: NoteOrderField;
  /**
   * Inverts EVERY field, not only the dates — under `title` it means Z to A.
   * One boolean rather than three because that is what the single checkbox in
   * the menu controls.
   */
  newestFirst: boolean;
}

export const DEFAULT_NOTE_ORDER: NoteOrder = { field: 'updated', newestFirst: true };

const FIELDS: readonly NoteOrderField[] = ['updated', 'created', 'title'];

/**
 * A total order, so `Array.prototype.sort` is deterministic across engines: a
 * comparator returning 0 for distinct notes leaves their relative order up to
 * the implementation, and the list would reshuffle on unrelated re-renders.
 * `id` is the tiebreaker because it is the only field guaranteed unique.
 */
export function compareNotes(order: NoteOrder): (a: Note, b: Note) => number {
  const direction = order.newestFirst ? -1 : 1;

  return (a, b) => {
    let primary: number;

    switch (order.field) {
      case 'updated':
        primary = a.updatedAt - b.updatedAt;
        break;
      case 'created':
        primary = a.createdAt - b.createdAt;
        break;
      case 'title':
        // localeCompare, never `<`: the corpus is Korean and codepoint order
        // on Hangul is not alphabetical order. `undefined` locale follows the
        // runtime's, which is the same locale the row's title is read in.
        primary = a.title.localeCompare(b.title, undefined, { numeric: true });
        break;
    }

    if (primary !== 0) return primary * direction;
    return a.id.localeCompare(b.id);
  };
}

/**
 * Validates a value read back from the `settings` table. A hand-edited row, or
 * one written by a future version with a field this build does not know, must
 * fall back to the default rather than reach `compareNotes` as an unhandled
 * `switch` arm.
 */
export function isNoteOrder(value: unknown): value is NoteOrder {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<NoteOrder>;
  return (
    typeof candidate.newestFirst === 'boolean' &&
    typeof candidate.field === 'string' &&
    FIELDS.includes(candidate.field as NoteOrderField)
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/order.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Export from the data barrel**

In `src/data/index.ts`, add alphabetically among the existing exports (after the `newId` line):

```ts
export { compareNotes, DEFAULT_NOTE_ORDER, isNoteOrder } from './order';
export type { NoteOrder, NoteOrderField } from './order';
```

- [ ] **Step 6: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`
Expected: all pass; existing test count rises by 12.

- [ ] **Step 7: Commit**

```bash
git add src/data/order.ts src/data/order.test.ts src/data/index.ts
git commit -m "feat(data): NoteOrder and a total, locale-aware comparator"
```

---

### Task 2: The repository accepts an order and a sub-tag flag

**Files:**

- Modify: `src/data/repositories/notes.ts`
- Modify: `src/data/repositories/notes.test.ts`

**Interfaces:**

- Consumes: `NoteOrder`, `DEFAULT_NOTE_ORDER`, `compareNotes` from Task 1 (import from `../order`, not `../index`, to avoid a barrel cycle).
- Produces: `listActive(order?: NoteOrder)`; `listByTag(tag: string, options?: { order?: NoteOrder; includeDescendants?: boolean })`; `listTrashed()` unchanged. Task 3 calls all three.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('notesRepository', ...)` block in `src/data/repositories/notes.test.ts`:

```ts
  describe('ordering', () => {
    async function seed(): Promise<void> {
      clock = 1000;
      await notes.create('Banana #work');
      clock = 3000;
      await notes.create('Apple #work');
      clock = 2000;
      await notes.create('Cherry #work');
    }

    it('defaults listActive to pinned-then-newest, exactly as before', async () => {
      await seed();
      const list = await notes.listActive();
      expect(list.map((n) => n.title)).toEqual(['Apple', 'Cherry', 'Banana']);
    });

    it('applies a chosen order to listActive', async () => {
      await seed();
      const list = await notes.listActive({ field: 'title', newestFirst: false });
      expect(list.map((n) => n.title)).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('keeps pinned notes on top under every order', async () => {
      await seed();
      const [, , banana] = await notes.listActive({ field: 'title', newestFirst: false });
      // Banana is last by title; pinning must lift it above Apple and Cherry.
      await notes.setPinned(banana!.id, true);

      const list = await notes.listActive({ field: 'title', newestFirst: false });
      expect(list.map((n) => n.title)).toEqual(['Banana', 'Apple', 'Cherry']);
    });

    it('applies a chosen order to listByTag', async () => {
      await seed();
      const list = await notes.listByTag('work', { order: { field: 'title', newestFirst: true } });
      expect(list.map((n) => n.title)).toEqual(['Cherry', 'Banana', 'Apple']);
    });

    it('ignores a chosen order in listTrashed, which orders by deletion time', async () => {
      await seed();
      const [first, second] = await notes.listActive();
      clock = 5000;
      await notes.trash(second!.id);
      clock = 6000;
      await notes.trash(first!.id);

      const list = await notes.listTrashed();
      expect(list.map((n) => n.id)).toEqual([first!.id, second!.id]);
    });
  });

  describe('listByTag sub-tag filtering', () => {
    it('includes descendants by default', async () => {
      await notes.create('parent #work');
      await notes.create('child #work/urgent');

      const list = await notes.listByTag('work');
      expect(list).toHaveLength(2);
    });

    it('excludes descendants when includeDescendants is false', async () => {
      await notes.create('parent #work');
      await notes.create('child #work/urgent');

      const list = await notes.listByTag('work', { includeDescendants: false });
      expect(list.map((n) => n.title)).toEqual(['parent']);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/data/repositories/notes.test.ts`
Expected: FAIL — `listActive` rejects an argument at typecheck, and the ordering assertions return the default order.

- [ ] **Step 3: Write the implementation**

In `src/data/repositories/notes.ts`, add to the imports:

```ts
import { compareNotes, DEFAULT_NOTE_ORDER, type NoteOrder } from '../order';
```

Replace the `byPinnedThenRecent` function with:

```ts
  /**
   * Pinned first, then the caller's chosen order. Applied to every non-trash
   * lister so a pinned note is pinned everywhere it appears, not only in the
   * Pinned list.
   *
   * The pinned partition is applied FIRST and unconditionally: the user's order
   * is the tiebreaker WITHIN each partition, never something that can lift an
   * unpinned note above a pinned one. Otherwise pinning would mean something
   * different from the Pinned smart list.
   *
   * `pinned` cannot drive an IndexedDB index — booleans are not valid keys —
   * so this is an in-memory sort, which is also why `listActive` already
   * filters in memory.
   */
  function byPinnedThen(order: NoteOrder): (a: Note, b: Note) => number {
    const within = compareNotes(order);
    return (a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return within(a, b);
    };
  }
```

Update the interface declaration:

```ts
  listActive(order?: NoteOrder): Promise<Note[]>;
  listTrashed(): Promise<Note[]>;
  /**
   * Active notes carrying `tag`, and by default any descendant of it.
   * `includeDescendants: false` is the "hide sub-tag notes" preference.
   */
  listByTag(tag: string, options?: ListByTagOptions): Promise<Note[]>;
```

Add above the interface:

```ts
export interface ListByTagOptions {
  order?: NoteOrder;
  includeDescendants?: boolean;
}
```

Replace the two lister bodies:

```ts
    async listActive(order = DEFAULT_NOTE_ORDER) {
      // `pinned` and `trashedAt === null` cannot drive an index here; see db.ts.
      const all = await db.notes.toArray();
      return all.filter((n) => n.trashedAt === null).sort(byPinnedThen(order));
    },
```

```ts
    async listByTag(tag, options = {}) {
      const { order = DEFAULT_NOTE_ORDER, includeDescendants = true } = options;

      // Two queries, not one: selecting a parent covers its descendants, and
      // including the `/` in the prefix is what stops `work` matching
      // `workflow`. Hiding sub-tag notes is therefore one skipped query.
      const [exact, descendants] = await Promise.all([
        db.noteTags.where('tag').equals(tag).toArray(),
        includeDescendants
          ? db.noteTags.where('tag').startsWith(`${tag}/`).toArray()
          : Promise.resolve([]),
      ]);

      const ids = [...new Set([...exact, ...descendants].map((row) => row.noteId))];
      const found = await db.notes.bulkGet(ids);

      return found
        .filter((note): note is Note => note !== undefined && note.trashedAt === null)
        .sort(byPinnedThen(order));
    },
```

Add a line to `listTrashed`'s existing comment:

```ts
    async listTrashed() {
      // Deliberately takes NO order. Trash orders by deletion time, which is
      // not one of NoteOrder's three fields; the menu renders the sort group
      // disabled here rather than accepting a setting it would ignore.
      //
      // aboveOrEqual(0), not above(0): a note trashed at epoch 0 must still
      // appear here. IndexedDB omits null-valued records from the index, so
      // this still matches only trashed notes.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/repositories/notes.test.ts`
Expected: PASS, including every pre-existing test in the file — the defaults reproduce the old behaviour exactly.

- [ ] **Step 5: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/data/repositories/notes.ts src/data/repositories/notes.test.ts
git commit -m "feat(data): listActive and listByTag accept a NoteOrder

Defaults reproduce byPinnedThenRecent exactly, so every existing call site
and test is untouched. Pinned stays partitioned first under every order.
listByTag gains includeDescendants for the hide-sub-tag-notes preference."
```

---

### Task 3: `listForScope` passes the order through

**Files:**

- Modify: `src/features/notes/scope.ts`
- Modify: `src/features/notes/scope.test.ts`
- Modify: `src/features/notes/useNotes.ts`
- Modify: `src/features/notes/index.ts`

**Interfaces:**

- Consumes: Task 2's repository signatures; `NoteOrder`, `DEFAULT_NOTE_ORDER` from `@/data`.
- Produces: `ScopeQuery = { order: NoteOrder; includeDescendants: boolean }`; `listForScope(scope, query?, repository?, now?)`; `useNotes(scope, query?)`. Tasks 7 and 8 pass a `ScopeQuery` down from `AppShell`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/scope.test.ts`:

```ts
describe('listForScope ordering', () => {
  it('hands the order to listActive rather than re-sorting the result', async () => {
    const listActive = vi.fn().mockResolvedValue([]);
    const repository = {
      listActive,
      listTrashed: vi.fn().mockResolvedValue([]),
      listByTag: vi.fn().mockResolvedValue([]),
      allTagRows: vi.fn().mockResolvedValue([]),
    };
    const order = { field: 'title', newestFirst: false } as const;

    await listForScope(smartScope('all'), { order, includeDescendants: true }, repository);

    expect(listActive).toHaveBeenCalledWith(order);
  });

  it('hands both the order and the sub-tag flag to listByTag', async () => {
    const listByTag = vi.fn().mockResolvedValue([]);
    const repository = {
      listActive: vi.fn().mockResolvedValue([]),
      listTrashed: vi.fn().mockResolvedValue([]),
      listByTag,
      allTagRows: vi.fn().mockResolvedValue([]),
    };
    const order = { field: 'created', newestFirst: true } as const;

    await listForScope(tagScope('work'), { order, includeDescendants: false }, repository);

    expect(listByTag).toHaveBeenCalledWith('work', { order, includeDescendants: false });
  });

  it('calls listTrashed with no arguments, because Trash owns its order', async () => {
    const listTrashed = vi.fn().mockResolvedValue([]);
    const repository = {
      listActive: vi.fn().mockResolvedValue([]),
      listTrashed,
      listByTag: vi.fn().mockResolvedValue([]),
      allTagRows: vi.fn().mockResolvedValue([]),
    };

    await listForScope(
      smartScope('trash'),
      { order: { field: 'title', newestFirst: false }, includeDescendants: true },
      repository,
    );

    expect(listTrashed).toHaveBeenCalledWith();
  });

  it('preserves the repository order rather than re-sorting a smart list', async () => {
    // The repository returns C, A, B. A predicate-filtered smart list must
    // hand that order straight through — re-sorting here is the thing the
    // ruling in this module forbids.
    const notes = [
      { id: 'c', title: 'C', text: '', createdAt: 3, updatedAt: 3, pinned: false, trashedAt: null, archivedAt: null },
      { id: 'a', title: 'A', text: '', createdAt: 1, updatedAt: 1, pinned: false, trashedAt: null, archivedAt: null },
      { id: 'b', title: 'B', text: '', createdAt: 2, updatedAt: 2, pinned: false, trashedAt: null, archivedAt: null },
    ];
    const repository = {
      listActive: vi.fn().mockResolvedValue(notes),
      listTrashed: vi.fn().mockResolvedValue([]),
      listByTag: vi.fn().mockResolvedValue([]),
      allTagRows: vi.fn().mockResolvedValue([]),
    };

    const result = await listForScope(
      smartScope('all'),
      { order: { field: 'title', newestFirst: false }, includeDescendants: true },
      repository,
    );

    expect(result.map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });
});
```

Add `vi` to the existing `vitest` import in that file if it is not already there.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/notes/scope.test.ts`
Expected: FAIL — `listForScope` currently takes `(scope, repository, now)`, so the second argument is read as the repository.

- [ ] **Step 3: Write the implementation**

In `src/features/notes/scope.ts`, add to the imports:

```ts
import { DEFAULT_NOTE_ORDER, type NoteOrder } from '@/data';
```

Add above `listForScope`:

```ts
/**
 * The two view preferences that reach the data layer. Bundled into one object
 * so `listForScope` keeps a stable arity as preferences are added, and so
 * `useNotes` can put a single value in its `useLiveQuery` dependency array.
 */
export interface ScopeQuery {
  order: NoteOrder;
  /** `false` is the "hide sub-tag notes" preference. Ignored outside tag scopes. */
  includeDescendants: boolean;
}

export const DEFAULT_SCOPE_QUERY: ScopeQuery = {
  order: DEFAULT_NOTE_ORDER,
  includeDescendants: true,
};
```

Replace `listForScope`'s signature and the first two branches, keeping the existing docblock and extending it:

```ts
/**
 * Ordering comes from the repository and is never re-sorted here: every lister
 * returns its own order, and pinned-first ordering lives in the repository so
 * it applies to the tag scope too.
 *
 * From A, the repository ACCEPTS an order rather than hardcoding one — which
 * does not move ownership. The order is passed through untouched and the
 * result is handed on in the order it arrived; the only transformation applied
 * here is the smart list's predicate filter, which preserves order.
 */
export async function listForScope(
  scope: NoteScope,
  query: ScopeQuery = DEFAULT_SCOPE_QUERY,
  repository: ScopeLister = notes,
  now: () => number = Date.now,
): Promise<Note[]> {
  if (scope.kind === 'tag') {
    return repository.listByTag(scope.tag, {
      order: query.order,
      includeDescendants: query.includeDescendants,
    });
  }
  if (scope.list === 'trash') return repository.listTrashed();

  const list = await repository.listActive(query.order);
```

The rest of the function is unchanged.

- [ ] **Step 4: Thread it through `useNotes`**

In `src/features/notes/useNotes.ts`, change the import and signature:

```ts
import {
  DEFAULT_SCOPE_QUERY,
  isTrash,
  listForScope,
  type NoteScope,
  type ScopeQuery,
  scopeKey,
} from './scope';
```

```ts
export function useNotes(scope: NoteScope, query: ScopeQuery = DEFAULT_SCOPE_QUERY): NotesState {
```

Replace the `key` and `itemsResult` lines:

```ts
  // The query joins the key, not just the scope: changing the sort must re-run
  // the live query, and the tag-and-verify guard must reject a result fetched
  // under the previous sort for exactly the reason it rejects one fetched under
  // the previous scope — a stale-but-present list is worse than "still
  // loading", because it renders a wrong order the user just asked to change.
  const key = `${scopeKey(scope)}|${query.order.field}|${query.order.newestFirst}|${query.includeDescendants}`;

  const itemsResult = useLiveQuery(
    async () => ({ key, list: await listForScope(scope, query) }),
    [key],
  );
```

- [ ] **Step 5: Export the new types**

In `src/features/notes/index.ts`, add `DEFAULT_SCOPE_QUERY` to the value export list from `./scope` (alphabetically, after `allowsTrash`) and `ScopeQuery` to the type export list.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/notes/`
Expected: PASS, including `useNotes.test.tsx` untouched — the default parameter preserves its behaviour.

- [ ] **Step 7: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/features/notes/scope.ts src/features/notes/scope.test.ts src/features/notes/useNotes.ts src/features/notes/index.ts
git commit -m "feat(notes): listForScope passes a ScopeQuery through to the repository

The 'never re-sorted here' ruling stands: the order is handed to the lister
and the result is returned in the order it arrived. useNotes folds the query
into its live-query key so a sort change cannot render under the old tag."
```

---

### Task 4: `useSetting`, the durable-preference hook

**Files:**

- Create: `src/app/useSetting.ts`
- Create: `src/app/useSetting.test.tsx`

**Interfaces:**

- Consumes: `settings` from `@/data`.
- Produces: `useSetting<T>(key: string, fallback: T, guard: (value: unknown) => value is T): [T, (next: T) => void]`. Task 7 calls it three times.

- [ ] **Step 1: Write the failing test**

Create `src/app/useSetting.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, settings } from '@/data';

import { useSetting } from './useSetting';

const isSize = (value: unknown): value is 'small' | 'large' =>
  value === 'small' || value === 'large';

describe('useSetting', () => {
  beforeEach(async () => {
    if (!db.isOpen()) await db.open();
    await db.settings.clear();
  });

  it('renders the fallback before the stored value resolves', () => {
    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));
    expect(result.current[0]).toBe('large');
  });

  it('reads a stored value back', async () => {
    await settings.set('previewSize', 'small');

    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));

    await waitFor(() => expect(result.current[0]).toBe('small'));
  });

  it('persists a written value', async () => {
    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));

    act(() => result.current[1]('small'));

    await waitFor(async () => {
      expect(await settings.get('previewSize', 'large')).toBe('small');
    });
  });

  it('falls back when the stored value fails its guard', async () => {
    // A row written by a future version, or edited by hand. It must never
    // reach the consumer as a value it cannot handle.
    await settings.set('previewSize', 'enormous');

    const { result } = renderHook(() => useSetting('previewSize', 'large', isSize));

    await waitFor(() => expect(result.current[0]).toBe('large'));
    // Still 'large' after the live query has certainly resolved.
    expect(result.current[0]).toBe('large');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/useSetting.test.tsx`
Expected: FAIL — `Failed to resolve import "./useSetting"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/useSetting.ts`:

```ts
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback } from 'react';

import { settings } from '@/data';

/**
 * One durable preference from the `settings` table.
 *
 * Deliberately NOT modelled on `usePaneWidths`. That hook's `drag`,
 * `pendingCommit` and `lastCommitted` machinery exists to absorb a continuous
 * pointer drag, and to close the window `settings.set`'s fire-and-forget write
 * leaves open mid-drag. A menu click is one discrete event with nothing to
 * render optimistically, so there is no optimistic overlay to reconcile and no
 * need for `useFlushTriggers`.
 *
 * `guard` runs on every read. A row written by a future version — or edited by
 * hand in devtools — must fall back rather than reach a consumer that cannot
 * handle it; `compareNotes` switches exhaustively over its field, so an
 * unknown one would fall through every arm.
 */
export function useSetting<T>(
  key: string,
  fallback: T,
  guard: (value: unknown) => value is T,
): [T, (next: T) => void] {
  // Render at the fallback immediately rather than blocking on IndexedDB —
  // one frame at the default beats a blank pane.
  const stored = useLiveQuery(() => settings.get<unknown>(key, fallback), [key], fallback);

  const value = guard(stored) ? stored : fallback;

  const set = useCallback(
    (next: T) => {
      void settings.set(key, next);
    },
    [key],
  );

  return [value, set];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/useSetting.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/app/useSetting.ts src/app/useSetting.test.tsx
git commit -m "feat(app): useSetting, a guarded durable-preference hook

Guards on read so a stored value from a future version falls back instead of
reaching an exhaustive switch as an unhandled arm."
```

---

### Task 5: `NoteListItem` renders three preview sizes

**Files:**

- Create: `src/features/notes/preview.ts`
- Create: `src/features/notes/preview.test.ts`
- Modify: `src/features/notes/NoteListItem.tsx`
- Modify: `src/features/notes/NoteListItem.test.tsx`
- Modify: `src/features/notes/index.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `PreviewSize = 'small' | 'medium' | 'large'`; `PREVIEW_SIZES: readonly PreviewSize[]`; `DEFAULT_PREVIEW_SIZE`; `isPreviewSize`; `snippetLines(size): 0 | 1 | 2`. `NoteListItemProps` gains `size?: PreviewSize`. Tasks 6 and 7 use all of these.

- [ ] **Step 1: Write the failing test for the value module**

Create `src/features/notes/preview.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { DEFAULT_PREVIEW_SIZE, isPreviewSize, PREVIEW_SIZES, snippetLines } from './preview';

describe('preview size', () => {
  it('defaults to large, which is the row the app shipped with', () => {
    expect(DEFAULT_PREVIEW_SIZE).toBe('large');
  });

  it('lists the three sizes smallest first, which is the menu order', () => {
    expect(PREVIEW_SIZES).toEqual(['small', 'medium', 'large']);
  });

  it('maps each size to a snippet line count', () => {
    expect(snippetLines('small')).toBe(0);
    expect(snippetLines('medium')).toBe(1);
    expect(snippetLines('large')).toBe(2);
  });

  it('rejects a value that is not a size', () => {
    expect(isPreviewSize('enormous')).toBe(false);
    expect(isPreviewSize(2)).toBe(false);
    expect(isPreviewSize(null)).toBe(false);
  });

  it('accepts every listed size', () => {
    for (const size of PREVIEW_SIZES) expect(isPreviewSize(size)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/features/notes/preview.test.ts`
Expected: FAIL — `Failed to resolve import "./preview"`.

- [ ] **Step 3: Write the value module**

Create `src/features/notes/preview.ts`:

```ts
/** Row density. `large` is the row the app shipped with from M3 to M9a. */
export type PreviewSize = 'small' | 'medium' | 'large';

/** Smallest first — the order the menu lists them in. */
export const PREVIEW_SIZES: readonly PreviewSize[] = ['small', 'medium', 'large'];

export const DEFAULT_PREVIEW_SIZE: PreviewSize = 'large';

export function isPreviewSize(value: unknown): value is PreviewSize {
  return typeof value === 'string' && (PREVIEW_SIZES as readonly string[]).includes(value);
}

/**
 * How many lines of snippet a size shows. Drives BOTH the rendered row and its
 * accessible name, from this one decision — the label must never announce a
 * snippet the row does not display.
 */
export function snippetLines(size: PreviewSize): 0 | 1 | 2 {
  switch (size) {
    case 'small':
      return 0;
    case 'medium':
      return 1;
    case 'large':
      return 2;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/features/notes/preview.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing row tests**

Append to `describe('NoteListItem', ...)` in `src/features/notes/NoteListItem.test.tsx`:

```tsx
  describe('preview size', () => {
    it('shows two snippet lines at large, the default', () => {
      renderItem();
      expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /milk, bread, coffee/ })).toBeInTheDocument();
    });

    it('shows one snippet line at medium', () => {
      const { container } = renderItem({ size: 'medium' });
      expect(screen.getByText('milk, bread, coffee')).toBeInTheDocument();
      expect(container.querySelector('.line-clamp-1')).not.toBeNull();
      expect(container.querySelector('.line-clamp-2')).toBeNull();
    });

    it('renders no snippet at small', () => {
      renderItem({ size: 'small' });
      expect(screen.queryByText('milk, bread, coffee')).not.toBeInTheDocument();
    });

    it('drops the snippet from the accessible name at small, so the name matches the row', () => {
      renderItem({ size: 'small' });
      const row = screen.getByRole('button', { name: /Groceries/ });
      expect(row).toHaveAccessibleName('Groceries, 14:32');
    });

    it('keeps title and date in the name at every size', () => {
      for (const size of ['small', 'medium', 'large'] as const) {
        const { unmount } = renderItem({ size });
        expect(screen.getByRole('button', { name: /Groceries, 14:32/ })).toBeInTheDocument();
        unmount();
      }
    });

    it('still reserves the snippet height at medium, so rows stay uniform', () => {
      const { container } = renderItem({ size: 'medium', note: makeNote({ text: 'Groceries' }) });
      const snippet = container.querySelector('.line-clamp-1');
      expect(snippet?.className).toContain('min-h-[1.03125rem]');
    });
  });
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/features/notes/NoteListItem.test.tsx`
Expected: FAIL — `size` is not a prop, and the small-size assertions find the snippet still rendered.

- [ ] **Step 7: Implement the row**

In `src/features/notes/NoteListItem.tsx`, add to the imports:

```ts
import { DEFAULT_PREVIEW_SIZE, type PreviewSize, snippetLines } from './preview';
```

Add to `NoteListItemProps`:

```ts
  /** Row density. Defaults to `large`, the row the app shipped with. */
  size?: PreviewSize;
```

Add `size = DEFAULT_PREVIEW_SIZE` to the destructured parameters, then replace the label derivation and the snippet span:

```tsx
  const lines = snippetLines(size);

  // Built from the SAME size decision that drives the render below, so the
  // accessible name can never announce a snippet the row does not display.
  // The explicit commas remain load-bearing: the spans concatenate with no
  // separator and accessible-name computation ignores the CSS gap, which is
  // why this row announced as "Groceries14:32milk and bread" from M3 to M7.
  const label = lines === 0
    ? `${displayTitle}, ${date}`
    : `${displayTitle}, ${date}, ${displaySnippet}`;
```

```tsx
        {/*
          The reserved snippet height is per size, not a single constant. Bear's
          rows are a uniform height whether or not a note has a body (measured —
          a body-less note still occupies a full row), and a list whose rows
          change height with their content reads as ragged. That is true at every
          density, so each size clamps AND reserves its own height.
        */}
        {lines === 1 && (
          <span className="line-clamp-1 min-h-[1.03125rem] text-ui-sm leading-snug text-muted">
            <HighlightedText text={displaySnippet} query={hasSnippet ? query : undefined} />
          </span>
        )}
        {lines === 2 && (
          <span className="line-clamp-2 min-h-[2.0625rem] text-ui-sm leading-snug text-muted">
            <HighlightedText text={displaySnippet} query={hasSnippet ? query : undefined} />
          </span>
        )}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/features/notes/NoteListItem.test.tsx`
Expected: PASS, including every pre-existing test — `size` defaults to `large`.

- [ ] **Step 9: Export from the barrel**

In `src/features/notes/index.ts`:

```ts
export { DEFAULT_PREVIEW_SIZE, isPreviewSize, PREVIEW_SIZES, snippetLines } from './preview';
export type { PreviewSize } from './preview';
```

- [ ] **Step 10: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 11: Commit**

```bash
git add src/features/notes/preview.ts src/features/notes/preview.test.ts src/features/notes/NoteListItem.tsx src/features/notes/NoteListItem.test.tsx src/features/notes/index.ts
git commit -m "feat(notes): NoteListItem renders three preview densities

Size drives the rendered row and its accessible name from one decision, so
the two cannot drift. Each size reserves its own snippet height — the ragged
-list problem min-h solves exists at every density, with different values."
```

---

### Task 6: `ScopeMenu`

**Files:**

- Create: `src/features/notes/ScopeMenu.tsx`
- Create: `src/features/notes/ScopeMenu.test.tsx`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ko.ts`
- Modify: `src/features/notes/index.ts`

**Interfaces:**

- Consumes: `NoteOrder`, `NoteOrderField` (Task 1); `ScopeQuery` (Task 3); `PreviewSize`, `PREVIEW_SIZES` (Task 5); `NoteScope`, `SMART_LIST_IDS`, `smartScope`, `isTrash`, `scopeKey`.
- Produces: `ScopeMenu` and `ScopeMenuProps`; `SCOPE_SHORTCUT_DIGITS: Record<SmartListId, string>`. Task 8 imports `SCOPE_SHORTCUT_DIGITS` so the menu's hints and the key handler cannot disagree.

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/en.ts`, after the existing `noteList.*` block:

```ts
  'noteList.menu.label': 'List options',
  'noteList.menu.open': 'List options for {scope}',
  'noteList.count.one': '1 note',
  'noteList.count.other': '{count} notes',

  'noteList.sort.group': 'Sort by',
  'noteList.sort.updated': 'Date modified',
  'noteList.sort.created': 'Date created',
  'noteList.sort.title': 'Title',
  'noteList.sort.newestFirst': 'Newest first',
  'noteList.sort.trashNote': 'Trash is ordered by when notes were deleted.',

  'noteList.preview.group': 'Preview style',
  'noteList.preview.small': 'Small',
  'noteList.preview.medium': 'Medium',
  'noteList.preview.large': 'Large',
  'noteList.preview.hideSubTags': 'Hide sub-tag notes',
  'noteList.preview.hideSubTagsNote': 'Only tag lists have sub-tags.',

  'noteList.scope.group': 'Lists',
```

In `src/i18n/ko.ts`, at the matching position:

```ts
  'noteList.menu.label': '목록 옵션',
  'noteList.menu.open': '{scope} 목록 옵션',
  'noteList.count.one': '메모 1개',
  'noteList.count.other': '메모 {count}개',

  'noteList.sort.group': '정렬',
  'noteList.sort.updated': '수정일',
  'noteList.sort.created': '생성일',
  'noteList.sort.title': '제목',
  'noteList.sort.newestFirst': '새로운 항목 맨 위로',
  'noteList.sort.trashNote': '휴지통은 삭제한 시각 순으로 정렬됩니다.',

  'noteList.preview.group': '미리 보기 스타일',
  'noteList.preview.small': '작음',
  'noteList.preview.medium': '중간',
  'noteList.preview.large': '큼',
  'noteList.preview.hideSubTags': '하위 태그 메모 숨기기',
  'noteList.preview.hideSubTagsNote': '태그 목록에만 하위 태그가 있습니다.',

  'noteList.scope.group': '목록',
```

Check how `useT` handles interpolation before using `{scope}` / `{count}`: run `grep -rn "replace\|{.*}" src/i18n/useT.ts src/i18n/*.ts | head`. If `useT` takes no parameters, compose these two strings at the call site from a parameterless key plus the value, and drop the braces from the key text.

- [ ] **Step 2: Write the failing test**

Create `src/features/notes/ScopeMenu.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { ScopeMenu, type ScopeMenuProps } from './ScopeMenu';
import { smartScope, tagScope } from './scope';

function renderMenu(overrides: Partial<ScopeMenuProps> = {}): void {
  const props: ScopeMenuProps = {
    scope: smartScope('all'),
    count: 33,
    query: { order: { field: 'updated', newestFirst: true }, includeDescendants: true },
    previewSize: 'large',
    onOrderChange: vi.fn(),
    onPreviewSizeChange: vi.fn(),
    onIncludeDescendantsChange: vi.fn(),
    onScopeChange: vi.fn(),
    ...overrides,
  };
  renderWithI18n(<ScopeMenu {...props} />);
}

describe('ScopeMenu', () => {
  it('names the count from the unfiltered scope list', () => {
    renderMenu({ count: 33 });
    expect(screen.getByText('33 notes')).toBeInTheDocument();
  });

  it('uses the singular for one note', () => {
    renderMenu({ count: 1 });
    expect(screen.getByText('1 note')).toBeInTheDocument();
  });

  it('marks the active sort field checked, as a radio', () => {
    renderMenu();
    expect(screen.getByRole('menuitemradio', { name: 'Date modified' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Date created' })).not.toBeChecked();
  });

  it('marks the direction toggle as a checkbox', () => {
    renderMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Newest first' })).toBeChecked();
  });

  it('reports a chosen sort field, keeping the current direction', async () => {
    const onOrderChange = vi.fn();
    renderMenu({ onOrderChange });

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Title' }));

    expect(onOrderChange).toHaveBeenCalledWith({ field: 'title', newestFirst: true });
  });

  it('reports a flipped direction, keeping the current field', async () => {
    const onOrderChange = vi.fn();
    renderMenu({ onOrderChange });

    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Newest first' }));

    expect(onOrderChange).toHaveBeenCalledWith({ field: 'updated', newestFirst: false });
  });

  it('marks the active preview size checked', () => {
    renderMenu({ previewSize: 'medium' });
    expect(screen.getByRole('menuitemradio', { name: 'Medium' })).toBeChecked();
  });

  it('disables the sort group in Trash and says why', () => {
    renderMenu({ scope: smartScope('trash') });

    expect(screen.getByRole('menuitemradio', { name: 'Title' })).toBeDisabled();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Newest first' })).toBeDisabled();
    expect(screen.getByText('Trash is ordered by when notes were deleted.')).toBeInTheDocument();
  });

  it('disables the sub-tag toggle outside a tag scope and says why', () => {
    renderMenu({ scope: smartScope('all') });

    expect(screen.getByRole('menuitemcheckbox', { name: 'Hide sub-tag notes' })).toBeDisabled();
    expect(screen.getByText('Only tag lists have sub-tags.')).toBeInTheDocument();
  });

  it('enables the sub-tag toggle in a tag scope, checked when descendants are hidden', () => {
    renderMenu({
      scope: tagScope('work'),
      query: { order: { field: 'updated', newestFirst: true }, includeDescendants: false },
    });

    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Hide sub-tag notes' });
    expect(toggle).toBeEnabled();
    expect(toggle).toBeChecked();
  });

  it('lists every smart list, in sidebar order, with its shortcut hint', () => {
    renderMenu();

    const rows = screen
      .getAllByRole('menuitemradio')
      .map((row) => row.textContent ?? '')
      .filter((text) => text.includes('⇧⌘'));

    expect(rows).toEqual([
      'Notes⇧⌘1',
      'Untagged⇧⌘2',
      'Todo⇧⌘3',
      'Today⇧⌘4',
      'Pinned⇧⌘5',
      'Locked⇧⌘6',
      'Trash⇧⌘0',
    ]);
  });

  it('marks the current scope checked among the scope rows', () => {
    renderMenu({ scope: smartScope('todo') });
    expect(screen.getByRole('menuitemradio', { name: /Todo/ })).toBeChecked();
  });

  it('reports a chosen scope', async () => {
    const onScopeChange = vi.fn();
    renderMenu({ onScopeChange });

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Pinned/ }));

    expect(onScopeChange).toHaveBeenCalledWith(smartScope('pinned'));
  });

  it('moves focus down the rows with ArrowDown, skipping the presentational count', async () => {
    renderMenu();
    const first = screen.getByRole('menuitemradio', { name: 'Date modified' });
    first.focus();

    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitemradio', { name: 'Date created' })).toHaveFocus();
  });

  it('wraps from the last row to the first with ArrowDown', async () => {
    renderMenu();
    const rows = screen.getAllByRole('menuitemradio');
    rows[rows.length - 1]!.focus();

    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('menuitemradio', { name: 'Date modified' })).toHaveFocus();
  });

  it('jumps to the last row with End and the first with Home', async () => {
    renderMenu();
    const rows = screen.getAllByRole('menuitemradio');
    rows[0]!.focus();

    await userEvent.keyboard('{End}');
    expect(rows[rows.length - 1]!).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(rows[0]!).toHaveFocus();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/features/notes/ScopeMenu.test.tsx`
Expected: FAIL — `Failed to resolve import "./ScopeMenu"`.

- [ ] **Step 4: Write the component**

Create `src/features/notes/ScopeMenu.tsx`:

```tsx
import { type ReactElement, useRef } from 'react';

import type { NoteOrder, NoteOrderField } from '@/data';
import type { TranslationKey } from '@/i18n';
import { useT } from '@/i18n';

import { DEFAULT_PREVIEW_SIZE, PREVIEW_SIZES, type PreviewSize } from './preview';
import {
  isTrash,
  type NoteScope,
  type ScopeQuery,
  scopeKey,
  SMART_LIST_IDS,
  type SmartListId,
  smartScope,
} from './scope';

/**
 * The digit each builtin answers to, with `⇧⌘`. Exported so `useScopeShortcuts`
 * binds exactly what this menu advertises — a hint and a handler that disagree
 * is the failure this constant exists to make impossible.
 *
 * Follows SMART_LIST_IDS order, NOT Bear's: Bear puts 잠긴항목 at 5 and 고정됨
 * at 6, and our sidebar has always run pinned before locked. A digit that
 * disagreed with the row above it would be worse than one that disagrees with
 * another app.
 *
 * 7, 8 and 9 are deliberately unassigned — `@tiptap` binds `Mod-Shift-7/8/9`
 * to ordered list, bullet list and blockquote. A future Archive list cannot
 * take ⇧⌘9.
 */
export const SCOPE_SHORTCUT_DIGITS: Record<SmartListId, string> = {
  all: '1',
  untagged: '2',
  todo: '3',
  today: '4',
  pinned: '5',
  locked: '6',
  trash: '0',
};

const SORT_FIELDS: readonly { field: NoteOrderField; label: TranslationKey }[] = [
  { field: 'updated', label: 'noteList.sort.updated' },
  { field: 'created', label: 'noteList.sort.created' },
  { field: 'title', label: 'noteList.sort.title' },
];

const PREVIEW_LABELS: Record<PreviewSize, TranslationKey> = {
  small: 'noteList.preview.small',
  medium: 'noteList.preview.medium',
  large: 'noteList.preview.large',
};

const SMART_LIST_LABELS: Record<SmartListId, TranslationKey> = {
  all: 'smartList.all',
  untagged: 'smartList.untagged',
  todo: 'smartList.todo',
  today: 'smartList.today',
  pinned: 'smartList.pinned',
  locked: 'smartList.locked',
  trash: 'smartList.trash',
};

export interface ScopeMenuProps {
  scope: NoteScope;
  /** From the UNFILTERED scope list, never the query-narrowed view. */
  count: number;
  query: ScopeQuery;
  previewSize: PreviewSize;
  onOrderChange: (next: NoteOrder) => void;
  onPreviewSizeChange: (next: PreviewSize) => void;
  onIncludeDescendantsChange: (next: boolean) => void;
  onScopeChange: (next: NoteScope) => void;
}

const ROW =
  'flex w-full items-center justify-between gap-4 rounded-sm px-2 py-1 text-left text-ui text-text transition-colors duration-[var(--bear-duration-fast)] ease-bear enabled:hover:bg-hover disabled:text-faint';

const NOTE = 'px-2 py-1 text-ui-xs text-faint';

/**
 * Flat, not nested. Bear nests its sort and preview submenus; nesting costs
 * hover-intent timing, a second placement layer and focus return on close, and
 * none of it is unit-testable because jsdom has no layout engine to place a
 * submenu against. Sixteen rows flat is shorter than the scope list Bear
 * already shows unnested.
 *
 * The checkmarks Bear draws are structure here: `menuitemradio` with
 * `aria-checked` for one-of-N choices, `menuitemcheckbox` for the two toggles.
 */
export function ScopeMenu({
  scope,
  count,
  query,
  previewSize,
  onOrderChange,
  onPreviewSizeChange,
  onIncludeDescendantsChange,
  onScopeChange,
}: ScopeMenuProps): ReactElement {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);

  const trash = isTrash(scope);
  const isTagScope = scope.kind === 'tag';

  // Roving movement over the enabled rows only. Sixteen rows need it; the
  // three-row ExportMenu did not, which is why this is new rather than shared.
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const rows = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    if (rows.length === 0) return;

    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;

    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = rows.length - 1;
    else if (event.key === 'ArrowDown') next = (current + 1) % rows.length;
    else next = (current - 1 + rows.length) % rows.length;

    event.preventDefault();
    rows[next]?.focus();
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('noteList.menu.label')}
      onKeyDown={onKeyDown}
      className="flex min-w-56 flex-col gap-0.5"
    >
      {/* Presentational: a count is not an action, and a focus stop on it
          would make every arrow-key pass through the menu cost an extra press. */}
      <div aria-hidden="true" className={NOTE}>
        {count === 1 ? t('noteList.count.one') : t('noteList.count.other').replace('{count}', String(count))}
      </div>

      <hr className="border-border my-1" />

      {SORT_FIELDS.map(({ field, label }) => (
        <button
          key={field}
          type="button"
          role="menuitemradio"
          aria-checked={query.order.field === field}
          disabled={trash}
          onClick={() => onOrderChange({ ...query.order, field })}
          className={ROW}
        >
          {t(label)}
          {query.order.field === field && <span aria-hidden="true">✓</span>}
        </button>
      ))}

      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={query.order.newestFirst}
        disabled={trash}
        onClick={() => onOrderChange({ ...query.order, newestFirst: !query.order.newestFirst })}
        className={ROW}
      >
        {t('noteList.sort.newestFirst')}
        {query.order.newestFirst && <span aria-hidden="true">✓</span>}
      </button>

      {/* A disabled control whose reason is invisible is the defect B1 rejected
          the pane-width threshold over. The copy is not decoration. */}
      {trash && <p className={NOTE}>{t('noteList.sort.trashNote')}</p>}

      <hr className="border-border my-1" />

      {PREVIEW_SIZES.map((size) => (
        <button
          key={size}
          type="button"
          role="menuitemradio"
          aria-checked={previewSize === size}
          onClick={() => onPreviewSizeChange(size)}
          className={ROW}
        >
          {t(PREVIEW_LABELS[size])}
          {previewSize === size && <span aria-hidden="true">✓</span>}
        </button>
      ))}

      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={!query.includeDescendants}
        disabled={!isTagScope}
        onClick={() => onIncludeDescendantsChange(!query.includeDescendants ? true : false)}
        className={ROW}
      >
        {t('noteList.preview.hideSubTags')}
        {!query.includeDescendants && <span aria-hidden="true">✓</span>}
      </button>

      {!isTagScope && <p className={NOTE}>{t('noteList.preview.hideSubTagsNote')}</p>}

      <hr className="border-border my-1" />

      {/* Generated from SMART_LIST_IDS, never hand-listed. M6 deleted
          ScopeSidebar precisely because it hardcoded its rows; a second surface
          listing the same scopes must not reintroduce that shape. */}
      {SMART_LIST_IDS.map((list) => {
        const target = smartScope(list);
        const checked = scopeKey(scope) === scopeKey(target);
        return (
          <button
            key={list}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            onClick={() => onScopeChange(target)}
            className={ROW}
          >
            {t(SMART_LIST_LABELS[list])}
            <span aria-hidden="true" className="text-faint">
              ⇧⌘{SCOPE_SHORTCUT_DIGITS[list]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

Note on the unused `DEFAULT_PREVIEW_SIZE` import: remove it if oxlint flags it. It is listed above only because the import line is written once.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/features/notes/ScopeMenu.test.tsx`
Expected: PASS, 17 tests.

The shortcut-hint test asserts the exact hint strings. If `textContent` includes the checkmark for the active scope, adjust the assertion to match the rendered text rather than changing the component — the hint text is the contract, the checkmark is presentation.

- [ ] **Step 6: Export from the barrel**

In `src/features/notes/index.ts`:

```ts
export { SCOPE_SHORTCUT_DIGITS, ScopeMenu } from './ScopeMenu';
export type { ScopeMenuProps } from './ScopeMenu';
```

- [ ] **Step 7: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/features/notes/ScopeMenu.tsx src/features/notes/ScopeMenu.test.tsx src/features/notes/index.ts src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(notes): ScopeMenu, a flat menu with typed roles

Bear's checkmarks become menuitemradio/menuitemcheckbox rather than drawing.
Disabled groups carry copy naming the reason. Scope rows are generated from
SMART_LIST_IDS, and their shortcut hints come from the same constant the key
handler will bind."
```

---

### Task 7: The header button, wired

**Files:**

- Modify: `src/features/notes/NoteList.tsx`
- Modify: `src/features/notes/NoteList.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**

- Consumes: `ScopeMenu` (Task 6), `useSetting` (Task 4), `ScopeQuery`/`DEFAULT_SCOPE_QUERY` (Task 3), `isNoteOrder`/`DEFAULT_NOTE_ORDER` (Task 1), `isPreviewSize`/`DEFAULT_PREVIEW_SIZE` (Task 5).
- Produces: `NoteListProps` gains `count: number`, `query: ScopeQuery`, `previewSize: PreviewSize`, `onOrderChange`, `onPreviewSizeChange`, `onIncludeDescendantsChange`, `onScopeChange`.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/NoteList.test.tsx`:

```tsx
  describe('scope header', () => {
    it('names the current smart list on the header button', () => {
      renderList({ scope: smartScope('todo') });
      expect(screen.getByRole('button', { name: /Todo/ })).toHaveAttribute(
        'aria-haspopup',
        'menu',
      );
    });

    it('names the tag on the header button in a tag scope', () => {
      renderList({ scope: tagScope('work/urgent') });
      expect(screen.getByRole('button', { name: /work\/urgent/ })).toBeInTheDocument();
    });

    it('opens the menu and reports expansion', async () => {
      renderList();
      const button = screen.getByRole('button', { name: /Notes/ });
      expect(button).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(button);

      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('menu', { name: 'List options' })).toBeInTheDocument();
    });

    it('closes the menu after choosing a scope', async () => {
      const onScopeChange = vi.fn();
      renderList({ onScopeChange });

      await userEvent.click(screen.getByRole('button', { name: /Notes/ }));
      await userEvent.click(screen.getByRole('menuitemradio', { name: /Pinned/ }));

      expect(onScopeChange).toHaveBeenCalledWith(smartScope('pinned'));
      expect(screen.queryByRole('menu', { name: 'List options' })).not.toBeInTheDocument();
    });

    it('passes the unfiltered count to the menu, not the filtered item count', async () => {
      renderList({ count: 33, items: [makeNote({ id: 'only' })] });

      await userEvent.click(screen.getByRole('button', { name: /Notes/ }));

      expect(screen.getByText('33 notes')).toBeInTheDocument();
    });

    it('renders rows at the given preview size', () => {
      const { container } = renderList({ previewSize: 'small' });
      expect(container.querySelector('.line-clamp-2')).toBeNull();
      expect(container.querySelector('.line-clamp-1')).toBeNull();
    });
  });
```

Add whatever imports the file lacks (`smartScope`, `tagScope`, `userEvent`), and give `renderList`'s default props the new required fields:

```tsx
    count: 0,
    query: { order: { field: 'updated', newestFirst: true }, includeDescendants: true },
    previewSize: 'large',
    onOrderChange: vi.fn(),
    onPreviewSizeChange: vi.fn(),
    onIncludeDescendantsChange: vi.fn(),
    onScopeChange: vi.fn(),
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/features/notes/NoteList.test.tsx`
Expected: FAIL — no header button exists.

- [ ] **Step 3: Implement the header in `NoteList`**

Add imports:

```tsx
import { useState } from 'react';
import type { NoteOrder } from '@/data';
import { Popover } from '@/ui/Popover';
import { ChevronDown } from '@/ui/Icon';
import { ScopeMenu } from './ScopeMenu';
import { DEFAULT_PREVIEW_SIZE, type PreviewSize } from './preview';
import type { ScopeQuery } from './scope';
```

If `ChevronDown` is not yet re-exported from `src/ui/Icon.tsx`, add it there — `lucide-react` may only be imported inside `Icon.tsx`, and `testing-and-tooling.md` records that rule.

Add to `NoteListProps`:

```tsx
  /** Rows in this scope BEFORE the query narrowed it. Same reason as `hasUnfilteredItems`. */
  count: number;
  query: ScopeQuery;
  previewSize: PreviewSize;
  onOrderChange: (next: NoteOrder) => void;
  onPreviewSizeChange: (next: PreviewSize) => void;
  onIncludeDescendantsChange: (next: boolean) => void;
  onScopeChange: (next: NoteScope) => void;
```

Add a name helper above the component:

```tsx
const SMART_LIST_LABELS: Record<SmartListId, TranslationKey> = {
  all: 'smartList.all',
  untagged: 'smartList.untagged',
  todo: 'smartList.todo',
  today: 'smartList.today',
  pinned: 'smartList.pinned',
  locked: 'smartList.locked',
  trash: 'smartList.trash',
};
```

Inside the component, add `const [menuOpen, setMenuOpen] = useState(false);` and put the header button first in the action strip, with `ml-auto` on the `New note` button:

```tsx
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {/* The first thing in the app that names the active scope on screen.
            Until now the only indication was the sidebar's aria-current row,
            which is why activating a tag pill has to reveal its ancestors. */}
        <div className="relative">
          <Button
            variant="ghost"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            {scopeName}
            <Icon glyph={ChevronDown} size="sm" />
          </Button>

          <Popover
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            label={t('noteList.menu.label')}
            className="absolute top-full left-0 z-10 mt-1"
          >
            <ScopeMenu
              scope={scope}
              count={count}
              query={query}
              previewSize={previewSize}
              onOrderChange={onOrderChange}
              onPreviewSizeChange={onPreviewSizeChange}
              onIncludeDescendantsChange={onIncludeDescendantsChange}
              onScopeChange={(next) => {
                onScopeChange(next);
                setMenuOpen(false);
              }}
            />
          </Popover>
        </div>

        <Button variant="ghost" className="ml-auto" onClick={onCreate} label={t('noteList.create')}>
```

with

```tsx
  const scopeName = scope.kind === 'tag' ? scope.tag : t(SMART_LIST_LABELS[scope.list]);
```

`Button` may not accept `className`; if it does not, wrap the remaining action buttons in a `<div className="ml-auto flex items-center gap-1">` rather than adding a className escape hatch — `design-tokens-and-layout.md` records that "not this utility" is expressed by a prop, not an overriding class.

Pass `size={previewSize}` to each `NoteListItem`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/notes/NoteList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `AppShell`**

In `src/app/AppShell.tsx`, add:

```tsx
import {
  DEFAULT_NOTE_ORDER,
  DEFAULT_PREVIEW_SIZE,
  isNoteOrder,
  isPreviewSize,
  type NoteOrder,
  type PreviewSize,
} from '@/data';
import { useSetting } from './useSetting';

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
```

(`DEFAULT_PREVIEW_SIZE`, `isPreviewSize` and `PreviewSize` come from `@/features/notes`, not `@/data` — split the import accordingly.)

Inside the component, above `useNotes`:

```tsx
  const [order, setOrder] = useSetting<NoteOrder>('noteOrder', DEFAULT_NOTE_ORDER, isNoteOrder);
  const [previewSize, setPreviewSize] = useSetting<PreviewSize>(
    'previewSize',
    DEFAULT_PREVIEW_SIZE,
    isPreviewSize,
  );
  const [hideSubTagNotes, setHideSubTagNotes] = useSetting<boolean>(
    'hideSubTagNotes',
    false,
    isBoolean,
  );

  // Memoised because it lands in `useNotes`' live-query dependency chain; a
  // fresh object identity per render is the same defect `ACTIVE_SCOPE` exists
  // to avoid for scopes.
  const scopeQuery = useMemo(
    () => ({ order, includeDescendants: !hideSubTagNotes }),
    [order, hideSubTagNotes],
  );
```

Change `useNotes(scope)` to `useNotes(scope, scopeQuery)`, and pass the new props to `<NoteList>`:

```tsx
        count={items?.length ?? 0}
        query={scopeQuery}
        previewSize={previewSize}
        onOrderChange={setOrder}
        onPreviewSizeChange={setPreviewSize}
        onIncludeDescendantsChange={(next) => setHideSubTagNotes(!next)}
        onScopeChange={setScope}
```

- [ ] **Step 6: Add an AppShell test**

Append to `src/app/AppShell.test.tsx`:

```tsx
  it('re-orders the list when a sort is chosen, and keeps it across a remount', async () => {
    await notes.create('Banana');
    await notes.create('Apple');

    const { unmount } = renderWithI18n(<AppShell />);
    await screen.findByRole('button', { name: /Apple/ });

    await userEvent.click(await screen.findByRole('button', { name: /Notes/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Title' }));
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Newest first' }));

    await waitFor(() => {
      const rows = screen.getAllByRole('button', { name: /(Apple|Banana)/ });
      expect(rows[0]).toHaveAccessibleName(expect.stringContaining('Apple'));
    });

    unmount();
    renderWithI18n(<AppShell />);

    await waitFor(async () => {
      const rows = await screen.findAllByRole('button', { name: /(Apple|Banana)/ });
      expect(rows[0]).toHaveAccessibleName(expect.stringContaining('Apple'));
    });
  });
```

Match the file's existing setup conventions for creating notes and clearing the database between tests.

- [ ] **Step 7: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/features/notes/NoteList.tsx src/features/notes/NoteList.test.tsx src/app/AppShell.tsx src/app/AppShell.test.tsx
git commit -m "feat(notes): the note list names its scope and opens the options menu

Closes the 'no header naming the current scope' item deferred.md has carried
since M3. The count comes from the unfiltered list, for the same reason
emptyTrashDisabled and hasUnfilteredItems do."
```

---

### Task 8: `⇧⌘`+digit scope switching

**Files:**

- Create: `src/app/useScopeShortcuts.ts`
- Create: `src/app/useScopeShortcuts.test.tsx`
- Modify: `src/app/AppShell.tsx`

**Interfaces:**

- Consumes: `SCOPE_SHORTCUT_DIGITS` (Task 6), `smartScope`, `NoteScope`, `SMART_LIST_IDS`.
- Produces: `useScopeShortcuts({ onScope, onSearch })`.

- [ ] **Step 1: Write the failing test**

Create `src/app/useScopeShortcuts.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { smartScope } from '@/features/notes';

import { useScopeShortcuts } from './useScopeShortcuts';

function press(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('useScopeShortcuts', () => {
  it('switches scope on Meta+Shift+digit', () => {
    const onScope = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    press({ code: 'Digit3', key: '#', metaKey: true, shiftKey: true });

    expect(onScope).toHaveBeenCalledWith(smartScope('todo'));
  });

  it('matches on code, not key: Shift+1 reports key "!" on a US layout', () => {
    const onScope = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    press({ code: 'Digit1', key: '!', metaKey: true, shiftKey: true });

    expect(onScope).toHaveBeenCalledWith(smartScope('all'));
  });

  it('accepts Control as the modifier, for Windows and Linux', () => {
    const onScope = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    press({ code: 'Digit0', key: ')', ctrlKey: true, shiftKey: true });

    expect(onScope).toHaveBeenCalledWith(smartScope('trash'));
  });

  it('ignores the combination when Alt is held, so it cannot fire alongside a heading toggle', () => {
    const onScope = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    press({ code: 'Digit1', key: '¡', metaKey: true, shiftKey: true, altKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('ignores an unbound digit, leaving 7, 8 and 9 to the editor extensions', () => {
    const onScope = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    press({ code: 'Digit9', key: '(', metaKey: true, shiftKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('ignores a digit without Shift, which is the browser tab-switching family', () => {
    const onScope = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    press({ code: 'Digit1', key: '1', metaKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });

  it('still handles the search shortcut it took over from AppShell', () => {
    const onSearch = vi.fn();
    renderHook(() => useScopeShortcuts({ onScope: vi.fn(), onSearch }));

    press({ code: 'KeyF', key: 'f', metaKey: true });

    expect(onSearch).toHaveBeenCalled();
  });

  it('detaches its listener on unmount', () => {
    const onScope = vi.fn();
    const { unmount } = renderHook(() => useScopeShortcuts({ onScope, onSearch: vi.fn() }));

    unmount();
    press({ code: 'Digit3', key: '#', metaKey: true, shiftKey: true });

    expect(onScope).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/useScopeShortcuts.test.tsx`
Expected: FAIL — `Failed to resolve import "./useScopeShortcuts"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/useScopeShortcuts.ts`:

```ts
import { useEffect } from 'react';

import {
  type NoteScope,
  SCOPE_SHORTCUT_DIGITS,
  SMART_LIST_IDS,
  smartScope,
} from '@/features/notes';

/** `Digit3` → the scope it selects. Built from the same constant the menu advertises. */
const BY_CODE = new Map<string, NoteScope>(
  SMART_LIST_IDS.map((list) => [`Digit${SCOPE_SHORTCUT_DIGITS[list]}`, smartScope(list)]),
);

export interface ScopeShortcutHandlers {
  onScope: (scope: NoteScope) => void;
  onSearch: () => void;
}

/**
 * Every global key binding in the app, in one place.
 *
 * `⇧⌘`, NOT `⌥⌘`: `@tiptap/extension-heading` binds `Mod-Alt-${level}` for
 * levels 1–6 and B1 shipped on it, so `⌥⌘1` with the editor focused would make
 * an H1 and switch scope at once. `Ctrl`+digit is free in Tiptap and rejected
 * anyway — `Ctrl+1`–`8` switches browser tabs off macOS, and this ships to
 * Pages. Verify any new binding against `node_modules/@tiptap`, not only
 * against browser shortcuts:
 *
 *   grep -rEn "Mod-Shift-[0-9]|Mod-Alt-[0-9]|Mod-Alt-\$\{" node_modules/@tiptap
 *
 * Matching is on `event.code`, never `event.key`: with Shift held, `key` for
 * the 1 key is `'!'` on a US layout, and shifts again under 두벌식. `code` is
 * the physical key regardless of layout or modifier.
 */
export function useScopeShortcuts({ onScope, onSearch }: ScopeShortcutHandlers): void {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.code === 'KeyF' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onSearch();
        return;
      }

      // Alt is rejected rather than ignored: `⌥⇧⌘1` must not fire this AND a
      // heading toggle, which is the collision this whole binding avoids.
      if (!event.shiftKey || event.altKey) return;

      const scope = BY_CODE.get(event.code);
      if (scope === undefined) return;

      event.preventDefault();
      onScope(scope);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onScope, onSearch]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/useScopeShortcuts.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 5: Replace the inline handler in `AppShell`**

Delete the existing `useEffect` around `src/app/AppShell.tsx:170-180` that listens for `Mod-f`, and call instead:

```tsx
  useScopeShortcuts({
    onScope: setScope,
    onSearch: () => searchRef.current?.focus(),
  });
```

Keep whatever the deleted effect did beyond focusing — if it also selected the field's text or cleared a state, carry that into the `onSearch` callback verbatim rather than dropping it.

- [ ] **Step 6: Verify the search shortcut still works**

Run: `npx vitest run src/app/AppShell.test.tsx`
Expected: PASS, including any pre-existing `Mod-f` test.

- [ ] **Step 7: Run the full gate**

Run: `npm test && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 8: Commit**

```bash
git add src/app/useScopeShortcuts.ts src/app/useScopeShortcuts.test.tsx src/app/AppShell.tsx
git commit -m "feat(app): ⇧⌘1-6 and ⇧⌘0 switch scope

NOT ⌥⌘ digits: @tiptap/extension-heading owns Mod-Alt-\${level} and B1
shipped on it, so ⌥⌘1 with the editor focused would make an H1 and switch
scope at once. Matches on event.code, because Shift+1 reports key '!'.
The Mod-f handler moves here so global keys live in one place."
```

---

### Task 9: End-to-end coverage and the visual tooling

**Files:**

- Create: `e2e/noteListHeader.spec.ts`
- Modify: `e2e/shots.spec.ts`
- Modify: `e2e/measure.spec.ts`

**Interfaces:**

- Consumes: the shipped UI from Tasks 5–8; `seedDatabase` from `e2e/fixtures/seed.ts`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Kill any stale preview server**

Run: `lsof -ti:4173 | xargs -r kill -9`

This is not optional. `playwright.config.ts` hardcodes 4173 with `reuseExistingServer`, and a leftover server silently tests a stale build — M9a hit it twice, once making a fault injection pass.

- [ ] **Step 2: Write the failing spec**

Create `e2e/noteListHeader.spec.ts`, following the seeding and selector conventions in the existing specs:

```ts
import { expect, test } from '@playwright/test';

import { seedDatabase } from './fixtures/seed';

test.describe('note list header', () => {
  test('a chosen sort survives a reload', async ({ page }) => {
    await seedDatabase(page, [
      { title: 'Banana', text: 'Banana' },
      { title: 'Apple', text: 'Apple' },
    ]);
    await page.goto('/');

    await page.getByRole('button', { name: /Notes/ }).first().click();
    await page.getByRole('menuitemradio', { name: 'Title' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Newest first' }).click();
    await page.keyboard.press('Escape');

    const first = page.getByRole('listitem').first();
    await expect(first).toContainText('Apple');

    await page.reload();
    await expect(page.getByRole('listitem').first()).toContainText('Apple');
  });

  test('a chosen preview size survives a reload', async ({ page }) => {
    await seedDatabase(page, [{ title: 'Groceries', text: 'Groceries\nmilk and bread' }]);
    await page.goto('/');

    await expect(page.getByText('milk and bread')).toBeVisible();

    await page.getByRole('button', { name: /Notes/ }).first().click();
    await page.getByRole('menuitemradio', { name: 'Small' }).click();
    await page.keyboard.press('Escape');

    await expect(page.getByText('milk and bread')).toHaveCount(0);

    await page.reload();
    await expect(page.getByText('milk and bread')).toHaveCount(0);
  });

  test('⇧⌘3 switches to Todo from a cold page', async ({ page }) => {
    await seedDatabase(page, [{ title: 'Chores', text: 'Chores\n- [ ] sweep' }]);
    await page.goto('/');

    await page.keyboard.press('Meta+Shift+Digit3');

    await expect(page.getByRole('button', { name: /Todo/ }).first()).toBeVisible();
  });

  test('⇧⌘4 switches scope with the editor focused, and writes no heading', async ({ page }) => {
    // The regression test for the ⌥⌘ collision: heading levels are bound to
    // Mod-Alt-${level}, so a scope shortcut in the ⌥⌘ family would both switch
    // scope and turn the current line into an H1. Only a real browser can run
    // this — jsdom has no ProseMirror keymap dispatch for it.
    await seedDatabase(page, [{ title: 'Draft', text: 'Draft\n\nsome body text' }]);
    await page.goto('/');

    await page.getByRole('listitem').first().click();
    const editor = page.locator('.ProseMirror');
    await editor.click();

    await page.keyboard.press('Meta+Shift+Digit4');

    await expect(page.getByRole('button', { name: /Today/ }).first()).toBeVisible();
    await expect(editor.locator('h1')).toHaveCount(0);
  });
});
```

Adjust `seedDatabase`'s call shape to whatever `e2e/fixtures/seed.ts` actually exports — read it first; it opens IndexedDB at version 10 and closes its connection in `onsuccess`, and it must run through `page.addInitScript` before `goto`.

- [ ] **Step 3: Run the spec and watch it pass for the right reason**

Run: `lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e -- noteListHeader`
Expected: 4 passing.

- [ ] **Step 4: Inject a fault to prove the collision test can fail**

Temporarily change `useScopeShortcuts.ts` to accept `altKey` (delete `|| event.altKey` from the guard) and add `Mod-Alt` digits to `BY_CODE`. Re-run:

Run: `lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e -- noteListHeader`
Expected: the editor-focused test FAILS with an `h1` present.

Revert the fault. Re-run and confirm green. A test that has never been seen to fail is not evidence.

- [ ] **Step 5: Add the menu to the shots**

In `e2e/shots.spec.ts`, add a shot that opens the header menu, named consistently with the existing eleven. Themes are selected through the paint-time mirror, the way a user selects one — never by driving `colorScheme`, which is the bug that made the `paper` shot silently render Indigo Light.

Run: `npm run shots`
Expected: 12 × 5 = 60 files under `docs/design/shots/` (gitignored).

- [ ] **Step 6: Add the header to the measurements**

In `e2e/measure.spec.ts`, add the header strip and the three row heights to the measured surfaces.

Run: `npm run measure`
Expected: `docs/design/measurements.md` and `.json` regenerate with the new surfaces.

- [ ] **Step 7: Review the shots by eye**

Open the new menu shot in all five themes. Check the popover's contrast against the pane beneath it, that the disabled rows read as disabled rather than as missing, and that the shortcut hints do not crowd the labels at the narrowest pane width. Nothing in the test suite can see "renders wrong" — this step is the only thing that can.

- [ ] **Step 8: Run the full gate**

Run: `lsof -ti:4173 | xargs -r kill -9 && npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 9: Commit**

```bash
git add e2e/noteListHeader.spec.ts e2e/shots.spec.ts e2e/measure.spec.ts docs/design/measurements.md docs/design/measurements.json
git commit -m "test(e2e): the note-list header, its preferences, and the shortcut collision

The editor-focused ⇧⌘4 test is the regression guard for the ⌥⌘ collision:
it was proved to fail by injecting the alt-accepting variant."
```

---

### Task 10: Rulings and status

**Files:**

- Modify: `docs/rulings/deferred.md`
- Modify: `docs/rulings/scopes-and-search.md`
- Modify: `docs/rulings/markdown-and-schema.md`
- Modify: `docs/rulings/accessibility.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/NEXT.md`

- [ ] **Step 1: Strike the resolved deferral**

In `docs/rulings/deferred.md`, wrap the "The note list has no header naming the current scope" bullet in `~~` and append the resolution, following the format the two already-struck bullets use — struck rather than deleted, so a reader can see the ruling was retired on purpose.

- [ ] **Step 2: Add the new rulings**

To `docs/rulings/scopes-and-search.md`: ordering is a repository argument, passed through `listForScope` and never re-sorted downstream; the pinned partition is applied first under every order; Trash keeps `trashedAt` and the menu says so; sort and preview preferences are global because per-scope keys on unbounded tag scopes would accumulate unprunably.

To `docs/rulings/markdown-and-schema.md`: `⌥⌘`+digit belongs to heading levels (`@tiptap/extension-heading`'s `` `Mod-Alt-${level}` ``) and `⇧⌘`+digit to scope switching; `Mod-Shift-7/8/9` are taken by list and blockquote extensions, so a future Archive list cannot take `⇧⌘9`; verify any new binding against `node_modules/@tiptap`, not only against browser shortcuts; match on `event.code`, never `event.key`.

To `docs/rulings/accessibility.md`: preview size drives the rendered row and its accessible name from one decision; a disabled menu group carries copy naming the reason.

Extend each file's own `**Trigger:**` line with the new symbols (`order.ts`, `ScopeMenu.tsx`, `useScopeShortcuts.ts`, `preview.ts`, `useSetting.ts`) so the trigger and the index stay in step.

- [ ] **Step 3: Update `CLAUDE.md`**

Add the new symbols to the relevant rows of the rulings table. Update the test counts to the actual numbers from `npm test` and `npm run test:e2e` — read them off the output, do not estimate. Mark row A `complete` in the status table and note that `npm run shots` now writes 12 × 5 = 60 files.

- [ ] **Step 4: Update `NEXT.md`**

Mark A shipped with its spec and plan paths, in the shape B's section uses. Record anything that diverged from this plan during execution and why — B's section is the model, and that record is worth more than the checkmark. Note that B2 and C remain queued and that their relative order is still undecided.

- [ ] **Step 5: Run the full gate**

Run: `lsof -ti:4173 | xargs -r kill -9 && npm test && npm run test:e2e && npm run lint && npm run typecheck && npm run format && npm run build`

- [ ] **Step 6: Commit**

```bash
git add docs/rulings/ CLAUDE.md docs/superpowers/NEXT.md
git commit -m "docs: rulings and status for A

Strikes the note-list-header deferral open since M3. Records the ordering
ruling, the ⌥⌘/⇧⌘ split and its verification method, and the one-decision
rule for preview size and accessible name."
```
