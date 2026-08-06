# M1 Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete IndexedDB persistence layer for bear-web — schema, repositories, derived-data rules, and full database export and import — with no user interface at all.

**Architecture:** A single Dexie database wrapped by four small repositories, each owning one table group and exposing a narrow interface. Repositories are created by factory functions that take their dependencies as arguments, so tests inject a fresh in-memory database, a fixed clock, and a fake tag parser rather than reaching for module-level singletons. One composition module wires the real dependencies together and is the only thing the rest of the application imports.

**Tech Stack:** Dexie 4, `fake-indexeddb` for tests, Vitest 4, TypeScript 6.

**Spec:** `docs/superpowers/specs/2026-08-06-bear-web-design.md`
**Preceding milestone:** `docs/superpowers/plans/2026-08-06-m0-scaffold.md` (complete through Task 6)

## Global Constraints

- Node 22 LTS.
- No backend and no runtime network calls. Everything in this milestone is local to the browser.
- **No user interface.** This milestone adds no React components, no hooks, no styling. If a task tempts you to render something, the task is wrong.
- `notes.text` holds Markdown and is the canonical content. Everything else about a note is either metadata or derived from that text.
- `notes.title` and the `noteTags` table are **derived**. Recomputing them from `notes.text` must always produce the same result, and dropping `noteTags` entirely and rebuilding it must always be safe.
- Every note carries a UUID and `updatedAt`, even though there is no server.
- `notes.archivedAt` is reserved for Phase 2. It exists in the schema, and it stays `null` throughout Phase 1.
- Timestamps are stored as epoch milliseconds (`number`), never as `Date` objects or ISO strings. IndexedDB indexes numbers cleanly and JSON round-trips them without ambiguity.
- `erasableSyntaxOnly: true` is set in `tsconfig.app.json`. **`enum`, parameter properties, and namespaces will not compile.** Use string-literal unions and `as const` objects instead.
- `verbatimModuleSyntax: true` is set. Type-only imports must use `import type`.
- `strict: true` is declared explicitly in every tsconfig.
- No `any`. Where a type is genuinely unknown — setting values, imported JSON — use `unknown` and narrow it.
- Every new file must be typechecked by `npm run typecheck` and pass `npm run lint` and `npm run format:check`.

---

## Interfaces Produced by This Milestone

Later milestones consume exactly this surface, exported from `src/data/index.ts`. Task 6 assembles it; earlier tasks build the pieces.

```ts
export type { Note, NoteTag, TagMeta, FileRecord, SettingRecord, BackupBundle } from './types';
export { db } from './db';
export { deriveTitle } from './derive';
export { newId } from './ids';
export { notes, tags, files, settings } from './repositories';
export { exportDatabase, importDatabase } from './backup';
```

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/data/types.ts` | Every persisted record shape and the backup bundle shape. Types only, no logic. |
| `src/data/ids.ts` | UUID generation, isolated so tests can stub it |
| `src/data/derive.ts` | `deriveTitle` — pure, no database access |
| `src/data/db.ts` | The Dexie subclass, schema version 1, and the migration pattern |
| `src/data/testing.ts` | `createTestDatabase()` — a fresh isolated database per test |
| `src/data/repositories/notes.ts` | Note lifecycle, plus maintenance of the derived `noteTags` index |
| `src/data/repositories/tags.ts` | Tag *metadata* only: collapsed, icon, sort order |
| `src/data/repositories/files.ts` | Image and attachment blobs |
| `src/data/repositories/settings.ts` | Key-value application settings |
| `src/data/repositories/index.ts` | Composition — wires real dependencies into the four repositories |
| `src/data/backup.ts` | `exportDatabase` and `importDatabase`, including blob serialization |
| `src/data/index.ts` | The public surface listed above |
| `vitest.setup.ts` | Extended to register `fake-indexeddb` |

Each repository file stays focused on one table group. If one grows past roughly 200 lines, that is a signal it has absorbed something belonging elsewhere.

---

## Two Design Decisions You Must Not Silently Reverse

These are load-bearing, and both look like arbitrary style choices until they break something.

### 1. IndexedDB cannot index booleans or nulls

IndexedDB rejects `true`/`false` as key values, and it **omits records entirely** from an index when the indexed property is `null` or `undefined`. This has two consequences that shape the schema:

- **`pinned` is not indexed.** It stays a real `boolean` in the domain type, and pinned queries filter in memory. At Phase 1 scale — thousands of notes, not millions — a filter over an `updatedAt`-ordered iteration is not a bottleneck, and it keeps the domain type honest.
- **`trashedAt` is indexed, and the index deliberately contains only trashed notes.** That is exactly what an index on a nullable column does here, and it happens to be what the Trash query wants. Queries for *non*-trashed notes must not attempt to use this index; they iterate `updatedAt` and filter `trashedAt === null`.

If a later change adds `.where('pinned').equals(true)`, it will throw at runtime, not compile time. That is why this is written down.

### 2. The tag parser is injected, not implemented here

`noteTags` is rebuilt from note text on every save, which requires parsing tags out of Markdown. But `parseTags` is M5's deliverable and the spec makes test-driven development mandatory for it — it is one of the two functions where getting it wrong corrupts user data.

So M1 defines the seam and not the implementation:

```ts
export type TagParser = (markdown: string) => string[];
```

`createNotesRepository` takes a `TagParser`. M1's composition module wires in a documented stub that returns `[]`. Tests inject fakes that return whatever the test needs, so the index-maintenance logic is fully exercised without a real parser existing. M5 replaces one line in the composition module.

Do not write a "temporary simple" regex parser. A placeholder that appears to work is how the untested version becomes permanent.

---

## Task 1: Test infrastructure, types, and schema

**Files:**
- Create: `src/data/types.ts`, `src/data/db.ts`, `src/data/testing.ts`, `src/data/db.test.ts`
- Modify: `vitest.setup.ts`, `package.json`

**Interfaces:**
- Consumes: nothing from this milestone.
- Produces: the `Note`, `NoteTag`, `TagMeta`, `FileRecord`, `SettingRecord` types; a `BearDatabase` class with typed tables `notes`, `noteTags`, `tags`, `files`, `settings`; the singleton `db`; and `createTestDatabase(): BearDatabase` for tests.

- [ ] **Step 1: Install Dexie and the IndexedDB test shim**

```bash
npm install dexie
npm install -D fake-indexeddb
```

- [ ] **Step 2: Register `fake-indexeddb` in the test setup**

jsdom provides no IndexedDB. Without this, every test in this milestone fails at import time with `indexedDB is not defined`.

Replace `vitest.setup.ts` entirely:

```ts
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

The `fake-indexeddb/auto` import must come first. It installs the globals that Dexie looks for at module load, and Dexie captures them when it is imported.

- [ ] **Step 3: Define the record types**

Create `src/data/types.ts`:

```ts
export interface Note {
  /** Stable UUID. Exists so sync can be added later without a data migration. */
  id: string;
  /** Derived cache of the first non-empty line of `text`. Never edited directly. */
  title: string;
  /** Markdown. The canonical content of the note. */
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Not indexed — IndexedDB rejects boolean keys. Filter in memory. */
  pinned: boolean;
  /** Indexed. The index contains only trashed notes, because IndexedDB omits nulls. */
  trashedAt: number | null;
  /** Reserved for Phase 2. Stays null throughout Phase 1. */
  archivedAt: number | null;
}

export interface NoteTag {
  noteId: string;
  tag: string;
}

export interface TagMeta {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
}

export interface FileRecord {
  id: string;
  noteId: string;
  blob: Blob;
  mime: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}
```

- [ ] **Step 4: Write the failing schema test**

Create `src/data/db.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { createTestDatabase } from './testing';

describe('BearDatabase', () => {
  it('opens at schema version 1', async () => {
    const db = createTestDatabase();
    await db.open();

    expect(db.verno).toBe(1);

    db.close();
  });

  it('declares all five tables', async () => {
    const db = createTestDatabase();
    await db.open();

    expect(db.tables.map((t) => t.name).sort()).toEqual([
      'files',
      'noteTags',
      'notes',
      'settings',
      'tags',
    ]);

    db.close();
  });

  it('gives each test database an isolated store', async () => {
    const first = createTestDatabase();
    const second = createTestDatabase();
    await first.open();
    await second.open();

    await first.settings.put({ key: 'theme', value: 'dark' });

    expect(await second.settings.get('theme')).toBeUndefined();

    first.close();
    second.close();
  });

  it('round-trips a note through the notes table', async () => {
    const db = createTestDatabase();
    await db.open();

    await db.notes.put({
      id: 'n1',
      title: 'Hello',
      text: '# Hello\n\nbody',
      createdAt: 1000,
      updatedAt: 1000,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    const found = await db.notes.get('n1');
    expect(found?.text).toBe('# Hello\n\nbody');

    db.close();
  });
});
```

- [ ] **Step 5: Run the test and verify it fails**

Run: `npx vitest run src/data/db.test.ts`
Expected: FAIL — cannot resolve `./testing`.

- [ ] **Step 6: Write the database**

Create `src/data/db.ts`:

```ts
import Dexie, { type EntityTable, type Table } from 'dexie';

import type { FileRecord, Note, NoteTag, SettingRecord, TagMeta } from './types';

export class BearDatabase extends Dexie {
  notes!: EntityTable<Note, 'id'>;
  /**
   * Compound primary key `[noteId+tag]`, so this is a plain `Table` keyed by a
   * tuple. `EntityTable<NoteTag, 'noteId'>` would be wrong: it declares a single
   * named key property and makes it optional on insert, and both halves of this
   * key are required.
   */
  noteTags!: Table<NoteTag, [string, string]>;
  tags!: EntityTable<TagMeta, 'tag'>;
  files!: EntityTable<FileRecord, 'id'>;
  settings!: EntityTable<SettingRecord, 'key'>;

  constructor(name: string) {
    super(name);

    // `pinned` is deliberately absent from every index: IndexedDB rejects
    // boolean keys. `trashedAt` is indexed knowing the index holds only
    // trashed notes, since IndexedDB omits records with null indexed values.
    this.version(1).stores({
      notes: 'id, updatedAt, createdAt, trashedAt',
      noteTags: '[noteId+tag], noteId, tag',
      tags: 'tag, sortOrder',
      files: 'id, noteId',
      settings: 'key',
    });
  }
}

export const DATABASE_NAME = 'bear-web';

export const db = new BearDatabase(DATABASE_NAME);
```

Adding a version 2 later follows this pattern, appended below version 1 and never editing it:

```ts
// this.version(2).stores({ notes: 'id, updatedAt, createdAt, trashedAt, someNewIndex' })
//   .upgrade((tx) => tx.table('notes').toCollection().modify((n) => { n.someNewField = 0; }));
```

- [ ] **Step 7: Write the test database factory**

Create `src/data/testing.ts`:

```ts
import { BearDatabase } from './db';

let counter = 0;

/**
 * A fresh, uniquely named database per call, so tests never share state.
 * Requires `fake-indexeddb/auto`, which `vitest.setup.ts` imports.
 */
export function createTestDatabase(): BearDatabase {
  counter += 1;
  return new BearDatabase(`bear-web-test-${counter}`);
}
```

- [ ] **Step 8: Run the tests and verify they pass**

Run: `npx vitest run src/data/db.test.ts`
Expected: PASS, 4 tests.

If it fails with `indexedDB is not defined`, the `fake-indexeddb/auto` import is not first in `vitest.setup.ts`, or the setup file is not registered in `vite.config.ts`.

- [ ] **Step 9: Verify the whole suite still passes**

```bash
npm test && npm run lint && npm run format:check && npm run typecheck && npm run build
```

Expected: all exit 0. The three M0 component tests still pass alongside the new ones.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(data): add Dexie schema, record types, and IndexedDB test harness"
```

---

## Task 2: Identifiers and title derivation

**Files:**
- Create: `src/data/ids.ts`, `src/data/derive.ts`, `src/data/derive.test.ts`
- Test: `src/data/derive.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `newId(): string` and `deriveTitle(text: string): string`.

This task is genuinely test-driven: write the tests, watch them fail, then implement.

- [ ] **Step 1: Write the failing title-derivation test**

`deriveTitle` is the rule that a note's title is the first non-empty line of its Markdown, stripped of heading syntax. Create `src/data/derive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { deriveTitle } from './derive';

describe('deriveTitle', () => {
  it('uses the first non-empty line', () => {
    expect(deriveTitle('My note\nsecond line')).toBe('My note');
  });

  it('strips leading heading hashes', () => {
    expect(deriveTitle('# Heading\n\nbody')).toBe('Heading');
    expect(deriveTitle('### Deep heading')).toBe('Deep heading');
  });

  it('skips leading blank lines and whitespace-only lines', () => {
    expect(deriveTitle('\n\n   \n# Real title')).toBe('Real title');
  });

  it('trims surrounding whitespace', () => {
    expect(deriveTitle('   Padded title   \nbody')).toBe('Padded title');
  });

  it('returns an empty string for empty or whitespace-only text', () => {
    expect(deriveTitle('')).toBe('');
    expect(deriveTitle('   \n\n  ')).toBe('');
  });

  it('does not treat a hash without a following space as a heading', () => {
    expect(deriveTitle('#tag is not a heading')).toBe('#tag is not a heading');
  });

  it('leaves inline markup alone', () => {
    expect(deriveTitle('**bold** title')).toBe('**bold** title');
  });

  it('is idempotent when applied to its own output', () => {
    const once = deriveTitle('# Heading\nbody');
    expect(deriveTitle(once)).toBe(once);
  });
});
```

The `#tag` case matters: bear-web's tags start with `#`, and a note whose first line is a tag must not have that tag mistaken for a heading and stripped.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/data/derive.test.ts`
Expected: FAIL — cannot resolve `./derive`.

