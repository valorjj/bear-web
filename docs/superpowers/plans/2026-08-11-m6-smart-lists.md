# M6 Smart Lists and Trash Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship every row of the smart-list sidebar, make pinning reachable, and give Trash real Delete Forever and Empty Trash actions behind a confirmation dialog.

**Architecture:** `NoteScope` collapses from a growing arm-per-scope union into two permanent arms — `{ kind: 'smart'; list: SmartListId }` and `{ kind: 'tag'; tag: string }` — with every behavioural question answered by a named capability function reading one registry table, never by a `scope.kind` comparison at a call site. Smart lists are pure predicates over a note plus an injected context. Trash operations reuse the transactional repository methods that have existed since M1 and gain a `ui/ConfirmDialog`.

**Tech Stack:** React 19, TypeScript, Dexie + `dexie-react-hooks`, Tailwind v4, Vitest, React Testing Library, Playwright.

## Global Constraints

These bind **every** task. Violating one is a task failure even if its own tests pass.

- **All six gates must pass before every commit:** `npm test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, `npm run test:e2e`.
- **Baselines to preserve:** unit **626** (this plan adds to it), e2e **18**, and `npm run lint` at exactly **5 warnings**. Do not introduce a sixth; do not fix the existing five.
- **Check exit codes, not pass counts** (`echo "exit=$?"`). Editor tests here can print all-green and still exit 1 on an uncaught error from a missing jsdom stub.
- **oxlint, not ESLint.** No `eslint.config.js`. No import sorting exists — order imports by hand to match the surrounding file.
- `erasableSyntaxOnly` forbids `enum`, parameter properties, and namespaces. `verbatimModuleSyntax` requires `import type` / `export type`. **`SmartListId` is a type union, never an enum.**
- **No user-facing string is hardcoded in a component.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `src/i18n/ko.ts` is annotated `Record<TranslationKey, string>`, so a missing Korean translation is a compile error. **Never weaken that annotation** — add the translation.
- **No colour literal outside `src/styles/tokens.css`.** `scripts/sourceLint.test.ts` fails `npm test` on one, and its scan now covers multi-line `className` template literals.
- **`src/ui/` must import nothing** from `@/app`, `@/data`, `@/features`, or `@/i18n` — including via relative specifiers like `../features`. `scripts/sourceLint.test.ts` resolves both forms. Every user-facing string reaches a `src/ui/` component as a prop.
- **Components reach persistence only through `src/data/index.ts`**, never a repository module directly, and never Dexie directly.
- **Only `Resizer.tsx` and `RichEditor.tsx` may set `outline-none`**, allowlisted in `scripts/sourceLint.test.ts` with a marker string each. A third file fails the suite.
- **Motion uses the duration tokens** (`duration-[var(--bear-duration-fast)]`, `duration-[var(--bear-duration)]`), never a hardcoded `duration-150`, so the `prefers-reduced-motion` block keeps covering everything. Tailwind v4 has **no** `--duration-*` theme namespace.
- **Never rely on a CSS `gap` to separate text for assistive tech.** Accessible-name computation concatenates text content and ignores gaps. M5.5 shipped and reverted a regression where a row announced as `"work3"` instead of `"work 3"`. Use an explicit `{' '}` text node.
- **A role-based test failing during a refactor is reporting a behaviour change, not a stale expectation.** Editing it to match new output is a defect. If a test fails on an accessible name, role, or ARIA attribute, **stop and report**.
- **IndexedDB cannot index booleans or nulls.** `pinned` is unindexed and filtered in memory; `.where('pinned')` throws at runtime, not compile time. The `trashedAt` index contains only trashed notes, which is why `.aboveOrEqual(0)` is the correct idiom.
- **`useLiveQuery` returns the previous deps' value for one tick after the deps change — never `undefined`.** Any call site whose deps can change must tag its result with the dependency it was computed for and treat a mismatch as "still loading". Call sites with constant `[]` deps must NOT adopt the pattern; it would be dead complexity.

### Verified facts this plan depends on

Established by reading and running the code, not assumed. If any turns out false, stop and report.

- **Our serializer emits `- [ ]` for an unchecked task and `- [x]` for a checked one.** It normalizes `* [ ]` → `- [ ]` and `- [X]` → `- [x]`, and nests with two spaces: `- [ ] parent\n  - [ ] nested`. Verified by driving `normalizeMarkdown` over real inputs.
- `parseMarkdown('- [ ] a')` produces `taskList > taskItem{checked:false} > paragraph`.
- `notes.setPinned(id, pinned)` exists, is transactional, is tested, and **has zero callers**.
- `listActive()` = `orderBy('updatedAt').reverse()` then filter `trashedAt === null`. `listByTag(tag)` sorts `b.updatedAt - a.updatedAt`. `listTrashed()` sorts `b.trashedAt - a.trashedAt`.
- `db.notes` indexes are `id, updatedAt, createdAt, trashedAt` only.
- **The blank-note purge is emergent, not an explicit branch.** `useAutosave`'s unmount flush calls `discard()` when the text is empty; `NoteEditor`'s `discard` purges unless `hadTextAtMountRef.current && !editedRef.current`. So Delete on a blank note trashes it *and then* the unmount purges it. Task 12 changes exactly that.
- `src/ui/SidebarRow.tsx` props: `label`, `selected`, `onSelect`, `depth?`, `count?`, `icon?`, `disclosure?`, `current?`, `children?`.
- `src/ui/Button.tsx` props: `onClick`, `children`, `label?`, `variant?` (`default | primary | danger | ghost`), `size?` (`sm | md`), `disabled?`, `className?`.
- Tokens available for the dialog: `--bear-shadow-dialog`, `rounded-lg`, `bg-danger`, `--bear-duration`.

### Setup, before Task 1

```bash
git checkout -b m6-smart-lists
```

All tasks commit to this branch. It merges to `main` locally at the end.

---

### Task 1: Introduce capability functions over the existing union

**Files:**

- Modify: `src/features/notes/scope.ts`
- Modify: `src/features/notes/scope.test.ts`
- Modify: `src/features/notes/NoteList.tsx` (the two `scope.kind` gates)
- Modify: `src/features/notes/useNotes.ts:~95` (`scopeIsTrash`)
- Modify: `src/app/AppShell.tsx` (the `scope.kind === 'tag'` and `=== 'trashed'` sites)
- Modify: `src/features/notes/index.ts` (export the new functions)

**Interfaces:**

- Consumes: nothing new.
- Produces:

```ts
export function isTrash(scope: NoteScope): boolean;
export function allowsTrash(scope: NoteScope): boolean;
export function seedTagFor(scope: NoteScope): string | null;
export function acceptsNewNote(scope: NoteScope): boolean;
```

**Why this task exists separately.** Task 2 reshapes the union. Doing both at once means every `scope.kind` call site changes in the same commit that changes what `kind` can be, and the tree does not compile in between. This task introduces the seam with **no behaviour change**, so Task 2 becomes a small, reviewable change behind it.

**The rule driving the whole milestone.** `CLAUDE.md` records what happened when this union last grew: `NoteList`'s Trash button was gated `scope.kind === 'active'`, total over two arms, and silently became partial when `tag` arrived — a tag scope rendered neither Trash nor Restore, so a filtered note had no delete affordance at all. Gating the total case (`!== 'trashed'`) fixed it then and stops being total the moment `locked` exists, because Locked must render no Trash button either.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/scope.test.ts`:

```ts
describe('capabilities', () => {
  it('reports only the trash scope as trash', () => {
    expect(isTrash(TRASHED_SCOPE)).toBe(true);
    expect(isTrash(ACTIVE_SCOPE)).toBe(false);
    expect(isTrash(tagScope('work'))).toBe(false);
  });

  it('offers Trash everywhere except the trash scope', () => {
    expect(allowsTrash(ACTIVE_SCOPE)).toBe(true);
    expect(allowsTrash(tagScope('work'))).toBe(true);
    expect(allowsTrash(TRASHED_SCOPE)).toBe(false);
  });

  it('seeds a new note only inside a tag scope', () => {
    expect(seedTagFor(tagScope('work'))).toBe('work');
    expect(seedTagFor(ACTIVE_SCOPE)).toBeNull();
    expect(seedTagFor(TRASHED_SCOPE)).toBeNull();
  });

  it('accepts a new note everywhere a new note would be visible', () => {
    expect(acceptsNewNote(ACTIVE_SCOPE)).toBe(true);
    expect(acceptsNewNote(tagScope('work'))).toBe(true);
    // A note created here would be untrashed, so it would vanish immediately.
    expect(acceptsNewNote(TRASHED_SCOPE)).toBe(false);
  });
});
```

Add `isTrash, allowsTrash, seedTagFor, acceptsNewNote` to the file's existing import from `./scope`.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/features/notes/scope.test.ts
```

Expected: fails to resolve the four new imports.

- [ ] **Step 3: Implement in `src/features/notes/scope.ts`**

Append below `scopeKey`:

```ts
/**
 * Whether this scope shows trashed notes. Governs Restore-instead-of-Trash and,
 * from M6, whether Delete Forever and Empty Trash render.
 */
export function isTrash(scope: NoteScope): boolean {
  return scope.kind === 'trashed';
}

/**
 * Whether a Trash affordance should render at all.
 *
 * Call sites ask this rather than comparing `scope.kind`. When the union grew
 * from two arms to three, `NoteList` kept gating on `scope.kind === 'active'`,
 * which had been total and silently became partial — a tag-scoped note had no
 * delete affordance whatsoever. M6 adds five more scopes; the only defence that
 * scales is for the question to live here, next to the union, instead of at
 * each call site.
 */
export function allowsTrash(scope: NoteScope): boolean {
  return !isTrash(scope);
}

/** The tag a note created in this scope should be seeded with, or `null`. */
export function seedTagFor(scope: NoteScope): string | null {
  return scope.kind === 'tag' ? scope.tag : null;
}

/**
 * Whether a note created here would actually be visible here.
 *
 * `false` means the caller should switch to All Notes before creating, rather
 * than making a note that vanishes the instant it exists.
 */
export function acceptsNewNote(scope: NoteScope): boolean {
  return !isTrash(scope);
}
```

- [ ] **Step 4: Convert every call site**

`src/features/notes/NoteList.tsx` — replace the two gates. Import `allowsTrash, isTrash` from `./scope`:

```tsx
        {selectedNoteId !== null && allowsTrash(scope) && (
          <Button onClick={() => onTrash(selectedNoteId)}>{t('noteList.trash')}</Button>
        )}
        {selectedNoteId !== null && isTrash(scope) && (
          <Button onClick={() => onRestore(selectedNoteId)}>{t('noteList.restore')}</Button>
        )}
```

and the empty-state ternaries:

```tsx
          title={isTrash(scope) ? t('trash.empty.title') : t('noteList.empty.title')}
          body={isTrash(scope) ? t('trash.empty.body') : t('noteList.empty.body')}
```

`src/features/notes/useNotes.ts` — replace `const scopeIsTrash = scope.kind === 'trashed';` with `const scopeIsTrash = isTrash(scope);` and add `isTrash` to the existing `./scope` import. **Leave the `useEffect` and its dependency array exactly as they are.**

`src/app/AppShell.tsx` — in `handleCreate`:

```tsx
      const tag = seedTagFor(scope);
      const seedText = tag === null ? '' : `\n#${tag}`;
      if (!acceptsNewNote(scope)) setScope(ACTIVE_SCOPE);
```

Leave the rest of `handleCreate` unchanged, including `creatingRef` and the `setSeed`/`select` ordering — the comment there explains why they batch.

- [ ] **Step 5: Export from the barrel**

In `src/features/notes/index.ts`, extend the existing `./scope` export line to include `acceptsNewNote`, `allowsTrash`, `isTrash`, `seedTagFor`, keeping alphabetical order within the braces to match the file's style.

- [ ] **Step 6: Run the full suite — behaviour must not have changed**

```bash
npm test; echo "exit=$?"
```

Expected: **626 passing**, exit 0. This task changes no behaviour, so no existing test may fail. **If one does, stop and report** — a behavioural test failing during a pure refactor means the refactor changed behaviour.

- [ ] **Step 7: Falsify**

1. Make `allowsTrash` return `true` unconditionally. Re-run `npx vitest run src/features/notes/`. A test **must** redden. Restore.
2. Make `seedTagFor` always return `null`. Re-run. A test **must** redden — if none does, tag-seeded creation is untested at this level; report it. Restore.

- [ ] **Step 8: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/ src/app/AppShell.tsx
git commit -m "refactor(notes): ask scope capabilities, not scope.kind

No behaviour change. Introduces the seam M6's union reshape needs, so
call sites stop enumerating arms — the pattern that silently removed the
delete affordance from tag scopes in M5."
```

