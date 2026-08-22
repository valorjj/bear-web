# D2 — Sync Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move note and tag data between IndexedDB and the account server, automatically and quietly, so a signed-in user's notes survive the device and reach a second one.

**Architecture:** One monotonic `users.rev_counter` per user, incremented once per write transaction and stamped on every row that transaction touches — so pull is a single indexed range query (`rev > since`) and no clock is ever compared between devices. The client marks rows dirty inside the same Dexie transaction as the local write, pushes them with the `rev` it last saw, and the server rejects any note whose stored `rev` has moved past that base. A rejected note is not lost: the server copy wins and the local text is preserved as a new `<title> (conflict)` note.

**Tech Stack:** Hono on Node (`server/`), mysql2 against MariaDB, Dexie 4 in the browser, React 19, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-21-d-server-sync-and-oauth-design.md` — read its "The sync protocol", "Client integration" and "Testing" sections before Task 1. `docs/superpowers/NEXT.md`'s "Start here next session — D2" section carries the live-environment facts that are not in the repo.

## Global Constraints

Copied from the spec and from `CLAUDE.md`. Every task's requirements implicitly include this section.

- **All six gates must pass before every commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **Before trusting any e2e result that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview server on 4173 is silently reused and the suite tests the previous build.
- **The production API is running from this repo right now** as `npm run server:dev` (`tsx watch --env-file=server/.env`), serving `api.markflowing.com` through the tunnel. **Never edit `server/.env`.** Local work uses `npm run server:dev:local`, which reads the gitignored `server/.env.local`. The two cannot run at once — both bind 8787, because `http://localhost:8787/auth/google/callback` is the only registered redirect URI. Stop the production watcher before starting the local one, and restart it afterwards.
- **`server/` may import only `src/data/types.ts`** from under `src/`. Enforced by `scripts/serverBoundaries.test.ts`.
- **Every SQL statement naming a user-scoped table must constrain `user_id` in predicate position** (`user_id =` or `user_id IN`), or carry `/* tenancy-ok: reason */` on its own line or exactly one line above. `INSERT INTO` naming `user_id` in the column list is accepted. The guard derives its table list from `server/migrations/*.sql`, so the tables added in Task 1 are covered the moment that file lands.
- **`src/data/` must import nothing from `src/features/`.** Enforced by `scripts/sourceLint.test.ts`.
- **No user-facing string is hardcoded.** Every string goes through `useT`; `src/i18n/en.ts` defines the key type and `src/i18n/ko.ts` is `Record<TranslationKey, string>`, so a missing Korean string is a compile error. Never weaken that annotation.
- **Every colour comes from a CSS custom property.** Literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **IndexedDB rejects boolean keys.** Any flag that must be indexed is stored as `0 | 1`, exactly as `pinned` is kept out of every index today.
- **Dexie multiplies declared versions by ten.** `version(3)` is IndexedDB version **30**, and `e2e/fixtures/seed.ts` must move with it in the same commit or the app boots to a bare `<div id="root">` with no error at all.
- **Duck-type in tests, never `instanceof`.** `vitest.setup.ts` swaps the global `Blob` for Node's.
- **Quota: 10 MiB** (`10 * 1024 * 1024` bytes) of note text per user, measured as the UTF-8 byte length of `text` across that user's non-deleted notes.
- **Tombstone retention: 90 days**, swept opportunistically inside `GET /sync`. No scheduler.
- **Integration tests skip when `TEST_DATABASE_URL` is unset** and truncate whatever database it names. It must never equal `DATABASE_URL`.

## Divergences from the spec, decided during planning

Three, each recorded here so a reviewer does not read them as drift:

1. **`syncState` is keyed `[kind+key]`, not `noteId`.** The spec sketches `syncState(noteId, syncedRev, dirty)`. Tags sync too, and giving them a second bookkeeping table would mean two engines. One table with a `kind` discriminator (`'note' | 'tag'`) means one push loop, one pull loop, one set of tests.
2. **`syncState` carries a `deleted` flag.** Without it a local purge is unsyncable: the note row is gone, so nothing is left to tell the server to write a tombstone. The row outlives the note precisely so the delete can be pushed, and is removed once the server acknowledges it.
3. **The server does not store `title`.** `title` is a derived cache of the first non-empty line of `text` (`src/data/derive.ts`), and `deriveTitle` stays its single authority. The client derives it when applying a pulled note, exactly as it does on every local save.

---

### Task 1: Server schema and the revision counter

**Files:**
- Create: `server/migrations/002_sync.sql`
- Create: `server/src/repositories/revisions.ts`
- Test: `server/src/repositories/revisions.test.ts`

**Interfaces:**
- Consumes: `Query` and `Transaction` from `server/src/app.ts`; `migrate` from `server/src/db/migrate.ts`.
- Produces: `nextRev(query: Query, userId: string): Promise<number>` — allocates and returns the user's next revision number. **Must be called inside a `transaction`**, never against the pool `Query` directly.

- [ ] **Step 1: Write the failing test**

Create `server/src/repositories/revisions.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { findOrCreateUserByIdentity } from './users.ts';
import { nextRev } from './revisions.ts';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('nextRev', () => {
  let pool: Pool;
  let userId: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    userId = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-1',
      email: 'a@example.com',
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('starts at 1 and increases by one', async () => {
    const first = await pool.transaction((q) => nextRev(q, userId));
    const second = await pool.transaction((q) => nextRev(q, userId));

    expect(first).toBe(1);
    expect(second).toBe(2);
  });

  it('never issues the same number twice under concurrency', async () => {
    // The whole point of the counter. `FOR UPDATE` is what makes this pass;
    // a plain read-then-write hands the same number to both callers.
    const issued = await Promise.all(
      Array.from({ length: 8 }, () => pool.transaction((q) => nextRev(q, userId))),
    );

    expect(new Set(issued).size).toBe(8);
  });

  it('counts per user, not globally', async () => {
    const other = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google',
      subject: 'sub-2',
      email: 'b@example.com',
    });

    await pool.transaction((q) => nextRev(q, userId));
    const theirs = await pool.transaction((q) => nextRev(q, other));

    expect(theirs).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project server server/src/repositories/revisions.test.ts`
Expected: FAIL — `Cannot find module './revisions.ts'`. (If it reports 0 tests and skips, `TEST_DATABASE_URL` is unset: add it to `server/.env.local` and export it into the shell.)

- [ ] **Step 3: Write the migration**

Create `server/migrations/002_sync.sql`:

```sql
-- D2: note data on the server. Every table here is user-scoped and cascades
-- from `users`, so `DELETE FROM users WHERE id = ?` in routes/account.ts stays
-- the one statement that removes an account.

CREATE TABLE notes (
  user_id     CHAR(36)   NOT NULL,
  id          CHAR(36)   NOT NULL,
  -- The user's revision at the moment this row was last written. Pull is
  -- `WHERE user_id = ? AND rev > ?` and needs no clock comparison.
  rev         BIGINT     NOT NULL,
  -- `title` is deliberately absent: it is a derived cache of the first
  -- non-empty line of `text`, and `src/data/derive.ts` stays its only author.
  text        MEDIUMTEXT NOT NULL,
  created_at  BIGINT     NOT NULL,
  updated_at  BIGINT     NOT NULL,
  pinned      TINYINT(1) NOT NULL DEFAULT 0,
  trashed_at  BIGINT     NULL,
  archived_at BIGINT     NULL,
  -- A tombstone: `deleted = 1` rows carry an empty `text` and survive 90 days
  -- so every other device learns of the purge. Without them the next pull
  -- resurrects the note on every other device, forever.
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at  BIGINT     NULL,
  -- UTF-8 byte length of `text`, maintained on write so the quota check is a
  -- SUM over the user's own rows rather than a scan of every note body.
  byte_size   INT        NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  KEY idx_notes_user_rev (user_id, rev),
  KEY idx_notes_deleted_at (deleted, deleted_at),
  CONSTRAINT fk_notes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tag METADATA only: order, icon, collapsed. Which notes carry a tag is
-- derived locally by parseTags and is never synced.
CREATE TABLE tag_meta (
  user_id    CHAR(36)     NOT NULL,
  tag        VARCHAR(255) NOT NULL,
  rev        BIGINT       NOT NULL,
  collapsed  TINYINT(1)   NOT NULL DEFAULT 0,
  icon_key   VARCHAR(64)  NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  deleted    TINYINT(1)   NOT NULL DEFAULT 0,
  deleted_at BIGINT       NULL,
  PRIMARY KEY (user_id, tag),
  KEY idx_tag_meta_user_rev (user_id, rev),
  KEY idx_tag_meta_deleted_at (deleted, deleted_at),
  CONSTRAINT fk_tag_meta_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 4: Write the counter**

Create `server/src/repositories/revisions.ts`:

```ts
import type { Query } from '../app.ts';

interface CounterRow {
  rev_counter: number;
}

/**
 * Allocates the caller's next revision number.
 *
 * **Must be called inside a `Transaction`.** Two things depend on it: the
 * `SELECT ... FOR UPDATE` only holds its row lock for the life of a
 * transaction, and the spec requires the counter to move in the same
 * transaction as the write it stamps. Called against the pool `Query`, each
 * statement is its own transaction and two concurrent pushes are handed the
 * same number — which silently makes one device's writes invisible to the
 * other's `rev > since` pull, forever.
 *
 * `users` is keyed by `id`, not `user_id`, so the tenancy guard does not
 * derive it as user-scoped and these statements need no annotation.
 */