- [ ] **Step 3: Implement `deriveTitle`**

Create `src/data/derive.ts`:

```ts
/**
 * A note's title is the first non-empty line of its Markdown, with ATX heading
 * syntax removed. This is a derived cache — see `Note.title`. Applying it to its
 * own output must always return that output unchanged.
 */
export function deriveTitle(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;

    // Only `#` followed by a space is a heading. `#tag` is a tag, not a heading.
    return trimmed.replace(/^#{1,6}\s+/, '').trim();
  }

  return '';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/derive.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the identifier module**

Create `src/data/ids.ts`:

```ts
/**
 * Isolated behind a function so tests can stub identifier generation and so a
 * fallback can be swapped in if a target browser lacks `crypto.randomUUID`.
 */
export function newId(): string {
  return crypto.randomUUID();
}
```

- [ ] **Step 6: Verify `crypto.randomUUID` exists under the test environment**

Add to `src/data/derive.test.ts`:

```ts
import { newId } from './ids';

describe('newId', () => {
  it('returns a distinct UUID each call', () => {
    const a = newId();
    const b = newId();

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
```

Run: `npx vitest run src/data/derive.test.ts`
Expected: PASS, 9 tests. If `crypto.randomUUID` is undefined under jsdom, report it — do not silently add a weak `Math.random` fallback, because note identity depends on this.

- [ ] **Step 7: Verify everything and commit**

```bash
npm test && npm run lint && npm run format:check && npm run typecheck
git add -A
git commit -m "feat(data): add title derivation and identifier generation"
```

---

## Task 3: Notes repository

**Files:**
- Create: `src/data/repositories/notes.ts`, `src/data/repositories/notes.test.ts`

**Interfaces:**
- Consumes: `BearDatabase` and `createTestDatabase` (Task 1), `deriveTitle` and `newId` (Task 2).
- Produces:

```ts
export type TagParser = (markdown: string) => string[];

export interface NotesRepositoryDeps {
  db: BearDatabase;
  parseTags: TagParser;
  now?: () => number;
  generateId?: () => string;
}

export interface NotesRepository {
  create(text?: string): Promise<Note>;
  get(id: string): Promise<Note | undefined>;
  save(id: string, text: string): Promise<Note>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  emptyTrash(): Promise<number>;
  listActive(): Promise<Note[]>;
  listTrashed(): Promise<Note[]>;
  tagsOf(id: string): Promise<string[]>;
  rebuildTagIndex(): Promise<number>;
}

export function createNotesRepository(deps: NotesRepositoryDeps): NotesRepository;
```

`now` and `generateId` are injectable purely so tests are deterministic; production wiring omits them and gets `Date.now` and `newId`.

- [ ] **Step 1: Write the failing lifecycle tests**