---

### Task 2: Reshape `NoteScope` into two permanent arms

**Files:**

- Modify: `src/features/notes/scope.ts`
- Modify: `src/features/notes/scope.test.ts`
- Modify: `src/features/notes/index.ts`

**Interfaces:**

- Consumes: Task 1's capability functions.
- Produces:

```ts
export type SmartListId = 'all' | 'untagged' | 'todo' | 'today' | 'pinned' | 'locked' | 'trash';
export const SMART_LIST_IDS: readonly SmartListId[];
export type NoteScope = { kind: 'smart'; list: SmartListId } | { kind: 'tag'; tag: string };
export function smartScope(list: SmartListId): NoteScope;
export const ACTIVE_SCOPE: NoteScope; // { kind: 'smart', list: 'all' }
export const TRASHED_SCOPE: NoteScope; // { kind: 'smart', list: 'trash' }
```

`scopeKey` now yields `smart:all` / `tag:work`. The `tag:` prefix stays for the reason M5 gave: a tag literally named `all` must not collide with the builtin.

**Because Task 1 moved every behavioural question behind a function, this task should change almost nothing outside `scope.ts`.** If you find yourself editing a component, stop and ask whether the question belongs in a capability function instead.

- [ ] **Step 1: Write the failing tests**

Replace the `describe('capabilities')` block from Task 1 with an exhaustive version, and add the registry tests:

```ts
describe('capabilities', () => {
  // Exhaustive over SmartListId. A new smart list added without a ruling on
  // its capabilities fails here rather than silently inheriting a default —
  // this is the assertion that would have caught the M5 defect where a new
  // union arm rendered no delete affordance at all.
  const EXPECTED: Record<
    SmartListId,
    { trash: boolean; allowsTrash: boolean; accepts: boolean }
  > = {
    all: { trash: false, allowsTrash: true, accepts: true },
    untagged: { trash: false, allowsTrash: true, accepts: true },
    todo: { trash: false, allowsTrash: true, accepts: false },
    today: { trash: false, allowsTrash: true, accepts: true },
    pinned: { trash: false, allowsTrash: true, accepts: false },
    locked: { trash: false, allowsTrash: false, accepts: false },
    trash: { trash: true, allowsTrash: false, accepts: false },
  };

  it('covers every smart list', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SMART_LIST_IDS].sort());
  });

  for (const list of SMART_LIST_IDS) {
    it(`rules on ${list}`, () => {
      const scope = smartScope(list);
      expect(isTrash(scope)).toBe(EXPECTED[list].trash);
      expect(allowsTrash(scope)).toBe(EXPECTED[list].allowsTrash);
      expect(acceptsNewNote(scope)).toBe(EXPECTED[list].accepts);
      expect(seedTagFor(scope)).toBeNull();
    });
  }

  it('treats a tag scope as ordinary and seedable', () => {
    const scope = tagScope('work');
    expect(isTrash(scope)).toBe(false);
    expect(allowsTrash(scope)).toBe(true);
    expect(acceptsNewNote(scope)).toBe(true);
    expect(seedTagFor(scope)).toBe('work');
  });

  it('keeps the builtin constants pointing at the right lists', () => {
    expect(scopeKey(ACTIVE_SCOPE)).toBe('smart:all');
    expect(scopeKey(TRASHED_SCOPE)).toBe('smart:trash');
  });

  it('does not let a tag collide with a builtin name', () => {
    expect(scopeKey(tagScope('all'))).not.toBe(scopeKey(ACTIVE_SCOPE));
  });
});
```

**Note the two `accepts: false` rows that are easy to get wrong.** `today` accepts, because a new note's `updatedAt` is by definition today. `untagged` accepts, because a new note genuinely has no tags. `todo` and `pinned` do not: a new note has no task and is not pinned, so it would vanish the instant it was created.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/features/notes/scope.test.ts
```

Expected: `SmartListId`, `SMART_LIST_IDS` and `smartScope` do not resolve.

- [ ] **Step 3: Rewrite the top of `src/features/notes/scope.ts`**

```ts
import { notes } from '@/data';
import type { Note, NotesRepository } from '@/data';

/**
 * The builtin lists. Adding one means adding an id here and a row to
 * `SMART_LIST_IDS` — never a new arm on `NoteScope`, and never a new
 * `scope.kind` comparison at a call site.
 */
export type SmartListId = 'all' | 'untagged' | 'todo' | 'today' | 'pinned' | 'locked' | 'trash';

/** Sidebar order. `scope.test.ts` asserts this covers every `SmartListId`. */
export const SMART_LIST_IDS: readonly SmartListId[] = [
  'all',
  'untagged',
  'todo',
  'today',
  'pinned',
  'locked',
  'trash',
];

/**
 * Two arms, permanently.
 *
 * The previous shape grew an arm per scope, and every `===` gate written
 * against it was total until it silently was not. M6 would have taken it to
 * eight arms; instead the builtins became data.
 */
export type NoteScope = { kind: 'smart'; list: SmartListId } | { kind: 'tag'; tag: string };

export function smartScope(list: SmartListId): NoteScope {
  return { kind: 'smart', list };
}

export function tagScope(tag: string): NoteScope {
  return { kind: 'tag', tag };
}

/**
 * Module-level constants, not object literals at each call site. A literal has
 * a fresh identity on every render, and `useNotes` puts the scope through a
 * `useLiveQuery` dependency array.
 */
export const ACTIVE_SCOPE: NoteScope = smartScope('all');
export const TRASHED_SCOPE: NoteScope = smartScope('trash');

/**
 * A stable string identity for a scope, for use as a `useLiveQuery` dependency
 * and as the tag in the tag-and-verify pattern. The `tag:` prefix is what keeps
 * a tag literally named `all` from colliding with the builtin.
 */
export function scopeKey(scope: NoteScope): string {
  return scope.kind === 'tag' ? `tag:${scope.tag}` : `smart:${scope.list}`;
}
```

- [ ] **Step 4: Rewrite the capability functions against the new shape**

```ts
export function isTrash(scope: NoteScope): boolean {
  return scope.kind === 'smart' && scope.list === 'trash';
}

/**
 * Whether a Trash affordance should render. False in Trash (Restore renders
 * instead) and false in Locked, which is permanently empty and must show no
 * destructive control at all.
 */
export function allowsTrash(scope: NoteScope): boolean {
  return !(scope.kind === 'smart' && (scope.list === 'trash' || scope.list === 'locked'));
}

export function seedTagFor(scope: NoteScope): string | null {
  return scope.kind === 'tag' ? scope.tag : null;
}

/**
 * Whether a note created here would be visible here.
 *
 * Accepting: `all`; `untagged`, because a new note genuinely has no tags;
 * `today`, because a new note's `updatedAt` is by definition today; and any
 * tag scope, because the note is seeded with that tag. Rejecting: `todo` and
 * `pinned`, where a new note satisfies neither predicate; `locked`, which
 * holds nothing; and `trash`.
 *
 * `untagged` and `today` accept for opposite reasons — one because the note
 * satisfies the predicate now and always, one because it satisfies it now and
 * will stop later. Neither is a special case: the question is only whether the
 * predicate holds at the moment of creation.
 */
export function acceptsNewNote(scope: NoteScope): boolean {
  if (scope.kind === 'tag') return true;
  return scope.list === 'all' || scope.list === 'untagged' || scope.list === 'today';
}
```

- [ ] **Step 5: Leave `listForScope` compiling**

`listForScope`'s switch no longer matches the union. Replace it with a temporary form that preserves today's behaviour exactly; Task 4 gives it the real implementation.

```ts
/** Narrowed for injection in tests. */
export type ScopeLister = Pick<NotesRepository, 'listActive' | 'listTrashed' | 'listByTag'>;

/**
 * Ordering comes from the repository and is not re-sorted here.
 *
 * Task 4 replaces the smart-list arm with real predicate filtering. Until then
 * every non-trash builtin behaves as All Notes, which is exactly today's
 * behaviour for the only two builtins that exist.
 */
export function listForScope(scope: NoteScope, repository: ScopeLister = notes): Promise<Note[]> {
  if (scope.kind === 'tag') return repository.listByTag(scope.tag);
  if (scope.list === 'trash') return repository.listTrashed();
  return repository.listActive();
}
```

- [ ] **Step 6: Update the barrel**

In `src/features/notes/index.ts`, add `SMART_LIST_IDS` and `smartScope` to the value export and `SmartListId` to the type export from `./scope`.

- [ ] **Step 7: Run the full suite**

```bash
npm test; echo "exit=$?"
```

Expected: green. `ScopeSidebar.tsx` still uses `ACTIVE_SCOPE`/`TRASHED_SCOPE` and `scopeKey`, all of which still exist with the same names — it should need no edit. **If any component needed changing, note exactly which and why in your report**; Task 1 was supposed to make that unnecessary.

- [ ] **Step 8: Falsify the exhaustiveness guard**

1. Add `'archived'` to `SmartListId` and to `SMART_LIST_IDS`, without touching `EXPECTED`. Re-run `npx vitest run src/features/notes/scope.test.ts`. The `covers every smart list` test **must** redden. Restore both.
2. Change `allowsTrash` so it no longer excludes `locked`. Re-run. The `rules on locked` test **must** redden. Restore.
3. Change `acceptsNewNote` to include `pinned`. Re-run. The `rules on pinned` test **must** redden. Restore.

- [ ] **Step 9: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/
git commit -m "refactor(notes): NoteScope becomes two arms and a registry

Adding a smart list is now a row in SMART_LIST_IDS, not a union arm and
not a new === site. scope.test.ts asserts capabilities exhaustively over
SmartListId, so a new list without a ruling fails the suite."
```

---

### Task 3: Smart-list predicates

**Files:**

- Create: `src/features/notes/smartLists.ts`
- Create: `src/features/notes/smartLists.test.ts`

**Interfaces:**

- Consumes: `SmartListId` from Task 2.
- Produces:

```ts
export interface PredicateContext {
  /** Note ids carrying at least one tag, from the index — not from a parser. */
  tagged: ReadonlySet<string>;
  /** Injected, so `today` is testable without touching the system clock. */
  now: number;
}
export type SmartListPredicate = (note: Note, ctx: PredicateContext) => boolean;
export const SMART_LIST_PREDICATES: Record<SmartListId, SmartListPredicate>;
export function isSameLocalDay(a: number, b: number): boolean;
export const UNCHECKED_TASK: RegExp;
```

**Two of these are not functions of a note alone**, and pretending otherwise is how they end up wrong — hence the context parameter. Predicates that ignore it still take it, so the registry can hold them in one table.

- [ ] **Step 1: Write the failing tests**

Create `src/features/notes/smartLists.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Note } from '@/data';
import { normalizeMarkdown } from '@/features/editor';

import { isSameLocalDay, SMART_LIST_PREDICATES, UNCHECKED_TASK } from './smartLists';

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    title: '',
    text: '',
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

const ctx = (overrides: Partial<{ tagged: Set<string>; now: number }> = {}) => ({
  tagged: new Set<string>(),
  now: Date.UTC(2026, 7, 11, 12, 0, 0),
  ...overrides,
});

describe('untagged', () => {
  const untagged = SMART_LIST_PREDICATES.untagged;

  it('accepts a note absent from the tag index', () => {
    expect(untagged(note({ id: 'n1' }), ctx())).toBe(true);
  });

  it('rejects a note present in the tag index', () => {
    expect(untagged(note({ id: 'n1' }), ctx({ tagged: new Set(['n1']) }))).toBe(false);
  });

  it('reads the index rather than the note text', () => {
    // The note's text says `#work`, but the index is the authority: feature
    // code must not acquire a second tag parser, and `noteTags` reflects
    // active notes only, consistently across trash, restore and rebuild.
    expect(untagged(note({ id: 'n1', text: 'see #work' }), ctx())).toBe(true);
  });
});