export async function nextRev(query: Query, userId: string): Promise<number> {
  const rows = (await query('SELECT rev_counter FROM users WHERE id = ? FOR UPDATE', [
    userId,
  ])) as CounterRow[];

  const current = rows[0]?.rev_counter;
  if (current === undefined) throw new Error(`no such user: ${userId}`);

  const next = current + 1;
  await query('UPDATE users SET rev_counter = ? WHERE id = ?', [next, userId]);
  return next;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project server server/src/repositories/revisions.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Prove the concurrency test can fail**

Temporarily drop ` FOR UPDATE` from the `SELECT` and re-run. Expected: the "never issues the same number twice" test FAILS with a set size below 8. Restore ` FOR UPDATE` and confirm it passes again. A test that cannot fail is not evidence.

- [ ] **Step 7: Run the boundary guard**

Run: `npx vitest run --project app scripts/serverBoundaries.test.ts`
Expected: PASS. Confirm the guard now derives the new tables — add a temporary `console.log(USER_SCOPED_TABLES)` if you want to see `notes` and `tag_meta` in the list, then remove it.

- [ ] **Step 8: Commit**

```bash
git add server/migrations/002_sync.sql server/src/repositories/revisions.ts server/src/repositories/revisions.test.ts
git commit -m "feat(server): add sync tables and the per-user revision counter"
```

---

### Task 2: Server sync repository — pull, push, quota, sweep

**Files:**
- Create: `server/src/repositories/sync.ts`
- Test: `server/src/repositories/sync.test.ts`

**Interfaces:**
- Consumes: `nextRev` from Task 1; `Query`, `Transaction` from `server/src/app.ts`.
- Produces:

```ts
export const QUOTA_BYTES: number;              // 10 * 1024 * 1024
export const TOMBSTONE_RETENTION_MS: number;   // 90 * 24 * 60 * 60 * 1000

export interface SyncNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
  archivedAt: number | null;
  deleted: boolean;
  rev: number;
}

export interface SyncTag {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
  deleted: boolean;
  rev: number;
}

export interface PushNote extends Omit<SyncNote, 'rev'> { baseRev: number }
export interface PushTag  extends Omit<SyncTag,  'rev'> { baseRev: number }

export interface PullResult { notes: SyncNote[]; tags: SyncTag[]; rev: number }
export interface PushResult {
  accepted: Array<{ id: string; kind: 'note' | 'tag' }>;
  conflicts: { notes: SyncNote[]; tags: SyncTag[] };
  rev: number;
}
export class QuotaExceededError extends Error {
  readonly used: number;
  readonly limit: number;
}

export function pull(query: Query, userId: string, since: number): Promise<PullResult>;
export function push(
  transaction: Transaction,
  userId: string,
  input: { notes: PushNote[]; tags: PushTag[] },
): Promise<PushResult>;
export function sweepTombstones(query: Query, userId: string, now: number): Promise<number>;
```

- [ ] **Step 1: Write the failing test**

Create `server/src/repositories/sync.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { findOrCreateUserByIdentity } from './users.ts';
import {
  pull,
  push,
  QuotaExceededError,
  QUOTA_BYTES,
  sweepTombstones,
  TOMBSTONE_RETENTION_MS,
  type PushNote,
} from './sync.ts';

const url = process.env.TEST_DATABASE_URL;

function note(overrides: Partial<PushNote> = {}): PushNote {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    text: 'hello',
    createdAt: 1000,
    updatedAt: 1000,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
    deleted: false,
    baseRev: 0,
    ...overrides,
  };
}

describe.skipIf(!url)('sync repository', () => {
  let pool: Pool;
  let alice: string;
  let bob: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');
    alice = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google', subject: 'alice', email: 'alice@example.com',
    });
    bob = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google', subject: 'bob', email: 'bob@example.com',
    });
  });

  afterAll(async () => { await pool.end(); });

  it('accepts a first push and returns it on pull', async () => {
    const result = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    expect(result.accepted).toEqual([{ id: note().id, kind: 'note' }]);

    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes).toHaveLength(1);
    expect(pulled.notes[0]!.text).toBe('hello');
    expect(pulled.notes[0]!.rev).toBe(result.rev);
  });

  it('stamps every row in one push with the same revision', async () => {
    const result = await push(pool.transaction, alice, {
      notes: [note(), note({ id: '22222222-2222-4222-8222-222222222222' })],
      tags: [{ tag: 'work', collapsed: false, iconKey: null, sortOrder: 0, deleted: false, baseRev: 0 }],
    });

    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes.map((n) => n.rev)).toEqual([result.rev, result.rev]);
    expect(pulled.tags.map((t) => t.rev)).toEqual([result.rev]);
  });

  it('returns only what changed since a revision', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ id: '22222222-2222-4222-8222-222222222222' })], tags: [],
    });

    const pulled = await pull(pool.query, alice, first.rev);
    expect(pulled.notes.map((n) => n.id)).toEqual(['22222222-2222-4222-8222-222222222222']);
  });

  it('rejects a note whose server revision has moved past baseRev', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ text: 'from device A', baseRev: first.rev })], tags: [],
    });

    // Device B still believes the note is at `first.rev`.
    const stale = await push(pool.transaction, alice, {
      notes: [note({ text: 'from device B', baseRev: first.rev })], tags: [],
    });

    expect(stale.accepted).toEqual([]);
    expect(stale.conflicts.notes).toHaveLength(1);
    expect(stale.conflicts.notes[0]!.text).toBe('from device A');

    // And the server copy is untouched by the rejected push.
    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes[0]!.text).toBe('from device A');
  });

  it('accepts a repeat push from the device that made the last write', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    const second = await push(pool.transaction, alice, {
      notes: [note({ text: 'edited', baseRev: first.rev })], tags: [],
    });

    expect(second.accepted).toHaveLength(1);
    expect(second.conflicts.notes).toEqual([]);
  });

  it('never shows one user another user’s notes', async () => {
    await push(pool.transaction, alice, { notes: [note({ text: 'alice secret' })], tags: [] });

    const pulled = await pull(pool.query, bob, 0);
    expect(pulled.notes).toEqual([]);
  });

  it('keeps a tombstone for a deleted note', async () => {
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ deleted: true, text: '', baseRev: first.rev })], tags: [],
    });

    const pulled = await pull(pool.query, alice, first.rev);
    expect(pulled.notes).toHaveLength(1);
    expect(pulled.notes[0]!.deleted).toBe(true);
    expect(pulled.notes[0]!.text).toBe('');
  });

  it('refuses a push that would exceed the quota, and writes nothing', async () => {
    const big = 'x'.repeat(QUOTA_BYTES + 1);

    await expect(
      push(pool.transaction, alice, { notes: [note({ text: big })], tags: [] }),
    ).rejects.toBeInstanceOf(QuotaExceededError);

    const pulled = await pull(pool.query, alice, 0);
    expect(pulled.notes).toEqual([]);
  });

  it('measures the quota in UTF-8 bytes, not characters', async () => {
    // Three bytes per character. A character count would let a user store
    // three times the cap in Korean or emoji.
    const text = '가'.repeat(4);
    await push(pool.transaction, alice, { notes: [note({ text })], tags: [] });

    /* tenancy-ok: reading the byte column back for one user in a test. */
    const rows = (await pool.query('SELECT byte_size FROM notes WHERE user_id = ?', [
      alice,
    ])) as Array<{ byte_size: number }>;
    expect(rows[0]!.byte_size).toBe(12);
  });

  it('sweeps tombstones older than the retention window and keeps newer ones', async () => {
    // `deleted_at` is taken from the pushed `updatedAt`, so the fixture's
    // epoch-1000 default would be 56 years old and swept on the first call.
    // Delete at a real timestamp and move the CLOCK, not the row.
    const deletedAt = Date.now();
    const first = await push(pool.transaction, alice, { notes: [note()], tags: [] });
    await push(pool.transaction, alice, {
      notes: [note({ deleted: true, text: '', updatedAt: deletedAt, baseRev: first.rev })],
      tags: [],
    });

    const kept = await sweepTombstones(pool.query, alice, deletedAt);
    expect(kept).toBe(0);
    expect((await pull(pool.query, alice, first.rev)).notes).toHaveLength(1);

    const swept = await sweepTombstones(
      pool.query,
      alice,
      deletedAt + TOMBSTONE_RETENTION_MS + 1,
    );
    expect(swept).toBe(1);
    expect((await pull(pool.query, alice, 0)).notes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project server server/src/repositories/sync.test.ts`
Expected: FAIL — `Cannot find module './sync.ts'`.

- [ ] **Step 3: Write the repository**

Create `server/src/repositories/sync.ts`:

```ts
import type { Query, Transaction } from '../app.ts';
import { nextRev } from './revisions.ts';

/** 10 MiB of note text per user. The bound on disk growth under open signup. */
export const QUOTA_BYTES = 10 * 1024 * 1024;

/** Ninety days, per the spec. A device offline longer than this may resurrect a note. */
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export interface SyncNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
  archivedAt: number | null;
  deleted: boolean;
  rev: number;
}

export interface SyncTag {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
  deleted: boolean;
  rev: number;
}

export interface PushNote extends Omit<SyncNote, 'rev'> {
  /** The `rev` this device last saw for this note. 0 means "never synced". */
  baseRev: number;
}

export interface PushTag extends Omit<SyncTag, 'rev'> {
  baseRev: number;
}

export interface PullResult {
  notes: SyncNote[];
  tags: SyncTag[];
  rev: number;
}

export interface PushResult {
  accepted: Array<{ id: string; kind: 'note' | 'tag' }>;
  conflicts: { notes: SyncNote[]; tags: SyncTag[] };
  rev: number;
}

export class QuotaExceededError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(`quota exceeded: ${used} > ${limit}`);
  }
}

interface NoteRow {
  id: string;
  text: string;
  created_at: number;
  updated_at: number;
  pinned: number;
  trashed_at: number | null;
  archived_at: number | null;
  deleted: number;
  rev: number;
}

interface TagRow {
  tag: string;
  collapsed: number;
  icon_key: string | null;
  sort_order: number;
  deleted: number;
  rev: number;
}

function toNote(row: NoteRow): SyncNote {
  return {
    id: row.id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // MySQL hands TINYINT back as a number; the wire format is a real boolean
    // so the client never has to know which.
    pinned: row.pinned === 1,
    trashedAt: row.trashed_at,
    archivedAt: row.archived_at,
    deleted: row.deleted === 1,
    rev: row.rev,
  };
}

function toTag(row: TagRow): SyncTag {
  return {
    tag: row.tag,
    collapsed: row.collapsed === 1,
    iconKey: row.icon_key,
    sortOrder: row.sort_order,
    deleted: row.deleted === 1,
    rev: row.rev,
  };
}

/** UTF-8 bytes, not characters: a character count lets three-byte scripts store 3x the cap. */
function byteSize(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export async function pull(query: Query, userId: string, since: number): Promise<PullResult> {
  const noteRows = (await query(
    `SELECT id, text, created_at, updated_at, pinned, trashed_at, archived_at, deleted, rev
       FROM notes WHERE user_id = ? AND rev > ? ORDER BY rev ASC`,
    [userId, since],
  )) as NoteRow[];

  const tagRows = (await query(
    `SELECT tag, collapsed, icon_key, sort_order, deleted, rev
       FROM tag_meta WHERE user_id = ? AND rev > ? ORDER BY rev ASC`,
    [userId, since],
  )) as TagRow[];

  const counter = (await query('SELECT rev_counter FROM users WHERE id = ?', [
    userId,
  ])) as Array<{ rev_counter: number }>;

  return {
    notes: noteRows.map(toNote),
    tags: tagRows.map(toTag),
    // The user's current counter, NOT the highest rev returned: a pull that
    // finds nothing must still advance the client's cursor, or every
    // subsequent pull re-scans the same range forever.
    rev: counter[0]?.rev_counter ?? since,
  };
}

/**
 * Applies a batch atomically.
 *
 * One revision is allocated for the whole batch and stamped on every row it
 * writes. Per-row revisions would be equally correct and eight times the
 * counter contention, for a pull granularity nobody can observe.
 *
 * Conflicts do NOT abort the batch: a stale note is skipped and returned, its
 * siblings are still written. A quota overrun DOES abort it — the transaction
 * rolls back, so a refused push leaves the account exactly as it was.
 */
export async function push(
  transaction: Transaction,
  userId: string,
  input: { notes: PushNote[]; tags: PushTag[] },
): Promise<PushResult> {
  return transaction(async (query) => {
    const accepted: PushResult['accepted'] = [];
    const conflicts: PushResult['conflicts'] = { notes: [], tags: [] };

    const existingNotes = new Map(
      (
        (await query(
          `SELECT id, text, created_at, updated_at, pinned, trashed_at, archived_at, deleted, rev
             FROM notes WHERE user_id = ?`,
          [userId],
        )) as NoteRow[]
      ).map((row) => [row.id, row]),
    );

    const existingTags = new Map(
      (
        (await query(
          `SELECT tag, collapsed, icon_key, sort_order, deleted, rev
             FROM tag_meta WHERE user_id = ?`,
          [userId],
        )) as TagRow[]
      ).map((row) => [row.tag, row]),
    );

    const writableNotes = input.notes.filter((incoming) => {
      const current = existingNotes.get(incoming.id);
      if (current !== undefined && current.rev > incoming.baseRev) {
        conflicts.notes.push(toNote(current));
        return false;
      }
      return true;
    });

    const writableTags = input.tags.filter((incoming) => {
      const current = existingTags.get(incoming.tag);
      if (current !== undefined && current.rev > incoming.baseRev) {
        conflicts.tags.push(toTag(current));
        return false;
      }
      return true;
    });

    // Quota is checked against what the account WOULD hold, before anything is
    // written: the total of every note this batch does not touch, plus every
    // note it does. Checking afterwards would mean rolling back a write that
    // has already grown the tablespace.
    const untouched = [...existingNotes.values()]
      .filter((row) => !writableNotes.some((note) => note.id === row.id))
      .filter((row) => row.deleted === 0)
      .reduce((total, row) => total + byteSize(row.text), 0);

    const incoming = writableNotes
      .filter((note) => !note.deleted)
      .reduce((total, note) => total + byteSize(note.text), 0);

    if (untouched + incoming > QUOTA_BYTES) {
      throw new QuotaExceededError(untouched + incoming, QUOTA_BYTES);
    }

    if (writableNotes.length === 0 && writableTags.length === 0) {
      const counter = (await query('SELECT rev_counter FROM users WHERE id = ?', [
        userId,
      ])) as Array<{ rev_counter: number }>;
      return { accepted, conflicts, rev: counter[0]?.rev_counter ?? 0 };
    }

    const rev = await nextRev(query, userId);

    for (const note of writableNotes) {
      // A tombstone keeps no text. Retaining the body of a purged note would
      // mean a delete that frees nothing and leaks what the user deleted.
      const text = note.deleted ? '' : note.text;

      await query(
        `INSERT INTO notes
           (user_id, id, rev, text, created_at, updated_at, pinned, trashed_at,
            archived_at, deleted, deleted_at, byte_size)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           rev = VALUES(rev), text = VALUES(text), updated_at = VALUES(updated_at),
           pinned = VALUES(pinned), trashed_at = VALUES(trashed_at),
           archived_at = VALUES(archived_at), deleted = VALUES(deleted),
           deleted_at = VALUES(deleted_at), byte_size = VALUES(byte_size)`,
        [
          userId,
          note.id,
          rev,
          text,
          note.createdAt,
          note.updatedAt,
          note.pinned ? 1 : 0,
          note.trashedAt,
          note.archivedAt,
          note.deleted ? 1 : 0,
          note.deleted ? note.updatedAt : null,
          byteSize(text),
        ],
      );

      accepted.push({ id: note.id, kind: 'note' });
    }

    for (const tag of writableTags) {
      await query(
        `INSERT INTO tag_meta
           (user_id, tag, rev, collapsed, icon_key, sort_order, deleted, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           rev = VALUES(rev), collapsed = VALUES(collapsed), icon_key = VALUES(icon_key),
           sort_order = VALUES(sort_order), deleted = VALUES(deleted),
           deleted_at = VALUES(deleted_at)`,
        [
          userId,
          tag.tag,
          rev,
          tag.collapsed ? 1 : 0,
          tag.iconKey,
          tag.sortOrder,
          tag.deleted ? 1 : 0,
          tag.deleted ? Date.now() : null,
        ],
      );

      accepted.push({ id: tag.tag, kind: 'tag' });
    }

    return { accepted, conflicts, rev };
  });
}

/**
 * Removes this user's tombstones older than the retention window.
 *
 * Opportunistic, called from `GET /sync`: a scheduled job would be a second
 * thing that must stay running on a machine where the API server itself has
 * already died from exactly that.
 *
 * Counted first, then deleted. `createPool`'s `query` normalises anything that
 * is not a row set to `[]`, so a DELETE reports no `affectedRows` through it —
 * and widening `Query` to expose them would change the one shape every
 * repository and the tenancy guard are both written against.
 */
export async function sweepTombstones(
  query: Query,
  userId: string,
  now: number,
): Promise<number> {
  const cutoff = now - TOMBSTONE_RETENTION_MS;

  const doomedNotes = (await query(
    'SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND deleted = 1 AND deleted_at < ?',
    [userId, cutoff],
  )) as Array<{ n: number }>;

  const doomedTags = (await query(
    'SELECT COUNT(*) AS n FROM tag_meta WHERE user_id = ? AND deleted = 1 AND deleted_at < ?',
    [userId, cutoff],
  )) as Array<{ n: number }>;

  await query('DELETE FROM notes WHERE user_id = ? AND deleted = 1 AND deleted_at < ?', [
    userId,
    cutoff,
  ]);
  await query('DELETE FROM tag_meta WHERE user_id = ? AND deleted = 1 AND deleted_at < ?', [
    userId,
    cutoff,
  ]);

  return Number(doomedNotes[0]?.n ?? 0) + Number(doomedTags[0]?.n ?? 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server server/src/repositories/sync.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Inject the tenancy fault**

Temporarily remove `AND user_id = ?`'s companion — change `pull`'s notes query to `WHERE rev > ?` with only `[since]` as params. Run `npx vitest run --project app scripts/serverBoundaries.test.ts` and `npx vitest run --project server server/src/repositories/sync.test.ts`.
Expected: the tenancy guard FAILS naming the line, and "never shows one user another user's notes" FAILS. Restore both and confirm green. This is the leak the guard exists to catch; prove it catches it here rather than trusting it.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/sync.ts server/src/repositories/sync.test.ts
git commit -m "feat(server): pull, push, quota and tombstone sweep"
```

---

### Task 3: Server `/sync` routes

**Files:**
- Create: `server/src/auth/authenticate.ts`
- Create: `server/src/routes/sync.ts`
- Test: `server/src/routes/sync.test.ts`
- Modify: `server/src/routes/account.ts` (use the extracted helper)
- Modify: `server/src/app.ts` (mount the routes, add the per-session rate limit)

**Interfaces:**
- Consumes: `pull`, `push`, `sweepTombstones`, `QuotaExceededError` from Task 2; `AppDeps` from `server/src/app.ts`; `cookieName`, `readCookie`, `SESSION_COOKIE` from `server/src/auth/cookies.ts`; `findSession` from `server/src/repositories/sessions.ts`.
- Produces:
  - `authenticator(deps: AppDeps): (cookieHeader: string | undefined) => Promise<string | null>`
  - `syncRoutes(deps: AppDeps): Hono`
  - Wire contract:
    - `GET /sync?since=<int>` → `200 { notes, tags, rev }` | `401 { error }`
    - `POST /sync` body `{ notes: PushNote[], tags: PushTag[] }` → `200 { accepted, conflicts, rev }` | `401` | `413 { error: 'quota', used, limit }` | `400 { error }`

- [ ] **Step 1: Write the failing test**

Create `server/src/routes/sync.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.ts';
import { cookieName, SESSION_COOKIE } from '../auth/cookies.ts';
import { migrate } from '../db/migrate.ts';
import { createPool, type Pool } from '../db/pool.ts';
import { createSession } from '../repositories/sessions.ts';
import { findOrCreateUserByIdentity } from '../repositories/users.ts';
import { QUOTA_BYTES } from '../repositories/sync.ts';

const url = process.env.TEST_DATABASE_URL;
const APP_ORIGIN = 'http://localhost:5173';

const env = {
  appOrigin: APP_ORIGIN,
  apiOrigin: 'http://localhost:8787',
  databaseUrl: url ?? '',
  googleClientId: 'id',
  googleClientSecret: 'secret',
};

describe.skipIf(!url)('/sync', () => {
  let pool: Pool;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeEach(async () => {
    pool ??= createPool(url!);
    await migrate(pool.query);
    /* tenancy-ok: test teardown truncates every row by design. */
    await pool.query('DELETE FROM users');

    app = createApp({
      env,
      query: pool.query,
      transaction: pool.transaction,
      fetch: globalThis.fetch,
      secureCookies: false,
    });

    const userId = await findOrCreateUserByIdentity(pool.transaction, {
      provider: 'google', subject: 'alice', email: 'alice@example.com',
    });
    const token = await createSession(pool.query, userId);
    cookie = `${cookieName(SESSION_COOKIE, false)}=${token}`;
  });

  afterAll(async () => { await pool.end(); });

  function request(path: string, init: RequestInit = {}): Promise<Response> {
    return app.request(path, {
      ...init,
      headers: { origin: APP_ORIGIN, cookie, 'content-type': 'application/json', ...init.headers },
    });
  }

  it('refuses an unauthenticated pull', async () => {
    const response = await app.request('/sync?since=0', { headers: { origin: APP_ORIGIN } });
    expect(response.status).toBe(401);
  });

  it('round-trips a note', async () => {
    const body = JSON.stringify({
      notes: [{
        id: '11111111-1111-4111-8111-111111111111',
        text: 'hello', createdAt: 1, updatedAt: 1, pinned: false,
        trashedAt: null, archivedAt: null, deleted: false, baseRev: 0,
      }],
      tags: [],
    });

    const pushed = await request('/sync', { method: 'POST', body });
    expect(pushed.status).toBe(200);

    const pulled = await request('/sync?since=0');
    const data = (await pulled.json()) as { notes: Array<{ text: string }> };
    expect(data.notes.map((n) => n.text)).toEqual(['hello']);
  });

  it('answers 413 when the push would exceed the quota', async () => {
    const body = JSON.stringify({
      notes: [{
        id: '11111111-1111-4111-8111-111111111111',
        text: 'x'.repeat(QUOTA_BYTES + 1), createdAt: 1, updatedAt: 1, pinned: false,
        trashedAt: null, archivedAt: null, deleted: false, baseRev: 0,
      }],
      tags: [],
    });

    const response = await request('/sync', { method: 'POST', body });
    expect(response.status).toBe(413);
    expect((await response.json()) as { error: string }).toMatchObject({ error: 'quota' });
  });

  it('rejects a malformed body with 400 rather than a 500', async () => {
    const response = await request('/sync', { method: 'POST', body: '{"notes":"nope"}' });
    expect(response.status).toBe(400);
  });

  it('treats a missing or non-numeric `since` as 0', async () => {
    const response = await request('/sync?since=banana');
    expect(response.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project server server/src/routes/sync.test.ts`
Expected: FAIL — every request 404s, because nothing is mounted at `/sync`.

- [ ] **Step 3: Extract the authenticator**

Create `server/src/auth/authenticate.ts`:

```ts
import type { AppDeps } from '../app.ts';
import { findSession } from '../repositories/sessions.ts';
import { cookieName, readCookie, SESSION_COOKIE } from './cookies.ts';

/**
 * Resolves a request's cookie header to a user id, or null.
 *
 * Extracted from `routes/account.ts` when `/sync` became the second consumer.
 * Two copies of this is how one of them ends up checking expiry and the other
 * not: every route that reads user data must resolve identity the same way.
 */
export function authenticator(deps: AppDeps): (cookieHeader: string | undefined) => Promise<string | null> {
  const name = cookieName(SESSION_COOKIE, deps.secureCookies);

  return async (cookieHeader) => {
    const token = readCookie(cookieHeader, name);
    if (token === null) return null;
    return findSession(deps.query, token);
  };
}
```

- [ ] **Step 4: Use it in `account.ts`**

In `server/src/routes/account.ts`, delete the local `authenticate` function and its now-unused `findSession`, `readCookie`, `cookieName`, `SESSION_COOKIE` imports, and replace with:

```ts
import { authenticator } from '../auth/authenticate.ts';
// ...
export function accountRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);
  // ... route bodies unchanged
```

Keep the `clearedSessionCookie` import — `DELETE /account` still uses it.

- [ ] **Step 5: Write the routes**

Create `server/src/routes/sync.ts`:

```ts
import { Hono } from 'hono';

import type { AppDeps } from '../app.ts';
import { authenticator } from '../auth/authenticate.ts';
import {
  pull,
  push,
  QuotaExceededError,
  sweepTombstones,
  type PushNote,
  type PushTag,
} from '../repositories/sync.ts';

/**
 * Shape-checks the push body.
 *
 * Not a validation library: the body has two array fields and the alternative
 * is a dependency plus a schema for a payload this file can describe in
 * fifteen lines. What matters is that a malformed body is a 400 naming the
 * problem rather than a 500 from a `.filter` on a string.
 */
function readBatch(body: unknown): { notes: PushNote[]; tags: PushTag[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const { notes, tags } = body as { notes?: unknown; tags?: unknown };
  if (!Array.isArray(notes) || !Array.isArray(tags)) return null;

  for (const note of notes) {
    if (typeof note !== 'object' || note === null) return null;
    const n = note as Partial<PushNote>;
    if (typeof n.id !== 'string' || typeof n.text !== 'string') return null;
    if (typeof n.baseRev !== 'number' || typeof n.updatedAt !== 'number') return null;
  }

  for (const tag of tags) {
    if (typeof tag !== 'object' || tag === null) return null;
    const t = tag as Partial<PushTag>;
    if (typeof t.tag !== 'string' || typeof t.baseRev !== 'number') return null;
  }

  return { notes: notes as PushNote[], tags: tags as PushTag[] };
}

export function syncRoutes(deps: AppDeps): Hono {
  const app = new Hono();
  const authenticate = authenticator(deps);

  app.get('/sync', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    // `Number('banana')` is NaN and `NaN > x` is false for every x, which would
    // silently return an empty pull forever. Coerce to a floor of 0 instead.
    const raw = Number(c.req.query('since'));
    const since = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;

    // Opportunistic, and deliberately before the read: a tombstone old enough
    // to sweep is one no live device still needs, so removing it first keeps
    // the response from carrying rows about to be deleted anyway.
    await sweepTombstones(deps.query, userId, Date.now());

    return c.json(await pull(deps.query, userId, since));
  });

  app.post('/sync', async (c) => {
    const userId = await authenticate(c.req.header('cookie'));
    if (userId === null) return c.json({ error: 'not signed in' }, 401);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'body is not JSON' }, 400);
    }

    const batch = readBatch(body);
    if (batch === null) return c.json({ error: 'expected { notes: [], tags: [] }' }, 400);

    try {
      return c.json(await push(deps.transaction, userId, batch));
    } catch (error) {
      if (error instanceof QuotaExceededError) {
        return c.json({ error: 'quota', used: error.used, limit: error.limit }, 413);
      }
      throw error;
    }
  });

  return app;
}
```

- [ ] **Step 6: Mount them**

In `server/src/app.ts`, add the import and the mount, and a per-session rate limit above the global one:

```ts
import { syncRoutes } from './routes/sync.ts';
```

```ts
  // Per-session rather than per-IP, per the spec's "per-user on /sync". The
  // session cookie is the only per-user handle available before the route
  // resolves it, and an unauthenticated caller falls back to its IP bucket —
  // which is correct, since it is about to get a 401 anyway.
  app.use(
    '/sync',
    rateLimit({
      limit: 120,
      windowMs: 60_000,
      key: (c) => c.req.header('cookie') ?? clientIp(c),
    }),
  );
```

placed immediately before the existing `app.use('*', rateLimit(...))` line, and:

```ts
  app.route('/', syncRoutes(deps));
```

immediately after `app.route('/', accountRoutes(deps));`.

Check `server/src/middleware/rateLimit.ts` for the exact `key` signature before writing this — if `key` takes something other than a Hono context, match what is there rather than what this plan guessed. A plan's usage sketch is not a signature reference.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run --project server`
Expected: PASS, including the pre-existing `account.test.ts` and `app.test.ts`.

- [ ] **Step 8: Prove the 401 path**

Temporarily change `if (userId === null) return c.json(...)` in `GET /sync` to `if (false)`. Run the suite. Expected: "refuses an unauthenticated pull" FAILS, and the round-trip test likely throws on a null user id. Restore.

- [ ] **Step 9: Commit**

```bash
git add server/src/auth/authenticate.ts server/src/routes/sync.ts server/src/routes/sync.test.ts server/src/routes/account.ts server/src/app.ts
git commit -m "feat(server): GET and POST /sync"
```

---

### Task 4: Dexie version 3, `syncState`, and the e2e seed

**Files:**
- Modify: `src/data/types.ts`
- Modify: `src/data/db.ts`
- Modify: `e2e/fixtures/seed.ts`
- Test: `src/data/db.test.ts`

**Interfaces:**
- Produces:

```ts
export type SyncKind = 'note' | 'tag';

export interface SyncState {
  kind: SyncKind;
  /** A note id when `kind` is 'note'; a tag string when 'tag'. */
  key: string;
  /** The server `rev` this row was last confirmed at. 0 means never synced. */
  syncedRev: number;
  /** 0 or 1 — IndexedDB rejects boolean keys and this one is indexed. */
  dirty: 0 | 1;
  /** 0 or 1. A row that outlives its note so the purge can still be pushed. */
  deleted: 0 | 1;
  /** `Note.updatedAt` at the moment `dirty` was last set. See Task 7. */
  markedAt: number;
}
```
  and `db.syncState` as `Table<SyncState, [SyncKind, string]>`.

- [ ] **Step 1: Write the failing test**

Append to `src/data/db.test.ts`:

```ts
it('carries a syncState table keyed by kind and key', async () => {
  const database = new BearDatabase(`test-${crypto.randomUUID()}`);
  await database.open();

  await database.syncState.put({
    kind: 'note',
    key: 'note-1',
    syncedRev: 0,
    dirty: 1,
    deleted: 0,
    markedAt: 42,
  });

  const found = await database.syncState.get(['note', 'note-1']);
  expect(found?.markedAt).toBe(42);

  // The dirty index is what the push loop queries. It must be a NUMBER:
  // IndexedDB rejects boolean keys outright, exactly as it does for `pinned`.
  const dirty = await database.syncState.where('dirty').equals(1).toArray();
  expect(dirty).toHaveLength(1);

  database.close();
});

it('declares version 3, which is IndexedDB version 30', async () => {
  // e2e/fixtures/seed.ts opens at the RAW IndexedDB number and must move with
  // this. Seeding at the wrong number leaves a connection blocking the
  // upgrade forever and the app boots to a bare <div id="root"> with no error.
  const database = new BearDatabase(`test-${crypto.randomUUID()}`);
  await database.open();
  expect(database.verno).toBe(3);
  database.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project app src/data/db.test.ts`
Expected: FAIL — `database.syncState` is undefined, and `verno` is 2.

- [ ] **Step 3: Add the type**

Append to `src/data/types.ts`:

```ts
export type SyncKind = 'note' | 'tag';

/**
 * Per-row sync bookkeeping.
 *
 * Deliberately NOT fields on `Note`: `Note` is the shape `BackupBundle`
 * serialises, so sync state added to it would leak server bookkeeping into
 * every exported backup and every import would carry another account's
 * revision numbers.
 *
 * Keyed by `[kind, key]` rather than by note id, because tag metadata syncs
 * too and a second bookkeeping table would mean a second engine.
 */
export interface SyncState {
  kind: SyncKind;
  /** A note id when `kind` is `'note'`; the tag string when `'tag'`. */
  key: string;
  /** The server revision this row was last confirmed at. 0 means never synced. */
  syncedRev: number;
  /** `0 | 1`, not boolean: this is indexed, and IndexedDB rejects boolean keys. */
  dirty: 0 | 1;
  /**
   * `0 | 1`. Set when the local row is purged, and the reason this table
   * outlives the note: once the note is gone there is nothing else left to
   * tell the server to write a tombstone.
   */
  deleted: 0 | 1;
  /**
   * The note's `updatedAt` at the moment `dirty` was last set.
   *
   * Push carries it and the accept path clears `dirty` only if the stored note
   * still matches — so an edit that lands while a push is in flight leaves the
   * row dirty and re-pushes, instead of being silently stranded on one device.
   */
  markedAt: number;
}
```

- [ ] **Step 4: Add the table**

In `src/data/db.ts`, add the import, the field, and the version:

```ts
import type {
  FileRecord, Note, NoteFolds, NoteTag, SettingRecord, SyncKind, SyncState, TagMeta,
} from './types';
```

```ts
  /**
   * Compound primary key `[kind+key]`, so this is a plain `Table` keyed by a
   * tuple — the same reason `noteTags` is, and for the same reason
   * `EntityTable` would be wrong here.
   */
  syncState!: Table<SyncState, [SyncKind, string]>;
```

```ts
    // Version 3 adds sync bookkeeping. No `.upgrade()` hook: an absent row
    // already means "never synced, not dirty", which is exactly right for a
    // database that predates sync — the first sync after signing in treats
    // every note as new, which is what adoption does anyway.
    //
    // Dexie multiplies declared versions by ten, so this is IndexedDB version
    // 30, and `e2e/fixtures/seed.ts` MUST move with it in the same commit.
    // `dirty` and `deleted` are indexed and therefore stored as 0 | 1;
    // IndexedDB rejects boolean keys.
    this.version(3).stores({
      syncState: '[kind+key], dirty, kind, deleted',
    });
```

- [ ] **Step 5: Move the e2e seed**

In `e2e/fixtures/seed.ts`, change `indexedDB.open('bear-web', 20)` to `indexedDB.open('bear-web', 30)`, add the store inside `onupgradeneeded`, and update the docblock's version arithmetic:

```ts
      // Added at version 3. Created empty here, exactly as Dexie would: an
      // absent row means "never synced, not dirty", and no fixture is signed
      // in. Key path and index names must match src/data/db.ts exactly or
      // Dexie throws SchemaError on the first shot.
      const syncState = database.createObjectStore('syncState', {
        keyPath: ['kind', 'key'],
      });
      syncState.createIndex('dirty', 'dirty');
      syncState.createIndex('kind', 'kind');
      syncState.createIndex('deleted', 'deleted');
```

and in the docblock replace "Dexie's `version(2)` (added in b1 for fold state) is IndexedDB version 20, not 2" with "Dexie's `version(3)` (added in D2 for sync bookkeeping) is IndexedDB version 30, not 3".

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project app src/data/`
Expected: PASS, including the pre-existing backup and migration tests.

- [ ] **Step 7: Prove the seed actually still boots the app**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
```
Expected: PASS. A `SchemaError` or a blank `#root` here means the seed's store definition and `db.ts` disagree — compare key paths and index names character by character. **Do not skip this step**: the unit suite cannot see it, and the failure mode is a page with no error on it at all.

- [ ] **Step 8: Commit**

```bash
git add src/data/types.ts src/data/db.ts src/data/db.test.ts e2e/fixtures/seed.ts
git commit -m "feat(data): Dexie version 3 with the syncState table"
```

---

### Task 5: Mark rows dirty inside the local write

**Files:**
- Create: `src/data/sync/markDirty.ts`
- Test: `src/data/sync/markDirty.test.ts`
- Modify: `src/data/repositories/notes.ts`
- Modify: `src/data/repositories/tags.ts`
- Modify: `src/data/repositories/index.ts`
- Modify: `src/data/backup.ts`
- Test: `src/data/repositories/notes.test.ts`, `src/data/repositories/tags.test.ts`

**Interfaces:**
- Consumes: `SyncState`, `SyncKind` from `src/data/types.ts`; `BearDatabase` from `src/data/db.ts`.
- Produces:

```ts
export function markDirty(db: BearDatabase, kind: SyncKind, key: string, markedAt: number): Promise<void>;
export function markDeleted(db: BearDatabase, kind: SyncKind, key: string, markedAt: number): Promise<void>;
export function markAllDirty(db: BearDatabase, now: number): Promise<number>;
```

- [ ] **Step 1: Write the failing test**

Create `src/data/sync/markDirty.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { BearDatabase } from '../db';
import { markAllDirty, markDeleted, markDirty } from './markDirty';

describe('markDirty', () => {
  let db: BearDatabase;

  beforeEach(async () => {
    db = new BearDatabase(`test-${crypto.randomUUID()}`);
    await db.open();
  });

  it('creates a dirty row for a note that has never synced', async () => {
    await markDirty(db, 'note', 'n1', 100);

    expect(await db.syncState.get(['note', 'n1'])).toEqual({
      kind: 'note', key: 'n1', syncedRev: 0, dirty: 1, deleted: 0, markedAt: 100,
    });
  });

  it('keeps syncedRev when re-marking an already-synced row', async () => {
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 7, dirty: 0, deleted: 0, markedAt: 1,
    });

    await markDirty(db, 'note', 'n1', 200);

    const row = await db.syncState.get(['note', 'n1']);
    // Losing this is how a re-edited note pushes with baseRev 0 and is treated
    // as brand new by a server that already holds it at rev 7 — a guaranteed
    // conflict copy on every single edit.
    expect(row?.syncedRev).toBe(7);
    expect(row?.dirty).toBe(1);
    expect(row?.markedAt).toBe(200);
  });

  it('marks a purge as deleted and dirty, and keeps the row', async () => {
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 7, dirty: 0, deleted: 0, markedAt: 1,
    });

    await markDeleted(db, 'note', 'n1', 300);

    const row = await db.syncState.get(['note', 'n1']);
    expect(row).toMatchObject({ deleted: 1, dirty: 1, syncedRev: 7 });
  });

  it('does not create a tombstone row for a note that never reached the server', async () => {
    // Nothing to tell the server about: it has never heard of this note, and a
    // tombstone for it would be a delete of something that does not exist.
    await markDirty(db, 'note', 'n1', 100);
    await markDeleted(db, 'note', 'n1', 300);

    expect(await db.syncState.get(['note', 'n1'])).toBeUndefined();
  });

  it('marks every note and tag dirty', async () => {
    await db.notes.bulkAdd([
      { id: 'n1', title: '', text: '', createdAt: 1, updatedAt: 1, pinned: false, trashedAt: null, archivedAt: null },
      { id: 'n2', title: '', text: '', createdAt: 1, updatedAt: 1, pinned: false, trashedAt: null, archivedAt: null },
    ]);
    await db.tags.add({ tag: 'work', collapsed: false, iconKey: null, sortOrder: 0 });

    expect(await markAllDirty(db, 500)).toBe(3);
    expect(await db.syncState.where('dirty').equals(1).count()).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project app src/data/sync/markDirty.test.ts`
Expected: FAIL — `Cannot find module './markDirty'`.

- [ ] **Step 3: Write the module**

Create `src/data/sync/markDirty.ts`:

```ts
import type { BearDatabase } from '../db';
import type { SyncKind } from '../types';

/**
 * Records that a row differs from the server's copy.
 *
 * Called from INSIDE the repository's own Dexie transaction, never after it.
 * A separate write would leave a window where the note is saved and nothing
 * knows it needs pushing — and a crash inside that window loses the edit from
 * every other device permanently, with the local copy looking perfectly fine.
 *
 * `syncedRev` is preserved on an existing row: it is the `baseRev` the push
 * will send, and resetting it to 0 makes the server treat a known note as new,
 * which produces a `(conflict)` copy on every edit.
 */
export async function markDirty(
  db: BearDatabase,
  kind: SyncKind,
  key: string,
  markedAt: number,
): Promise<void> {
  const existing = await db.syncState.get([kind, key]);

  await db.syncState.put({
    kind,
    key,
    syncedRev: existing?.syncedRev ?? 0,
    dirty: 1,
    deleted: 0,
    markedAt,
  });
}

/**
 * Records a local purge.
 *
 * The bookkeeping row deliberately OUTLIVES the note: once the note row is
 * gone there is nothing else left that could tell the server to write a
 * tombstone, and without a tombstone the next pull resurrects the note on
 * every other device, forever.
 *
 * A note the server never saw (`syncedRev === 0`) is the exception — there is
 * nothing to delete there, so the row is dropped rather than queued.
 */
export async function markDeleted(
  db: BearDatabase,
  kind: SyncKind,
  key: string,
  markedAt: number,
): Promise<void> {
  const existing = await db.syncState.get([kind, key]);

  if (existing === undefined || existing.syncedRev === 0) {
    await db.syncState.delete([kind, key]);
    return;
  }

  await db.syncState.put({ ...existing, dirty: 1, deleted: 1, markedAt });
}

/**
 * Marks the whole database dirty. Used by adoption and by import.
 *
 * Returns the number of rows marked, so a caller can report "N notes added to
 * your account" from the same number the engine will push.
 */
export async function markAllDirty(db: BearDatabase, now: number): Promise<number> {
  const [noteIds, tagRows] = await Promise.all([
    db.notes.toCollection().primaryKeys(),
    db.tags.toArray(),
  ]);

  for (const id of noteIds) await markDirty(db, 'note', id as string, now);
  for (const row of tagRows) await markDirty(db, 'tag', row.tag, now);

  return noteIds.length + tagRows.length;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project app src/data/sync/markDirty.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Wire it into the notes repository**

In `src/data/repositories/notes.ts`:

- add `import { markDeleted, markDirty } from '../sync/markDirty';`
- add `db.syncState` to the table list of every `db.transaction('rw', ...)` call in `create`, `save`, `setPinned`, `trash`, `restore`, `purge` and `emptyTrash`.
- call `await markDirty(db, 'note', id, timestamp)` as the last statement inside `create` and `save`'s transactions (using the same `timestamp`/`updated.updatedAt` the note was written with — **the same number**, not a second `now()` call; `markedAt` must equal the note's `updatedAt` or the accept path in Task 7 can never clear the flag).
- `setPinned`, `trash` and `restore` all change a synced field, so each must bump `updatedAt` as well and mark dirty with it. Today they do not touch `updatedAt`. Change each to compute `const timestamp = now();`, include `updatedAt: timestamp` in the `update({...})` call, and then `await markDirty(db, 'note', id, timestamp)`.
- `purge` calls `await markDeleted(db, 'note', id, now())`.
- `emptyTrash` calls `markDeleted` for each purged id.

**Why `setPinned`/`trash`/`restore` must bump `updatedAt`:** without it, pinning a note on device A changes nothing the sort order on device B can see, and worse, `markedAt` would not match the note's `updatedAt`, so the flag would never clear and the note would re-push on every single sync forever.

- [ ] **Step 6: Wire it into the tags repository**

In `src/data/repositories/tags.ts`, change `patch` to run in a transaction that also marks dirty, and `removeMeta` to mark deleted:

```ts
  async function patch(tag: string, changes: Partial<TagMeta>): Promise<void> {
    await db.transaction('rw', db.tags, db.syncState, async () => {
      const existing = (await db.tags.get(tag)) ?? defaults(tag);
      await db.tags.put({ ...existing, ...changes, tag });
      await markDirty(db, 'tag', tag, Date.now());
    });
  }
```

```ts
    async removeMeta(tag) {
      await db.transaction('rw', db.tags, db.syncState, async () => {
        await db.tags.delete(tag);
        await markDeleted(db, 'tag', tag, Date.now());
      });
    },
```

`TagMeta` has no `updatedAt`, so `markedAt` here is a wall clock rather than a mirror of a stored field. That is fine: Task 7's accept path compares `markedAt` against the stored `updatedAt` for notes only, and clears tag rows on acceptance unconditionally. Note that difference in a comment on `patch`.

- [ ] **Step 7: Mark everything dirty on import**

In `src/data/backup.ts`'s `importDatabase`, add `db.syncState` to the transaction's table list, and after the bulk writes add:

```ts
      // An imported database is entirely new to the server, whatever the
      // account already holds. Marking it dirty is what makes an import
      // reach the other devices instead of sitting locally until each note
      // happens to be edited.
      await markAllDirty(db, Date.now());
```

Also confirm `exportDatabase` does NOT read `syncState` — the bundle must stay exactly the six existing fields. Add an assertion to `src/data/backup.test.ts`:

```ts
it('never puts sync bookkeeping in the bundle', async () => {
  const bundle = await exportDatabase(db);
  expect(Object.keys(bundle)).not.toContain('syncState');
});
```

- [ ] **Step 8: Add repository tests**

In `src/data/repositories/notes.test.ts`, add:

```ts
it('marks a saved note dirty with markedAt equal to its updatedAt', async () => {
  const created = await notes.create('hello');
  const saved = await notes.save(created.id, 'hello again');

  const state = await db.syncState.get(['note', created.id]);
  // These two numbers being equal is the entire dirty-clearing mechanism: the
  // push snapshot is compared against the stored note's updatedAt on accept.
  expect(state?.markedAt).toBe(saved.updatedAt);
  expect(state?.dirty).toBe(1);
});

it('leaves a tombstone row behind when a synced note is purged', async () => {
  const created = await notes.create('hello');
  await db.syncState.put({
    kind: 'note', key: created.id, syncedRev: 5, dirty: 0, deleted: 0, markedAt: 1,
  });

  await notes.purge(created.id);

  expect(await db.notes.get(created.id)).toBeUndefined();
  expect(await db.syncState.get(['note', created.id])).toMatchObject({ deleted: 1, dirty: 1 });
});

it('bumps updatedAt when pinning, so the change can reach another device', async () => {
  const created = await notes.create('hello');
  await notes.setPinned(created.id, true);

  const after = await notes.get(created.id);
  expect(after!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
  expect((await db.syncState.get(['note', created.id]))?.markedAt).toBe(after!.updatedAt);
});
```

Follow the existing file's setup for how `db` and `notes` are constructed — do not invent a new harness.

- [ ] **Step 9: Run the whole app suite**

Run: `npx vitest run --project app`
Expected: PASS. Existing tests that assert `updatedAt` is unchanged by `setPinned`/`trash`/`restore` will now fail — those assertions were encoding "this field is untouched", and the field is now load-bearing for sync. Update them to assert the new behaviour, and note each change in the commit message. Do NOT weaken an assertion to make it pass without understanding which of the two behaviours is now correct.

- [ ] **Step 10: Commit**

```bash
git add src/data/sync/ src/data/repositories/ src/data/backup.ts src/data/backup.test.ts
git commit -m "feat(data): mark rows dirty inside the write that changes them"
```

---

### Task 6: The sync transport

**Files:**
- Create: `src/data/sync/config.ts`
- Create: `src/data/sync/transport.ts`
- Test: `src/data/sync/transport.test.ts`
- Modify: `src/features/account/api.ts` (import the origin from the data layer)
- Delete: `src/features/account/config.ts`
- Modify: `src/data/index.ts` (export the new surface)

**Interfaces:**
- Produces:

```ts
export const API_ORIGIN: string;

export interface RemoteNote { id: string; text: string; createdAt: number; updatedAt: number;
  pinned: boolean; trashedAt: number | null; archivedAt: number | null; deleted: boolean; rev: number }
export interface RemoteTag { tag: string; collapsed: boolean; iconKey: string | null;
  sortOrder: number; deleted: boolean; rev: number }
export interface PullResponse { notes: RemoteNote[]; tags: RemoteTag[]; rev: number }
export interface PushResponse {
  accepted: Array<{ id: string; kind: 'note' | 'tag' }>;
  conflicts: { notes: RemoteNote[]; tags: RemoteTag[] };
  rev: number;
}

export class SyncUnavailableError extends Error {}
export class SyncUnauthorizedError extends Error {}
export class SyncQuotaError extends Error { readonly used: number; readonly limit: number }

export interface Transport {
  pull(since: number): Promise<PullResponse>;
  push(batch: { notes: Array<Omit<RemoteNote, 'rev'> & { baseRev: number }>;
                tags: Array<Omit<RemoteTag, 'rev'> & { baseRev: number }> }): Promise<PushResponse>;
}

export function createTransport(origin?: string, doFetch?: typeof globalThis.fetch): Transport;
```

- [ ] **Step 1: Write the failing test**

Create `src/data/sync/transport.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import {
  createTransport,
  SyncQuotaError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from './transport';

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('transport', () => {
  it('sends credentials on every call', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(200, { notes: [], tags: [], rev: 0 }));
    await createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0);

    // Without this the browser sends no cookie and every call is anonymous —
    // a failure that looks exactly like being signed out.
    expect(doFetch.mock.calls[0]![1]).toMatchObject({ credentials: 'include' });
  });

  it('puts `since` in the query string', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(200, { notes: [], tags: [], rev: 9 }));
    await createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(7);

    expect(doFetch.mock.calls[0]![0]).toBe('https://api.test/sync?since=7');
  });

  it('throws SyncUnauthorizedError on 401', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(401, { error: 'not signed in' }));
    await expect(
      createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0),
    ).rejects.toBeInstanceOf(SyncUnauthorizedError);
  });

  it('throws SyncQuotaError carrying the numbers on 413', async () => {
    const doFetch = vi
      .fn()
      .mockResolvedValue(respond(413, { error: 'quota', used: 11, limit: 10 }));

    const error = await createTransport('https://api.test', doFetch as unknown as typeof fetch)
      .push({ notes: [], tags: [] })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SyncQuotaError);
    expect(error).toMatchObject({ used: 11, limit: 10 });
  });

  it('throws SyncUnavailableError when the host cannot be reached', async () => {
    const doFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(
      createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
  });

  it('throws SyncUnavailableError on a 500, not a silent empty pull', async () => {
    const doFetch = vi.fn().mockResolvedValue(respond(500, { error: 'boom' }));
    await expect(
      createTransport('https://api.test', doFetch as unknown as typeof fetch).pull(0),
    ).rejects.toBeInstanceOf(SyncUnavailableError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project app src/data/sync/transport.test.ts`
Expected: FAIL — `Cannot find module './transport'`.

- [ ] **Step 3: Move the origin into the data layer**

Create `src/data/sync/config.ts` with the exact contents of the current `src/features/account/config.ts`, and update the docblock's first line to "Where the sync service lives." (it already reads that way).

It moves because `src/data/sync/` needs it and `src/data/` must import nothing from `src/features/` — a rule `scripts/sourceLint.test.ts` enforces, and one that a relative `../features/account/config` would violate in a single hop.

Then delete `src/features/account/config.ts` and change `src/features/account/api.ts`'s first import to:

```ts
import { API_ORIGIN } from '@/data';
```

- [ ] **Step 4: Write the transport**

Create `src/data/sync/transport.ts`:

```ts
import { API_ORIGIN } from './config';

export interface RemoteNote {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
  archivedAt: number | null;
  deleted: boolean;
  rev: number;
}

export interface RemoteTag {
  tag: string;
  collapsed: boolean;
  iconKey: string | null;
  sortOrder: number;
  deleted: boolean;
  rev: number;
}

export type PushNote = Omit<RemoteNote, 'rev'> & { baseRev: number };
export type PushTag = Omit<RemoteTag, 'rev'> & { baseRev: number };

export interface PullResponse {
  notes: RemoteNote[];
  tags: RemoteTag[];
  rev: number;
}

export interface PushResponse {
  accepted: Array<{ id: string; kind: 'note' | 'tag' }>;
  conflicts: { notes: RemoteNote[]; tags: RemoteTag[] };
  rev: number;
}

/** The server could not be reached, or answered in a way nothing can act on. */
export class SyncUnavailableError extends Error {}

/** The server answered 401. The session is gone; sync must stop, not retry. */
export class SyncUnauthorizedError extends Error {}

export class SyncQuotaError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(`quota exceeded: ${used} of ${limit} bytes`);
  }
}

export interface Transport {
  pull(since: number): Promise<PullResponse>;
  push(batch: { notes: PushNote[]; tags: PushTag[] }): Promise<PushResponse>;
}

/**
 * The engine's only door to the network.
 *
 * `doFetch` is injected so the engine's tests drive a fake rather than a
 * server: a sync engine tested against a real HTTP round trip is a sync engine
 * tested once, slowly, and never at its failure paths.
 *
 * Every non-OK status becomes a typed error. A `500` returning an empty pull
 * would look exactly like "nothing changed", and the client would advance its
 * cursor past changes it never received.
 */
export function createTransport(
  origin: string = API_ORIGIN,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): Transport {
  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${origin}${path}`, { ...init, credentials: 'include' });
    } catch (cause) {
      throw new SyncUnavailableError(`cannot reach ${origin}`, { cause });
    }

    if (response.status === 401) throw new SyncUnauthorizedError('session is gone');

    if (response.status === 413) {
      const body = (await response.json()) as { used?: number; limit?: number };
      throw new SyncQuotaError(body.used ?? 0, body.limit ?? 0);
    }

    if (!response.ok) throw new SyncUnavailableError(`${path} returned ${response.status}`);

    return response.json();
  }

  return {
    async pull(since) {
      return (await call(`/sync?since=${since}`)) as PullResponse;
    },
    async push(batch) {
      return (await call('/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(batch),
      })) as PushResponse;
    },
  };
}
```

- [ ] **Step 5: Export the surface**

Add to `src/data/index.ts`:

```ts
export { API_ORIGIN } from './sync/config';
export { markAllDirty, markDeleted, markDirty } from './sync/markDirty';
export {
  createTransport,
  SyncQuotaError,
  SyncUnauthorizedError,
  SyncUnavailableError,
} from './sync/transport';
export type {
  PullResponse, PushNote, PushResponse, PushTag, RemoteNote, RemoteTag, Transport,
} from './sync/transport';
export type { SyncKind, SyncState } from './types';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project app src/data/sync/transport.test.ts src/features/account/ scripts/sourceLint.test.ts`
Expected: PASS. `sourceLint` is included deliberately: the config move is exactly the kind of change that trips a boundary, and finding out here is cheaper than at the gate.

- [ ] **Step 7: Commit**

```bash
git add src/data/sync/ src/data/index.ts src/features/account/api.ts
git rm src/features/account/config.ts
git commit -m "feat(data): typed sync transport, with the API origin in the data layer"
```

---

### Task 7: The sync engine

**Files:**
- Create: `src/data/sync/engine.ts`
- Test: `src/data/sync/engine.test.ts`
- Modify: `src/data/index.ts`

**Interfaces:**
- Consumes: `Transport` and its error types from Task 6; `markDirty` from Task 5; `BearDatabase` from Task 4; `deriveTitle` from `src/data/derive.ts`; `parseTags` from `src/data/tags/`; `newId` from `src/data/ids.ts`.
- Produces:

```ts
export const LAST_PULLED_REV_KEY = 'sync:lastPulledRev';
export const SYNCED_ACCOUNT_KEY = 'sync:accountId';

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  conflicts: number;
  rev: number;
}

export interface EngineDeps {
  db: BearDatabase;
  transport: Transport;
  parseTags: (markdown: string) => string[];
  now?: () => number;
  generateId?: () => string;
}

export function createEngine(deps: EngineDeps): {
  syncOnce(accountId: string): Promise<SyncOutcome>;
};
```

- [ ] **Step 1: Write the failing test**

Create `src/data/sync/engine.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';

import { BearDatabase } from '../db';
import { parseTags } from '../tags';
import type { PullResponse, PushResponse, Transport } from './transport';
import { createEngine, LAST_PULLED_REV_KEY, SYNCED_ACCOUNT_KEY } from './engine';

/** A transport whose two answers the test sets directly. No HTTP, no server. */
function fakeTransport(): Transport & {
  pulls: PullResponse[];
  pushed: Array<{ notes: unknown[]; tags: unknown[] }>;
  nextPull: PullResponse;
  nextPush: PushResponse;
} {
  const state = {
    pulls: [] as PullResponse[],
    pushed: [] as Array<{ notes: unknown[]; tags: unknown[] }>,
    nextPull: { notes: [], tags: [], rev: 0 } as PullResponse,
    nextPush: { accepted: [], conflicts: { notes: [], tags: [] }, rev: 0 } as PushResponse,
    async pull() {
      state.pulls.push(state.nextPull);
      return state.nextPull;
    },
    async push(batch: { notes: unknown[]; tags: unknown[] }) {
      state.pushed.push(batch);
      return state.nextPush;
    },
  };
  return state as unknown as ReturnType<typeof fakeTransport>;
}

const ACCOUNT = 'user-1';

describe('sync engine', () => {
  let db: BearDatabase;
  let transport: ReturnType<typeof fakeTransport>;

  beforeEach(async () => {
    db = new BearDatabase(`test-${crypto.randomUUID()}`);
    await db.open();
    transport = fakeTransport();
  });

  function engine(now = () => 1000, generateId = () => 'generated') {
    return createEngine({ db, transport, parseTags, now, generateId });
  }

  it('writes a pulled note into IndexedDB with a derived title', async () => {
    transport.nextPull = {
      notes: [{
        id: 'n1', text: '# Remote\nbody', createdAt: 1, updatedAt: 2, pinned: false,
        trashedAt: null, archivedAt: null, deleted: false, rev: 3,
      }],
      tags: [], rev: 3,
    };

    await engine().syncOnce(ACCOUNT);

    const note = await db.notes.get('n1');
    // deriveTitle stays the only author of `title` — the server does not store
    // it, so a divergence here can only come from this line.
    expect(note?.title).toBe('Remote');
    expect((await db.syncState.get(['note', 'n1']))?.syncedRev).toBe(3);
  });

  it('rebuilds the tag index for a pulled note', async () => {
    transport.nextPull = {
      notes: [{
        id: 'n1', text: 'about #work today', createdAt: 1, updatedAt: 2, pinned: false,
        trashedAt: null, archivedAt: null, deleted: false, rev: 3,
      }],
      tags: [], rev: 3,
    };

    await engine().syncOnce(ACCOUNT);

    // noteTags is never synced: the rebuild path stays the single authority,
    // and a pulled note must go through it like any local save.
    expect(await db.noteTags.where('noteId').equals('n1').toArray()).toEqual([
      { noteId: 'n1', tag: 'work' },
    ]);
  });

  it('applies a tombstone by purging the local note', async () => {
    await db.notes.add({
      id: 'n1', title: 'x', text: 'x', createdAt: 1, updatedAt: 1,
      pinned: false, trashedAt: null, archivedAt: null,
    });
    transport.nextPull = {
      notes: [{
        id: 'n1', text: '', createdAt: 1, updatedAt: 5, pinned: false,
        trashedAt: null, archivedAt: null, deleted: true, rev: 4,
      }],
      tags: [], rev: 4,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.notes.get('n1')).toBeUndefined();
    expect(await db.syncState.get(['note', 'n1'])).toBeUndefined();
  });

  it('does not overwrite a locally dirty note with a pulled one', async () => {
    await db.notes.add({
      id: 'n1', title: 'mine', text: 'mine', createdAt: 1, updatedAt: 9,
      pinned: false, trashedAt: null, archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 1, dirty: 1, deleted: 0, markedAt: 9,
    });
    transport.nextPull = {
      notes: [{
        id: 'n1', text: 'theirs', createdAt: 1, updatedAt: 2, pinned: false,
        trashedAt: null, archivedAt: null, deleted: false, rev: 3,
      }],
      tags: [], rev: 3,
    };

    await engine().syncOnce(ACCOUNT);

    // The push in the same run carries this note with baseRev 1; the server
    // decides. Clobbering it here would destroy the local edit before the
    // conflict rule ever ran.
    expect((await db.notes.get('n1'))?.text).toBe('mine');
  });

  it('pushes dirty notes with the revision it last saw', async () => {
    await db.notes.add({
      id: 'n1', title: 'a', text: 'a', createdAt: 1, updatedAt: 7,
      pinned: false, trashedAt: null, archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 4, dirty: 1, deleted: 0, markedAt: 7,
    });

    await engine().syncOnce(ACCOUNT);

    expect(transport.pushed[0]!.notes).toEqual([
      expect.objectContaining({ id: 'n1', text: 'a', baseRev: 4, deleted: false }),
    ]);
  });

  it('pushes a tombstone for a purged note', async () => {
    await db.syncState.put({
      kind: 'note', key: 'gone', syncedRev: 4, dirty: 1, deleted: 1, markedAt: 8,
    });

    await engine().syncOnce(ACCOUNT);

    expect(transport.pushed[0]!.notes).toEqual([
      expect.objectContaining({ id: 'gone', deleted: true, baseRev: 4 }),
    ]);
  });

  it('clears dirty on accept when the note has not changed since the push', async () => {
    await db.notes.add({
      id: 'n1', title: 'a', text: 'a', createdAt: 1, updatedAt: 7,
      pinned: false, trashedAt: null, archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 4, dirty: 1, deleted: 0, markedAt: 7,
    });
    transport.nextPush = {
      accepted: [{ id: 'n1', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.syncState.get(['note', 'n1'])).toMatchObject({ dirty: 0, syncedRev: 9 });
  });

  it('LEAVES dirty set when the note changed while the push was in flight', async () => {
    await db.notes.add({
      id: 'n1', title: 'a', text: 'a', createdAt: 1, updatedAt: 7,
      pinned: false, trashedAt: null, archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 4, dirty: 1, deleted: 0, markedAt: 7,
    });
    transport.nextPush = {
      accepted: [{ id: 'n1', kind: 'note' }],
      conflicts: { notes: [], tags: [] },
      rev: 9,
    };
    // The edit that lands mid-flight: updatedAt moves past the snapshot.
    await db.notes.update('n1', { text: 'a2', updatedAt: 8 });

    await engine().syncOnce(ACCOUNT);

    // Clearing here would strand 'a2' on this device forever — the note looks
    // saved and synced and the server never hears about it again.
    expect((await db.syncState.get(['note', 'n1']))?.dirty).toBe(1);
  });

  it('keeps the losing text as a (conflict) note and takes the server copy', async () => {
    await db.notes.add({
      id: 'n1', title: 'Mine', text: '# Mine\nlocal edit', createdAt: 1, updatedAt: 7,
      pinned: false, trashedAt: null, archivedAt: null,
    });
    await db.syncState.put({
      kind: 'note', key: 'n1', syncedRev: 4, dirty: 1, deleted: 0, markedAt: 7,
    });
    transport.nextPush = {
      accepted: [],
      conflicts: {
        notes: [{
          id: 'n1', text: '# Theirs\nremote edit', createdAt: 1, updatedAt: 8, pinned: false,
          trashedAt: null, archivedAt: null, deleted: false, rev: 6,
        }],
        tags: [],
      },
      rev: 6,
    };

    const outcome = await engine().syncOnce(ACCOUNT);

    expect(outcome.conflicts).toBe(1);
    expect((await db.notes.get('n1'))?.text).toBe('# Theirs\nremote edit');

    const copy = await db.notes.get('generated');
    expect(copy?.text).toBe('# Mine\nlocal edit');
    expect(copy?.title).toBe('Mine (conflict)');
    // The copy is a real, pushable note, not a local curiosity.
    expect((await db.syncState.get(['note', 'generated']))?.dirty).toBe(1);
  });

  it('advances the cursor and records the account', async () => {
    transport.nextPull = { notes: [], tags: [], rev: 12 };
    transport.nextPush = { accepted: [], conflicts: { notes: [], tags: [] }, rev: 12 };

    await engine().syncOnce(ACCOUNT);

    expect(await db.settings.get(LAST_PULLED_REV_KEY)).toMatchObject({ value: 12 });
    expect(await db.settings.get(SYNCED_ACCOUNT_KEY)).toMatchObject({ value: ACCOUNT });
  });

  it('resets the cursor when a different account signs in', async () => {
    await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 99 });
    await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: 'someone-else' });
    transport.nextPull = { notes: [], tags: [], rev: 3 };

    await engine().syncOnce(ACCOUNT);

    // Revisions are per-user. Carrying another account's cursor means pulling
    // `rev > 99` from a counter that is at 3 — nothing, forever, silently.
    expect(transport.pulls).toHaveLength(1);
    expect(await db.settings.get(LAST_PULLED_REV_KEY)).toMatchObject({ value: 3 });
  });

  it('syncs tag metadata both ways', async () => {
    await db.tags.add({ tag: 'work', collapsed: true, iconKey: null, sortOrder: 2 });
    await db.syncState.put({
      kind: 'tag', key: 'work', syncedRev: 0, dirty: 1, deleted: 0, markedAt: 1,
    });
    transport.nextPull = {
      notes: [],
      tags: [{ tag: 'home', collapsed: false, iconKey: 'house', sortOrder: 1, deleted: false, rev: 2 }],
      rev: 2,
    };

    await engine().syncOnce(ACCOUNT);

    expect(await db.tags.get('home')).toMatchObject({ iconKey: 'house', sortOrder: 1 });
    expect(transport.pushed[0]!.tags).toEqual([
      expect.objectContaining({ tag: 'work', collapsed: true, sortOrder: 2, baseRev: 0 }),
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --project app src/data/sync/engine.test.ts`
Expected: FAIL — `Cannot find module './engine'`.

- [ ] **Step 3: Write the engine**

Create `src/data/sync/engine.ts`:

```ts
import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { newId } from '../ids';
import type { Note, TagMeta } from '../types';
import type { PushNote, PushTag, RemoteNote, RemoteTag, Transport } from './transport';

/** The highest revision this device has applied. Reset when the account changes. */
export const LAST_PULLED_REV_KEY = 'sync:lastPulledRev';

/**
 * Which account the cursor above belongs to.
 *
 * Revision counters are per user. Reusing one account's cursor for another
 * means pulling `rev > 99` from a counter sitting at 3: nothing comes back,
 * nothing is wrong, and the second account's notes never appear.
 */
export const SYNCED_ACCOUNT_KEY = 'sync:accountId';

export interface SyncOutcome {
  pulled: number;
  pushed: number;
  conflicts: number;
  rev: number;
}

export interface EngineDeps {
  db: BearDatabase;
  transport: Transport;
  parseTags: (markdown: string) => string[];
  now?: () => number;
  generateId?: () => string;
}

function toNote(remote: RemoteNote): Note {
  return {
    id: remote.id,
    // The server stores no title. `deriveTitle` is its only author, here as
    // everywhere else.
    title: deriveTitle(remote.text),
    text: remote.text,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    pinned: remote.pinned,
    trashedAt: remote.trashedAt,
    archivedAt: remote.archivedAt,
  };
}

function toTagMeta(remote: RemoteTag): TagMeta {
  return {
    tag: remote.tag,
    collapsed: remote.collapsed,
    iconKey: remote.iconKey,
    sortOrder: remote.sortOrder,
  };
}

export function createEngine(deps: EngineDeps) {
  const { db, transport, parseTags } = deps;
  const now = deps.now ?? (() => Date.now());
  const generateId = deps.generateId ?? newId;

  /** Replaces a note's derived tag rows. Mirrors `notes.reindex` exactly. */
  async function reindex(noteId: string, text: string): Promise<void> {
    const tags = [...new Set(parseTags(text))];
    await db.noteTags.where('noteId').equals(noteId).delete();
    if (tags.length > 0) await db.noteTags.bulkPut(tags.map((tag) => ({ noteId, tag })));
  }

  async function readCursor(accountId: string): Promise<number> {
    const account = await db.settings.get(SYNCED_ACCOUNT_KEY);
    if (account?.value !== accountId) {
      await db.settings.put({ key: SYNCED_ACCOUNT_KEY, value: accountId });
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: 0 });
      return 0;
    }
    const cursor = await db.settings.get(LAST_PULLED_REV_KEY);
    return typeof cursor?.value === 'number' ? cursor.value : 0;
  }

  /**
   * Writes pulled rows locally.
   *
   * A locally dirty note is left alone: it is being pushed in this same run,
   * and the server — not this function — decides which side wins. Applying the
   * remote copy here would destroy the local edit before the conflict rule
   * ever ran, which is the one outcome the whole `(conflict)` design exists
   * to prevent.
   */
  async function applyNotes(remotes: RemoteNote[]): Promise<number> {
    let applied = 0;

    for (const remote of remotes) {
      const state = await db.syncState.get(['note', remote.id]);
      if (state?.dirty === 1) continue;

      if (remote.deleted) {
        await db.transaction(
          'rw',
          db.notes, db.noteTags, db.files, db.noteFolds, db.syncState,
          async () => {
            await db.noteTags.where('noteId').equals(remote.id).delete();
            await db.files.where('noteId').equals(remote.id).delete();
            await db.noteFolds.delete(remote.id);
            await db.notes.delete(remote.id);
            await db.syncState.delete(['note', remote.id]);
          },
        );
      } else {
        await db.transaction('rw', db.notes, db.noteTags, db.syncState, async () => {
          await db.notes.put(toNote(remote));
          await reindex(remote.id, remote.text);
          await db.syncState.put({
            kind: 'note',
            key: remote.id,
            syncedRev: remote.rev,
            dirty: 0,
            deleted: 0,
            markedAt: remote.updatedAt,
          });
        });
      }

      applied += 1;
    }

    return applied;
  }

  async function applyTags(remotes: RemoteTag[]): Promise<number> {
    let applied = 0;

    for (const remote of remotes) {
      const state = await db.syncState.get(['tag', remote.tag]);
      if (state?.dirty === 1) continue;

      await db.transaction('rw', db.tags, db.syncState, async () => {
        if (remote.deleted) {
          await db.tags.delete(remote.tag);
          await db.syncState.delete(['tag', remote.tag]);
        } else {
          await db.tags.put(toTagMeta(remote));
          await db.syncState.put({
            kind: 'tag',
            key: remote.tag,
            syncedRev: remote.rev,
            dirty: 0,
            deleted: 0,
            markedAt: now(),
          });
        }
      });

      applied += 1;
    }

    return applied;
  }

  /** Collects everything dirty, with the revision each row last saw as its `baseRev`. */
  async function collect(): Promise<{ notes: PushNote[]; tags: PushTag[]; snapshots: Map<string, number> }> {
    const dirty = await db.syncState.where('dirty').equals(1).toArray();
    const notes: PushNote[] = [];
    const tags: PushTag[] = [];
    // `markedAt` at the moment of collection, per note id. Compared against the
    // stored note on accept, so an edit landing mid-flight cannot be cleared.
    const snapshots = new Map<string, number>();

    for (const row of dirty) {
      if (row.kind === 'note') {
        snapshots.set(row.key, row.markedAt);

        if (row.deleted === 1) {
          notes.push({
            id: row.key, text: '', createdAt: 0, updatedAt: row.markedAt, pinned: false,
            trashedAt: null, archivedAt: null, deleted: true, baseRev: row.syncedRev,
          });
          continue;
        }

        const note = await db.notes.get(row.key);
        // The row and its note disagree: the note is gone but nothing recorded
        // a purge. Drop the bookkeeping rather than pushing an empty note.
        if (note === undefined) {
          await db.syncState.delete(['note', row.key]);
          continue;
        }

        notes.push({
          id: note.id, text: note.text, createdAt: note.createdAt, updatedAt: note.updatedAt,
          pinned: note.pinned, trashedAt: note.trashedAt, archivedAt: note.archivedAt,
          deleted: false, baseRev: row.syncedRev,
        });
      } else {
        if (row.deleted === 1) {
          tags.push({
            tag: row.key, collapsed: false, iconKey: null, sortOrder: 0,
            deleted: true, baseRev: row.syncedRev,
          });
          continue;
        }

        const meta = await db.tags.get(row.key);
        if (meta === undefined) {
          await db.syncState.delete(['tag', row.key]);
          continue;
        }

        tags.push({
          tag: meta.tag, collapsed: meta.collapsed, iconKey: meta.iconKey,
          sortOrder: meta.sortOrder, deleted: false, baseRev: row.syncedRev,
        });
      }
    }

    return { notes, tags, snapshots };
  }

  /**
   * Takes the server's copy and keeps the local text as a visible note.
   *
   * No dialog, no merge UI, no silent loss: the losing edit is always a real
   * note the user can open, compare and delete. This is last-write-wins
   * without last-write-wins's data loss.
   */
  async function resolveConflicts(remotes: RemoteNote[]): Promise<void> {
    for (const remote of remotes) {
      const local = await db.notes.get(remote.id);

      await db.transaction('rw', db.notes, db.noteTags, db.syncState, async () => {
        if (local !== undefined && local.text !== remote.text) {
          const copyId = generateId();
          const timestamp = now();
          const copy: Note = {
            id: copyId,
            title: `${local.title} (conflict)`,
            text: local.text,
            createdAt: timestamp,
            updatedAt: timestamp,
            pinned: false,
            trashedAt: null,
            archivedAt: null,
          };

          await db.notes.add(copy);
          await reindex(copyId, copy.text);
          // Dirty, so the copy reaches the account too. A conflict copy that
          // lives on one device is a backup the user does not have.
          await db.syncState.put({
            kind: 'note', key: copyId, syncedRev: 0, dirty: 1, deleted: 0, markedAt: timestamp,
          });
        }

        await db.notes.put(toNote(remote));
        await reindex(remote.id, remote.text);
        await db.syncState.put({
          kind: 'note', key: remote.id, syncedRev: remote.rev, dirty: 0, deleted: 0,
          markedAt: remote.updatedAt,
        });
      });
    }
  }

  return {
    /**
     * One pull, then one push. Never called on the render path.
     *
     * Pull first, deliberately: it costs one round trip to learn what the
     * server already holds, and pushing blind guarantees a conflict copy for
     * every note another device touched since this one last looked.
     */
    async syncOnce(accountId: string): Promise<SyncOutcome> {
      const since = await readCursor(accountId);

      const remote = await transport.pull(since);
      const pulled = (await applyNotes(remote.notes)) + (await applyTags(remote.tags));
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: remote.rev });

      const { notes, tags, snapshots } = await collect();
      if (notes.length === 0 && tags.length === 0) {
        return { pulled, pushed: 0, conflicts: 0, rev: remote.rev };
      }

      const result = await transport.push({ notes, tags });

      for (const item of result.accepted) {
        if (item.kind === 'tag') {
          const row = await db.syncState.get(['tag', item.id]);
          if (row?.deleted === 1) await db.syncState.delete(['tag', item.id]);
          else if (row !== undefined) {
            await db.syncState.put({ ...row, dirty: 0, syncedRev: result.rev });
          }
          continue;
        }

        const row = await db.syncState.get(['note', item.id]);
        if (row === undefined) continue;

        if (row.deleted === 1) {
          // The tombstone is on the server now; the bookkeeping row has done
          // its whole job and can go.
          await db.syncState.delete(['note', item.id]);
          continue;
        }

        const stored = await db.notes.get(item.id);
        const snapshot = snapshots.get(item.id);

        // The dirty-clearing rule. An edit that landed while the push was in
        // flight moved `updatedAt` past the snapshot; clearing here would
        // strand that edit on this device forever, looking perfectly saved.
        if (stored !== undefined && stored.updatedAt !== snapshot) {
          await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 1 });
          continue;
        }

        await db.syncState.put({ ...row, syncedRev: result.rev, dirty: 0 });
      }

      await resolveConflicts(result.conflicts.notes);
      await db.settings.put({ key: LAST_PULLED_REV_KEY, value: result.rev });

      return {
        pulled,
        pushed: result.accepted.length,
        conflicts: result.conflicts.notes.length,
        rev: result.rev,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project app src/data/sync/engine.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Inject the dirty-clearing fault**

In the accept loop, replace the `stored.updatedAt !== snapshot` guard with `if (false)`. Re-run.
Expected: "LEAVES dirty set when the note changed while the push was in flight" FAILS. Restore and confirm green. This is the decision this task exists to implement; prove the test can see it broken.

- [ ] **Step 6: Inject the conflict fault**

In `resolveConflicts`, delete the `db.notes.add(copy)` line. Re-run.
Expected: "keeps the losing text as a (conflict) note" FAILS. Restore.

- [ ] **Step 7: Export the engine**

Add to `src/data/index.ts`:

```ts
export { createEngine, LAST_PULLED_REV_KEY, SYNCED_ACCOUNT_KEY } from './sync/engine';
export type { EngineDeps, SyncOutcome } from './sync/engine';
```

- [ ] **Step 8: Commit**

```bash
git add src/data/sync/engine.ts src/data/sync/engine.test.ts src/data/index.ts
git commit -m "feat(data): the sync engine, with conflict copies and in-flight edit safety"
```

---

### Task 8: Triggers and the status indicator

**Files:**
- Create: `src/features/account/useSync.ts`
- Test: `src/features/account/useSync.test.tsx`
- Create: `src/features/account/SyncStatus.tsx`
- Test: `src/features/account/SyncStatus.test.tsx`
- Modify: `src/features/account/AccountMenu.tsx`
- Modify: `src/features/account/index.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: `createEngine`, `createTransport`, `SyncQuotaError`, `SyncUnauthorizedError`, `SyncUnavailableError`, `notes`/`db` from `@/data`; `SessionState` from `./useSession`.
- Produces:

```ts
export type SyncStatusValue = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncController {
  status: SyncStatusValue;
  /** Set only when `status` is 'error'. A translated, plain sentence. */
  message: string | null;
  lastSyncedAt: number | null;
  syncNow: () => void;
}

export function useSync(state: SessionState): SyncController;
export function SyncStatus(props: { status: SyncStatusValue; message: string | null }): ReactElement;
```

- [ ] **Step 1: Add the strings**

In `src/i18n/en.ts`, beside the existing `account.*` keys:

```ts
  'sync.idle': 'Notes are backed up',
  'sync.syncing': 'Backing up…',
  // "Offline" is the NORMAL state for a machine that sleeps. This reads as
  // information, not as a failure — a copy requirement of the spec, not
  // decoration.
  'sync.offline': 'Offline — your notes are safe on this device',
  'sync.error': 'Backup paused',
  'sync.quota': 'Your account is full. Delete some notes to back up again.',
  'sync.never': 'Not backed up yet',
```

and the Korean equivalents in `src/i18n/ko.ts`. `ko.ts` is `Record<TranslationKey, string>`, so a missing key is a compile error — never weaken the annotation to silence it.

- [ ] **Step 2: Write the failing test for the hook**

Create `src/features/account/useSync.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionState } from './useSession';
import { useSync } from './useSync';

const syncOnce = vi.fn();

vi.mock('@/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data')>()),
  createEngine: () => ({ syncOnce }),
}));

const signedIn: SessionState = {
  status: 'signedIn',
  account: { userId: 'u1', email: 'a@example.com' },
};

describe('useSync', () => {
  beforeEach(() => {
    syncOnce.mockReset().mockResolvedValue({ pulled: 0, pushed: 0, conflicts: 0, rev: 1 });
  });

  it('does not sync when signed out', async () => {
    renderHook(() => useSync({ status: 'signedOut' }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncOnce).not.toHaveBeenCalled();
  });

  it('syncs on mount when signed in', async () => {
    renderHook(() => useSync(signedIn));
    await waitFor(() => expect(syncOnce).toHaveBeenCalledWith('u1'));
  });

  it('reports offline rather than error when the server is unreachable', async () => {
    const { SyncUnavailableError } = await import('@/data');
    syncOnce.mockRejectedValue(new SyncUnavailableError('nope'));

    const { result } = renderHook(() => useSync(signedIn));
    await waitFor(() => expect(result.current.status).toBe('offline'));
    // A machine that sleeps is offline constantly. Calling that an error would
    // make the one real error state meaningless.
    expect(result.current.message).toBeNull();
  });

  it('reports a quota overrun as an error with a plain message', async () => {
    const { SyncQuotaError } = await import('@/data');
    syncOnce.mockRejectedValue(new SyncQuotaError(11, 10));

    const { result } = renderHook(() => useSync(signedIn));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.message).toBe('Your account is full. Delete some notes to back up again.');
  });

  it('stops syncing after a 401 rather than hammering the server', async () => {
    const { SyncUnauthorizedError } = await import('@/data');
    syncOnce.mockRejectedValue(new SyncUnauthorizedError('gone'));

    const { result } = renderHook(() => useSync(signedIn));
    await waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));

    act(() => result.current.syncNow());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncOnce).toHaveBeenCalledTimes(1);
  });

  it('never runs two syncs at once', async () => {
    let release: () => void = () => {};
    syncOnce.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ pulled: 0, pushed: 0, conflicts: 0, rev: 1 }); }),
    );

    const { result } = renderHook(() => useSync(signedIn));
    await waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));

    act(() => result.current.syncNow());
    act(() => result.current.syncNow());
    expect(syncOnce).toHaveBeenCalledTimes(1);

    act(() => release());
  });
});
```

Wrap `renderHook` in the app's real `I18nProvider` if the existing account tests do — check `src/features/account/AccountMenu.test.tsx` for the harness this repo actually uses. **Do not invent a provider name**: a plan's usage sketch is not a signature reference, and a previous milestone lost a task to exactly this.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project app src/features/account/useSync.test.tsx`
Expected: FAIL — `Cannot find module './useSync'`.

- [ ] **Step 4: Write the hook**

Create `src/features/account/useSync.ts`. Requirements, each with its reason:

- Build the engine once, in a `useMemo`, from `createEngine({ db, transport: createTransport(), parseTags })`. Rebuilding it per render would rebuild nothing important but churns identity through every dependency array below.
- A `runningRef` guard so two triggers cannot overlap. Two concurrent `syncOnce` calls both read the cursor before either writes it, and the second push carries stale `baseRev`s for rows the first already advanced — manufacturing conflict copies out of nothing.
- A `stoppedRef` set on `SyncUnauthorizedError`, checked before every run. A session that is gone will be gone for every retry; retrying it on every visibility change is a request loop against a machine in someone's house.
- Triggers, matching the spec exactly: on mount (after first paint — inside `useEffect`, never during render), on `visibilitychange` → `visible`, on the `online` event, and on a debounce after edits settle. For the edit trigger, reuse `useFlushTriggers`' shape rather than adding a second listener pair; a 2000 ms debounce after the last local write is enough — sync is "automatic and quiet", not immediate.
- Error mapping: `SyncUnavailableError` → `'offline'` with `message: null`; `SyncQuotaError` → `'error'` with `t('sync.quota')`; anything else → `'error'` with `t('sync.error')`; success → `'idle'` and `lastSyncedAt = Date.now()`.
- Nothing here may run on the render path.

- [ ] **Step 5: Run the hook tests to verify they pass**

Run: `npx vitest run --project app src/features/account/useSync.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Write the indicator**

Create `src/features/account/SyncStatus.tsx`: a status line reusing `AccountMenu`'s existing `Status` shape (dot + label). Export `Status` from `AccountMenu.tsx` or lift it into `SyncStatus.tsx` and import it back — do not copy the markup, since the dot's alignment rules are already written down there and two copies drift.

Every colour must be a token utility (`bg-accent`, `bg-faint`, `text-muted`); no literal hex. Give `error` the `danger` token if one exists in `src/styles/tokens.css` — check before using a name.

Add a test asserting each of the four states renders its translated string and that no literal colour appears.

- [ ] **Step 7: Mount it**

In `AccountMenu.tsx`, call `useSync(state)` and render `<SyncStatus status={sync.status} message={sync.message} />` directly under the existing account `Status` block, inside the `signedIn` branch only — a signed-out user has nothing being backed up and a "Backing up…" line would be a lie.

Update `src/features/account/index.ts` to export `useSync` and `SyncStatus`.

- [ ] **Step 8: Run the app suite and the gates**

```bash
npx vitest run --project app
npm run typecheck && npm run lint && npm run format
```
Expected: PASS. A `ko.ts` compile error here means a key was added to `en.ts` and not translated — add the translation.

- [ ] **Step 9: Commit**

```bash
git add src/features/account/ src/i18n/
git commit -m "feat(account): automatic sync triggers and the status indicator"
```

---

### Task 9: The adoption and logout dialogs

**Files:**
- Create: `src/features/account/AdoptNotesDialog.tsx`
- Test: `src/features/account/AdoptNotesDialog.test.tsx`
- Modify: `src/features/account/AccountMenu.tsx`
- Modify: `src/features/account/useSync.ts` (expose the adoption decision)
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: `markAllDirty`, `db`, `notes` from `@/data`; `ConfirmDialog` from `@/ui/ConfirmDialog`.
- Produces:

```ts
export function AdoptNotesDialog(props: {
  open: boolean;
  count: number;
  onAdopt: () => void;
  onDiscard: () => void;
}): ReactElement | null;
```

- [ ] **Step 1: Add the strings**

`src/i18n/en.ts`:

```ts
  'sync.adopt.title': 'Add your notes to this account?',
  'sync.adopt.body':
    'You have {count} notes on this device. Adding them puts a copy in your account and on your other devices. Discarding removes them from this device.',
  'sync.adopt.confirm': 'Add them',
  'sync.adopt.discard': 'Discard them',
  // The spec makes this sentence a requirement, not decoration: on a shared
  // browser the next person opens the app and reads these notes. The
  // mitigation is disclosure, so the user's choice is an informed one.
  'account.signOut.title': 'Sign out?',
  'account.signOut.body':
    'Your notes stay on this device after you sign out. Anyone using this browser can read them.',
  'account.signOut.confirm': 'Sign out',
  'account.signOut.cancel': 'Cancel',
```

plus Korean. Check how the existing i18n handles interpolation before writing `{count}` — if `useT` takes no parameters, split the sentence or add the count as a separate line rather than inventing an interpolation API.

- [ ] **Step 2: Write the failing test**

Create `src/features/account/AdoptNotesDialog.test.tsx` asserting:
- nothing renders when `open` is false;
- the count appears in the body;
- clicking "Add them" calls `onAdopt` and not `onDiscard`;
- clicking "Discard them" calls `onDiscard`;
- **Escape calls `onAdopt`, not `onDiscard`** — dismissing a dialog must never be the destructive branch. `ConfirmDialog` already focuses Cancel first for the same reason; state that reason in a comment here.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run --project app src/features/account/AdoptNotesDialog.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Write the dialog**

Build it on `ConfirmDialog` if its two buttons can carry these two meanings without the cancel path being destructive; otherwise write a sibling component in `src/features/account/`. It is a feature component, so it may use `useT` — but any new *presentation* primitive belongs in `src/ui/` and must import nothing from `@/i18n`, taking every string as a prop the way `ConfirmDialog` does.

- [ ] **Step 5: Wire adoption into the sync flow**

In `useSync`, before the first `syncOnce` for a given account:

- read `SYNCED_ACCOUNT_KEY`; if it already equals this account id, there is nothing to ask — sync normally;
- otherwise count local notes (`db.notes.count()`). Zero means nothing to adopt: record the account and sync;
- a non-zero count with a *new* account raises the dialog and **blocks the first sync until the user answers**. Syncing first would push the guest notes into the account before the user was asked, which is the silent adoption the spec rejected;
- **Add them** → `await markAllDirty(db, Date.now())`, then sync;
- **Discard them** → purge every local note through `notes` (not raw Dexie, so the tag index and folds are cleaned up too), then sync.

- [ ] **Step 6: Wire the logout dialog**

In `AccountMenu.tsx`, the "Sign out" row now opens a `ConfirmDialog` carrying `account.signOut.body` rather than calling `signOut()` directly.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run --project app src/features/account/`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/account/ src/i18n/
git commit -m "feat(account): guest adoption dialog and the sign-out disclosure"
```

---

### Task 10: End-to-end proof, live verification, and the written record

**Files:**
- Create: `e2e/sync.spec.ts`
- Create: `docs/rulings/sync.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/NEXT.md`
- Modify: `server/README.md`
- Modify: `server/.env.example`

- [ ] **Step 1: Write the end-to-end test**

Create `e2e/sync.spec.ts`. It cannot reach a real server, and it must not try: `playwright.config.ts` starts the app's preview server and nothing else. Assert what is observable without one:

- a signed-out visitor makes **no** request to the API origin at all (route-intercept `**/api.markflowing.com/**` and `**/localhost:8787/**`, assert zero hits). This is the `SESSION_HINT_KEY` gate, and D2 adds two new call sites that could each break it;
- with `bear-web:account:hasSession` seeded in `localStorage` and the API routes fulfilled with a stubbed `GET /me` and `GET /sync`, the app boots, renders three panes, and shows the sync status line in the account menu;
- with `GET /sync` fulfilled by `route.abort()`, the app still boots and the note list still works. **This is the local-first guarantee** and it is the only place in the suite that can see it broken.

- [ ] **Step 2: Run the end-to-end suite**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
```
Expected: PASS. The kill is not optional — a preview server left on 4173 silently serves the previous build, and this suite is testing a change made minutes ago.

- [ ] **Step 3: Verify against the real server, by hand**

Tests cannot see this and the previous milestone's two real bugs were both found by running the app.

```bash
# Stop the production watcher first — both bind 8787.
lsof -ti:8787 | xargs -r kill -9
npm run server:migrate  # applies 002_sync.sql; confirm it prints "applied: 002_sync.sql"
npm run server:dev:local
# in a second shell
npm run dev
```

Then, in a real browser at `http://localhost:5173`:
1. Sign in with Google. Confirm the account menu shows the address and a sync status line.
2. Write a note. Within a few seconds the status should read "Notes are backed up".
3. Open a private window, sign in as the same account, and confirm the note appears.
4. Edit the note in **both** windows without letting them sync between, then let both sync. Confirm one wins and a `(conflict)` note holds the other text. **This is the path no test drives end to end.**
5. Sign out in one window. Confirm the dialog states the notes stay on the device, and that they do.
6. In DevTools → Application → Cookies, confirm the session cookie is host-only with no `Domain=` attribute.

Record what you saw. If any step fails, that is a bug in this branch, not a note for later.

- [ ] **Step 4: Restore production**

```bash
lsof -ti:8787 | xargs -r kill -9
npm run server:dev   # production origins, the tunnel's upstream
curl -s -o /dev/null -w "%{http_code}\n" https://api.markflowing.com/me   # expect 401
```

A 502 here means the tunnel has no upstream and sign-in is down on the live site. Do not leave this step for later.

**Note the standing debt:** this is still `tsx watch`, started by hand. It does not survive a closed terminal, a reboot, or the Mini sleeping, and it has already gone down that way once. Giving it a launchd service and a non-watcher start command is not part of D2, and is the next thing worth doing after it.

- [ ] **Step 5: Write the rulings**

Create `docs/rulings/sync.md` with a `**Trigger:**` line naming the files a future change would touch — `src/data/sync/`, `syncState`, `server/src/repositories/sync.ts`, `server/src/routes/sync.ts`, `server/migrations/002_sync.sql`, `LAST_PULLED_REV_KEY`, `SYNCED_ACCOUNT_KEY` — and one bullet per constraint that no test enforces, at minimum:

- `nextRev` must be called inside a transaction, and the `SELECT ... FOR UPDATE` is what makes it safe.
- `markDirty` must run inside the repository's own Dexie transaction, never after it.
- `markedAt` must equal the note's `updatedAt`, which is why `setPinned`/`trash`/`restore` now bump it.
- `syncState` must never appear in `BackupBundle`.
- The server stores no `title`; `deriveTitle` is its only author.
- `noteTags` is never synced; the rebuild path stays the single authority.
- The cursor is per account and resets when the account changes.
- Pull applies nothing over a locally dirty row.
- A conflict copy is itself dirty, so it reaches the account.
- The tombstone bookkeeping row outlives its note deliberately.

- [ ] **Step 6: Update the index and the handoff**

In `CLAUDE.md`: add the `sync.md` row to the rulings table with its trigger; move D2 to `complete` in the status table; update the test counts to the real numbers from `npm test` and `npm run test:e2e` (run them and read the output — do not estimate); and revise the D paragraph, which currently states "no note data crosses the network yet".

In `docs/superpowers/NEXT.md`: replace the "Start here next session — D2" section with what actually shipped and what diverged, following the shape A and B used. Carry forward the debt list, minus anything D2 paid off, plus the launchd item from Step 4.

In `server/README.md` and `server/.env.example`: document `server/.env.local` and `npm run server:dev:local`, and the fact that the two servers cannot run at once because both bind 8787 against the single registered redirect URI.

- [ ] **Step 7: Run all six gates**

```bash
npm test
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
npm run lint
npm run typecheck
npm run format
npm run build
```
Expected: all six PASS. **Check exit codes, not pass counts** — an uncaught error in an editor test makes `vitest run` exit 1 with every assertion green.

- [ ] **Step 8: Commit**

```bash
git add e2e/sync.spec.ts docs/rulings/sync.md CLAUDE.md docs/superpowers/NEXT.md server/README.md server/.env.example
git commit -m "docs(d2): rulings, handoff, and the end-to-end sync proof"
```

---

## Self-review

**Spec coverage.** Revision counter → Task 1. `GET`/`POST /sync` → Tasks 2–3. Tombstones and the 90-day sweep → Tasks 2–3. Dexie version 3 and `syncState` → Task 4. What syncs and what does not (`noteTags`, `noteFolds`, `settings`, `files` all excluded) → Tasks 4 and 7. Conflict copy → Task 7. Rate limits and per-user quota → Tasks 2–3. Module boundaries (`src/data/sync/`, `src/features/account/`) → Tasks 5–8. Sync triggers → Task 8. Four-state status indicator with its tone requirement → Task 8. Guest adoption dialog → Task 9. Logout disclosure → Task 9. `DELETE /account` removing note data → covered by the `ON DELETE CASCADE` in Task 1's migration and by the existing single-statement `deleteUser`. Testing requirements (real MariaDB, fake transport, forced stale `baseRev`, multi-tenancy guard, the 4173 hazard) → Tasks 1, 2, 6, 7, 10.

**Not covered, and deliberately:** GitHub OAuth (the spec calls it a third, separate piece), and the launchd service for the API server (named debt, recorded in Task 10 Step 4 rather than folded in).

**Two known rough edges left for the implementer to settle in place**, both flagged at their step: whether `useT` supports `{count}` interpolation (Task 9 Step 1), and the exact `key` signature of `rateLimit` (Task 3 Step 6). Both are "read the real signature before writing code from a plan written from memory" — the failure mode `CLAUDE.md` already records from Task 10 of a previous milestone.