Create `src/data/repositories/notes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createNotesRepository, type NotesRepository } from './notes';

/** A fake parser: every word starting with `#` is a tag. Not the real M5 parser. */
const fakeParseTags = (text: string): string[] =>
  [...text.matchAll(/#([\w/]+)/g)].map((m) => m[1]);

describe('notesRepository', () => {
  let db: BearDatabase;
  let notes: NotesRepository;
  let clock: number;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    clock = 1000;

    let seq = 0;
    notes = createNotesRepository({
      db,
      parseTags: fakeParseTags,
      now: () => clock,
      generateId: () => `id-${++seq}`,
    });
  });

  it('creates an empty note with derived defaults', async () => {
    const note = await notes.create();

    expect(note.id).toBe('id-1');
    expect(note.text).toBe('');
    expect(note.title).toBe('');
    expect(note.createdAt).toBe(1000);
    expect(note.updatedAt).toBe(1000);
    expect(note.pinned).toBe(false);
    expect(note.trashedAt).toBeNull();
    expect(note.archivedAt).toBeNull();
  });

  it('derives the title from the text on save', async () => {
    const note = await notes.create();
    clock = 2000;

    const saved = await notes.save(note.id, '# Groceries\n\nmilk');

    expect(saved.title).toBe('Groceries');
    expect(saved.updatedAt).toBe(2000);
    expect(saved.createdAt).toBe(1000);
  });

  it('rejects saving a note that does not exist', async () => {
    await expect(notes.save('missing', 'text')).rejects.toThrow();
  });

  it('moves a note to trash and back without losing content', async () => {
    const note = await notes.create('keep me');
    clock = 3000;

    await notes.trash(note.id);
    expect((await notes.get(note.id))?.trashedAt).toBe(3000);

    await notes.restore(note.id);
    const restored = await notes.get(note.id);
    expect(restored?.trashedAt).toBeNull();
    expect(restored?.text).toBe('keep me');
  });

  it('excludes trashed notes from listActive and includes them in listTrashed', async () => {
    const kept = await notes.create('kept');
    const tossed = await notes.create('tossed');
    await notes.trash(tossed.id);

    expect((await notes.listActive()).map((n) => n.id)).toEqual([kept.id]);
    expect((await notes.listTrashed()).map((n) => n.id)).toEqual([tossed.id]);
  });

  it('orders listActive by updatedAt, newest first', async () => {
    const first = await notes.create('first');
    clock = 2000;
    const second = await notes.create('second');
    clock = 3000;
    await notes.save(first.id, 'first again');

    expect((await notes.listActive()).map((n) => n.id)).toEqual([first.id, second.id]);
  });

  it('toggles pinned', async () => {
    const note = await notes.create();

    await notes.setPinned(note.id, true);
    expect((await notes.get(note.id))?.pinned).toBe(true);

    await notes.setPinned(note.id, false);
    expect((await notes.get(note.id))?.pinned).toBe(false);
  });

  it('purges a single note permanently', async () => {
    const note = await notes.create('doomed');
    await notes.purge(note.id);

    expect(await notes.get(note.id)).toBeUndefined();
  });

  it('empties the trash and leaves active notes alone', async () => {
    const kept = await notes.create('kept');
    const a = await notes.create('a');
    const b = await notes.create('b');
    await notes.trash(a.id);
    await notes.trash(b.id);

    expect(await notes.emptyTrash()).toBe(2);
    expect((await notes.listActive()).map((n) => n.id)).toEqual([kept.id]);
    expect(await notes.listTrashed()).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing tag-index tests**

Append to the same file, inside the same `describe`:

```ts
  it('indexes tags parsed from the note text on save', async () => {
    const note = await notes.create();
    await notes.save(note.id, 'shopping #food and #work/urgent');

    expect((await notes.tagsOf(note.id)).sort()).toEqual(['food', 'work/urgent']);
  });

  it('removes tags from the index when they leave the text', async () => {
    const note = await notes.create('#alpha #beta');
    expect((await notes.tagsOf(note.id)).sort()).toEqual(['alpha', 'beta']);

    await notes.save(note.id, '#alpha only');
    expect(await notes.tagsOf(note.id)).toEqual(['alpha']);
  });

  it('deduplicates a tag repeated in one note', async () => {
    const note = await notes.create('#same and #same again');

    expect(await notes.tagsOf(note.id)).toEqual(['same']);
  });

  it('drops the tag index entries when a note is purged', async () => {
    const note = await notes.create('#gone');
    await notes.purge(note.id);

    expect(await db.noteTags.where('noteId').equals(note.id).count()).toBe(0);
  });

  it('rebuilds the entire tag index from note text alone', async () => {
    const a = await notes.create('#one');
    const b = await notes.create('#two #three');

    // Simulate corruption: wipe the derived index entirely.
    await db.noteTags.clear();
    expect(await notes.tagsOf(a.id)).toEqual([]);

    const rebuilt = await notes.rebuildTagIndex();

    expect(rebuilt).toBe(3);
    expect(await notes.tagsOf(a.id)).toEqual(['one']);
    expect((await notes.tagsOf(b.id)).sort()).toEqual(['three', 'two']);
  });

  it('keeps trashed notes out of the tag index rebuild', async () => {
    const active = await notes.create('#live');
    const trashed = await notes.create('#dead');
    await notes.trash(trashed.id);

    await db.noteTags.clear();
    await notes.rebuildTagIndex();

    expect(await notes.tagsOf(active.id)).toEqual(['live']);
    expect(await notes.tagsOf(trashed.id)).toEqual([]);
  });
```

The rebuild test is the one that proves the spec's guarantee: the derived index can be destroyed and reconstructed from `notes.text` alone.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/repositories/notes.test.ts`
Expected: FAIL — cannot resolve `./notes`.

- [ ] **Step 4: Implement the repository**

Create `src/data/repositories/notes.ts`:

```ts
import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { newId } from '../ids';
import type { Note } from '../types';

export type TagParser = (markdown: string) => string[];

export interface NotesRepositoryDeps {
  db: BearDatabase;
  parseTags: TagParser;
  now?: () => number;
  generateId?: () => string;
}

export interface NotesRepository {
  create(text?: string): Promise<Note>;
  get(id: string): Promise<Note | undefined>;
  save(id: string, text: string): Promise<Note>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  trash(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  purge(id: string): Promise<void>;
  emptyTrash(): Promise<number>;
  listActive(): Promise<Note[]>;
  listTrashed(): Promise<Note[]>;
  tagsOf(id: string): Promise<string[]>;
  rebuildTagIndex(): Promise<number>;
}

export function createNotesRepository(deps: NotesRepositoryDeps): NotesRepository {
  const { db, parseTags } = deps;
  const now = deps.now ?? (() => Date.now());
  const generateId = deps.generateId ?? newId;

  /** Replaces this note's derived tag rows to match its current text. */
  async function reindex(noteId: string, text: string): Promise<void> {
    const tags = [...new Set(parseTags(text))];

    await db.noteTags.where('noteId').equals(noteId).delete();
    if (tags.length > 0) {
      await db.noteTags.bulkPut(tags.map((tag) => ({ noteId, tag })));
    }
  }

  /** Named `requireNote`, not `require` — shadowing the CommonJS global invites trouble. */
  async function requireNote(id: string): Promise<Note> {
    const note = await db.notes.get(id);
    if (!note) throw new Error(`Note not found: ${id}`);
    return note;
  }

  return {
    async create(text = '') {
      const timestamp = now();
      const note: Note = {
        id: generateId(),
        title: deriveTitle(text),
        text,
        createdAt: timestamp,
        updatedAt: timestamp,
        pinned: false,
        trashedAt: null,
        archivedAt: null,
      };

      await db.transaction('rw', db.notes, db.noteTags, async () => {
        await db.notes.add(note);
        await reindex(note.id, text);
      });

      return note;
    },

    async get(id) {
      return db.notes.get(id);
    },

    async save(id, text) {
      return db.transaction('rw', db.notes, db.noteTags, async () => {
        const existing = await requireNote(id);
        const updated: Note = {
          ...existing,
          text,
          title: deriveTitle(text),
          updatedAt: now(),
        };

        await db.notes.put(updated);
        await reindex(id, text);

        return updated;
      });
    },

    async setPinned(id, pinned) {
      await requireNote(id);
      await db.notes.update(id, { pinned });
    },

    async trash(id) {
      await requireNote(id);
      await db.notes.update(id, { trashedAt: now() });
    },

    async restore(id) {
      await requireNote(id);
      await db.notes.update(id, { trashedAt: null });
    },

    async purge(id) {
      await db.transaction('rw', db.notes, db.noteTags, db.files, async () => {
        await db.noteTags.where('noteId').equals(id).delete();
        await db.files.where('noteId').equals(id).delete();
        await db.notes.delete(id);
      });
    },

    async emptyTrash() {
      return db.transaction('rw', db.notes, db.noteTags, db.files, async () => {
        // The trashedAt index holds only trashed notes, since IndexedDB omits nulls.
        const trashed = await db.notes.where('trashedAt').above(0).toArray();
        const ids = trashed.map((n) => n.id);

        await db.noteTags.where('noteId').anyOf(ids).delete();
        await db.files.where('noteId').anyOf(ids).delete();
        await db.notes.bulkDelete(ids);

        return ids.length;
      });
    },

    async listActive() {
      // `pinned` and `trashedAt === null` cannot drive an index here; see db.ts.
      const all = await db.notes.orderBy('updatedAt').reverse().toArray();
      return all.filter((n) => n.trashedAt === null);
    },

    async listTrashed() {
      const trashed = await db.notes.where('trashedAt').above(0).toArray();
      return trashed.sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
    },

    async tagsOf(id) {
      const rows = await db.noteTags.where('noteId').equals(id).toArray();
      return rows.map((r) => r.tag);
    },

    async rebuildTagIndex() {
      return db.transaction('rw', db.notes, db.noteTags, async () => {
        await db.noteTags.clear();

        const all = await db.notes.toArray();
        const rows = all
          .filter((n) => n.trashedAt === null)
          .flatMap((n) => [...new Set(parseTags(n.text))].map((tag) => ({ noteId: n.id, tag })));

        await db.noteTags.bulkPut(rows);
        return rows.length;
      });
    },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/repositories/notes.test.ts`
Expected: PASS, 15 tests.

If `listActive` returns notes in the wrong order, check that `reverse()` is applied to the `orderBy` collection rather than to the resulting array.

- [ ] **Step 6: Verify everything and commit**

```bash
npm test && npm run lint && npm run format:check && npm run typecheck
git add -A
git commit -m "feat(data): add notes repository with derived tag index"
```

---

## Task 4: Tags, files, and settings repositories

**Files:**
- Create: `src/data/repositories/tags.ts`, `src/data/repositories/tags.test.ts`, `src/data/repositories/files.ts`, `src/data/repositories/files.test.ts`, `src/data/repositories/settings.ts`, `src/data/repositories/settings.test.ts`

**Interfaces:**
- Consumes: `BearDatabase`, `createTestDatabase`, `newId`.
- Produces:

```ts
export function createTagsRepository(db: BearDatabase): TagsRepository;
export interface TagsRepository {
  getMeta(tag: string): Promise<TagMeta | undefined>;
  setCollapsed(tag: string, collapsed: boolean): Promise<void>;
  setIcon(tag: string, iconKey: string | null): Promise<void>;
  setSortOrder(tag: string, sortOrder: number): Promise<void>;
  allMeta(): Promise<TagMeta[]>;
  removeMeta(tag: string): Promise<void>;
}

export function createFilesRepository(deps: { db: BearDatabase; generateId?: () => string }): FilesRepository;
export interface FilesRepository {
  add(noteId: string, blob: Blob, mime: string): Promise<FileRecord>;
  get(id: string): Promise<FileRecord | undefined>;
  listForNote(noteId: string): Promise<FileRecord[]>;
  remove(id: string): Promise<void>;
  removeForNote(noteId: string): Promise<number>;
}

export function createSettingsRepository(db: BearDatabase): SettingsRepository;
export interface SettingsRepository {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  all(): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
}
```

**The key behavioural rule for tags:** this repository stores *metadata only*. It never determines which notes carry a tag — that is `noteTags`, owned by the notes repository. `getMeta` returning `undefined` for a tag that is in active use is correct and expected; metadata rows exist only once a user customizes something.

**The key behavioural rule for settings:** `get` takes a fallback and returns it when the key is absent, so callers never handle `undefined`. Values are `unknown` and callers narrow.

- [ ] **Step 1: Write the failing tags tests**

Create `src/data/repositories/tags.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createTagsRepository, type TagsRepository } from './tags';

describe('tagsRepository', () => {
  let db: BearDatabase;
  let tags: TagsRepository;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    tags = createTagsRepository(db);
  });

  it('returns undefined for a tag with no stored metadata', async () => {
    expect(await tags.getMeta('work')).toBeUndefined();
  });

  it('creates a metadata row on first write with sensible defaults', async () => {
    await tags.setCollapsed('work', true);

    const meta = await tags.getMeta('work');
    expect(meta).toEqual({ tag: 'work', collapsed: true, iconKey: null, sortOrder: 0 });
  });

  it('updates one field without clobbering the others', async () => {
    await tags.setCollapsed('work', true);
    await tags.setIcon('work', 'briefcase');
    await tags.setSortOrder('work', 5);

    expect(await tags.getMeta('work')).toEqual({
      tag: 'work',
      collapsed: true,
      iconKey: 'briefcase',
      sortOrder: 5,
    });
  });

  it('clears an icon by setting it to null', async () => {
    await tags.setIcon('work', 'briefcase');
    await tags.setIcon('work', null);

    expect((await tags.getMeta('work'))?.iconKey).toBeNull();
  });

  it('lists all metadata rows ordered by sortOrder', async () => {
    await tags.setSortOrder('b', 2);
    await tags.setSortOrder('a', 1);

    expect((await tags.allMeta()).map((m) => m.tag)).toEqual(['a', 'b']);
  });

  it('removes a metadata row', async () => {
    await tags.setCollapsed('work', true);
    await tags.removeMeta('work');

    expect(await tags.getMeta('work')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/data/repositories/tags.test.ts`
Expected: FAIL — cannot resolve `./tags`.

- [ ] **Step 3: Implement the tags repository**

Create `src/data/repositories/tags.ts`:

```ts
import type { BearDatabase } from '../db';
import type { TagMeta } from '../types';

export interface TagsRepository {
  getMeta(tag: string): Promise<TagMeta | undefined>;
  setCollapsed(tag: string, collapsed: boolean): Promise<void>;
  setIcon(tag: string, iconKey: string | null): Promise<void>;
  setSortOrder(tag: string, sortOrder: number): Promise<void>;
  allMeta(): Promise<TagMeta[]>;
  removeMeta(tag: string): Promise<void>;
}

const defaults = (tag: string): TagMeta => ({
  tag,
  collapsed: false,
  iconKey: null,
  sortOrder: 0,
});

/**
 * Stores tag *metadata* only. Which notes carry a tag is owned by `noteTags`
 * and derived from note text — never from this table.
 */
export function createTagsRepository(db: BearDatabase): TagsRepository {
  async function patch(tag: string, changes: Partial<TagMeta>): Promise<void> {
    const existing = (await db.tags.get(tag)) ?? defaults(tag);
    await db.tags.put({ ...existing, ...changes, tag });
  }

  return {
    async getMeta(tag) {
      return db.tags.get(tag);
    },
    async setCollapsed(tag, collapsed) {
      await patch(tag, { collapsed });
    },
    async setIcon(tag, iconKey) {
      await patch(tag, { iconKey });
    },
    async setSortOrder(tag, sortOrder) {
      await patch(tag, { sortOrder });
    },
    async allMeta() {
      return db.tags.orderBy('sortOrder').toArray();
    },
    async removeMeta(tag) {
      await db.tags.delete(tag);
    },
  };
}
```

- [ ] **Step 4: Write the failing files tests**

Create `src/data/repositories/files.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createFilesRepository, type FilesRepository } from './files';

describe('filesRepository', () => {
  let db: BearDatabase;
  let files: FilesRepository;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();

    let seq = 0;
    files = createFilesRepository({ db, generateId: () => `file-${++seq}` });
  });

  it('stores a blob and returns it unchanged', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });

    const record = await files.add('note-1', blob, 'text/plain');
    const found = await files.get(record.id);

    expect(found?.mime).toBe('text/plain');
    expect(await found?.blob.text()).toBe('hello');
  });

  it('lists only the files belonging to one note', async () => {
    await files.add('note-1', new Blob(['a']), 'text/plain');
    await files.add('note-2', new Blob(['b']), 'text/plain');

    expect((await files.listForNote('note-1')).map((f) => f.id)).toEqual(['file-1']);
  });

  it('removes a single file', async () => {
    const record = await files.add('note-1', new Blob(['a']), 'text/plain');
    await files.remove(record.id);

    expect(await files.get(record.id)).toBeUndefined();
  });

  it('removes every file for a note and reports the count', async () => {
    await files.add('note-1', new Blob(['a']), 'text/plain');
    await files.add('note-1', new Blob(['b']), 'text/plain');
    await files.add('note-2', new Blob(['c']), 'text/plain');

    expect(await files.removeForNote('note-1')).toBe(2);
    expect(await files.listForNote('note-1')).toEqual([]);
    expect(await files.listForNote('note-2')).toHaveLength(1);
  });
});
```

- [ ] **Step 5: Implement the files repository**

Create `src/data/repositories/files.ts`:

```ts
import type { BearDatabase } from '../db';
import { newId } from '../ids';
import type { FileRecord } from '../types';

export interface FilesRepositoryDeps {
  db: BearDatabase;
  generateId?: () => string;
}

export interface FilesRepository {
  add(noteId: string, blob: Blob, mime: string): Promise<FileRecord>;
  get(id: string): Promise<FileRecord | undefined>;
  listForNote(noteId: string): Promise<FileRecord[]>;
  remove(id: string): Promise<void>;
  removeForNote(noteId: string): Promise<number>;
}

export function createFilesRepository(deps: FilesRepositoryDeps): FilesRepository {
  const { db } = deps;
  const generateId = deps.generateId ?? newId;

  return {
    async add(noteId, blob, mime) {
      const record: FileRecord = { id: generateId(), noteId, blob, mime };
      await db.files.add(record);
      return record;
    },
    async get(id) {
      return db.files.get(id);
    },
    async listForNote(noteId) {
      return db.files.where('noteId').equals(noteId).toArray();
    },
    async remove(id) {
      await db.files.delete(id);
    },
    async removeForNote(noteId) {
      return db.files.where('noteId').equals(noteId).delete();
    },
  };
}
```

- [ ] **Step 6: Write the failing settings tests**

Create `src/data/repositories/settings.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import type { BearDatabase } from '../db';
import { createTestDatabase } from '../testing';
import { createSettingsRepository, type SettingsRepository } from './settings';

describe('settingsRepository', () => {
  let db: BearDatabase;
  let settings: SettingsRepository;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    settings = createSettingsRepository(db);
  });

  it('returns the fallback for an absent key', async () => {
    expect(await settings.get('theme', 'light')).toBe('light');
  });

  it('stores and retrieves a value', async () => {
    await settings.set('theme', 'dark');

    expect(await settings.get('theme', 'light')).toBe('dark');
  });

  it('overwrites an existing value', async () => {
    await settings.set('fontSize', 16);
    await settings.set('fontSize', 18);

    expect(await settings.get('fontSize', 0)).toBe(18);
  });

  it('preserves a stored value that is falsy', async () => {
    await settings.set('paraIndent', 0);
    await settings.set('sidebarOpen', false);

    expect(await settings.get('paraIndent', 99)).toBe(0);
    expect(await settings.get('sidebarOpen', true)).toBe(false);
  });

  it('round-trips a structured value', async () => {
    await settings.set('panes', { sidebar: 240, list: 320 });

    expect(await settings.get('panes', {})).toEqual({ sidebar: 240, list: 320 });
  });

  it('returns everything as a plain object', async () => {
    await settings.set('a', 1);
    await settings.set('b', 2);

    expect(await settings.all()).toEqual({ a: 1, b: 2 });
  });

  it('removes a key so the fallback applies again', async () => {
    await settings.set('theme', 'dark');
    await settings.remove('theme');

    expect(await settings.get('theme', 'light')).toBe('light');
  });
});
```

The falsy-value test is the important one. A naive `value || fallback` implementation passes every other test in this file and silently destroys `0` and `false` — both of which this application genuinely stores, as paragraph indent and sidebar state.

- [ ] **Step 7: Implement the settings repository**

Create `src/data/repositories/settings.ts`:

```ts
import type { BearDatabase } from '../db';

export interface SettingsRepository {
  get<T>(key: string, fallback: T): Promise<T>;
  set(key: string, value: unknown): Promise<void>;
  all(): Promise<Record<string, unknown>>;
  remove(key: string): Promise<void>;
}

export function createSettingsRepository(db: BearDatabase): SettingsRepository {
  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const row = await db.settings.get(key);
      // Absence is the only trigger for the fallback. A stored 0 or false wins.
      return row === undefined ? fallback : (row.value as T);
    },
    async set(key, value) {
      await db.settings.put({ key, value });
    },
    async all() {
      const rows = await db.settings.toArray();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    },
    async remove(key) {
      await db.settings.delete(key);
    },
  };
}
```

- [ ] **Step 8: Run all three test files and verify they pass**

Run: `npx vitest run src/data/repositories`
Expected: PASS — 6 tags tests, 4 files tests, 7 settings tests, plus the 15 notes tests from Task 3.

- [ ] **Step 9: Verify everything and commit**

```bash
npm test && npm run lint && npm run format:check && npm run typecheck
git add -A
git commit -m "feat(data): add tags, files, and settings repositories"
```

---

## Task 5: Database export and import

**Files:**
- Create: `src/data/backup.ts`, `src/data/backup.test.ts`
- Modify: `src/data/types.ts`

**Interfaces:**
- Consumes: `BearDatabase`, all record types.
- Produces:

```ts
export const BACKUP_FORMAT = 'bear-web-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export function exportDatabase(db: BearDatabase): Promise<BackupBundle>;
export function importDatabase(db: BearDatabase, bundle: unknown): Promise<ImportResult>;

export interface ImportResult {
  notes: number;
  noteTags: number;
  tags: number;
  files: number;
  settings: number;
}
```

This is the user's backup and the project's debugging escape hatch, and the spec requires it in this milestone. It ships before any UI exists precisely so there is never a window where data can be created but not rescued.

**Import is replace-only.** It clears every table and writes the bundle's contents. Merging two databases needs conflict resolution that Phase 1 has no answer for, and a half-defined merge is worse than none. The calling UI will confirm destructively later.

**Blobs need explicit handling.** `JSON.stringify` turns a `Blob` into `{}` — silently, with no error. Files must be serialized to base64 on export and reconstructed on import, and the round-trip test must assert the bytes survive.

- [ ] **Step 1: Add the bundle types**

Append to `src/data/types.ts`:

```ts
/** A file with its blob encoded as base64, so the bundle is JSON-safe. */
export interface SerializedFile {
  id: string;
  noteId: string;
  mime: string;
  /** base64, without a data-URL prefix. */
  data: string;
}

export interface BackupBundle {
  format: 'bear-web-backup';
  schemaVersion: number;
  exportedAt: number;
  notes: Note[];
  noteTags: NoteTag[];
  tags: TagMeta[];
  files: SerializedFile[];
  settings: SettingRecord[];
}
```

- [ ] **Step 2: Write the failing round-trip tests**

Create `src/data/backup.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, exportDatabase, importDatabase } from './backup';
import type { BearDatabase } from './db';
import { createTestDatabase } from './testing';

async function seed(db: BearDatabase): Promise<void> {
  await db.notes.add({
    id: 'n1',
    title: 'Groceries',
    text: '# Groceries\n\n- [ ] milk #food',
    createdAt: 1000,
    updatedAt: 2000,
    pinned: true,
    trashedAt: null,
    archivedAt: null,
  });
  await db.noteTags.add({ noteId: 'n1', tag: 'food' });
  await db.tags.add({ tag: 'food', collapsed: true, iconKey: 'apple', sortOrder: 3 });
  await db.files.add({
    id: 'f1',
    noteId: 'n1',
    blob: new Blob([new Uint8Array([0, 1, 2, 253, 254, 255])], { type: 'image/png' }),
    mime: 'image/png',
  });
  await db.settings.add({ key: 'theme', value: 'dark' });
}

describe('exportDatabase', () => {
  let db: BearDatabase;

  beforeEach(async () => {
    db = createTestDatabase();
    await db.open();
    await seed(db);
  });

  it('stamps the format and schema version', async () => {
    const bundle = await exportDatabase(db);

    expect(bundle.format).toBe(BACKUP_FORMAT);
    expect(bundle.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(typeof bundle.exportedAt).toBe('number');
  });

  it('includes every table', async () => {
    const bundle = await exportDatabase(db);

    expect(bundle.notes).toHaveLength(1);
    expect(bundle.noteTags).toHaveLength(1);
    expect(bundle.tags).toHaveLength(1);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.settings).toHaveLength(1);
  });

  it('survives JSON serialization without losing the file blob', async () => {
    const bundle = await exportDatabase(db);
    const reparsed = JSON.parse(JSON.stringify(bundle)) as typeof bundle;

    // JSON.stringify turns a raw Blob into {} silently. Base64 is why this passes.
    expect(reparsed.files[0].data).toBe(bundle.files[0].data);
    expect(reparsed.files[0].data.length).toBeGreaterThan(0);
  });
});

describe('importDatabase', () => {
  let source: BearDatabase;
  let target: BearDatabase;

  beforeEach(async () => {
    source = createTestDatabase();
    target = createTestDatabase();
    await source.open();
    await target.open();
    await seed(source);
  });

  it('restores every record through a full JSON round trip', async () => {
    const json = JSON.stringify(await exportDatabase(source));

    const result = await importDatabase(target, JSON.parse(json));

    expect(result).toEqual({ notes: 1, noteTags: 1, tags: 1, files: 1, settings: 1 });

    const note = await target.notes.get('n1');
    expect(note?.text).toBe('# Groceries\n\n- [ ] milk #food');
    expect(note?.pinned).toBe(true);
    expect(note?.trashedAt).toBeNull();
    expect(await target.settings.get('theme')).toEqual({ key: 'theme', value: 'dark' });
  });

  it('restores file blobs byte for byte', async () => {
    const json = JSON.stringify(await exportDatabase(source));
    await importDatabase(target, JSON.parse(json));

    const file = await target.files.get('f1');
    const bytes = new Uint8Array(await file!.blob.arrayBuffer());

    expect([...bytes]).toEqual([0, 1, 2, 253, 254, 255]);
    expect(file?.mime).toBe('image/png');
  });

  it('replaces existing data rather than merging', async () => {
    await target.notes.add({
      id: 'pre-existing',
      title: 'Old',
      text: 'Old',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    await importDatabase(target, JSON.parse(JSON.stringify(await exportDatabase(source))));

    expect(await target.notes.get('pre-existing')).toBeUndefined();
    expect(await target.notes.count()).toBe(1);
  });

  it('rejects a bundle with the wrong format marker', async () => {
    await expect(importDatabase(target, { format: 'something-else' })).rejects.toThrow(
      /not a bear-web backup/i,
    );
  });

  it('rejects a bundle from a newer schema version', async () => {
    const bundle = await exportDatabase(source);

    await expect(
      importDatabase(target, { ...bundle, schemaVersion: BACKUP_SCHEMA_VERSION + 1 }),
    ).rejects.toThrow(/newer version/i);
  });

  it('rejects a non-object payload', async () => {
    await expect(importDatabase(target, 'not a bundle')).rejects.toThrow();
    await expect(importDatabase(target, null)).rejects.toThrow();
  });

  it('leaves the target untouched when validation fails', async () => {
    await target.notes.add({
      id: 'keep',
      title: 'Keep',
      text: 'Keep',
      createdAt: 1,
      updatedAt: 1,
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    });

    await expect(importDatabase(target, { format: 'wrong' })).rejects.toThrow();

    expect(await target.notes.get('keep')).toBeDefined();
  });
});
```

The last test matters most: a rejected import must not have already wiped the user's data. Validate before clearing anything.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/data/backup.test.ts`
Expected: FAIL — cannot resolve `./backup`.

- [ ] **Step 4: Implement export and import**

Create `src/data/backup.ts`:

```ts
import type { BearDatabase } from './db';
import type { BackupBundle, SerializedFile } from './types';

export const BACKUP_FORMAT = 'bear-web-backup';
export const BACKUP_SCHEMA_VERSION = 1;

export interface ImportResult {
  notes: number;
  noteTags: number;
  tags: number;
  files: number;
  settings: number;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBlob(data: string, mime: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportDatabase(db: BearDatabase): Promise<BackupBundle> {
  const [notes, noteTags, tags, fileRecords, settings] = await Promise.all([
    db.notes.toArray(),
    db.noteTags.toArray(),
    db.tags.toArray(),
    db.files.toArray(),
    db.settings.toArray(),
  ]);

  const files: SerializedFile[] = await Promise.all(
    fileRecords.map(async (f) => ({
      id: f.id,
      noteId: f.noteId,
      mime: f.mime,
      data: await blobToBase64(f.blob),
    })),
  );

  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    notes,
    noteTags,
    tags,
    files,
    settings,
  };
}

function assertBundle(candidate: unknown): asserts candidate is BackupBundle {
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('Import failed: the payload is not a bear-web backup.');
  }

  const bundle = candidate as Partial<BackupBundle>;

  if (bundle.format !== BACKUP_FORMAT) {
    throw new Error('Import failed: the payload is not a bear-web backup.');
  }

  if (typeof bundle.schemaVersion !== 'number') {
    throw new Error('Import failed: the backup has no schema version.');
  }

  if (bundle.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error(
      `Import failed: the backup was written by a newer version of bear-web ` +
        `(schema ${bundle.schemaVersion}, this build understands ${BACKUP_SCHEMA_VERSION}).`,
    );
  }

  for (const table of ['notes', 'noteTags', 'tags', 'files', 'settings'] as const) {
    if (!Array.isArray(bundle[table])) {
      throw new Error(`Import failed: the backup is missing its "${table}" table.`);
    }
  }
}

/**
 * Replaces the entire database with the bundle's contents. Validation happens
 * before anything is cleared, so a rejected import leaves existing data intact.
 */
export async function importDatabase(db: BearDatabase, payload: unknown): Promise<ImportResult> {
  assertBundle(payload);
  const bundle = payload;

  const files = bundle.files.map((f) => ({
    id: f.id,
    noteId: f.noteId,
    mime: f.mime,
    blob: base64ToBlob(f.data, f.mime),
  }));

  await db.transaction('rw', db.notes, db.noteTags, db.tags, db.files, db.settings, async () => {
    await Promise.all([
      db.notes.clear(),
      db.noteTags.clear(),
      db.tags.clear(),
      db.files.clear(),
      db.settings.clear(),
    ]);

    await Promise.all([
      db.notes.bulkAdd(bundle.notes),
      db.noteTags.bulkAdd(bundle.noteTags),
      db.tags.bulkAdd(bundle.tags),
      db.files.bulkAdd(files),
      db.settings.bulkAdd(bundle.settings),
    ]);
  });

  return {
    notes: bundle.notes.length,
    noteTags: bundle.noteTags.length,
    tags: bundle.tags.length,
    files: files.length,
    settings: bundle.settings.length,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/data/backup.test.ts`
Expected: PASS, 10 tests.

If the blob round-trip fails, check that `btoa`/`atob` are available under jsdom — they are — and that the byte loop is not being defeated by a `TextDecoder` somewhere. Bytes 253–255 in the fixture exist specifically to catch a UTF-8 decoding mistake that ASCII-only test data would hide.

- [ ] **Step 6: Verify everything and commit**

```bash
npm test && npm run lint && npm run format:check && npm run typecheck
git add -A
git commit -m "feat(data): add full database export and import"
```

---

## Task 6: Composition and public surface

**Files:**
- Create: `src/data/repositories/index.ts`, `src/data/index.ts`, `src/data/index.test.ts`

**Interfaces:**
- Consumes: every repository factory and `db`.
- Produces: the ready-to-use singletons `notes`, `tags`, `files`, `settings`, and the re-exported public surface listed at the top of this plan. This is the only module the rest of the application imports from.

- [ ] **Step 1: Write the composition module**

Create `src/data/repositories/index.ts`:

```ts
import { db } from '../db';
import { createFilesRepository } from './files';
import { createNotesRepository, type TagParser } from './notes';
import { createSettingsRepository } from './settings';
import { createTagsRepository } from './tags';

/**
 * Placeholder until M5 delivers the real parser.
 *
 * `parseTags` is one of the two functions where a wrong implementation corrupts
 * user data, so the spec makes test-driven development mandatory for it. Rather
 * than ship an untested approximation here, M1 wires in a parser that finds
 * nothing and leaves the index-maintenance logic fully exercised by injected
 * fakes in the repository tests.
 *
 * M5 replaces this single line.
 */
const noTags: TagParser = () => [];

export const notes = createNotesRepository({ db, parseTags: noTags });
export const tags = createTagsRepository(db);
export const files = createFilesRepository({ db });
export const settings = createSettingsRepository(db);

export type { FilesRepository } from './files';
export type { NotesRepository, TagParser } from './notes';
export type { SettingsRepository } from './settings';
export type { TagsRepository } from './tags';
```

- [ ] **Step 2: Write the public surface**

Create `src/data/index.ts`:

```ts
export { BACKUP_FORMAT, BACKUP_SCHEMA_VERSION, exportDatabase, importDatabase } from './backup';
export type { ImportResult } from './backup';
export { BearDatabase, DATABASE_NAME, db } from './db';
export { deriveTitle } from './derive';
export { newId } from './ids';
export { files, notes, settings, tags } from './repositories';
export type {
  FilesRepository,
  NotesRepository,
  SettingsRepository,
  TagParser,
  TagsRepository,
} from './repositories';
export type {
  BackupBundle,
  FileRecord,
  Note,
  NoteTag,
  SerializedFile,
  SettingRecord,
  TagMeta,
} from './types';
```

- [ ] **Step 3: Write the surface test**

Create `src/data/index.test.ts`. This test guards the contract later milestones depend on, and it catches an export accidentally dropped during a refactor.

```ts
import { describe, expect, it } from 'vitest';

import * as data from './index';

describe('data public surface', () => {
  it('exposes the repositories as ready-to-use singletons', () => {
    expect(typeof data.notes.create).toBe('function');
    expect(typeof data.tags.getMeta).toBe('function');
    expect(typeof data.files.add).toBe('function');
    expect(typeof data.settings.get).toBe('function');
  });

  it('exposes the backup functions and their constants', () => {
    expect(typeof data.exportDatabase).toBe('function');
    expect(typeof data.importDatabase).toBe('function');
    expect(data.BACKUP_FORMAT).toBe('bear-web-backup');
    expect(data.BACKUP_SCHEMA_VERSION).toBe(1);
  });

  it('exposes the derivation helpers', () => {
    expect(data.deriveTitle('# Title\nbody')).toBe('Title');
    expect(typeof data.newId()).toBe('string');
  });

  it('names the production database', () => {
    expect(data.DATABASE_NAME).toBe('bear-web');
  });
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/data/index.test.ts`
Expected: PASS, 4 tests.

Note this test touches the real `db` singleton rather than a test database. It only inspects function shapes and never opens a connection, so it stays isolated — but if it starts failing intermittently, that assumption has been broken and the test needs a rethink rather than a retry.

- [ ] **Step 5: Confirm the tag-parser seam is genuinely swappable**

Append to `src/data/index.test.ts`:

```ts
import { createNotesRepository } from './repositories/notes';
import { createTestDatabase } from './testing';

describe('tag parser seam', () => {
  it('accepts a replacement parser without touching repository code', async () => {
    const db = createTestDatabase();
    await db.open();

    const notes = createNotesRepository({
      db,
      parseTags: (text) => (text.includes('urgent') ? ['urgent'] : []),
    });

    const note = await notes.create('this is urgent');
    expect(await notes.tagsOf(note.id)).toEqual(['urgent']);

    db.close();
  });
});
```

This is what makes the M1 placeholder honest: the seam is proven to work before M5 uses it.

Run: `npx vitest run src/data/index.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Verify the whole milestone and commit**

```bash
npm test && npm run lint && npm run format:check && npm run typecheck && npm run build && npm run test:e2e
```

Expected: all exit 0. `npm test` reports the three M0 component tests plus roughly 45 data-layer tests. The end-to-end suite is unchanged — this milestone adds no UI, so those two tests must still pass untouched.

```bash
git add -A
git commit -m "feat(data): compose repositories and expose the data layer surface"
```

---

## Definition of Done for M1

- [ ] `npm test` passes, covering: schema, title derivation, note lifecycle, tag index maintenance and rebuild, tag metadata, file blobs, settings, and backup round-trip
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build` all exit 0
- [ ] `npm run test:e2e` still passes its two M0 tests unchanged
- [ ] The tag index can be destroyed and rebuilt from `notes.text` alone, proven by a test
- [ ] A database exports to JSON, survives `JSON.parse(JSON.stringify(...))`, and imports back with file blobs intact byte for byte
- [ ] A rejected import leaves existing data untouched, proven by a test
- [ ] No React component, hook, or stylesheet was added

## What M1 Deliberately Excludes

No UI of any kind. No real tag parser — the seam exists and is tested with injected fakes; M5 fills it. No search index; M7 owns that. No live-query React hooks; M2 adds `dexie-react-hooks` when there is something to render. No encryption. `archivedAt` stays null.

## Carried Forward

- **Import is replace-only.** If merge is ever wanted, it needs a conflict-resolution design first.
- **`pinned` is unindexed by necessity.** If the note count ever makes the in-memory filter slow, the fix is a `pinnedAt: number | null` column that IndexedDB can index — not an attempt to index the boolean.
- **`crypto.randomUUID` is assumed present.** If a target browser lacks it, `src/data/ids.ts` is the single place to add a fallback.