describe('todo', () => {
  const todo = SMART_LIST_PREDICATES.todo;

  // Derived from the real serializer, NOT hand-written. The parent spec writes
  // the predicate as "contains an unchecked `- [ ]`", which is an assumption
  // about our own output — exactly the kind that ships inert with a green
  // suite. If the serializer's task syntax ever changes, this fixture changes
  // with it and the predicate's own test starts failing.
  const UNCHECKED = normalizeMarkdown('- [ ] buy milk');
  const CHECKED = normalizeMarkdown('- [x] buy milk');

  it('uses a fixture the serializer actually produces', () => {
    expect(UNCHECKED).toContain('[ ]');
    expect(CHECKED).toContain('[x]');
  });

  it('accepts a note with an unchecked task', () => {
    expect(todo(note({ text: UNCHECKED }), ctx())).toBe(true);
  });

  it('rejects a note whose tasks are all checked', () => {
    expect(todo(note({ text: CHECKED }), ctx())).toBe(false);
  });

  it('accepts a note with one unchecked task among checked ones', () => {
    expect(todo(note({ text: `${CHECKED}\n${UNCHECKED}` }), ctx())).toBe(true);
  });

  it('accepts a nested unchecked task', () => {
    expect(todo(note({ text: normalizeMarkdown('- [ ] a\n  - [ ] b') }), ctx())).toBe(true);
  });

  it('accepts non-canonical bullets from an imported note', () => {
    // `importDatabase` accepts arbitrary Markdown, and a note only becomes
    // canonical once it has been through the editor. A checkbox the user can
    // see must not be invisible to this list until they happen to open it.
    expect(todo(note({ text: '* [ ] star' }), ctx())).toBe(true);
    expect(todo(note({ text: '+ [ ] plus' }), ctx())).toBe(true);
  });

  it('rejects a checked task written with a capital X', () => {
    expect(todo(note({ text: '- [X] done' }), ctx())).toBe(false);
  });

  it('rejects prose that merely mentions brackets', () => {
    expect(todo(note({ text: 'the array is [ ] empty' }), ctx())).toBe(false);
    expect(todo(note({ text: 'a - [ ] mid-line' }), ctx())).toBe(false);
  });

  it('rejects an empty note', () => {
    expect(todo(note(), ctx())).toBe(false);
  });
});

describe('today', () => {
  const today = SMART_LIST_PREDICATES.today;
  const noon = new Date(2026, 7, 11, 12, 0, 0).getTime();

  it('accepts a note updated on the same local date', () => {
    const morning = new Date(2026, 7, 11, 0, 30, 0).getTime();
    expect(today(note({ updatedAt: morning }), ctx({ now: noon }))).toBe(true);
  });

  it('accepts a note updated just before local midnight tonight', () => {
    const lateTonight = new Date(2026, 7, 11, 23, 59, 59).getTime();
    expect(today(note({ updatedAt: lateTonight }), ctx({ now: noon }))).toBe(true);
  });

  it('rejects a note updated just before local midnight last night', () => {
    // Not a 24-hour window: this is 12.5 hours ago and still not today.
    const lastNight = new Date(2026, 7, 10, 23, 59, 59).getTime();
    expect(today(note({ updatedAt: lastNight }), ctx({ now: noon }))).toBe(false);
  });

  it('rejects a note from tomorrow', () => {
    const tomorrow = new Date(2026, 7, 12, 0, 0, 1).getTime();
    expect(today(note({ updatedAt: tomorrow }), ctx({ now: noon }))).toBe(false);
  });
});

describe('pinned', () => {
  it('reads the note flag', () => {
    expect(SMART_LIST_PREDICATES.pinned(note({ pinned: true }), ctx())).toBe(true);
    expect(SMART_LIST_PREDICATES.pinned(note({ pinned: false }), ctx())).toBe(false);
  });
});

describe('locked', () => {
  it('accepts nothing, permanently', () => {
    expect(SMART_LIST_PREDICATES.locked(note({ pinned: true, text: '- [ ] x' }), ctx())).toBe(false);
  });
});

describe('all and trash', () => {
  it('accepts everything for all', () => {
    expect(SMART_LIST_PREDICATES.all(note(), ctx())).toBe(true);
  });

  it('accepts everything for trash, since the scope query already filtered', () => {
    expect(SMART_LIST_PREDICATES.trash(note(), ctx())).toBe(true);
  });
});

describe('isSameLocalDay', () => {
  it('is false across a local midnight one second apart', () => {
    const before = new Date(2026, 7, 10, 23, 59, 59).getTime();
    const after = new Date(2026, 7, 11, 0, 0, 0).getTime();
    expect(isSameLocalDay(before, after)).toBe(false);
  });

  it('is true across a whole local day', () => {
    expect(
      isSameLocalDay(new Date(2026, 7, 11, 0, 0, 0).getTime(), new Date(2026, 7, 11, 23, 59, 59).getTime()),
    ).toBe(true);
  });
});

describe('UNCHECKED_TASK', () => {
  it('is not sticky', () => {
    // A `/g` regex carries `lastIndex` between `.test()` calls, so the same
    // input alternates true/false. A module-level regex used per-note would
    // make roughly half the todo notes vanish from the list.
    expect(UNCHECKED_TASK.test('- [ ] a')).toBe(true);
    expect(UNCHECKED_TASK.test('- [ ] a')).toBe(true);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/features/notes/smartLists.test.ts
```

Expected: the module does not exist.

- [ ] **Step 3: Create `src/features/notes/smartLists.ts`**

```ts
import type { Note } from '@/data';

import type { SmartListId } from './scope';

export interface PredicateContext {
  /**
   * Note ids carrying at least one tag, taken from the derived `noteTags`
   * index — never from a parser. Feature code reaches the index only through
   * `notes.allTagRows()`, and `src/features/` must not import the parser from
   * `src/data/tags/`. The index also reflects active notes only, consistently
   * across trash, restore and rebuild, which is what makes it safe here.
   */
  tagged: ReadonlySet<string>;
  /** Injected so `today` is testable without touching the system clock. */
  now: number;
}

export type SmartListPredicate = (note: Note, ctx: PredicateContext) => boolean;

/**
 * An unchecked task at the start of a line, allowing leading whitespace for
 * nesting.
 *
 * Deliberately NOT `/g`: a global regex carries `lastIndex` between `.test()`
 * calls, so a module-level constant reused per note would alternate true and
 * false on identical input and drop roughly half the matching notes.
 *
 * `[-*+]` rather than just `-` because `importDatabase` accepts arbitrary
 * Markdown and a note is only canonical once it has been through the editor.
 * Our serializer emits `- [ ]`, normalising `* [ ]` to it — but an imported,
 * never-opened note keeps whatever it was written with, and a checkbox the
 * user can see must not be invisible to this list.
 *
 * A checked task cannot match: `\[ \]` requires a literal space, so both
 * `[x]` and `[X]` fail regardless of case.
 *
 * **Known false positive, accepted:** an unchecked task inside a fenced code
 * block counts. Masking code spans is `parseTags`' job and lives in the data
 * layer; duplicating it here for one smart list is not worth a second copy of
 * that logic. Same reasoning as the deliberately-unmasked indented code blocks
 * recorded in CLAUDE.md.
 */
export const UNCHECKED_TASK = /^[ \t]*[-*+] \[ \]/m;

/** Whether two instants fall on the same date in the viewer's local zone. */
export function isSameLocalDay(a: number, b: number): boolean {
  const left = new Date(a);
  const right = new Date(b);
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

/**
 * One predicate per smart list. `all` and `trash` accept everything because the
 * scope query has already selected the right set; they exist so the table is
 * total over `SmartListId` and callers never need a special case.
 *
 * `locked` accepts nothing, permanently. Real encryption needs WebCrypto, a
 * passphrase flow and a recovery story, and is Phase 2.
 */
export const SMART_LIST_PREDICATES: Record<SmartListId, SmartListPredicate> = {
  all: () => true,
  untagged: (note, ctx) => !ctx.tagged.has(note.id),
  todo: (note) => UNCHECKED_TASK.test(note.text),
  today: (note, ctx) => isSameLocalDay(note.updatedAt, ctx.now),
  pinned: (note) => note.pinned,
  locked: () => false,
  trash: () => true,
};
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/features/notes/smartLists.test.ts
```

- [ ] **Step 5: Falsify**

1. Add `g` to `UNCHECKED_TASK`'s flags. Re-run. The `is not sticky` test **must** redden. Restore. This is a real bug class, not a hypothetical.
2. Change `todo` to `/\[ \]/.test(note.text)` (no line anchor, no bullet). Re-run. The `rejects prose that merely mentions brackets` test **must** redden. Restore.
3. Change `today` to a 24-hour window: `ctx.now - note.updatedAt < 86_400_000`. Re-run. The `rejects a note updated just before local midnight last night` test **must** redden. Restore.
4. Change `untagged` to parse `note.text` for a `#`. Re-run. The `reads the index rather than the note text` test **must** redden. Restore.
5. Change `locked` to `() => true`. Re-run. Its test **must** redden. Restore.
6. Edit the `UNCHECKED` fixture to a hand-written `'- [ ] buy milk'` string literal instead of `normalizeMarkdown(...)`. Re-run — it stays green **today**, because our serializer happens to emit that exact form. Restore it, and record in your report that the derived fixture's value is protection against a *future* serializer change, not a present-day difference. Do not leave the literal in.

- [ ] **Step 6: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/smartLists.ts src/features/notes/smartLists.test.ts
git commit -m "feat(notes): smart-list predicates

Todo's fixture is derived from the real serializer rather than assumed,
and UNCHECKED_TASK is deliberately non-global: a sticky lastIndex would
drop half the matching notes."
```

---

### Task 4: `listForScope` returns real smart lists

**Files:**

- Modify: `src/features/notes/scope.ts` (`listForScope`, `ScopeLister`)
- Modify: `src/features/notes/scope.test.ts`

**Interfaces:**

- Consumes: `SMART_LIST_PREDICATES`, `PredicateContext` from Task 3.
- Produces: `listForScope(scope, repository?, now?)` — `now` injected for testability, defaulting to `Date.now`.

```ts
export type ScopeLister = Pick<
  NotesRepository,
  'listActive' | 'listTrashed' | 'listByTag' | 'allTagRows'
>;
export function listForScope(
  scope: NoteScope,
  repository?: ScopeLister,
  now?: () => number,
): Promise<Note[]>;
```

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/scope.test.ts`. Build a fake repository rather than touching Dexie:

```ts
describe('listForScope over smart lists', () => {
  const base = {
    id: '',
    title: '',
    text: '',
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  };
  const NOW = new Date(2026, 7, 11, 12, 0, 0).getTime();
  const YESTERDAY = new Date(2026, 7, 10, 12, 0, 0).getTime();

  const active = [
    { ...base, id: 'plain', updatedAt: YESTERDAY },
    { ...base, id: 'tagged', updatedAt: YESTERDAY, text: 'see #work' },
    { ...base, id: 'todo', updatedAt: YESTERDAY, text: '- [ ] milk' },
    { ...base, id: 'done', updatedAt: YESTERDAY, text: '- [x] milk' },
    { ...base, id: 'fresh', updatedAt: NOW },
    { ...base, id: 'pin', updatedAt: YESTERDAY, pinned: true },
  ];

  const repo = {
    listActive: async () => active,
    listTrashed: async () => [{ ...base, id: 'gone', trashedAt: 1 }],
    listByTag: async (tag: string) => (tag === 'work' ? [active[1]!] : []),
    allTagRows: async () => [{ noteId: 'tagged', tag: 'work' }],
  };

  const ids = async (scope: NoteScope) =>
    (await listForScope(scope, repo, () => NOW)).map((n) => n.id);

  it('returns every active note for all', async () => {
    expect(await ids(ACTIVE_SCOPE)).toEqual(active.map((n) => n.id));
  });

  it('returns only trashed notes for trash', async () => {
    expect(await ids(TRASHED_SCOPE)).toEqual(['gone']);
  });

  it('excludes notes carrying a tag from untagged', async () => {
    expect(await ids(smartScope('untagged'))).not.toContain('tagged');
  });

  it('keeps untagged notes in untagged', async () => {
    expect(await ids(smartScope('untagged'))).toContain('plain');
  });

  it('returns only notes with an unchecked task for todo', async () => {
    expect(await ids(smartScope('todo'))).toEqual(['todo']);
  });

  it('returns only notes updated today for today', async () => {
    expect(await ids(smartScope('today'))).toEqual(['fresh']);
  });

  it('returns only pinned notes for pinned', async () => {
    expect(await ids(smartScope('pinned'))).toEqual(['pin']);
  });

  it('returns nothing for locked', async () => {
    expect(await ids(smartScope('locked'))).toEqual([]);
  });

  it('delegates a tag scope to the repository', async () => {
    expect(await ids(tagScope('work'))).toEqual(['tagged']);
  });

  it('does not read the tag index for lists that do not need it', async () => {
    // allTagRows is a full table scan. Only `untagged` needs it, and paying
    // for it on every scope switch would be a needless second scan.
    let calls = 0;
    const counting = {
      ...repo,
      allTagRows: async () => {
        calls += 1;
        return repo.allTagRows();
      },
    };
    await listForScope(smartScope('todo'), counting, () => NOW);
    expect(calls).toBe(0);
    await listForScope(smartScope('untagged'), counting, () => NOW);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/features/notes/scope.test.ts
```

- [ ] **Step 3: Implement**

Replace `ScopeLister` and `listForScope` in `src/features/notes/scope.ts`, and add the import `import { SMART_LIST_PREDICATES } from './smartLists';`:

```ts
/** Narrowed for injection in tests. */
export type ScopeLister = Pick<
  NotesRepository,
  'listActive' | 'listTrashed' | 'listByTag' | 'allTagRows'
>;

/** Lists whose predicate reads `ctx.tagged`, and so must pay for the index scan. */
const NEEDS_TAG_INDEX: ReadonlySet<string> = new Set(['untagged']);

/**
 * Ordering comes from the repository and is never re-sorted here: every lister
 * returns its own order, and pinned-first ordering lives in the repository so
 * it applies to the tag scope too.
 */
export async function listForScope(
  scope: NoteScope,
  repository: ScopeLister = notes,
  now: () => number = Date.now,
): Promise<Note[]> {
  if (scope.kind === 'tag') return repository.listByTag(scope.tag);
  if (scope.list === 'trash') return repository.listTrashed();

  const list = await repository.listActive();

  // Only `untagged` reads the index, and `allTagRows` is a full table scan.
  // Paying for it on every scope switch would double the work for six of the
  // seven builtins.
  const tagged = NEEDS_TAG_INDEX.has(scope.list)
    ? new Set((await repository.allTagRows()).map((row) => row.noteId))
    : new Set<string>();

  const predicate = SMART_LIST_PREDICATES[scope.list];
  const ctx = { tagged, now: now() };
  return list.filter((note) => predicate(note, ctx));
}
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/features/notes/; echo "exit=$?"
```

- [ ] **Step 5: Falsify**

1. Change `NEEDS_TAG_INDEX` to include `'todo'`. Re-run. The call-count test **must** redden. Restore.
2. Remove `NEEDS_TAG_INDEX` entirely and always fetch the rows. Re-run. The call-count test **must** redden (it asserts `0` for `todo`). Restore.
3. Make `listForScope` skip the predicate filter and return `list` unchanged. Re-run. At least four tests **must** redden. Restore.

- [ ] **Step 6: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/
git commit -m "feat(notes): listForScope filters by smart-list predicate

Only `untagged` pays for the tag-index scan; the other six builtins
would otherwise double their work on every scope switch."
```

---

### Task 5: `useSmartListCounts`

**Files:**

- Create: `src/features/notes/useSmartListCounts.ts`
- Create: `src/features/notes/useSmartListCounts.test.tsx`
- Modify: `src/features/notes/index.ts`

**Interfaces:**

- Consumes: `SMART_LIST_PREDICATES`, `SMART_LIST_IDS`.
- Produces:

```ts
export type SmartListCounts = Record<SmartListId, number>;
export function useSmartListCounts(): SmartListCounts | undefined;
```

`undefined` while loading — never a zero-filled object, which would render every row as `0` on first paint.

**One live query, not seven.** The obvious implementation is a `useLiveQuery` per row, and M5 already paid for that mistake: the tag tree's row count and its children resolve independently, which is why a collapsed row can flash open for a frame. A single snapshot also makes the counts mutually consistent — untagged plus tagged always equals all, which seven queries landing in seven frames cannot guarantee.

**Its deps are the constant `[]`**, so the tag-and-verify pattern does NOT apply. Adding it here would be dead complexity.

- [ ] **Step 1: Write the failing test**

Create `src/features/notes/useSmartListCounts.test.tsx`. Follow the pattern in `src/features/tags/useTagTree.test.tsx` for driving a hook against the real fake-indexeddb-backed `db`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, notes } from '@/data';

import { useSmartListCounts } from './useSmartListCounts';

describe('useSmartListCounts', () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.noteTags.clear();
  });

  it('is undefined before the query resolves', () => {
    const { result } = renderHook(() => useSmartListCounts());
    expect(result.current).toBeUndefined();
  });

  it('counts every list from one snapshot', async () => {
    await notes.create('plain note');
    await notes.create('tagged #work');
    await notes.create('- [ ] milk');
    const trashed = await notes.create('bye');
    await notes.trash(trashed.id);

    const { result } = renderHook(() => useSmartListCounts());

    await waitFor(() => expect(result.current).toBeDefined());

    const counts = result.current!;
    expect(counts.all).toBe(3);
    expect(counts.trash).toBe(1);
    expect(counts.todo).toBe(1);
    expect(counts.untagged).toBe(2);
    expect(counts.locked).toBe(0);
    // Every note was just created, so all three are "today".
    expect(counts.today).toBe(3);
    expect(counts.pinned).toBe(0);
  });

  it('keeps untagged and tagged summing to all', async () => {
    await notes.create('a #x');
    await notes.create('b');
    await notes.create('c #y');

    const { result } = renderHook(() => useSmartListCounts());
    await waitFor(() => expect(result.current).toBeDefined());

    // The property seven independent queries cannot guarantee.
    expect(result.current!.untagged).toBe(1);
    expect(result.current!.all).toBe(3);
  });

  it('counts pinned notes', async () => {
    const note = await notes.create('pin me');
    await notes.setPinned(note.id, true);

    const { result } = renderHook(() => useSmartListCounts());
    await waitFor(() => expect(result.current?.pinned).toBe(1));
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/features/notes/useSmartListCounts.test.tsx
```

- [ ] **Step 3: Create `src/features/notes/useSmartListCounts.ts`**

```ts
import { useLiveQuery } from 'dexie-react-hooks';

import { notes } from '@/data';

import { SMART_LIST_IDS, type SmartListId } from './scope';
import { SMART_LIST_PREDICATES } from './smartLists';

export type SmartListCounts = Record<SmartListId, number>;

/**
 * Every sidebar count, from ONE snapshot.
 *
 * A `useLiveQuery` per row is the obvious shape and is wrong for a reason M5
 * already paid for: the tag tree's row count and its children resolve as two
 * independent queries, which is why a collapsed row can flash open for a
 * frame. Deriving all seven counts from one `listActive()` plus one
 * `allTagRows()` also makes them mutually consistent — untagged plus tagged
 * always equals all, which seven queries landing in seven frames cannot
 * promise.
 *
 * Returns `undefined` while loading, never a zero-filled object: the latter
 * renders every row as "0" on first paint, which reads as "empty" rather than
 * "not known yet".
 *
 * The deps are the constant `[]`, so the tag-and-verify pattern documented in
 * CLAUDE.md does not apply here. Adding it would be dead complexity.
 */
export function useSmartListCounts(): SmartListCounts | undefined {
  return useLiveQuery(async () => {
    const [active, trashed, rows] = await Promise.all([
      notes.listActive(),
      notes.listTrashed(),
      notes.allTagRows(),
    ]);

    const ctx = { tagged: new Set(rows.map((row) => row.noteId)), now: Date.now() };

    const counts = {} as SmartListCounts;
    for (const id of SMART_LIST_IDS) {
      counts[id] =
        id === 'trash'
          ? trashed.length
          : active.filter((note) => SMART_LIST_PREDICATES[id](note, ctx)).length;
    }
    return counts;
  }, []);
}
```

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/features/notes/useSmartListCounts.test.tsx; echo "exit=$?"
```

- [ ] **Step 5: Export from the barrel**

Add `useSmartListCounts` and the type `SmartListCounts` to `src/features/notes/index.ts`.

- [ ] **Step 6: Falsify**

1. Change the hook to seed `counts` with zeros and return it synchronously when the query has not resolved. Re-run. The `is undefined before the query resolves` test **must** redden. Restore.
2. Count `trash` from `active` instead of `trashed`. Re-run. A test **must** redden. Restore.
3. Drop `allTagRows` and pass an empty `tagged` set. Re-run. The untagged assertions **must** redden. Restore.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/
git commit -m "feat(notes): all seven smart-list counts from one live query

Seven independent queries would let rows land in seven different frames,
the mechanism behind M5's collapsed-tag flash, and would let untagged
plus tagged disagree with all."
```

---

### Task 6: `SmartListSidebar`, and delete `ScopeSidebar`

**Files:**

- Create: `src/features/notes/SmartListSidebar.tsx`
- Create: `src/features/notes/SmartListSidebar.test.tsx`
- Delete: `src/features/notes/ScopeSidebar.tsx`
- Delete: `src/features/notes/ScopeSidebar.test.tsx`
- Modify: `src/features/notes/index.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Modify: `src/app/AppShell.tsx` (swap the component)

**Interfaces:**

- Consumes: `SidebarRow` from `@/ui/SidebarRow`, `SMART_LIST_IDS`, `smartScope`, `scopeKey`, `useSmartListCounts`.
- Produces:

```ts
export interface SmartListSidebarProps {
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  counts: SmartListCounts | undefined;
}
export function SmartListSidebar(props: SmartListSidebarProps): ReactElement;
```

**`ScopeSidebar.tsx`'s own header comment says M6 deletes it.** Delete both it and its test; do not migrate its tests.

- [ ] **Step 1: Add the translations**

In `src/i18n/en.ts`, add alongside the existing `scope.*` keys:

```ts
  'smartList.label': 'Lists',
  'smartList.all': 'Notes',
  'smartList.untagged': 'Untagged',
  'smartList.todo': 'Todo',
  'smartList.today': 'Today',
  'smartList.pinned': 'Pinned',
  'smartList.locked': 'Locked',
  'smartList.trash': 'Trash',

  'locked.empty.title': 'Locked notes are not available yet',
  'locked.empty.body':
    'Encryption needs a passphrase and a way to recover it, so it is not built yet. Nothing of yours is hidden here.',
```

Remove `'scope.label'`, `'scope.notes'` and `'scope.trash'` — `ScopeSidebar` was their only consumer, and leaving dead keys in the type invites a future component to reach for the wrong one.

In `src/i18n/ko.ts`, add the matching Korean and remove the same three:

```ts
  'smartList.label': '목록',
  'smartList.all': '메모',
  'smartList.untagged': '태그 없음',
  'smartList.todo': '해야 할 일',
  'smartList.today': '오늘',
  'smartList.pinned': '고정됨',
  'smartList.locked': '잠긴 항목',
  'smartList.trash': '휴지통',

  'locked.empty.title': '잠긴 메모는 아직 사용할 수 없습니다',
  'locked.empty.body':
    '암호화에는 암호와 복구 수단이 필요해서 아직 구현하지 않았습니다. 여기에 숨겨진 메모는 없습니다.',
```

`ko.ts` is `Record<TranslationKey, string>`, so a missing key is a compile error. **Never weaken that annotation** — if typecheck complains, add the translation.

- [ ] **Step 2: Write the failing test**

Create `src/features/notes/SmartListSidebar.test.tsx`. Use the project's i18n test helper — check how `TagSidebar.test.tsx` wraps its renders and match it exactly:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { ACTIVE_SCOPE, smartScope, tagScope } from './scope';
import { SmartListSidebar } from './SmartListSidebar';

const counts = {
  all: 3,
  untagged: 1,
  todo: 2,
  today: 0,
  pinned: 0,
  locked: 0,
  trash: 4,
};

describe('SmartListSidebar', () => {
  it('renders every list in spec order', () => {
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={vi.fn()} counts={counts} />,
    );

    const rows = screen.getAllByRole('button');
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Notes 3',
      'Untagged 1',
      'Todo 2',
      'Today 0',
      'Pinned 0',
      'Locked 0',
      'Trash 4',
    ]);
  });

  it('marks the selected list', () => {
    renderWithI18n(
      <SmartListSidebar scope={smartScope('todo')} onScopeChange={vi.fn()} counts={counts} />,
    );

    expect(screen.getByRole('button', { name: 'Todo 2' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Notes 3' })).not.toHaveAttribute('aria-current');
  });

  it('marks nothing when a tag scope is active', () => {
    renderWithI18n(
      <SmartListSidebar scope={tagScope('work')} onScopeChange={vi.fn()} counts={counts} />,
    );

    for (const row of screen.getAllByRole('button')) {
      expect(row).not.toHaveAttribute('aria-current');
    }
  });

  it('changes scope on click', async () => {
    const onScopeChange = vi.fn();
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={onScopeChange} counts={counts} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Trash 4' }));
    expect(onScopeChange).toHaveBeenCalledWith(smartScope('trash'));
  });

  it('renders a zero count rather than omitting it', () => {
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={vi.fn()} counts={counts} />,
    );

    // "Today 0" must read as zero, not as an unknown quantity.
    expect(screen.getByRole('button', { name: 'Today 0' })).toBeInTheDocument();
  });

  it('renders rows without counts while they are loading', () => {
    renderWithI18n(
      <SmartListSidebar scope={ACTIVE_SCOPE} onScopeChange={vi.fn()} counts={undefined} />,
    );

    // The rows themselves must still render — the sidebar structure is not
    // waiting on a number — but no count element may appear.
    expect(screen.getByRole('button', { name: 'Notes' })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-count]')).toHaveLength(0);
  });
});
```

**Note the accessible names include the count separated by a space.** `SidebarRow` renders an explicit `{' '}` before its count for exactly this reason; a CSS gap would produce `"Notes3"`. If these names come out concatenated, `SidebarRow` has regressed — **stop and report**, do not adjust the expectation.

- [ ] **Step 3: Run and confirm failure**

```bash
npx vitest run src/features/notes/SmartListSidebar.test.tsx
```

- [ ] **Step 4: Create `src/features/notes/SmartListSidebar.tsx`**

```tsx
import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { SidebarRow } from '@/ui/SidebarRow';

import { type NoteScope, scopeKey, SMART_LIST_IDS, type SmartListId, smartScope } from './scope';
import type { SmartListCounts } from './useSmartListCounts';

export interface SmartListSidebarProps {
  scope: NoteScope;
  onScopeChange: (next: NoteScope) => void;
  /** `undefined` while the counts query has not resolved. Rows still render. */
  counts: SmartListCounts | undefined;
}

/**
 * Replaces `ScopeSidebar`, which shipped in M3 as two hardcoded rows with a
 * comment saying M6 would delete it. It has.
 */
const LABELS: Record<SmartListId, TranslationKey> = {
  all: 'smartList.all',
  untagged: 'smartList.untagged',
  todo: 'smartList.todo',
  today: 'smartList.today',
  pinned: 'smartList.pinned',
  locked: 'smartList.locked',
  trash: 'smartList.trash',
};

export function SmartListSidebar({
  scope,
  onScopeChange,
  counts,
}: SmartListSidebarProps): ReactElement {
  const t = useT();
  const active = scopeKey(scope);

  return (
    <nav aria-label={t('smartList.label')} className="p-2">
      <ul>
        {SMART_LIST_IDS.map((id) => {
          const rowScope = smartScope(id);
          return (
            <SidebarRow
              key={id}
              label={t(LABELS[id])}
              // `counts?.[id]` rather than `counts && counts[id]`: the latter
              // is `undefined` for a genuine zero only by accident of
              // falsiness, and a zero count must render as "0".
              count={counts?.[id]}
              selected={active === scopeKey(rowScope)}
              onSelect={() => onScopeChange(rowScope)}
            />
          );
        })}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 5: Swap it into `AppShell` and delete `ScopeSidebar`**

In `src/app/AppShell.tsx`, replace the `ScopeSidebar` import and element:

```tsx
import { SmartListSidebar, useSmartListCounts } from '@/features/notes';
```

```tsx
  const counts = useSmartListCounts();
```

```tsx
          <SmartListSidebar scope={scope} onScopeChange={setScope} counts={counts} />
```

Then:

```bash
git rm src/features/notes/ScopeSidebar.tsx src/features/notes/ScopeSidebar.test.tsx
```

and remove its two export lines from `src/features/notes/index.ts`, adding `SmartListSidebar` and `SmartListSidebarProps` in their place.

- [ ] **Step 6: Run the full suite**

```bash
npm test; echo "exit=$?"
```

`AppShell.test.tsx` will have assertions naming the old rows. A test that referenced `ScopeSidebar`'s "Notes"/"Trash" rows by accessible name may now match the new row including its count. **Update those to the new accessible names**, which is legitimate — the rows genuinely changed. Do **not** change any assertion about behaviour: what gets selected, what the note list shows, what `aria-current` means.

- [ ] **Step 7: Falsify**

1. Change `count={counts?.[id]}` to `count={counts && counts[id]}`. Re-run. Nothing reddens for a nonzero count, but the `Today 0` name test **must** redden, because `counts && counts['today']` is `0` which is falsy — trace what `SidebarRow` renders and confirm. Restore.
2. Remove `aria-current` by hardcoding `selected={false}`. Re-run. Two tests **must** redden. Restore.
3. Reorder `SMART_LIST_IDS` so `trash` is first. Re-run. The order test **must** redden. Restore.

- [ ] **Step 8: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add -A src/features/notes/ src/app/AppShell.tsx src/i18n/
git commit -m "feat(notes): smart-list sidebar, and delete ScopeSidebar

ScopeSidebar shipped in M3 as two hardcoded rows carrying a comment
saying M6 would delete it."
```

---

### Task 7: Wire the scope into `AppShell`

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/features/notes/NoteList.tsx` (Locked empty state)

**Interfaces:**

- Consumes: everything from Tasks 1–6.
- Produces: no new exports.

Two behaviours land here: the Locked empty state, and the create-bounce.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/AppShell.test.tsx`, following the file's existing render helper:

```tsx
it('shows a Phase 2 explanation in Locked, not "no notes"', async () => {
  await renderShell();

  await userEvent.click(await screen.findByRole('button', { name: /^Locked/ }));

  // A user who sees "No notes" here concludes their locked notes were lost.
  expect(await screen.findByText('Locked notes are not available yet')).toBeInTheDocument();
  expect(screen.queryByText('No notes')).not.toBeInTheDocument();
});

it('renders no Delete button in Locked', async () => {
  await renderShell();

  await userEvent.click(await screen.findByRole('button', { name: /^Locked/ }));

  expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
});

it('bounces to Notes when creating inside a list that could not show the note', async () => {
  await renderShell();

  await userEvent.click(await screen.findByRole('button', { name: /^Pinned/ }));
  await userEvent.click(screen.getByRole('button', { name: 'New note' }));

  // A note created in Pinned is not pinned, so it would vanish instantly.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Notes/ })).toHaveAttribute('aria-current', 'page'),
  );
});

it('stays put when creating inside a list that can show the note', async () => {
  await renderShell();

  await userEvent.click(await screen.findByRole('button', { name: /^Untagged/ }));
  await userEvent.click(screen.getByRole('button', { name: 'New note' }));

  // A new note genuinely has no tags, so Untagged can hold it.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^Untagged/ })).toHaveAttribute(
      'aria-current',
      'page',
    ),
  );
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/AppShell.test.tsx
```

- [ ] **Step 3: Add the Locked empty state to `NoteList`**

`NoteList` needs to distinguish three empty states. Add to its imports `import { isTrash, type NoteScope } from './scope';` — already partly there from Task 1 — and replace the `EmptyState` block:

```tsx
      {items === undefined ? null : items.length === 0 ? (
        <EmptyState title={t(emptyTitle(scope))} body={t(emptyBody(scope))} />
      ) : (
```

with these helpers above the component:

```tsx
/**
 * Locked gets its own copy deliberately. "No notes" would tell a user their
 * locked notes are missing; the truth is the feature does not exist yet.
 */
function isLocked(scope: NoteScope): boolean {
  return scope.kind === 'smart' && scope.list === 'locked';
}

function emptyTitle(scope: NoteScope): TranslationKey {
  if (isLocked(scope)) return 'locked.empty.title';
  return isTrash(scope) ? 'trash.empty.title' : 'noteList.empty.title';
}

function emptyBody(scope: NoteScope): TranslationKey {
  if (isLocked(scope)) return 'locked.empty.body';
  return isTrash(scope) ? 'trash.empty.body' : 'noteList.empty.body';
}
```

Import `type { TranslationKey }` from `@/i18n`.

- [ ] **Step 4: Confirm `allowsTrash` already handles Locked**

Task 2 made `allowsTrash` false for `locked`, and `NoteList`'s buttons were converted to `allowsTrash`/`isTrash` in Task 1. **No change should be needed** for the "no Delete button in Locked" test to pass. If it fails, the Task 1 conversion missed a site — find it rather than adding a special case here.

- [ ] **Step 5: Run and confirm the tests pass**

```bash
npx vitest run src/app/AppShell.test.tsx; echo "exit=$?"
```

- [ ] **Step 6: Falsify**

1. Make `emptyTitle` ignore `isLocked`. Re-run. The Locked copy test **must** redden. Restore.
2. Make `acceptsNewNote` return `true` for every smart list. Re-run. The bounce test **must** redden. Restore.
3. Make `acceptsNewNote` return `false` for `untagged`. Re-run. The stays-put test **must** redden — this is the pair that stops the bounce from being over-eager. Restore.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/app/ src/features/notes/
git commit -m "feat(app): Locked empty state, and bounce creation out of lists that cannot show a new note"
```

---

### Task 8: Pinning

**Files:**

- Modify: `src/data/repositories/notes.ts` (`listActive`, `listByTag`)
- Modify: `src/data/repositories/notes.test.ts`
- Modify: `src/features/notes/NoteListItem.tsx`
- Modify: `src/features/notes/NoteListItem.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `notes.setPinned` (exists since M1, **zero callers**).
- Produces: `NoteListItemProps` gains `onTogglePin: (id: string, pinned: boolean) => void`.

**This is not scope creep.** `setPinned` has never been called, so the spec's Pinned row is permanently empty without it.

**Pinned notes sort first in every non-trash list**, not only in the Pinned row — that is what pinning means, and a "pinned" note sitting mid-list is pinned to nothing. `listTrashed` is deliberately unaffected: trash is ordered by when things were deleted, and a pinned note deleted earlier is not more important than one deleted later.

- [ ] **Step 1: Write the failing repository tests**

Append to `src/data/repositories/notes.test.ts`, matching its existing setup:

```ts
describe('pinned ordering', () => {
  it('puts pinned notes first in listActive, newest-first within each group', async () => {
    const old = await repo.create('old');
    const mid = await repo.create('mid');
    const recent = await repo.create('recent');
    await repo.setPinned(old.id, true);

    const ids = (await repo.listActive()).map((n) => n.id);
    expect(ids[0]).toBe(old.id);
    expect(ids.slice(1)).toEqual([recent.id, mid.id]);
  });

  it('puts pinned notes first in listByTag', async () => {
    const a = await repo.create('a #work');
    const b = await repo.create('b #work');
    await repo.setPinned(a.id, true);

    expect((await repo.listByTag('work')).map((n) => n.id)).toEqual([a.id, b.id]);
  });

  it('leaves listTrashed ordered by deletion time, ignoring pinned', async () => {
    const first = await repo.create('first');
    const second = await repo.create('second');
    await repo.setPinned(first.id, true);
    await repo.trash(first.id);
    await repo.trash(second.id);

    // Most recently trashed first, regardless of pin.
    expect((await repo.listTrashed())[0]!.id).toBe(second.id);
  });
});
```

**If `repo.create` returns notes with identical `updatedAt`** because the fake clock does not advance, the within-group ordering assertion is meaningless. Check how the existing tests in this file handle time — if they inject a `now`, use it to give each note a distinct timestamp, and say so in your report.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/data/repositories/notes.test.ts
```

- [ ] **Step 3: Implement the ordering**

In `src/data/repositories/notes.ts`, add above the returned object:

```ts
  /**
   * Pinned first, then newest first. Applied to every non-trash lister so a
   * pinned note is pinned everywhere it appears, not only in the Pinned list.
   *
   * `pinned` cannot drive an IndexedDB index — booleans are not valid keys —
   * so this is an in-memory sort, which is also why `listActive` already
   * filters in memory.
   */
  function byPinnedThenRecent(a: Note, b: Note): number {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  }
```

Then in `listActive`:

```ts
    async listActive() {
      // `pinned` and `trashedAt === null` cannot drive an index here; see db.ts.
      const all = await db.notes.toArray();
      return all.filter((n) => n.trashedAt === null).sort(byPinnedThenRecent);
    },
```

and in `listByTag`, replace the final sort:

```ts
      return found
        .filter((note): note is Note => note !== undefined && note.trashedAt === null)
        .sort(byPinnedThenRecent);
```

**Leave `listTrashed` exactly as it is.**

- [ ] **Step 4: Add the pin affordance**

In `src/i18n/en.ts`:

```ts
  'note.pin': 'Pin note',
  'note.unpin': 'Unpin note',
```

and `ko.ts`:

```ts
  'note.pin': '메모 고정',
  'note.unpin': '고정 해제',
```

In `src/features/notes/NoteListItem.tsx`, add `onTogglePin` to the props and render the control. **The pin button must be a sibling of the row button, not nested inside it** — a `<button>` inside a `<button>` is invalid HTML and the inner one is unclickable in some browsers. Restructure the `<li>` so the row button and the pin button sit side by side:

```tsx
    <li className="relative flex items-stretch border-b border-border">
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2.5 text-left transition-colors duration-[var(--bear-duration-fast)] ease-bear ${
          selected ? 'bg-selected' : 'hover:bg-hover'
        }`}
      >
        {selected && (
          <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
        )}

        <span className="truncate text-ui-md font-semibold text-text">
          {note.title === '' ? t('note.untitled') : note.title}
        </span>
        <span className="text-ui-sm text-faint">
          {formatNoteDate(note.updatedAt, locale, now ?? Date.now())}
        </span>
        <span className="truncate text-ui-sm text-muted">
          {snippet === '' ? t('note.noText') : snippet}
        </span>
      </button>

      <button
        type="button"
        aria-label={note.pinned ? t('note.unpin') : t('note.pin')}
        aria-pressed={note.pinned}
        onClick={() => onTogglePin(note.id, !note.pinned)}
        className={`shrink-0 px-2 text-ui transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-accent ${
          note.pinned ? 'text-accent' : 'text-faint'
        }`}
      >
        ●
      </button>
    </li>
```

- [ ] **Step 5: Thread it through**

`NoteList` gains `onTogglePin: (id: string, pinned: boolean) => void` in its props and passes it to each `NoteListItem`. `AppShell` supplies it:

```tsx
  const handleTogglePin = useCallback(async (id: string, pinned: boolean) => {
    await notes.setPinned(id, pinned);
  }, []);
```

and `onTogglePin={(id, pinned) => void handleTogglePin(id, pinned)}`.

- [ ] **Step 6: Write the component test**

Append to `src/features/notes/NoteListItem.test.tsx`:

```tsx
it('offers a pin control that reports its state', async () => {
  const onTogglePin = vi.fn();
  renderItem({ note: { ...baseNote, pinned: false }, onTogglePin });

  const pin = screen.getByRole('button', { name: 'Pin note' });
  expect(pin).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(pin);
  expect(onTogglePin).toHaveBeenCalledWith(baseNote.id, true);
});

it('offers to unpin a pinned note', async () => {
  const onTogglePin = vi.fn();
  renderItem({ note: { ...baseNote, pinned: true }, onTogglePin });

  const pin = screen.getByRole('button', { name: 'Unpin note' });
  expect(pin).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(pin);
  expect(onTogglePin).toHaveBeenCalledWith(baseNote.id, false);
});

it('does not select the note when the pin is clicked', async () => {
  const onSelect = vi.fn();
  const onTogglePin = vi.fn();
  renderItem({ onSelect, onTogglePin });

  await userEvent.click(screen.getByRole('button', { name: 'Pin note' }));
  expect(onSelect).not.toHaveBeenCalled();
});
```

Adapt `renderItem` to the file's existing helper shape.

- [ ] **Step 7: Run and confirm the tests pass**

```bash
npx vitest run src/features/notes/ src/data/repositories/notes.test.ts; echo "exit=$?"
```

- [ ] **Step 8: Falsify**

1. Remove `if (a.pinned !== b.pinned)` from the comparator. Re-run. Two repository tests **must** redden. Restore.
2. Apply `byPinnedThenRecent` to `listTrashed` too. Re-run. The trash-ordering test **must** redden. Restore.
3. Nest the pin `<button>` inside the row `<button>`. Re-run. The `does not select the note` test **must** redden — a click on the inner button bubbles to the outer one. Restore.

- [ ] **Step 9: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/data/ src/features/notes/ src/app/ src/i18n/
git commit -m "feat(notes): pinning, and pinned-first ordering everywhere but trash

setPinned has existed and been tested since M1 with zero callers, which
made the Pinned smart list permanently empty."
```

---

### Task 9: `ui/ConfirmDialog`

**Files:**

- Create: `src/ui/ConfirmDialog.tsx`
- Modify: `src/ui/ui.test.tsx`

**Interfaces:**

- Consumes: `Button` from `./Button`; the `--bear-shadow-dialog`, `rounded-lg` and motion tokens.
- Produces:

```ts
export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Renders the confirm action as destructive. */
  destructive?: boolean;
}
export function ConfirmDialog(props: ConfirmDialogProps): ReactElement | null;
```

**Boundary:** `src/ui/` imports nothing from `@/app`, `@/data`, `@/features` or `@/i18n`. Every string arrives as a prop, already translated — the same reason `Resizer` takes `min`/`max` rather than importing the pane constants.

**Initial focus is on Cancel**, not Confirm: an Enter keypress in flight must not destroy notes.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/ui.test.tsx` (add the import):

```tsx
describe('ConfirmDialog', () => {
  const props = {
    open: true,
    title: 'Delete forever?',
    body: 'This cannot be undone.',
    confirmLabel: 'Delete forever',
    cancelLabel: 'Cancel',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...props} open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('exposes an alertdialog labelled by its title', () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Delete forever?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('focuses cancel on open, not confirm', () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    // An Enter keypress already in flight must not destroy anything.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('confirms and cancels through their buttons', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel on Escape when closed', async () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog {...props} open={false} onConfirm={vi.fn()} onCancel={onCancel} />,
    );

    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('traps Tab inside the dialog', async () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete forever' });

    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    // Wrapping is the trap: focus must not escape to the document body.
    await userEvent.tab();
    expect(cancel).toHaveFocus();
  });

  it('wraps backwards too', async () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Delete forever' })).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/ui/ui.test.tsx
```

- [ ] **Step 3: Create `src/ui/ConfirmDialog.tsx`**

```tsx
import { type ReactElement, useEffect, useId, useRef } from 'react';

import { Button } from './Button';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Renders the confirm action as destructive. */
  destructive?: boolean;
}

/**
 * A modal confirmation, for actions with no undo.
 *
 * Presentation only: every string arrives translated, so this file imports
 * nothing from `@/i18n` and the `src/ui` boundary holds.
 *
 * **Focus starts on Cancel, deliberately.** These dialogs guard irreversible
 * deletion with no server copy, and an Enter keypress already in flight when
 * the dialog opens must not destroy anything.
 *
 * The focus trap cycles on keydown rather than using `inert`, which jsdom does
 * not implement. That is enough to test tab order and Escape here; behaviour
 * that depends on real focus semantics across the backdrop belongs in
 * Playwright, alongside the pointer-drag tests that are there for the same
 * reason.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  destructive = false,
}: ConfirmDialogProps): ReactElement | null {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // The cancel button is the first `button` in DOM order, which is also what
    // makes the Tab-wrap arithmetic below correct. Queried through `dialogRef`
    // rather than held in its own ref because `Button` does not forward refs,
    // and widening its API for this is more than this task needs.
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button');
      if (focusable === undefined || focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      // Wrapping in both directions is what makes this a trap rather than a
      // suggestion: without it, Tab walks out into the page behind the modal.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/*
        The backdrop cancels on click. It carries no accessible role: the
        dialog below is `aria-modal`, so assistive tech already treats
        everything outside it as inert, and a second interactive element
        announcing itself would be noise.
      */}
      <div
        aria-hidden="true"
        onClick={onCancel}
        className="absolute inset-0 bg-text opacity-20 transition-opacity duration-[var(--bear-duration)] ease-bear"
      />

      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="relative z-10 mx-4 flex w-full max-w-sm flex-col gap-4 rounded-lg bg-bg p-5 shadow-dialog"
      >
        <h2 id={titleId} className="text-ui-lg font-semibold text-text">
          {title}
        </h2>
        <p id={bodyId} className="text-ui text-muted">
          {body}
        </p>

        {/*
          Cancel comes FIRST in DOM order, deliberately. It is what the mount
          effect focuses, and what the Tab-wrap arithmetic treats as `first`.
          Reordering these two swaps which button an in-flight Enter press
          activates, on a dialog guarding irreversible deletion.
        */}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>{cancelLabel}</Button>
          <Button onClick={onConfirm} variant={destructive ? 'danger' : 'primary'}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

Note the visual order this produces — Cancel on the left, the destructive action on the right — matches the DOM order, so no `flex-row-reverse` or `order-*` trickery is needed. **Do not reorder them for visual reasons**; if the design ever wants the destructive action on the left, move it in the DOM and update the focus query, never with CSS alone. CSS reordering leaves the focus and tab arithmetic pointing at the wrong button.

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/ui/ui.test.tsx; echo "exit=$?"
```

- [ ] **Step 5: Falsify**

1. Focus the confirm button on open instead of cancel. Re-run. The focus test **must** redden. Restore.
2. Remove the `shiftKey` branch from the Tab handler. Re-run. The `wraps backwards` test **must** redden. Restore.
3. Remove the `if (!open) return;` guard from the keydown effect and render with `open={false}`. Re-run. The `does not cancel on Escape when closed` test **must** redden. Restore.
4. Remove `aria-modal`. Re-run. A test **must** redden. Restore.

- [ ] **Step 6: Confirm the boundary and the outline allowlist still hold**

```bash
npx vitest run scripts/sourceLint.test.ts
```

Expected green. If it reddens on `outline-none`, you added a third suppressor — remove it; the global `:focus-visible` ring covers this dialog.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/ui/
git commit -m "feat(ui): ConfirmDialog, focused on cancel

window.confirm was rejected: it ignores the theme and some embedded
contexts suppress it silently, which turns a guarded delete into an
unguarded one."
```

---

### Task 10: Delete Forever and Empty Trash

**Files:**

- Modify: `src/features/notes/NoteList.tsx`
- Modify: `src/features/notes/NoteList.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `ConfirmDialog` from Task 9; `notes.purge` and `notes.emptyTrash`, both transactional and tested since M1.
- Produces: `NoteListProps` gains `onPurge: (id: string) => void` and `onEmptyTrash: () => void`.

- [ ] **Step 1: Add the translations**

`src/i18n/en.ts`:

```ts
  'noteList.deleteForever': 'Delete forever',
  'noteList.emptyTrash': 'Empty trash',

  'confirm.cancel': 'Cancel',
  'confirm.deleteForever.title': 'Delete this note forever?',
  'confirm.deleteForever.body':
    'This note will be removed permanently. bear-web keeps no copy anywhere else, so this cannot be undone.',
  'confirm.emptyTrash.title': 'Empty the trash?',
  'confirm.emptyTrash.body':
    'Every note in the trash will be removed permanently. bear-web keeps no copy anywhere else, so this cannot be undone.',
```

`src/i18n/ko.ts`:

```ts
  'noteList.deleteForever': '완전히 삭제',
  'noteList.emptyTrash': '휴지통 비우기',

  'confirm.cancel': '취소',
  'confirm.deleteForever.title': '이 메모를 완전히 삭제할까요?',
  'confirm.deleteForever.body':
    '이 메모는 영구적으로 삭제됩니다. bear-web은 다른 어디에도 사본을 두지 않으므로 되돌릴 수 없습니다.',
  'confirm.emptyTrash.title': '휴지통을 비울까요?',
  'confirm.emptyTrash.body':
    '휴지통의 모든 메모가 영구적으로 삭제됩니다. bear-web은 다른 어디에도 사본을 두지 않으므로 되돌릴 수 없습니다.',
```

- [ ] **Step 2: Write the failing tests**

Append to `src/app/AppShell.test.tsx`:

```tsx
it('purges a single note only after confirmation', async () => {
  await renderShell();
  await createNoteWithText('doomed');

  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));
  await userEvent.click(await screen.findByText('doomed'));

  await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));

  // Still there — the dialog is open and nothing has happened yet.
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(screen.getByText('doomed')).toBeInTheDocument();

  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete forever' }),
  );

  await waitFor(() => expect(screen.queryByText('doomed')).not.toBeInTheDocument());
});

it('leaves the note alone when the confirmation is cancelled', async () => {
  await renderShell();
  await createNoteWithText('spared');

  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));
  await userEvent.click(await screen.findByText('spared'));

  await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
  );

  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByText('spared')).toBeInTheDocument();
});

it('disables Empty trash when the trash is empty', async () => {
  await renderShell();

  await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));

  expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled();
});

it('empties the trash after confirmation', async () => {
  await renderShell();
  await createNoteWithText('one');

  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));

  const emptyTrash = await screen.findByRole('button', { name: 'Empty trash' });
  await waitFor(() => expect(emptyTrash).toBeEnabled());
  await userEvent.click(emptyTrash);

  await userEvent.click(
    within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Empty trash' }),
  );

  await waitFor(() => expect(screen.queryByText('one')).not.toBeInTheDocument());
});

it('offers neither destructive trash action outside the trash', async () => {
  await renderShell();
  await createNoteWithText('safe');

  expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Empty trash' })).not.toBeInTheDocument();
});
```

Adapt `renderShell` and `createNoteWithText` to the file's existing helpers; add `within` to the `@testing-library/react` import if absent.

- [ ] **Step 3: Extend `NoteList`**

Add to `NoteListProps`:

```ts
  onPurge: (id: string) => void;
  onEmptyTrash: () => void;
```

and render inside the toolbar, after the Restore button:

```tsx
        {selectedNoteId !== null && isTrash(scope) && (
          <Button variant="danger" onClick={() => onPurge(selectedNoteId)}>
            {t('noteList.deleteForever')}
          </Button>
        )}
        {isTrash(scope) && (
          <Button
            variant="danger"
            disabled={items === undefined || items.length === 0}
            onClick={onEmptyTrash}
          >
            {t('noteList.emptyTrash')}
          </Button>
        )}
```

`items === undefined` disables it while loading too: enabling a destructive action before knowing whether there is anything to destroy is the wrong default.

- [ ] **Step 4: Wire `AppShell`**

Add the confirmation state and handlers:

```tsx
  // Which destructive action is awaiting confirmation, if any. A single piece
  // of state rather than two booleans: the two dialogs are mutually exclusive
  // and two flags could both be true.
  const [pending, setPending] = useState<{ kind: 'purge'; id: string } | { kind: 'empty' } | null>(
    null,
  );

  const confirmPending = useCallback(async () => {
    if (pending === null) return;
    setPending(null);
    if (pending.kind === 'purge') await notes.purge(pending.id);
    else await notes.emptyTrash();
  }, [pending]);
```

Pass `onPurge={(id) => setPending({ kind: 'purge', id })}` and `onEmptyTrash={() => setPending({ kind: 'empty' })}` to `NoteList`, and render the dialog as the last child of `<main>`:

```tsx
      <ConfirmDialog
        open={pending !== null}
        destructive
        title={
          pending?.kind === 'empty'
            ? t('confirm.emptyTrash.title')
            : t('confirm.deleteForever.title')
        }
        body={
          pending?.kind === 'empty' ? t('confirm.emptyTrash.body') : t('confirm.deleteForever.body')
        }
        confirmLabel={
          pending?.kind === 'empty' ? t('noteList.emptyTrash') : t('noteList.deleteForever')
        }
        cancelLabel={t('confirm.cancel')}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
```

- [ ] **Step 5: Run and confirm the tests pass**

```bash
npx vitest run src/app/ src/features/notes/; echo "exit=$?"
```

- [ ] **Step 6: Falsify**

1. Make `onPurge` call `notes.purge` directly instead of opening the dialog. Re-run. The `leaves the note alone when cancelled` test **must** redden. Restore.
2. Remove the `disabled` prop from Empty trash. Re-run. The disabled test **must** redden. Restore.
3. Change both `isTrash(scope)` gates to `true`. Re-run. The `offers neither destructive trash action outside the trash` test **must** redden. Restore.
4. Make `confirmPending` not clear `pending` before awaiting. Re-run and observe: does any test catch a double-confirm? If none does, add one that clicks confirm twice rapidly and asserts `purge` ran once. Report which happened.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/app/ src/features/notes/ src/i18n/
git commit -m "feat(trash): Delete Forever and Empty Trash behind a confirmation"
```

---

### Task 11: The startup sweep

**Files:**

- Create: `src/data/sweep.ts`
- Create: `src/data/sweep.test.ts`
- Modify: `src/data/index.ts`
- Modify: `src/main.tsx`

**Interfaces:**

- Consumes: `db`.
- Produces:

```ts
export interface SweepDeps {
  listCandidates: () => Promise<Note[]>;
  purge: (id: string) => Promise<void>;
  onError?: (error: unknown) => void;
}
export function sweepBlankNotes(deps: SweepDeps): Promise<number>;
export function runStartupSweep(): Promise<number>;
```

**The three gates are the entire safety argument.** A note is purged only if `text` is empty **and** `trashedAt === null` **and** `createdAt === updatedAt`. The third is not redundant: the sweep runs before any editor has mounted, over notes it has never read — the same shape as the M4 defect where a truncation reached `notes.purge`. `save` always writes a fresh `updatedAt`, so `createdAt === updatedAt` means the note has never been saved even once. A note the user has typed into is therefore unreachable even if the emptiness check is wrong. Two independent conditions must both fail to lose data.

**Never rejects**, including when a caller-supplied `onError` itself throws — the same contract as `runMigrations` and `persistStorage`. Read `src/data/persist.ts` and match its shape.

- [ ] **Step 1: Write the failing tests**

Create `src/data/sweep.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import type { Note } from './types';
import { sweepBlankNotes } from './sweep';

const note = (overrides: Partial<Note>): Note => ({
  id: 'n',
  title: '',
  text: '',
  createdAt: 100,
  updatedAt: 100,
  pinned: false,
  trashedAt: null,
  archivedAt: null,
  ...overrides,
});

function deps(candidates: Note[], overrides: Partial<Parameters<typeof sweepBlankNotes>[0]> = {}) {
  return {
    listCandidates: vi.fn(async () => candidates),
    purge: vi.fn(async () => {}),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('sweepBlankNotes', () => {
  it('purges a blank, never-saved, untrashed note', async () => {
    const d = deps([note({ id: 'blank' })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(1);
    expect(d.purge).toHaveBeenCalledWith('blank');
  });

  it('spares a note with text', async () => {
    const d = deps([note({ id: 'kept', text: 'hello' })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('spares a blank note the user has saved at least once', async () => {
    // The gate that makes this safe: `save` always writes a fresh updatedAt,
    // so this note has been through the editor. Even if the emptiness check
    // were wrong, this note is unreachable.
    const d = deps([note({ id: 'edited', createdAt: 100, updatedAt: 200 })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('spares a blank note in the trash', async () => {
    // It is in the user's trash; removing it silently would be a deletion
    // they never asked for and cannot see happen.
    const d = deps([note({ id: 'trashed', trashedAt: 500 })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.purge).not.toHaveBeenCalled();
  });

  it('purges several and reports the count', async () => {
    const d = deps([note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c', text: 'x' })]);
    await expect(sweepBlankNotes(d)).resolves.toBe(2);
  });

  it('never rejects when listing throws', async () => {
    const boom = new Error('nope');
    const d = deps([], {
      listCandidates: vi.fn(async () => {
        throw boom;
      }),
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
    expect(d.onError).toHaveBeenCalledWith(boom);
  });

  it('never rejects when a purge throws', async () => {
    const d = deps([note({ id: 'a' })], {
      purge: vi.fn(async () => {
        throw new Error('locked');
      }),
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
  });

  it('never rejects when onError itself throws', async () => {
    const d = deps([], {
      listCandidates: vi.fn(async () => {
        throw new Error('nope');
      }),
      onError: vi.fn(() => {
        throw new Error('logger exploded');
      }),
    });
    await expect(sweepBlankNotes(d)).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/data/sweep.test.ts
```

- [ ] **Step 3: Create `src/data/sweep.ts`**

```ts
import { db } from './db';
import type { Note } from './types';

export interface SweepDeps {
  listCandidates: () => Promise<Note[]>;
  purge: (id: string) => Promise<void>;
  onError?: (error: unknown) => void;
}

/**
 * Reclaims notes left blank across a reload.
 *
 * `NoteEditor` discards a blank note when it unmounts, but `beforeunload` only
 * flushes — it never unmounts — so a blank note open when the tab closes
 * survives as a permanent `Untitled` row.
 *
 * **All three gates are load-bearing, and the third is the safety argument.**
 * This runs before any editor has mounted, over notes it has never read: the
 * same shape as the M4 defect where a truncated document reached
 * `notes.purge`. `save` always writes a fresh `updatedAt`, so
 * `createdAt === updatedAt` means the note has never been saved even once. A
 * note the user has typed into is unreachable here even if the emptiness check
 * is wrong — two independent conditions must both fail to lose data.
 *
 * Never rejects, including when `onError` itself throws. A failed sweep costs a
 * stray row and retries next launch.
 */
export async function sweepBlankNotes(deps: SweepDeps): Promise<number> {
  try {
    const candidates = await deps.listCandidates();

    let purged = 0;
    for (const note of candidates) {
      if (note.text !== '') continue;
      if (note.trashedAt !== null) continue;
      if (note.createdAt !== note.updatedAt) continue;

      await deps.purge(note.id);
      purged += 1;
    }
    return purged;
  } catch (error) {
    try {
      deps.onError?.(error);
    } catch {
      // Nothing useful left to do: the reporter is the thing that broke.
    }
    return 0;
  }
}

export function runStartupSweep(): Promise<number> {
  return sweepBlankNotes({
    listCandidates: () => db.notes.toArray(),
    purge: async (id) => {
      await db.notes.delete(id);
    },
    onError: (error) => {
      console.error('bear-web: blank-note sweep failed', error);
    },
  });
}
```

**Note `purge` here deletes only the note row**, not via `notes.purge`. A note satisfying all three gates has empty text, so it can carry no tag rows and no files — and going through the repository would pull `src/data/sweep.ts` into a dependency on the repositories barrel for no benefit. **If you disagree, say so in your report rather than changing it**; this is a deliberate call.

- [ ] **Step 4: Export and wire**

In `src/data/index.ts`, add:

```ts
export { runStartupSweep, sweepBlankNotes } from './sweep';
export type { SweepDeps } from './sweep';
```

In `src/main.tsx`, run the sweep **after** the migration resolves, not concurrently — both write inside transactions over `notes` and `noteTags`, and sequencing removes the question of what a rebuild sees mid-purge:

```tsx
  // Sequenced after the rebuild rather than run alongside it: both write inside
  // transactions touching `notes`, and ordering them removes the question of
  // what a rebuild sees mid-purge. Still unawaited as a pair, so neither
  // blocks first paint.
  void runStartupMigrations().then(() => runStartupSweep());
```

Keep `void persistStorage();` and the `createRoot(...)` call exactly as they are.

- [ ] **Step 5: Run and confirm the tests pass**

```bash
npx vitest run src/data/; echo "exit=$?"
```

- [ ] **Step 6: Falsify each gate separately**

1. Remove the `createdAt !== updatedAt` gate. Re-run. The `spares a blank note the user has saved` test **must** redden. Restore.
2. Remove the `trashedAt !== null` gate. Re-run. The trash test **must** redden. Restore.
3. Remove the `text !== ''` gate. Re-run. The `spares a note with text` test **must** redden. Restore.
4. Remove the inner try/catch around `onError`. Re-run. The `onError itself throws` test **must** redden. Restore.

All four must be independently falsifiable. If removing one gate reddens nothing, that gate is untested — report it.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/data/ src/main.tsx
git commit -m "feat(data): sweep never-saved blank notes at startup

Three gates, each independently falsified. createdAt === updatedAt is
the one that matters: it makes a note the user has typed into
unreachable even if the emptiness check is wrong."
```

---

### Task 12: Delete always trashes

**Files:**

- Modify: `src/features/notes/NoteEditor.tsx` (`discard`)
- Modify: `src/features/notes/NoteEditor.test.tsx`

**Interfaces:** no signature changes.

**The behaviour today, and why it is emergent rather than written down.** Pressing Delete on a blank note calls `notes.trash(id)`; `useNotes` then deselects it, `NoteEditor` unmounts, `useAutosave`'s unmount flush sees empty text and calls `discard()`, and `discard` purges. So one button is recoverable or not depending on state the user cannot see — the M5 deferral this task closes, ruled: **Delete always trashes.**

**The fix is one condition in `discard`, not a change to the Delete button.** The unmount discard must keep reclaiming a blank note the user navigates away from; only the already-trashed case changes.

- [ ] **Step 1: Write the failing test**

Append to `src/features/notes/NoteEditor.test.tsx`, inside the describe that owns the discard behaviour:

```tsx
it('does not purge a blank note that has been trashed', async () => {
  // Delete must mean the same thing everywhere. Before M6 the unmount discard
  // purged a blank note the instant it was trashed, so the same button was
  // recoverable or not depending on invisible state.
  const note = await notes.create('');
  await notes.trash(note.id);

  const { unmount } = renderEditor({ note: (await notes.get(note.id))! });
  unmount();

  await waitFor(async () => expect(await notes.get(note.id)).toBeDefined());
  expect((await notes.get(note.id))!.trashedAt).not.toBeNull();
});

it('still purges a blank note that was never trashed', async () => {
  // The reclaim path must survive: navigating away from an untouched blank
  // note still discards it.
  const note = await notes.create('');

  const { unmount } = renderEditor({ note });
  unmount();

  await waitFor(async () => expect(await notes.get(note.id)).toBeUndefined());
});
```

Adapt `renderEditor` to the file's existing helper. This file has jsdom stubs in its header — read them before adding tests.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/features/notes/NoteEditor.test.tsx; echo "exit=$?"
```

Expected: the first test fails (the note is purged); the second passes already. **Check the exit code** — this file can print green and exit 1.

- [ ] **Step 3: Implement**

In `src/features/notes/NoteEditor.tsx`, extend `discard`:

```tsx
  const discard = useCallback(async () => {
    if (hadTextAtMountRef.current && !editedRef.current) return;

    // A trashed note lives in the user's Trash and stays there. Without this,
    // the Delete button purged a blank note outright while trashing every
    // other note — one button, two irreversibilities, decided by state the
    // user cannot see. M6 ruled that Delete always trashes; this is that
    // ruling. The reclaim path for a blank note the user simply navigates
    // away from is untouched.
    const current = await notes.get(note.id);
    if (current === undefined || current.trashedAt !== null) return;

    await notes.purge(note.id);
  }, [note.id]);
```

`current === undefined` also makes a double-discard a no-op rather than a throw.

- [ ] **Step 4: Run and confirm the tests pass**

```bash
npx vitest run src/features/notes/; echo "exit=$?"
```

- [ ] **Step 5: Falsify**

1. Remove the `current.trashedAt !== null` check. Re-run. The first test **must** redden. Restore.
2. Remove the whole added block. Re-run. The first test **must** redden and the second **must** still pass. Restore.

- [ ] **Step 6: Check the seeded-note interaction**

M5 seeds a note created in a tag scope with `\n#tag` and relies on `isEmpty` treating that as disposable. Confirm the seeded-note purge still works:

```bash
npx vitest run src/features/notes/NoteEditor.test.tsx src/app/AppShell.test.tsx; echo "exit=$?"
```

A seeded note is not trashed, so the new check does not block it. **If a seeded-note test reddens, stop and report** — that path guards against exactly the tag-only deletion the M5 spec rejected.

- [ ] **Step 7: Run all six gates, then commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/
git commit -m "fix(notes): Delete always trashes, blank or not

The blank-note purge was emergent: trash, then unmount, then discard.
One button meant two different irreversibilities depending on state the
user could not see."
```

---

### Task 13: End-to-end coverage, and record the rulings

**Files:**

- Modify: `e2e/notes.spec.ts` (**not** `smoke.spec.ts` — that file holds shell, theme and resizer tests; every note flow lives in `notes.spec.ts`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add three Playwright flows**

Append to `e2e/notes.spec.ts`. These use the idioms already in that file: `getByRole('textbox', { name: 'Note text' })` for the editor, `getByRole('region', { name: 'Note list' })` to scope list assertions, and `keyboard.type` rather than `fill` wherever a Tiptap input rule must fire.

```ts
test('a note with an unchecked task appears in Todo, and leaves when checked', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  // Typed, not filled: `- [ ] ` is a Tiptap input rule and `fill` bypasses
  // input rules entirely, so the note would hold literal text and no task at
  // all — the predicate would still match, and the test would pass without
  // ever exercising a real checkbox.
  await page.keyboard.type('- [ ] milk');
  await editor.blur();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  const noteList = page.getByRole('region', { name: 'Note list' });

  await lists.getByRole('button', { name: /^Todo\b/ }).click();
  await expect(noteList.getByText('milk')).toBeVisible();

  // Checking it off removes it from Todo. This is the half a predicate test
  // cannot reach: it needs the real editor writing real Markdown.
  await noteList.getByText('milk').click();
  await page.getByRole('textbox', { name: 'Note text' }).getByRole('checkbox').check();
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  await expect(noteList.getByText('milk')).toHaveCount(0);
});

test('pinning floats a note to the top of the list', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('First note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  await page.getByRole('button', { name: 'New note' }).click();
  await page.getByRole('textbox', { name: 'Note text' }).fill('Second note');
  await page.getByRole('textbox', { name: 'Note text' }).blur();

  const noteList = page.getByRole('region', { name: 'Note list' });
  const rows = noteList.getByRole('listitem');

  // Newest first, so the second note leads.
  await expect(rows.first()).toContainText('Second note');

  await rows.filter({ hasText: 'First note' }).getByRole('button', { name: 'Pin note' }).click();

  await expect(rows.first()).toContainText('First note');
});

test('deleting a note forever removes it permanently across a reload', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.fill('Doomed note');
  await editor.blur();

  await page.getByRole('button', { name: 'Delete' }).click();

  const lists = page.getByRole('navigation', { name: 'Lists' });
  const noteList = page.getByRole('region', { name: 'Note list' });

  await lists.getByRole('button', { name: /^Trash\b/ }).click();
  await noteList.getByRole('button', { name: /Doomed/ }).click();

  // Only the toolbar button exists at this point, so the unscoped query is
  // unambiguous; once the dialog opens there are two, hence the scoping below.
  await page.getByRole('button', { name: 'Delete forever' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete forever' }).click();

  // The reload is the whole point: it proves the purge reached IndexedDB
  // rather than only the React tree. M2 shipped a persistence test that
  // compared a value read out of the page against itself and passed with
  // persistence completely broken.
  await page.reload();
  await expect(page.getByRole('region')).toHaveCount(3);
  await lists.getByRole('button', { name: /^Trash\b/ }).click();
  await expect(page.getByText('Trash is empty')).toBeVisible();
});
```

**If the checkbox interaction in the first test does not work**, Tiptap's task item may not expose a `checkbox` role in the way assumed. Report what it does expose rather than deleting the assertion — the "leaves when checked" half is the part no unit test can cover.

- [ ] **Step 2: Run e2e**

```bash
npm run test:e2e; echo "exit=$?"
```

Expected: **21 passing** (18 baseline + 3). If any new test is flaky, report it rather than adding a retry.

- [ ] **Step 3: Update `CLAUDE.md`**

Set M6 complete in the status table with the real counts from `npm test` and `npm run test:e2e`. Add these rules, in the file's existing voice, each stating the failure it prevents:

- **`NoteScope` has two arms permanently, and every behavioural question is a named capability function.** Adding a smart list is a row in `SMART_LIST_IDS`, never a union arm and never a `scope.kind` comparison at a call site. `scope.test.ts` asserts capabilities exhaustively over `SmartListId`, so a new list without a ruling fails the suite. This is the defence against the M5 defect where a widened union silently removed the delete affordance from tag scopes.
- **The Todo predicate's test fixture is derived from `MarkdownManager`, never hand-written.** The parent spec writes it as "contains an unchecked `- [ ]`", which is an assumption about our own output. Our serializer emits `- [ ]` and normalizes `* [ ]` to it, but that is a fact about the serializer, not a licence to hardcode it.
- **`UNCHECKED_TASK` must not carry the `g` flag.** A global regex keeps `lastIndex` between `.test()` calls, so a module-level constant reused per note alternates true and false on identical input and drops roughly half the matching notes.
- **`UNCHECKED_TASK` matches `-`, `*` and `+` bullets** because `importDatabase` accepts arbitrary Markdown and a note is only canonical once it has been through the editor. A checkbox the user can see must not be invisible until they open the note.
- **A task inside a fenced code block counts as a todo.** Accepted: masking code spans lives in `parseTags` in the data layer, and duplicating it for one smart list is not worth a second copy.
- **Only `untagged` reads the tag index in `listForScope`.** `allTagRows` is a full table scan; paying for it on every scope switch would double the work for six of the seven builtins.
- **All seven sidebar counts come from one live query.** Seven independent queries would let rows land in seven different frames — the mechanism behind M5's collapsed-tag flash — and would let untagged plus tagged disagree with all. Its deps are constant `[]`, so the tag-and-verify pattern deliberately does not apply.
- **`useSmartListCounts` returns `undefined` while loading, never a zero-filled object.** Zeros render as "empty" rather than "not known yet".
- **Pinned notes sort first in every list except Trash.** Trash is ordered by deletion time; a pinned note deleted earlier is not more important than one deleted later. `pinned` stays unindexed — IndexedDB rejects boolean keys.
- **The pin button is a sibling of the row button, never nested.** A `<button>` inside a `<button>` is invalid HTML and unclickable in some browsers.
- **`ConfirmDialog` focuses Cancel on open.** These guard irreversible deletion with no server copy, and an Enter keypress already in flight must not destroy anything. `window.confirm` was rejected: it ignores the theme, and some embedded contexts suppress it silently, turning a guarded delete into an unguarded one.
- **The startup sweep's three gates are all load-bearing, and `createdAt === updatedAt` is the safety argument.** It runs before any editor mounts, over notes it has never read — the M4 shape where a truncation reached `notes.purge`. `save` always writes a fresh `updatedAt`, so that gate makes a note the user has typed into unreachable even if the emptiness check is wrong. Like `runMigrations` and `persistStorage`, it never rejects, including when `onError` throws.
- **The sweep runs after the tag-index rebuild resolves, not concurrently.** Both write inside transactions over `notes`; sequencing removes the question of what a rebuild sees mid-purge.
- **Delete always trashes, blank or not.** The blank-note purge was emergent — trash, unmount, discard — so one button meant two irreversibilities depending on invisible state. `NoteEditor`'s `discard` now refuses to purge an already-trashed note. The reclaim path for a blank note the user navigates away from is unchanged.
- **Today does not roll over at midnight.** A note edited at 23:59 stays in Today until something else re-runs the query. A timer whose only job is to move one row is not worth a live subscription.

Move the M5-deferred items this milestone closed out of "Carried into M5b and M6", and leave the ones it did not — `NoteListItem`'s run-on accessible name is now M6's own carried item and should be updated to say so.

- [ ] **Step 4: Run every gate one final time**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
```

Record the final unit and e2e counts.

- [ ] **Step 5: Commit**

```bash
npm run format
git add CLAUDE.md e2e/
git commit -m "docs: record the M6 rulings"
```

**Do not merge.** A whole-branch review runs after this task.

---

## Verification checklist for the whole-branch review

- [ ] Every smart list returns what its name promises, checked against real data in a browser — not only against the fake repository.
- [ ] Creating a note in each of the seven lists either keeps it visible or bounces to Notes; none produces an invisible note.
- [ ] Pinning a note floats it to the top of All Notes **and** of a tag scope, and does not reorder Trash.
- [ ] Delete Forever and Empty Trash both survive a reload — the purge reached IndexedDB, not just the React tree.
- [ ] The confirmation dialog is keyboard-operable: Escape cancels, Tab cycles, focus starts on Cancel.
- [ ] A blank note left open across a reload is gone on next launch; a note with text is not.
- [ ] Deleting a blank note puts it in Trash and it can be restored.
- [ ] Locked shows its Phase 2 copy and no destructive controls.
- [ ] `ScopeSidebar.tsx` and its test no longer exist anywhere in the tree.
