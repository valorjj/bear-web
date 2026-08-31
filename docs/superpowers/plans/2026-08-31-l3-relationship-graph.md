# L3 Relationship Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-surface, whole-vault rendering of L2's `noteLinks` index that
shows what is central, what is isolated, and what the user keeps referring to
but never wrote.

**Architecture:** Two pure functions do the work — `buildGraph` projects the
note index and link rows into nodes and edges, `layoutGraph` runs a seeded
`d3-force` simulation to fixed positions. Everything above them is rendering:
an SVG canvas, a surface with four states, and one new piece of `AppShell`
state. The whole feature sits behind a `React.lazy` boundary so `d3-force`
never enters the main bundle.

**Tech Stack:** React 19, TypeScript 6, `d3-force` 3 (+ `@types/d3-force`),
Tailwind v4, Dexie, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-31-l3-relationship-graph-design.md`

## Global Constraints

- **Every user-facing string goes through `useT`.** Add the key to
  `src/i18n/en.ts` AND `src/i18n/ko.ts`; `ko.ts` is
  `Record<TranslationKey, string>`, so a missing translation is a compile
  error. Never weaken that annotation.
- **Every colour is a `--bear-*` token.** A literal hex or `rgb()` outside
  `src/styles/tokens.css` fails `scripts/sourceLint.test.ts`.
- **`src/lib/` may import nothing** from `src/app/`, `src/data/`,
  `src/features/` or `src/i18n/`. `src/ui/` may import nothing from
  `src/app/`, `src/data/` or `src/i18n/`. Enforced, not advisory.
- **Components reach persistence only through `src/data/index.ts`**, never a
  repository module directly.
- **`import type` for every type-only import** (`verbatimModuleSyntax`).
- **No `enum`, no parameter properties, no namespaces** (`erasableSyntaxOnly`).
- **`noUnusedLocals` and `noUnusedParameters` are on.**
- **Prettier:** 2-space, single quotes, semicolons, trailing commas, width 100.
- **The bundle ceiling is 340,000 B gzipped and must NOT be raised by this
  branch.** `main` measured **337,259 B** on 2026-08-31 — 2,741 B of headroom.
  If the guard fails, something leaked across the lazy boundary; find the leak
  rather than raising the number.
- **Gates before any commit:** `npm run typecheck`, `npm run lint`,
  `npm run format` are cheap and run every task. `npm test`, `npm run build`
  and `npm run test:e2e` run at task boundaries that say so.
- **Repetition targets FILES, never the suite:**
  `npx vitest run src/features/graph/buildGraph.test.ts`, not `npm test`.

---

### Task 1: Move title resolution into the data layer

The graph must resolve `[[title]] → note id` by exactly the rule a clicked link
pill uses. Rather than assert that two copies agree, there will be one copy.

**Files:**

- Create: `src/data/links/titleIndex.ts`
- Create: `src/data/links/titleIndex.test.ts`
- Modify: `src/data/links/index.ts`
- Modify: `src/data/index.ts`
- Modify: `src/app/resolveLinkTarget.ts`

**Interfaces:**

- Consumes: `normalizeTitle` from `./parseLinks`.
- Produces: `buildTitleIndex(index: readonly TitledNote[]) => Map<string, TitledNote>`
  and `interface TitledNote { id: string; title: string; updatedAt: number }`,
  both exported from `@/data`.

- [ ] **Step 1: Write the failing test**

`src/data/links/titleIndex.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildTitleIndex } from './titleIndex';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string, updatedAt = NOW) => ({ id, title, updatedAt });

describe('buildTitleIndex', () => {
  it('keys each note by its normalized title', () => {
    const index = buildTitleIndex([note('a', '  Alpha Note  ')]);

    expect(index.get('alpha note')?.id).toBe('a');
  });

  it('keeps the most recently updated note when titles collide', () => {
    // Not first-match: first-match happens to be right whenever the winner is
    // also first in the array, which is exactly the case a shallow test misses.
    // The newer note is deliberately LAST here, then FIRST in the next case.
    const index = buildTitleIndex([note('old', 'Duplicate', NOW - 1000), note('new', 'Duplicate', NOW)]);

    expect(index.get('duplicate')?.id).toBe('new');
  });

  it('keeps the most recently updated note when the winner comes first', () => {
    const index = buildTitleIndex([note('new', 'Duplicate', NOW), note('old', 'Duplicate', NOW - 1000)]);

    expect(index.get('duplicate')?.id).toBe('new');
  });

  it('has no entry for a title nothing carries', () => {
    expect(buildTitleIndex([note('a', 'Alpha')]).get('beta')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/data/links/titleIndex.test.ts`
Expected: FAIL — `Failed to resolve import "./titleIndex"`.

- [ ] **Step 3: Write the implementation**

`src/data/links/titleIndex.ts`:

```ts
import { normalizeTitle } from './parseLinks';

/**
 * The shape both link resolution and the graph need from a note: enough to
 * match a title and break a tie, and nothing else. Structural rather than
 * `Pick<Note, …>` so `src/data/links/` need not import the entity it indexes.
 */
export interface TitledNote {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * Normalized title → the note it means.
 *
 * More than one note can share a normalized title. The rule, from L2's spec
 * ("A link resolves by TITLE, and fails open"), is that the most recently
 * updated one wins and the pill says so by carrying no special state.
 *
 * This lives in `src/data/links/` rather than beside its first caller because
 * it derives an index — the same reasoning that puts `parseTags` in
 * `src/data/tags/`. Both `resolveLinkTarget` (a clicked pill) and
 * `buildGraph` (the L3 surface) go through it, so the picture the graph draws
 * cannot disagree with where a click actually lands. That agreement is
 * structural here; there is no second copy to test against.
 */
export function buildTitleIndex(index: readonly TitledNote[]): Map<string, TitledNote> {
  const byTitle = new Map<string, TitledNote>();

  for (const note of index) {
    const key = normalizeTitle(note.title);
    const current = byTitle.get(key);
    if (current === undefined || note.updatedAt > current.updatedAt) byTitle.set(key, note);
  }

  return byTitle;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/data/links/titleIndex.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Export it, from both barrels**

`src/data/links/index.ts` — add:

```ts
export { buildTitleIndex } from './titleIndex';
export type { TitledNote } from './titleIndex';
```

`src/data/index.ts` — extend the existing links line:

```ts
export { buildTitleIndex, findLinkRanges, normalizeTitle, parseLinks } from './links';
export type { LinkRange, TitledNote } from './links';
```

- [ ] **Step 6: Make `resolveLinkTarget` delegate**

Replace the body in `src/app/resolveLinkTarget.ts`, keeping its exported
signature exactly as it is so no caller changes:

```ts
import { buildTitleIndex, type Note } from '@/data';

/**
 * The note a `[[link]]` pill's normalized title resolves to, or `null` when
 * nothing matches.
 *
 * The tie-breaking rule itself now lives in `src/data/links/titleIndex.ts`,
 * shared with L3's graph so the picture and the click cannot disagree. This
 * stays as the app-level name for "resolve one pill", and still does not
 * re-normalize `normalizedTitle` — a caller passing a raw title matches
 * nothing, exactly as before.
 */
export function resolveLinkTarget(
  noteIndex: readonly Pick<Note, 'id' | 'title' | 'updatedAt'>[],
  normalizedTitle: string,
): Pick<Note, 'id' | 'title' | 'updatedAt'> | null {
  return buildTitleIndex(noteIndex).get(normalizedTitle) ?? null;
}
```

- [ ] **Step 7: Prove the existing suite still holds**

Run: `npx vitest run src/app/resolveLinkTarget.test.ts src/data/links/`
Expected: PASS — the pre-existing `resolveLinkTarget` tests are untouched and
must still pass against the delegating body. If any fails, the extraction
changed behaviour and is wrong.

- [ ] **Step 8: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/data/links/titleIndex.ts src/data/links/titleIndex.test.ts \
        src/data/links/index.ts src/data/index.ts src/app/resolveLinkTarget.ts
git commit -m "refactor(l3): share link title resolution through the data layer"
```

---

### Task 2: `notes.allNoteIndex()`

**Files:**

- Modify: `src/data/repositories/notes.ts`
- Modify: `src/data/repositories/notes.test.ts`

**Interfaces:**

- Consumes: `TitledNote` from Task 1.
- Produces: `notes.allNoteIndex(): Promise<TitledNote[]>`.

- [ ] **Step 1: Write the failing test**

Append to `src/data/repositories/notes.test.ts`, inside the existing top-level
`describe`:

```ts
describe('allNoteIndex', () => {
  it('returns id, title and updatedAt for active notes, and no text', async () => {
    const note = await notes.create('# Alpha\n\nbody text here');

    const index = await notes.allNoteIndex();

    expect(index).toEqual([{ id: note.id, title: note.title, updatedAt: note.updatedAt }]);
    // The projection is the point: a 2000-note vault must not pull every
    // note's markdown into memory to draw dots.
    expect(index[0]).not.toHaveProperty('text');
  });

  it('omits trashed notes', async () => {
    const kept = await notes.create('# Kept');
    const gone = await notes.create('# Gone');
    await notes.trash(gone.id);

    expect((await notes.allNoteIndex()).map((n) => n.id)).toEqual([kept.id]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/data/repositories/notes.test.ts -t allNoteIndex`
Expected: FAIL — `notes.allNoteIndex is not a function`.

- [ ] **Step 3: Declare it on the interface**

In `src/data/repositories/notes.ts`, add to `NotesRepository` directly below
`allNoteTitles`:

```ts
  /**
   * `{ id, title, updatedAt }` for every non-trashed note — what L3's graph
   * needs to place a node and what `buildTitleIndex` needs to resolve a link
   * target. Projects away `text` deliberately: the graph reads every note at
   * once, and the markdown is the only large field.
   */
  allNoteIndex(): Promise<TitledNote[]>;
```

Add `TitledNote` to the existing type import from `../links`:

```ts
import { buildTitleIndex, normalizeTitle, type TitledNote } from '../links';
```

(If `buildTitleIndex` is not otherwise used in this file, import only
`normalizeTitle` and the type — `noUnusedLocals` will tell you.)

- [ ] **Step 4: Implement it**

Beside `allNoteTitles` in the returned object:

```ts
    async allNoteIndex() {
      const all = await db.notes.toArray();
      return all
        .filter((n) => n.trashedAt === null)
        .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));
    },
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/data/repositories/notes.test.ts -t allNoteIndex`
Expected: PASS, 2 tests.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/data/repositories/notes.ts src/data/repositories/notes.test.ts
git commit -m "feat(l3): add notes.allNoteIndex for the graph projection"
```

---

### Task 3: `buildGraph` — the projection

**Files:**

- Create: `src/features/graph/buildGraph.ts`
- Create: `src/features/graph/buildGraph.test.ts`

**Interfaces:**

- Consumes: `buildTitleIndex`, `normalizeTitle`, `TitledNote`, `NoteLink` from `@/data`.
- Produces:

```ts
export const GHOST_PREFIX = 'ghost:';
export interface GraphNode { id: string; title: string; kind: 'note' | 'ghost'; degree: number }
export interface GraphEdge { source: string; target: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
export function buildGraph(index: readonly TitledNote[], rows: readonly NoteLink[]): Graph
```

- [ ] **Step 1: Write the failing test**

`src/features/graph/buildGraph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildGraph, GHOST_PREFIX } from './buildGraph';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string, updatedAt = NOW) => ({ id, title, updatedAt });

describe('buildGraph', () => {
  it('makes one node per active note, degree zero, when nothing links', () => {
    const graph = buildGraph([note('a', 'Alpha'), note('b', 'Beta')], []);

    expect(graph.nodes).toEqual([
      { id: 'a', title: 'Alpha', kind: 'note', degree: 0 },
      { id: 'b', title: 'Beta', kind: 'note', degree: 0 },
    ]);
    expect(graph.edges).toEqual([]);
  });

  it('joins a link row to the note its title resolves to', () => {
    const graph = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [{ noteId: 'a', toTitle: 'beta' }],
    );

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(graph.nodes.map((n) => n.degree)).toEqual([1, 1]);
  });

  it('mints a ghost node for a link no note answers', () => {
    const graph = buildGraph([note('a', 'Alpha')], [{ noteId: 'a', toTitle: 'kafka rebalancing' }]);

    expect(graph.nodes).toContainEqual({
      id: `${GHOST_PREFIX}kafka rebalancing`,
      title: 'kafka rebalancing',
      kind: 'ghost',
      degree: 1,
    });
  });

  it('collapses repeated links between the same pair into one edge', () => {
    // Two [[Beta]] mentions in one note, plus Beta linking back: one edge,
    // degree 1 each. Counting mentions would make the hub sizing a lie.
    const graph = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [
        { noteId: 'a', toTitle: 'beta' },
        { noteId: 'a', toTitle: 'beta' },
        { noteId: 'b', toTitle: 'alpha' },
      ],
    );

    expect(graph.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(graph.nodes.map((n) => n.degree)).toEqual([1, 1]);
  });

  it('drops a note that links to itself', () => {
    const graph = buildGraph([note('a', 'Alpha')], [{ noteId: 'a', toTitle: 'alpha' }]);

    expect(graph.edges).toEqual([]);
    expect(graph.nodes[0]!.degree).toBe(0);
  });

  it('drops a row whose source note is not in the index', () => {
    const graph = buildGraph([note('a', 'Alpha')], [{ noteId: 'trashed', toTitle: 'alpha' }]);

    expect(graph.edges).toEqual([]);
  });

  it('resolves a colliding title to the most recently updated note', () => {
    const graph = buildGraph(
      [note('src', 'Source'), note('old', 'Dup', NOW - 1000), note('new', 'Dup', NOW)],
      [{ noteId: 'src', toTitle: 'dup' }],
    );

    expect(graph.edges).toEqual([{ source: 'new', target: 'src' }]);
  });

  it('never emits an edge naming a node that does not exist', () => {
    // Load-bearing, not tidiness: forceLink THROWS on an unknown id, so a
    // ghost-minting bug would take the surface down rather than draw wrongly.
    const graph = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [
        { noteId: 'a', toTitle: 'beta' },
        { noteId: 'b', toTitle: 'nowhere' },
        { noteId: 'ghosted', toTitle: 'alpha' },
      ],
    );

    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(ids.has(edge.source), `source ${edge.source}`).toBe(true);
      expect(ids.has(edge.target), `target ${edge.target}`).toBe(true);
    }
  });

  it('orders nodes and edges independently of input order', () => {
    // Determinism starts HERE, not in layoutGraph: d3 seeds initial positions
    // from array index, so a Dexie ordering change would otherwise reshuffle
    // the whole picture with no code change behind it.
    const forward = buildGraph(
      [note('a', 'Alpha'), note('b', 'Beta')],
      [{ noteId: 'a', toTitle: 'beta' }],
    );
    const reversed = buildGraph(
      [note('b', 'Beta'), note('a', 'Alpha')],
      [{ noteId: 'a', toTitle: 'beta' }],
    );

    expect(reversed).toEqual(forward);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/graph/buildGraph.test.ts`
Expected: FAIL — cannot resolve `./buildGraph`.

- [ ] **Step 3: Write the implementation**

`src/features/graph/buildGraph.ts`:

```ts
import { buildTitleIndex, normalizeTitle, type NoteLink, type TitledNote } from '@/data';

/** Prefixes a ghost node's id, so it can never collide with a note id. */
export const GHOST_PREFIX = 'ghost:';

export interface GraphNode {
  /** A note id, or `ghost:<normalized title>`. */
  id: string;
  /** What the label shows: the note's own title, or the unresolved link text. */
  title: string;
  kind: 'note' | 'ghost';
  /** Distinct neighbours. Sizes the node; see `nodeRadius`. */
  degree: number;
}

export interface GraphEdge {
  /** Normalized so `source <= target`, which is what makes dedup possible. */
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The whole vault as an undirected graph: one node per active note, one ghost
 * node per `[[link]]` nothing answers, one edge per distinct pair.
 *
 * Three properties this guarantees, each with a test and a reason:
 *
 * - **Every edge endpoint exists as a node.** `forceLink` throws on an id it
 *   cannot find, so violating this takes the surface down rather than drawing
 *   it wrongly.
 * - **Output order does not depend on input order.** `d3-force` seeds initial
 *   positions from array index, so ordering IS layout. Sorting here is what
 *   lets `npm run shots` screenshot a stable picture.
 * - **Edges are distinct pairs, not mentions.** Three `[[Beta]]`s in one note
 *   is one relationship; counting them would make hub sizing a lie.
 *
 * Direction is discarded deliberately (see the spec): arrowheads at 1000 nodes
 * are unreadable until zoomed far enough in that the overview is gone.
 */
export function buildGraph(index: readonly TitledNote[], rows: readonly NoteLink[]): Graph {
  const byTitle = buildTitleIndex(index);
  const nodes = new Map<string, GraphNode>();

  for (const note of index) {
    nodes.set(note.id, { id: note.id, title: note.title, kind: 'note', degree: 0 });
  }

  const seen = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const row of rows) {
    // A row whose source is absent means the index is momentarily ahead of the
    // notes table (a trash mid-read). Skip rather than mint a node for it.
    if (!nodes.has(row.noteId)) continue;

    const key = normalizeTitle(row.toTitle);
    const resolved = byTitle.get(key);
    let targetId: string;

    if (resolved === undefined) {
      targetId = `${GHOST_PREFIX}${key}`;
      if (!nodes.has(targetId)) {
        nodes.set(targetId, { id: targetId, title: key, kind: 'ghost', degree: 0 });
      }
    } else {
      targetId = resolved.id;
    }

    if (targetId === row.noteId) continue;

    const [source, target] = row.noteId < targetId ? [row.noteId, targetId] : [targetId, row.noteId];
    // `\u0000` and not a space: a ghost id is `ghost:<title>` and titles
    // contain spaces, so a space separator makes `ghost:a` + `b c` and
    // `ghost:a b` + `c` the same key — two distinct pairs silently
    // collapsing into one edge. NUL cannot appear in either id.
    const pair = `${source}\u0000${target}`;
    if (seen.has(pair)) continue;

    seen.add(pair);
    edges.push({ source, target });
    nodes.get(source)!.degree += 1;
    nodes.get(target)!.degree += 1;
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    edges: edges.sort((a, b) =>
      a.source === b.source
        ? a.target < b.target
          ? -1
          : a.target > b.target
            ? 1
            : 0
        : a.source < b.source
          ? -1
          : 1,
    ),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/features/graph/buildGraph.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/graph/buildGraph.ts src/features/graph/buildGraph.test.ts
git commit -m "feat(l3): project notes and links into an undirected graph"
```

---

### Task 4: `layoutGraph` — the seeded simulation

**Files:**

- Create: `src/features/graph/nodeRadius.ts`
- Create: `src/features/graph/layoutGraph.ts`
- Create: `src/features/graph/layoutGraph.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `Graph`, `GraphNode` from Task 3.
- Produces: `layoutGraph(graph: Graph) => Map<string, Point>`,
  `interface Point { x: number; y: number }`,
  `nodeRadius(degree: number) => number`, `LAYOUT_TICKS`.

- [ ] **Step 1: Add the dependency**

```bash
npm i d3-force@^3
npm i -D @types/d3-force@^3
```

`d3-force` ships **no** type declarations of its own — `@types/d3-force` is
required or `npm run typecheck` fails on the import.

- [ ] **Step 2: Write the failing test**

`src/features/graph/layoutGraph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildGraph } from './buildGraph';
import { layoutGraph } from './layoutGraph';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

function fixture() {
  const index = Array.from({ length: 40 }, (_, i) => note(`n${String(i).padStart(2, '0')}`, `N${i}`));
  const rows = Array.from({ length: 60 }, (_, i) => ({
    noteId: `n${String(i % 40).padStart(2, '0')}`,
    toTitle: `n${(i * 7 + 3) % 40}`,
  }));
  return buildGraph(index, rows);
}

const fingerprint = (positions: Map<string, { x: number; y: number }>) =>
  [...positions].map(([id, p]) => `${id}:${p.x.toFixed(6)},${p.y.toFixed(6)}`).join('|');

describe('layoutGraph', () => {
  it('lays the same graph out identically every time', () => {
    // This is what makes the graph screenshottable by `npm run shots`, which
    // is the only thing in this repo that can see "renders wrong". d3-force's
    // only randomness is jiggle(); randomSource() replaces it for every force
    // the simulation owns.
    expect(fingerprint(layoutGraph(fixture()))).toBe(fingerprint(layoutGraph(fixture())));
  });

  it('gives every node a finite coordinate', () => {
    // A NaN position renders as an invisible node with NO error and NO crash —
    // the same silent shape as parseColour's NaN and an unmapped .hljs-* class.
    // It passes every assertion that is not this one.
    for (const [id, point] of layoutGraph(fixture())) {
      expect(Number.isFinite(point.x), `${id}.x`).toBe(true);
      expect(Number.isFinite(point.y), `${id}.y`).toBe(true);
    }
  });

  it('separates two nodes that would otherwise start coincident', () => {
    const graph = buildGraph([note('a', 'A'), note('b', 'B')], [{ noteId: 'a', toTitle: 'b' }]);

    const positions = layoutGraph(graph);
    const a = positions.get('a')!;
    const b = positions.get('b')!;

    expect(Number.isFinite(a.x) && Number.isFinite(b.x)).toBe(true);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
  });

  it('places every node of an edgeless graph', () => {
    const graph = buildGraph([note('a', 'A'), note('b', 'B'), note('c', 'C')], []);

    expect(layoutGraph(graph).size).toBe(3);
  });

  it('does not throw on a graph containing ghost nodes', () => {
    const graph = buildGraph([note('a', 'A')], [{ noteId: 'a', toTitle: 'nowhere at all' }]);

    expect(() => layoutGraph(graph)).not.toThrow();
    expect(layoutGraph(graph).size).toBe(2);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/features/graph/layoutGraph.test.ts`
Expected: FAIL — cannot resolve `./layoutGraph`.

- [ ] **Step 4: Write `nodeRadius`**

`src/features/graph/nodeRadius.ts`:

```ts
export const MIN_RADIUS = 3;
export const MAX_RADIUS = 14;

/**
 * A node's drawn radius, from its degree.
 *
 * `√degree`, so AREA scales with degree rather than radius — a linear radius
 * turns a 14-link hub into a blob that eats its own neighbourhood.
 *
 * Shared by `layoutGraph` (as the collision radius) and `GraphCanvas` (as the
 * drawn one) on purpose: if they disagree, nodes either overlap or float in
 * gaps the size of the difference.
 */
export function nodeRadius(degree: number): number {
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(degree) * 2.2);
}
```

- [ ] **Step 5: Write `layoutGraph`**

`src/features/graph/layoutGraph.ts`:

```ts
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';

import type { Graph } from './buildGraph';
import { nodeRadius } from './nodeRadius';

export interface Point {
  x: number;
  y: number;
}

/** Enough for the layout to settle at every size in the supported range. */
export const LAYOUT_TICKS = 300;

/**
 * Fixed, arbitrary, and the reason two runs agree. Changing it reshuffles
 * every user's graph, so treat it as a constant with a user-visible effect.
 */
const SEED = 0x5eed;

interface SimNode extends SimulationNodeDatum {
  id: string;
  radius: number;
}

/**
 * A linear congruential generator, standing in for `Math.random`.
 *
 * `d3-force`'s only randomness is `jiggle()` — `(random() - 0.5) * 1e-6`,
 * applied by `forceLink` and `forceCollide` when two nodes coincide exactly.
 * `simulation.randomSource()` replaces the source for every force the
 * simulation owns, and initial placement is phyllotaxis, already
 * deterministic. Those two facts together are what make the output stable.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Settle `graph` to fixed positions, centred on the origin.
 *
 * Pure and synchronous: no React, no DOM, no `Worker`. That is deliberate —
 * jsdom has no `Worker` at all, so a worker-only design would push the only
 * part of L3 with real math in it into Playwright. `runLayout` decides where
 * this runs; this function only knows how.
 */
export function layoutGraph(graph: Graph): Map<string, Point> {
  const nodes: SimNode[] = graph.nodes.map((node) => ({
    id: node.id,
    radius: nodeRadius(node.degree),
  }));
  const links = graph.edges.map((edge) => ({ source: edge.source, target: edge.target }));

  const simulation = forceSimulation(nodes)
    .randomSource(seededRandom(SEED))
    .force(
      'link',
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((node) => node.id)
        .distance(40),
    )
    .force('charge', forceManyBody().strength(-120))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide<SimNode>().radius((node) => node.radius + 2),
    )
    .stop();

  for (let i = 0; i < LAYOUT_TICKS; i += 1) simulation.tick();

  return new Map(nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
}
```

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run src/features/graph/layoutGraph.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add package.json package-lock.json src/features/graph/
git commit -m "feat(l3): settle the graph with a seeded d3-force simulation"
```

---

### Task 5: `runLayout` — the worker, and the threshold

**Files:**

- Create: `src/features/graph/layoutWorker.ts`
- Create: `src/features/graph/runLayout.ts`
- Create: `src/features/graph/runLayout.test.ts`

**Interfaces:**

- Consumes: `layoutGraph`, `Point` from Task 4; `Graph` from Task 3.
- Produces: `runLayout(graph: Graph) => Promise<Map<string, Point>>`,
  `WORKER_THRESHOLD`.

- [ ] **Step 1: Write the failing test**

`src/features/graph/runLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildGraph } from './buildGraph';
import { layoutGraph } from './layoutGraph';
import { runLayout, WORKER_THRESHOLD } from './runLayout';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

describe('runLayout', () => {
  it('matches layoutGraph exactly below the worker threshold', async () => {
    const graph = buildGraph([note('a', 'A'), note('b', 'B')], [{ noteId: 'a', toTitle: 'b' }]);

    expect([...(await runLayout(graph))]).toEqual([...layoutGraph(graph)]);
  });

  it('falls back to the synchronous path when no Worker exists', async () => {
    // jsdom has no `Worker` at all, so this IS the environment the fallback
    // exists for — and it is why every unit test here exercises the
    // synchronous half. The worker path belongs to e2e/graph.spec.ts.
    const index = Array.from({ length: WORKER_THRESHOLD + 5 }, (_, i) =>
      note(`n${String(i).padStart(4, '0')}`, `N${i}`),
    );
    const graph = buildGraph(index, []);

    const positions = await runLayout(graph);

    expect(positions.size).toBe(graph.nodes.length);
    for (const point of positions.values()) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/graph/runLayout.test.ts`
Expected: FAIL — cannot resolve `./runLayout`.

- [ ] **Step 3: Write the worker**

`src/features/graph/layoutWorker.ts`:

```ts
import type { Graph } from './buildGraph';
import { layoutGraph } from './layoutGraph';

/**
 * Typed by hand rather than with `/// <reference lib="webworker" />`.
 *
 * `tsconfig.app.json` sets `lib: ["ES2023", "DOM"]`, and pulling in the
 * WebWorker lib alongside DOM redeclares a pile of globals. The same reasoning
 * put a hand-written `MediaQueryList` shape in `vitest.setup.ts`: declare the
 * narrow surface actually used, rather than importing a conflicting world.
 */
const ctx = self as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<Graph>) => void): void;
};

ctx.addEventListener('message', (event) => {
  // A Map is structured-cloneable, but an array of entries survives every
  // transport and is what `runLayout` reassembles.
  ctx.postMessage([...layoutGraph(event.data)]);
});
```

- [ ] **Step 4: Write the runner**

`src/features/graph/runLayout.ts`:

```ts
import type { Graph } from './buildGraph';
import { layoutGraph, type Point } from './layoutGraph';

/**
 * Above this many nodes the simulation moves off the main thread.
 *
 * Measured on this machine on 2026-08-31, median of 5 runs at 300 ticks:
 * 200 nodes 121 ms, 300 nodes 202 ms, **400 nodes 262 ms**, 500 nodes 339 ms,
 * 800 nodes 581 ms. 400 is the last size whose settle stays inside the
 * ~250-300 ms a user reads as "instant" rather than "stalled". Those figures
 * are from Node and measure the simulation alone; in the browser the same
 * ticks compete with paint, so treat them as a floor.
 */
export const WORKER_THRESHOLD = 400;

function layoutInWorker(graph: Graph): Promise<Map<string, Point>> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      // Vite resolves `?worker` at build time into a separate chunk. `types:
      // ["vite/client"]` in tsconfig.app.json is what makes this typecheck.
      worker = new LayoutWorker();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    worker.addEventListener('message', (event: MessageEvent<[string, Point][]>) => {
      resolve(new Map(event.data));
      worker.terminate();
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(new Error(event.message));
    });

    worker.postMessage(graph);
  });
}

/**
 * Settle `graph`, on the main thread or in a worker depending on its size.
 *
 * A worker that will not start — no `Worker` global under jsdom, a blocked
 * chunk, a CSP — falls back to the synchronous path rather than surfacing an
 * error. The fallback runs the SAME function, so the only cost is a frozen
 * second; an error dialog would be a worse trade for the user than a pause.
 */
export async function runLayout(graph: Graph): Promise<Map<string, Point>> {
  if (graph.nodes.length < WORKER_THRESHOLD || typeof Worker === 'undefined') {
    return layoutGraph(graph);
  }

  try {
    return await layoutInWorker(graph);
  } catch {
    return layoutGraph(graph);
  }
}
```

Add the worker import at the top of the file, above the other imports:

```ts
import LayoutWorker from './layoutWorker?worker';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run src/features/graph/runLayout.test.ts`
Expected: PASS, 2 tests.

If the `?worker` import breaks the Vitest run, the import is being evaluated in
jsdom where Vite's worker plugin is still active — it should resolve fine. If
it does not, move the `import` inside `layoutInWorker` as a dynamic
`await import('./layoutWorker?worker')` and keep everything else identical.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/graph/layoutWorker.ts src/features/graph/runLayout.ts \
        src/features/graph/runLayout.test.ts
git commit -m "feat(l3): run large layouts in a worker, with a sync fallback"
```

---

### Task 6: `usePanZoom` — pan and zoom, with testable math

**Files:**

- Create: `src/lib/panZoom.ts`
- Create: `src/lib/panZoom.test.ts`
- Create: `src/lib/usePanZoom.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks. `src/lib/` may import **nothing** from
  `src/app/`, `src/data/`, `src/features/` or `src/i18n/`.
- Produces:

```ts
export interface Viewport { x: number; y: number; scale: number }
export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;
export function clampScale(scale: number): number
export function zoomAt(viewport: Viewport, factor: number, px: number, py: number): Viewport
export function panBy(viewport: Viewport, dx: number, dy: number): Viewport
export function usePanZoom(initial: Viewport): { viewport: Viewport; ... }
```

- [ ] **Step 1: Write the failing test**

`src/lib/panZoom.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { clampScale, MAX_SCALE, MIN_SCALE, panBy, zoomAt } from './panZoom';

describe('clampScale', () => {
  it('holds the scale inside its bounds', () => {
    expect(clampScale(1000)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(1.5)).toBe(1.5);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    // The whole correctness condition for wheel zoom, and the one thing that
    // is obviously wrong on screen when it is wrong: the graph slides away
    // from the pointer.
    const before = { x: 0, y: 0, scale: 1 };
    const after = zoomAt(before, 2, 100, 50);

    const worldBefore = { x: (100 - before.x) / before.scale, y: (50 - before.y) / before.scale };
    const worldAfter = { x: (100 - after.x) / after.scale, y: (50 - after.y) / after.scale };

    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 9);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 9);
  });

  it('does not drift the origin when the scale is already clamped', () => {
    const at = { x: 10, y: 20, scale: MAX_SCALE };

    expect(zoomAt(at, 4, 100, 50)).toEqual(at);
  });
});

describe('panBy', () => {
  it('translates without touching the scale', () => {
    expect(panBy({ x: 5, y: 5, scale: 2 }, 10, -3)).toEqual({ x: 15, y: 2, scale: 2 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/lib/panZoom.test.ts`
Expected: FAIL — cannot resolve `./panZoom`.

- [ ] **Step 3: Write the pure module**

`src/lib/panZoom.ts`:

```ts
export interface Viewport {
  /** Screen-space translation applied before `scale`. */
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zoom by `factor` about the screen point (`px`, `py`), which stays fixed.
 *
 * Separated from the hook because this is the only part with a correctness
 * condition worth asserting, and jsdom cannot drive the pointer path at all —
 * it has no `setPointerCapture`, so the drag belongs in Playwright.
 */
export function zoomAt(viewport: Viewport, factor: number, px: number, py: number): Viewport {
  const scale = clampScale(viewport.scale * factor);
  if (scale === viewport.scale) return viewport;

  const ratio = scale / viewport.scale;
  return {
    x: px - (px - viewport.x) * ratio,
    y: py - (py - viewport.y) * ratio,
    scale,
  };
}

export function panBy(viewport: Viewport, dx: number, dy: number): Viewport {
  return { x: viewport.x + dx, y: viewport.y + dy, scale: viewport.scale };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/lib/panZoom.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the hook**

`src/lib/usePanZoom.ts`:

```ts
import { useCallback, useRef, useState } from 'react';

import { panBy, type Viewport, zoomAt } from './panZoom';

export interface PanZoom {
  viewport: Viewport;
  onPointerDown: (event: React.PointerEvent<Element>) => void;
  onPointerMove: (event: React.PointerEvent<Element>) => void;
  onPointerUp: (event: React.PointerEvent<Element>) => void;
  onWheel: (event: React.WheelEvent<Element>) => void;
  zoomBy: (factor: number) => void;
  reset: () => void;
}

/**
 * Drag to pan, wheel to zoom, over any element.
 *
 * Lives in `src/lib/` rather than beside the graph because it holds no product
 * knowledge — it is behaviour, like `useFlushTriggers` and `useAnchoredMenu`.
 * That directory may import nothing from `src/app/`, `src/data/`,
 * `src/features/` or `src/i18n/`, and this does not.
 */
export function usePanZoom(initial: Viewport): PanZoom {
  const [viewport, setViewport] = useState<Viewport>(initial);
  const dragging = useRef<{ id: number; x: number; y: number } | null>(null);

  const onPointerDown = useCallback((event: React.PointerEvent<Element>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<Element>) => {
    const drag = dragging.current;
    if (drag === null || drag.id !== event.pointerId) return;

    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragging.current = { id: drag.id, x: event.clientX, y: event.clientY };
    setViewport((current) => panBy(current, dx, dy));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent<Element>) => {
    if (dragging.current?.id !== event.pointerId) return;
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onWheel = useCallback((event: React.WheelEvent<Element>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = Math.exp(-event.deltaY * 0.002);
    setViewport((current) =>
      zoomAt(current, factor, event.clientX - rect.left, event.clientY - rect.top),
    );
  }, []);

  const zoomBy = useCallback((factor: number) => {
    setViewport((current) => zoomAt(current, factor, 0, 0));
  }, []);

  const reset = useCallback(() => setViewport(initial), [initial]);

  return { viewport, onPointerDown, onPointerMove, onPointerUp, onWheel, zoomBy, reset };
}
```

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/lib/panZoom.ts src/lib/panZoom.test.ts src/lib/usePanZoom.ts
git commit -m "feat(l3): add pan/zoom behaviour with the transform math split out"
```

---

### Task 7: `GraphCanvas` — the SVG

**Files:**

- Create: `src/features/graph/GraphCanvas.tsx`
- Create: `src/features/graph/graphCanvas.test.tsx`
- Modify: `src/styles/tokens.css` (two tokens), `src/styles/index.css` (their Tailwind mapping)

**Interfaces:**

- Consumes: `Graph`, `GraphNode`, `GHOST_PREFIX` (Task 3); `Point`,
  `nodeRadius` (Task 4); `usePanZoom` (Task 6).
- Produces:

```ts
export const LABEL_SCALE_THRESHOLD = 1.2;
export const LABEL_DEGREE_THRESHOLD = 3;
export interface GraphCanvasProps {
  graph: Graph;
  positions: Map<string, Point>;
  activeId: string | null;
  onSelect: (node: GraphNode) => void;
}
export function GraphCanvas(props: GraphCanvasProps): ReactElement
```

- [ ] **Step 1: Add the two tokens**

The graph needs a fill for a plain node and one for a ghost's stroke. Both must
be tokens — a literal fails `scripts/sourceLint.test.ts`. In
`src/styles/tokens.css`, in the `:root` block that defines non-base tokens (the
one every theme may omit), add:

```css
  --bear-graph-node: var(--bear-muted);
  --bear-graph-edge: var(--bear-border);
```

Deriving both from existing tokens means all sixteen themes inherit a correct
graph with no per-theme work, and `sourceLint`'s "defines every non-base token
in `:root`" test stays satisfied.

Then map them for Tailwind. That mapping is in a **different file** —
`src/styles/index.css`'s `@theme inline` block, beside `--color-muted` — not in
`tokens.css`:

```css
  --color-graph-node: var(--bear-graph-node);
  --color-graph-edge: var(--bear-graph-edge);
```

Both halves are required. Tailwind v4 emits **nothing at all** for a utility
whose theme key is absent — no build warning, no runtime error — which is how
`hover:bg-hover` silently had no hover state for two milestones. After this
step, grep the built CSS for `fill-graph-node` and confirm it exists rather
than assuming it does.

- [ ] **Step 2: Write the failing test**

`src/features/graph/graphCanvas.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { buildGraph } from './buildGraph';
import { GraphCanvas, LABEL_DEGREE_THRESHOLD } from './GraphCanvas';
import { layoutGraph } from './layoutGraph';

const NOW = 1_700_000_000_000;
const note = (id: string, title: string) => ({ id, title, updatedAt: NOW });

function renderCanvas(onSelect = vi.fn(), activeId: string | null = null) {
  // A hub with 4 neighbours (above the label threshold) and a lone orphan.
  const index = [
    note('hub', 'Hub'),
    note('a', 'A'),
    note('b', 'B'),
    note('c', 'C'),
    note('d', 'D'),
    note('lonely', 'Lonely'),
  ];
  const rows = ['a', 'b', 'c', 'd'].map((id) => ({ noteId: id, toTitle: 'hub' }));
  const graph = buildGraph(index, [...rows, { noteId: 'hub', toTitle: 'nowhere' }]);

  const view = render(
    <I18nProvider locale="en">
      <GraphCanvas
        graph={graph}
        positions={layoutGraph(graph)}
        activeId={activeId}
        onSelect={onSelect}
      />
    </I18nProvider>,
  );
  return { ...view, graph, onSelect };
}

describe('GraphCanvas', () => {
  it('draws one element per node and one per edge', () => {
    const { container, graph } = renderCanvas();

    expect(container.querySelectorAll('[data-node]')).toHaveLength(graph.nodes.length);
    expect(container.querySelectorAll('[data-edge]')).toHaveLength(graph.edges.length);
  });

  it('marks a ghost node distinctly from a note', () => {
    const { container } = renderCanvas();

    const ghosts = container.querySelectorAll('[data-kind="ghost"]');
    expect(ghosts).toHaveLength(1);
    expect(container.querySelectorAll('[data-kind="note"]')).toHaveLength(6);
  });

  it('labels only nodes at or above the degree threshold at rest', () => {
    // Asserting a COUNT that changes with the rule, not merely that some label
    // exists — a presence assertion passes against a canvas that labels
    // everything, which is the bug this threshold exists to prevent.
    const { container, graph } = renderCanvas();

    const labelled = container.querySelectorAll('[data-label]');
    const expected = graph.nodes.filter((n) => n.degree >= LABEL_DEGREE_THRESHOLD).length;

    expect(labelled).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
    expect(expected).toBeLessThan(graph.nodes.length);
  });

  it('reports the clicked node to its caller', async () => {
    const { container, onSelect } = renderCanvas();

    const hub = container.querySelector('[data-node="hub"]')!;
    await userEvent.click(hub);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'hub', kind: 'note' }));
  });

  it('marks the active node so it can be found again', () => {
    const { container } = renderCanvas(vi.fn(), 'hub');

    expect(container.querySelectorAll('[data-active="true"]')).toHaveLength(1);
    expect(container.querySelector('[data-active="true"]')?.getAttribute('data-node')).toBe('hub');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/features/graph/graphCanvas.test.tsx`
Expected: FAIL — cannot resolve `./GraphCanvas`.

- [ ] **Step 4: Write the component**

`src/features/graph/GraphCanvas.tsx`:

```tsx
import { type ReactElement, useMemo, useState } from 'react';

import { useT } from '@/i18n';
import { usePanZoom } from '@/lib/usePanZoom';

import type { Graph, GraphNode } from './buildGraph';
import type { Point } from './layoutGraph';
import { nodeRadius } from './nodeRadius';

/** Above this zoom, every node is labelled. */
export const LABEL_SCALE_THRESHOLD = 1.2;
/** At rest, only nodes this well connected are labelled. */
export const LABEL_DEGREE_THRESHOLD = 3;

export interface GraphCanvasProps {
  graph: Graph;
  positions: Map<string, Point>;
  /** The note that was open when the graph was opened, drawn as an anchor. */
  activeId: string | null;
  onSelect: (node: GraphNode) => void;
}

/**
 * The picture: nodes, edges, labels, and hover emphasis.
 *
 * Knows no math — `buildGraph` and `layoutGraph` did that — and no persistence.
 * Hover emphasis is expressed as ONE data attribute on the root plus CSS
 * descendant rules, never per-node React state: at the top of the supported
 * range this tree is ~4,500 elements, and re-rendering all of them on
 * pointermove would drop frames on every machine.
 */
export function GraphCanvas({
  graph,
  positions,
  activeId,
  onSelect,
}: GraphCanvasProps): ReactElement {
  const t = useT();
  const [hovered, setHovered] = useState<string | null>(null);
  const { viewport, onPointerDown, onPointerMove, onPointerUp, onWheel } = usePanZoom({
    x: 0,
    y: 0,
    scale: 1,
  });

  const neighbours = useMemo(() => {
    if (hovered === null) return null;
    const near = new Set<string>([hovered]);
    for (const edge of graph.edges) {
      if (edge.source === hovered) near.add(edge.target);
      if (edge.target === hovered) near.add(edge.source);
    }
    return near;
  }, [graph.edges, hovered]);

  const showEveryLabel = viewport.scale >= LABEL_SCALE_THRESHOLD;

  return (
    <svg
      role="img"
      aria-label={t('graph.canvas.label')}
      className="h-full w-full touch-none select-none"
      data-hovering={hovered === null ? undefined : 'true'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
        <g>
          {graph.edges.map((edge) => {
            const a = positions.get(edge.source);
            const b = positions.get(edge.target);
            if (a === undefined || b === undefined) return null;

            const dim = neighbours !== null && !(neighbours.has(edge.source) && neighbours.has(edge.target));

            return (
              <line
                key={`${edge.source}\u0000${edge.target}`}
                data-edge=""
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="stroke-graph-edge"
                strokeWidth={1}
                opacity={dim ? 0.15 : 0.6}
              />
            );
          })}
        </g>

        <g>
          {graph.nodes.map((node) => {
            const at = positions.get(node.id);
            if (at === undefined) return null;

            const radius = nodeRadius(node.degree);
            const dim = neighbours !== null && !neighbours.has(node.id);
            const labelled =
              hovered === node.id || showEveryLabel || node.degree >= LABEL_DEGREE_THRESHOLD;

            return (
              <g
                key={node.id}
                data-node={node.id}
                data-kind={node.kind}
                data-active={node.id === activeId ? 'true' : undefined}
                opacity={dim ? 0.2 : 1}
                onPointerEnter={() => setHovered(node.id)}
                onPointerLeave={() => setHovered((current) => (current === node.id ? null : current))}
                onClick={() => onSelect(node)}
                className="cursor-pointer"
              >
                <circle
                  cx={at.x}
                  cy={at.y}
                  r={radius}
                  className={
                    node.kind === 'ghost'
                      ? 'fill-none stroke-graph-node'
                      : node.id === activeId
                        ? 'fill-accent'
                        : 'fill-graph-node'
                  }
                  strokeWidth={node.kind === 'ghost' ? 1.5 : 0}
                  strokeDasharray={node.kind === 'ghost' ? '3 2' : undefined}
                />
                {labelled && (
                  <text
                    data-label=""
                    x={at.x}
                    y={at.y - radius - 4}
                    textAnchor="middle"
                    className="fill-muted text-ui-xs"
                    style={{ fontSize: 10 }}
                  >
                    {node.title === '' ? t('note.untitled') : node.title}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </g>
    </svg>
  );
}
```

- [ ] **Step 5: Add the two i18n keys**

`src/i18n/en.ts`:

```ts
  'graph.canvas.label': 'Relationship graph',
```

`src/i18n/ko.ts`:

```ts
  'graph.canvas.label': '관계 그래프',
```

(The full accessible summary with counts arrives in Task 8; this is the bare
role name so the canvas is never unlabelled in between.)

- [ ] **Step 6: Run it and watch it pass**

Run: `npx vitest run src/features/graph/graphCanvas.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/graph/GraphCanvas.tsx src/features/graph/graphCanvas.test.tsx \
        src/styles/tokens.css src/styles/index.css src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(l3): draw the graph as SVG with degree sizing and label LOD"
```

---

### Task 8: `GraphView` — the surface, its states, and the text alternative

**Files:**

- Create: `src/features/graph/useGraphSnapshot.ts`
- Create: `src/features/graph/GraphView.tsx`
- Create: `src/features/graph/graphView.test.tsx`
- Create: `src/features/graph/index.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Modify: `src/ui/Icon.tsx`

**Interfaces:**

- Consumes: everything from Tasks 2–7.
- Produces: `GraphView` (default export as well as named — the lazy boundary in
  Task 9 needs a default), `useGraphSnapshot`, and the barrel
  `src/features/graph/index.ts`.

- [ ] **Step 1: Add the icons**

`GraphView`'s header needs a close chevron (already exported as `ChevronLeft`),
plus `Plus`, `Minus` and `Maximize2` for the zoom controls. Add them to the
`lucide-react` import list at the top of `src/ui/Icon.tsx` and to its
re-export block at the bottom. **Do not add them to `ICON_NODES`** — that map
exists only for `renderIconMarkup`, which draws ProseMirror widgets, and the
graph is React. `src/ui/Icon.tsx` is the only file allowed to import
`lucide-react`; importing it in the graph fails `sourceLint`.

- [ ] **Step 2: Write the snapshot hook**

`src/features/graph/useGraphSnapshot.ts`:

```ts
import { useEffect, useState } from 'react';

import { notes } from '@/data';

import { buildGraph, type Graph } from './buildGraph';
import type { Point } from './layoutGraph';
import { runLayout } from './runLayout';

/** Above this, the surface says what it is showing instead of hanging. */
export const NODE_CAP = 2000;

export type GraphSnapshot =
  | { status: 'building' }
  | { status: 'settling'; graph: Graph }
  | { status: 'ready'; graph: Graph; positions: Map<string, Point>; capped: number }
  | { status: 'empty' };

let cachedHash: string | null = null;
let cachedPositions: Map<string, Point> | null = null;

function topologyHash(graph: Graph): string {
  return `${graph.nodes.map((n) => n.id).join(',')}|${graph.edges
    .map((e) => `${e.source}>${e.target}`)
    .join(',')}`;
}

/**
 * Read the vault once, project it, and settle it.
 *
 * A SNAPSHOT, not a `useLiveQuery` subscription, and that is deliberate — see
 * `docs/rulings/notes-lifecycle.md`. Relayout is not incremental: every node
 * moves. A live graph would therefore rearrange itself under the reader's
 * cursor, for up to two seconds, because a note they cannot even see was
 * autosaved. No note is editable while this surface is open, so the only thing
 * that can change the vault underneath it is a sync pull. Reopening
 * re-snapshots.
 *
 * Positions are cached in module scope by topology hash, so reopening after
 * editing nothing is instant and reopening after adding one note recomputes.
 */
export function useGraphSnapshot(): GraphSnapshot {
  const [snapshot, setSnapshot] = useState<GraphSnapshot>({ status: 'building' });

  useEffect(() => {
    let live = true;

    void (async () => {
      const [index, rows] = await Promise.all([notes.allNoteIndex(), notes.allLinkRows()]);
      if (!live) return;

      if (index.length === 0) {
        setSnapshot({ status: 'empty' });
        return;
      }

      // Cap by taking the best-connected notes: an arbitrary slice would hide
      // exactly the hubs the surface exists to show.
      const full = buildGraph(index, rows);
      const capped = Math.max(0, full.nodes.length - NODE_CAP);
      const graph =
        capped === 0
          ? full
          : (() => {
              const keep = new Set(
                [...full.nodes]
                  .sort((a, b) => b.degree - a.degree || (a.id < b.id ? -1 : 1))
                  .slice(0, NODE_CAP)
                  .map((n) => n.id),
              );
              return {
                nodes: full.nodes.filter((n) => keep.has(n.id)),
                edges: full.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
              };
            })();

      setSnapshot({ status: 'settling', graph });

      const hash = topologyHash(graph);
      if (cachedHash === hash && cachedPositions !== null) {
        setSnapshot({ status: 'ready', graph, positions: cachedPositions, capped });
        return;
      }

      const positions = await runLayout(graph);
      if (!live) return;

      cachedHash = hash;
      cachedPositions = positions;
      setSnapshot({ status: 'ready', graph, positions, capped });
    })();

    return () => {
      live = false;
    };
  }, []);

  return snapshot;
}
```

- [ ] **Step 3: Write the failing test**

`src/features/graph/graphView.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { I18nProvider } from '@/i18n';

import { GraphView } from './GraphView';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteLinks.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderView(onClose = vi.fn(), onOpenNote = vi.fn()) {
  render(
    <I18nProvider locale="en">
      <GraphView activeId={null} onClose={onClose} onOpenNote={onOpenNote} />
    </I18nProvider>,
  );
  return { onClose, onOpenNote };
}

describe('GraphView', () => {
  it('shows the empty state for a vault with no notes', async () => {
    renderView();

    expect(await screen.findByText('No notes to graph')).toBeInTheDocument();
  });

  it('settles a real vault and states the finding in its accessible name', async () => {
    const alpha = await notes.create('# Alpha\n\nlinks to [[Beta]] and [[Nowhere]]');
    await notes.create('# Beta');
    await notes.create('# Lonely');

    renderView();

    // 3 notes + 1 ghost. Asserting the COUNTS, because the whole point of the
    // text alternative is that it carries the finding, not just a role name.
    const canvas = await screen.findByRole('img', { name: /3 notes/ });
    expect(canvas).toHaveAccessibleName(/1 unlinked/);
    expect(canvas).toHaveAccessibleName(/1 link to a note that doesn't exist/);
    expect(alpha.id).toBeTruthy();
  });

  it('lists the ghosts and hubs as real focusable rows', async () => {
    await notes.create('# Alpha\n\n[[Nowhere]]');

    renderView();

    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));

    expect(await screen.findByRole('button', { name: /nowhere/i })).toBeInTheDocument();
  });

  it('closes when its back control is used', async () => {
    await notes.create('# Alpha');

    const { onClose } = renderView();
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Back to notes' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('creates and opens a note when a ghost is chosen', async () => {
    await notes.create('# Alpha\n\n[[Kafka rebalancing]]');

    const { onOpenNote } = renderView();
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Summary' }));
    await userEvent.click(await screen.findByRole('button', { name: /kafka rebalancing/i }));

    await waitFor(() => expect(onOpenNote).toHaveBeenCalled());
    const created = await notes.allNoteIndex();
    expect(created.some((n) => n.title.toLowerCase() === 'kafka rebalancing')).toBe(true);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `npx vitest run src/features/graph/graphView.test.tsx`
Expected: FAIL — cannot resolve `./GraphView`.

- [ ] **Step 5: Add the i18n keys**

`src/i18n/en.ts` — replace the `graph.canvas.label` added in Task 7 with the
full set:

```ts
  'graph.title': 'Graph',
  'graph.back': 'Back to notes',
  'graph.summary': 'Summary',
  'graph.zoomIn': 'Zoom in',
  'graph.zoomOut': 'Zoom out',
  'graph.zoomReset': 'Reset zoom',
  'graph.settling': 'Working out the shape…',
  'graph.empty.title': 'No notes to graph',
  'graph.empty.body': 'Write a note, link two together with [[double brackets]], and the shape shows up here.',
  'graph.hubs': 'Most linked',
  'graph.ghosts': 'Linked but never written',
  // Assembled by `graphSummary`, which joins the parts it needs with commas.
  // Split rather than templated so Korean can reorder and add counter words.
  'graph.summary.notes': ' notes',
  'graph.summary.links': ' links',
  'graph.summary.unlinked': ' unlinked',
  'graph.summary.ghosts': " links to notes that don't exist",
  'graph.summary.ghostsOne': " link to a note that doesn't exist",
  'graph.capped': ' notes not shown',
```

`src/i18n/ko.ts` — the same keys:

```ts
  'graph.title': '그래프',
  'graph.back': '노트로 돌아가기',
  'graph.summary': '요약',
  'graph.zoomIn': '확대',
  'graph.zoomOut': '축소',
  'graph.zoomReset': '배율 초기화',
  'graph.settling': '모양을 계산하는 중…',
  'graph.empty.title': '그릴 노트가 없습니다',
  'graph.empty.body': '노트를 쓰고 [[대괄호 두 개]]로 두 노트를 이어 보세요. 여기에 모양이 나타납니다.',
  'graph.hubs': '가장 많이 연결됨',
  'graph.ghosts': '연결됐지만 아직 쓰지 않음',
  'graph.summary.notes': '개 노트',
  'graph.summary.links': '개 연결',
  'graph.summary.unlinked': '개 미연결',
  'graph.summary.ghosts': '개의 없는 노트 연결',
  'graph.summary.ghostsOne': '개의 없는 노트 연결',
  'graph.capped': '개 노트는 표시되지 않음',
```

- [ ] **Step 6: Write the surface**

`src/features/graph/GraphView.tsx`:

```tsx
import { type ReactElement, useCallback, useMemo, useState } from 'react';

import { notes } from '@/data';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { ChevronLeft, Icon, Maximize2, Minus, Plus } from '@/ui/Icon';
import { SidebarRow } from '@/ui/SidebarRow';

import { GHOST_PREFIX, type GraphNode } from './buildGraph';
import { GraphCanvas } from './GraphCanvas';
import { useGraphSnapshot } from './useGraphSnapshot';

export interface GraphViewProps {
  /** The note open behind the graph, drawn as an anchor. */
  activeId: string | null;
  onClose: () => void;
  onOpenNote: (id: string) => void;
}

/** How many hubs the text alternative lists. Enough to see the shape, few enough to read. */
const HUB_LIMIT = 10;

/**
 * The graph surface: a header, the canvas, and a text alternative.
 *
 * The text alternative is not a courtesy. This surface's entire purpose is to
 * answer "what is central, what is isolated" — and 1,000 SVG circles are not
 * tab stops. Rather than pretend they are, the canvas carries the finding in
 * its accessible name and the header opens the same finding as real focusable
 * rows. Someone who never sees the picture gets the answer the picture exists
 * to give.
 */
export function GraphView({ activeId, onClose, onOpenNote }: GraphViewProps): ReactElement {
  const t = useT();
  const snapshot = useGraphSnapshot();
  const [summaryOpen, setSummaryOpen] = useState(false);

  const openNode = useCallback(
    async (node: GraphNode) => {
      if (node.kind === 'note') {
        onOpenNote(node.id);
        return;
      }
      // A ghost is a title someone has referred to and never written. Choosing
      // it writes it — which is what makes the graph the vault's to-do list.
      const created = await notes.create(`# ${node.title}\n\n`);
      onOpenNote(created.id);
    },
    [onOpenNote],
  );

  const graph = snapshot.status === 'settling' || snapshot.status === 'ready' ? snapshot.graph : null;

  const summary = useMemo(() => {
    if (graph === null) return null;
    const noteNodes = graph.nodes.filter((n) => n.kind === 'note');
    const ghosts = graph.nodes.filter((n) => n.kind === 'ghost');
    return {
      notes: noteNodes.length,
      links: graph.edges.length,
      unlinked: noteNodes.filter((n) => n.degree === 0).length,
      ghosts,
      hubs: [...noteNodes].sort((a, b) => b.degree - a.degree).slice(0, HUB_LIMIT),
    };
  }, [graph]);

  const canvasLabel =
    summary === null
      ? t('graph.title')
      : [
          `${t('graph.title')}: ${summary.notes}${t('graph.summary.notes')}`,
          `${summary.links}${t('graph.summary.links')}`,
          `${summary.unlinked}${t('graph.summary.unlinked')}`,
          `${summary.ghosts.length}${
            summary.ghosts.length === 1
              ? t('graph.summary.ghostsOne')
              : t('graph.summary.ghosts')
          }`,
        ].join(', ');

  return (
    <div className="bg-canvas text-text flex h-full w-full flex-col">
      <header className="border-border flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <Button onClick={onClose} label={t('graph.back')} variant="ghost" size="sm">
          <Icon glyph={ChevronLeft} />
        </Button>
        <h1 className="text-ui-sm font-semibold">{t('graph.title')}</h1>
        <div className="flex-1" />
        <Button
          onClick={() => setSummaryOpen((open) => !open)}
          variant="ghost"
          size="sm"
          ariaExpanded={summaryOpen}
        >
          {t('graph.summary')}
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {snapshot.status === 'empty' && (
            <EmptyState title={t('graph.empty.title')} body={t('graph.empty.body')} />
          )}
          {(snapshot.status === 'building' || snapshot.status === 'settling') && (
            <div className="text-muted flex h-full items-center justify-center text-ui-sm">
              {t('graph.settling')}
            </div>
          )}
          {snapshot.status === 'ready' && (
            <GraphCanvasFrame
              label={canvasLabel}
              snapshot={snapshot}
              activeId={activeId}
              onSelect={(node) => void openNode(node)}
            />
          )}
        </div>

        {summaryOpen && summary !== null && (
          <nav
            aria-label={t('graph.summary')}
            className="border-border w-64 shrink-0 overflow-y-auto border-l p-2"
          >
            <h2 className="text-faint px-2 pt-1 text-ui-xs font-semibold">{t('graph.hubs')}</h2>
            <ul>
              {summary.hubs.map((node) => (
                <SidebarRow
                  key={node.id}
                  label={node.title === '' ? t('note.untitled') : node.title}
                  count={node.degree}
                  selected={false}
                  onSelect={() => void openNode(node)}
                />
              ))}
            </ul>
            {summary.ghosts.length > 0 && (
              <>
                <h2 className="text-faint px-2 pt-3 text-ui-xs font-semibold">
                  {t('graph.ghosts')}
                </h2>
                <ul>
                  {summary.ghosts.map((node) => (
                    <SidebarRow
                      key={node.id}
                      label={node.title}
                      count={node.degree}
                      selected={false}
                      onSelect={() => void openNode(node)}
                    />
                  ))}
                </ul>
              </>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}

/**
 * Split out ONLY so the zoom controls can sit beside the canvas and share its
 * `usePanZoom` state. Defined at module scope, never inside `GraphView`'s
 * body: a component declared in a render body is a new type every render, and
 * React unmounts and remounts its whole subtree each time — the trap
 * `NoteRowMenu`'s `Item` cost this project once already.
 */
function GraphCanvasFrame({
  label,
  snapshot,
  activeId,
  onSelect,
}: {
  label: string;
  snapshot: { graph: import('./buildGraph').Graph; positions: Map<string, import('./layoutGraph').Point>; capped: number };
  activeId: string | null;
  onSelect: (node: GraphNode) => void;
}): ReactElement {
  const t = useT();

  return (
    <div className="relative h-full w-full" aria-label={label}>
      <GraphCanvas
        graph={snapshot.graph}
        positions={snapshot.positions}
        activeId={activeId}
        onSelect={onSelect}
        label={label}
      />
      {snapshot.capped > 0 && (
        <p className="text-faint absolute bottom-2 left-2 text-ui-xs">
          {snapshot.capped}
          {t('graph.capped')}
        </p>
      )}
      <div className="absolute right-2 bottom-2 flex gap-1">
        <Button onClick={() => {}} label={t('graph.zoomOut')} variant="ghost" size="sm">
          <Icon glyph={Minus} />
        </Button>
        <Button onClick={() => {}} label={t('graph.zoomIn')} variant="ghost" size="sm">
          <Icon glyph={Plus} />
        </Button>
        <Button onClick={() => {}} label={t('graph.zoomReset')} variant="ghost" size="sm">
          <Icon glyph={Maximize2} />
        </Button>
      </div>
    </div>
  );
}

export default GraphView;
```

**Note for the implementer — two deliberate loose ends in the sketch above,
both of which you must close:**

1. `GraphCanvas` now takes a `label` prop (the assembled summary) and must use
   it as its `aria-label` instead of the Task 7 placeholder key. Update
   `GraphCanvasProps` and its test accordingly, and delete the now-unused
   `graph.canvas.label` key from both locale files.
2. The three zoom buttons have empty handlers. Lift `usePanZoom` out of
   `GraphCanvas` into `GraphCanvasFrame` and pass `viewport` plus the handlers
   down, so the buttons call `zoomBy(1.25)`, `zoomBy(0.8)` and `reset()`. A
   zoom control that does nothing is worse than none.

- [ ] **Step 7: Write the barrel**

`src/features/graph/index.ts`:

```ts
export { GraphView } from './GraphView';
export type { GraphViewProps } from './GraphView';
```

- [ ] **Step 8: Run it and watch it pass**

Run: `npx vitest run src/features/graph/`
Expected: PASS — every graph test, including the five new `GraphView` ones.

- [ ] **Step 9: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/graph/ src/i18n/en.ts src/i18n/ko.ts src/ui/Icon.tsx
git commit -m "feat(l3): the graph surface, its four states and its text alternative"
```

---

### Task 9: Wire it into the shell, lazily

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/useScopeShortcuts.ts`
- Modify: `src/app/useScopeShortcuts.test.tsx`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**

- Consumes: `GraphView` (Task 8).
- Produces: no new exports; `AppShell` gains `view` state and
  `useScopeShortcuts` gains an `onGraph` handler.

- [ ] **Step 1: Write the failing shortcut test**

Add to `src/app/useScopeShortcuts.test.tsx`:

```tsx
it('opens the graph on Mod+Shift+G', async () => {
  const onGraph = vi.fn();
  renderHook(() =>
    useScopeShortcuts({ onScope: vi.fn(), onSearch: vi.fn(), onGraph }),
  );

  fireEvent.keyDown(window, { code: 'KeyG', metaKey: true, shiftKey: true });

  expect(onGraph).toHaveBeenCalledTimes(1);
});

it('leaves Mod+Alt+Shift+G alone', () => {
  // Alt is rejected rather than merely unmatched, for the same reason the
  // digits reject it: one keystroke must not fire two unrelated effects.
  const onGraph = vi.fn();
  renderHook(() =>
    useScopeShortcuts({ onScope: vi.fn(), onSearch: vi.fn(), onGraph }),
  );

  fireEvent.keyDown(window, { code: 'KeyG', metaKey: true, shiftKey: true, altKey: true });

  expect(onGraph).not.toHaveBeenCalled();
});
```

Match the existing file's imports and render helper — read the top of that file
before writing; it already has whatever `renderHook`/`fireEvent` setup the
other cases use.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/useScopeShortcuts.test.tsx`
Expected: FAIL — `onGraph` is not a recognised handler.

- [ ] **Step 3: Extend the hook**

In `src/app/useScopeShortcuts.ts`, add to `ScopeShortcutHandlers`:

```ts
  /** Toggles L3's graph surface. */
  onGraph: () => void;
```

and inside `onKeyDown`, after the Alt rejection and before the digit lookup:

```ts
      if (event.code === 'KeyG') {
        event.preventDefault();
        onGraph();
        return;
      }
```

Add `onGraph` to the `useEffect` dependency array. `⇧⌘G` was verified unbound
in `node_modules/@tiptap` with the grep this file's docblock prescribes; extend
that docblock to say so, so the next person does not have to re-derive it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/app/useScopeShortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the lazy boundary in `AppShell`**

At the top of `src/app/AppShell.tsx`:

```tsx
import { lazy, Suspense } from 'react';

/**
 * Lazy, and STRUCTURALLY so — not as an optimisation.
 *
 * `scripts/bundleSize.test.ts` caps the main bundle at 340,000 B gzipped and
 * `main` measured 337,259 B on 2026-08-31: 2,741 bytes of headroom against
 * `d3-force`'s 5.6 KB. An eager import here breaches the ceiling before any
 * first-party code counts. If that guard ever fails on this branch, something
 * has leaked across this boundary — find the leak; do not raise the number.
 */
const GraphView = lazy(() => import('@/features/graph/GraphView'));
```

Import from the module path, not the barrel: a barrel re-exporting other graph
modules would drag them across the boundary.

- [ ] **Step 6: Add the state and render branch**

Beside the other `useState` calls:

```tsx
  const [view, setView] = useState<'notes' | 'graph'>('notes');
  const toggleGraph = useCallback(() => setView((v) => (v === 'graph' ? 'notes' : 'graph')), []);
  const closeGraph = useCallback(() => setView('notes'), []);
```

Pass `onGraph: toggleGraph` into the existing `useScopeShortcuts({…})` call.

Render the graph in place of the three panes, inside the existing
`<SessionProvider>` so it keeps the same context ancestors as the rest of the
shell:

```tsx
        {view === 'graph' ? (
          <Suspense
            fallback={<div className="bg-canvas h-full w-full" aria-busy="true" />}
          >
            <GraphView
              activeId={selectedNoteId}
              onClose={closeGraph}
              onOpenNote={(id) => {
                select(id);
                setView('notes');
              }}
            />
          </Suspense>
        ) : (
          <main className="bg-canvas text-text flex h-full w-full gap-2 overflow-hidden p-2">
            {/* …the existing three-pane tree, unchanged… */}
          </main>
        )}
```

Also close it on `Escape`, and route the phone back-gesture to it the way the
editor already does:

```tsx
  useOverlayHistory(view === 'graph', closeGraph, 'graph');
```

- [ ] **Step 7: Write and run the shell test**

Add to `src/app/AppShell.test.tsx`:

```tsx
it('swaps the panes for the graph and back', async () => {
  await notes.create('# Alpha');
  renderShell();

  fireEvent.keyDown(window, { code: 'KeyG', metaKey: true, shiftKey: true });

  // The panes are GONE, not merely covered — the assertion that distinguishes
  // a takeover from an overlay.
  await waitFor(() => expect(screen.queryByRole('img')).toBeInTheDocument());
  expect(screen.queryByLabelText('Note list')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Back to notes' }));

  expect(await screen.findByLabelText('Note list')).toBeInTheDocument();
});
```

Use whatever pane label the existing tests in that file already assert on —
read them first rather than trusting `'Note list'`.

Run: `npx vitest run src/app/AppShell.test.tsx src/app/useScopeShortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 8: Prove the lazy boundary held — this is a gate boundary**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run typecheck && npm run lint && npm run format
NODE_ENV=production npm run build
node -e "
const {readdirSync,statSync,readFileSync}=require('fs');const {gzipSync}=require('zlib');
const rows=readdirSync('dist/assets').filter(n=>n.endsWith('.js'))
  .map(n=>({n,gz:gzipSync(readFileSync('dist/assets/'+n)).length})).sort((a,b)=>b.gz-a.gz);
rows.slice(0,5).forEach(r=>console.log(r.n,r.gz));
console.log('headroom:',340000-rows[0].gz);
"
npm test -- --run --maxWorkers=4
```

Expected: a **separate** graph chunk appears in the asset list, the largest
asset stays under 340,000 B, and the full unit suite is green. If the largest
asset grew by ~6 KB and no separate chunk appeared, the lazy boundary did not
take — find the eager import before going further.

- [ ] **Step 9: Commit**

```bash
git add src/app/AppShell.tsx src/app/AppShell.test.tsx \
        src/app/useScopeShortcuts.ts src/app/useScopeShortcuts.test.tsx
git commit -m "feat(l3): open the graph from the shell behind a lazy boundary"
```

---

### Task 10: End-to-end, and the visual harnesses

**Files:**

- Create: `e2e/graph.spec.ts`
- Modify: `e2e/shots.spec.ts`
- Modify: `e2e/measure.spec.ts`
- Modify: `docs/design/measurements.md` and `.json` (regenerated, not edited)

**Interfaces:** consumes the shipped app; produces no source exports.

- [ ] **Step 1: Write the e2e spec**

`e2e/graph.spec.ts`. Read `e2e/backlinks.spec.ts` first for this repo's seeding
helper and its import paths, then cover exactly these, and nothing more:

```ts
// 1. Mod+Shift+G opens the graph and the three panes are gone.
// 2. The canvas's accessible name carries the real counts for the seeded corpus.
// 3. A ghost node renders with data-kind="ghost" and its count matches the seed.
// 4. Clicking a note node opens that note and returns to the panes.
// 5. Escape closes the graph.
// 6. THE WORKER PATH: seed enough notes to cross WORKER_THRESHOLD (400) and
//    assert the graph still reaches `ready`. This is the ONLY test in the repo
//    that can exercise the worker — jsdom has no `Worker`, so every unit test
//    runs the synchronous fallback. Seed via the init-script helper, at
//    IndexedDB version 10, BEFORE Dexie opens (see e2e/fixtures/seed.ts).
// 7. LABEL LEVEL-OF-DETAIL: count `[data-label]` at rest, wheel-zoom past
//    LABEL_SCALE_THRESHOLD, and assert the count INCREASED. A presence
//    assertion would pass against a canvas that labels everything.
```

- [ ] **Step 2: Run it against a fresh build**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/graph.spec.ts
```

Expected: PASS. The kill is not optional — `playwright.config.ts` hardcodes
port 4173 with `reuseExistingServer`, so a stale preview silently tests an old
build in both directions.

- [ ] **Step 3: Prove the tests can fail**

Fault-inject each of the two subtle ones and confirm a red run, then revert:

- Change `WORKER_THRESHOLD` to `100_000` so the worker never runs → test 6
  should still pass (the fallback is correct), which tells you test 6 is
  measuring the wrong thing. Fix it to assert the worker was USED — e.g. by
  counting requests for the worker chunk via `page.on('request')` — then
  re-inject and confirm it goes red.
- Make `LABEL_DEGREE_THRESHOLD` `0` so everything is labelled at rest → test 7
  must go red.

A test that cannot be made to fail is not evidence. This repo has shipped three
near-vacuous assertions before; do not add a fourth.

- [ ] **Step 4: Add the screenshot**

In `e2e/shots.spec.ts`, add one shot of the graph on the fixed corpus, opened
via the keyboard shortcut and awaited until `ready`. **Do not touch the theme
list regex** — it requires `id`, `labelKey` and `group` on one line in that
order, and a reflow makes it match nothing while still exiting 0.

```bash
npm run shots
ls docs/design/shots/*.png | wc -l   # expect 256, up from 240
```

Count the files. Do not trust the exit code.

- [ ] **Step 5: Add the measurement and regenerate**

Add the graph header to `e2e/measure.spec.ts`'s surface list, then:

```bash
npm run measure
git diff --stat docs/design/measurements.md
npm run measure:check
```

`measure:check` must pass after regenerating. If it fails on surfaces you did
not touch, run `npm run measure` on `main` first — that file has drifted
silently before, through three sub-projects.

- [ ] **Step 6: Commit**

```bash
git add e2e/graph.spec.ts e2e/shots.spec.ts e2e/measure.spec.ts \
        docs/design/measurements.md docs/design/measurements.json
git commit -m "test(l3): cover the graph end to end, and add its shot and measurement"
```

---

### Task 11: Rulings and documentation

**Files:**

- Modify: `docs/rulings/notes-lifecycle.md`
- Modify: `docs/rulings/testing-and-tooling.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/NEXT.md`

- [ ] **Step 1: Record the snapshot ruling**

In `docs/rulings/notes-lifecycle.md`, add a bullet stating that the graph is a
snapshot rather than a `useLiveQuery` subscription, and **why** — relayout is
not incremental, so a live graph rearranges itself under the reader for up to
two seconds because of an autosave they cannot see. Name
`useGraphSnapshot.ts`. Extend that file's `**Trigger:**` line with it, and add
the trigger to `CLAUDE.md`'s rulings table row for that file. Without this the
next session "fixes" it.

- [ ] **Step 2: Record the two tooling traps**

In `docs/rulings/testing-and-tooling.md`:

- **jsdom has no `Worker`**, so every unit test of `runLayout` exercises the
  synchronous fallback and only `e2e/graph.spec.ts` can see the worker path.
- **`d3-force` ships no types**; `@types/d3-force` is required, and the
  determinism the shots depend on comes from `simulation.randomSource()` plus
  phyllotaxis initial placement — changing `SEED` reshuffles every user's
  graph.
  (Corrected after the fact — this bullet is wrong about where the
  determinism actually comes from, and is left as the historical record of
  what was believed at plan time. See "Determinism is real, and was measured
  to come from somewhere other than where it was first credited" in
  `docs/superpowers/specs/2026-08-31-l3-relationship-graph-design.md`:
  phyllotaxis placement plus the fixed `LAYOUT_TICKS` are what actually make
  two runs agree, and changing `SEED` was measured to leave every test and
  shot passing.)

- [ ] **Step 3: Update the status table**

In `CLAUDE.md`, add the L3 row as complete, and update the test counts from the
final green run. Add the graph shot to the shots description — **256 files, 16
shots × 16 themes**, not 240.

- [ ] **Step 4: Update `NEXT.md`**

Move L3 out of the open table, note what shipped and the two things worth
carrying forward (the measured settle table; the lazy boundary being structural
rather than an optimisation), and leave L4 as next.

- [ ] **Step 5: The full gate, then commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run build
npm run test:e2e
npm run measure:check
git add -A
git commit -m "docs(l3): rule the graph snapshot, and record what shipped"
```

All seven must be green. Check `uptime` before concluding a failure is real —
several e2e specs fail under load in ways that look exactly like regressions.

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: target scale →
Task 8's `NODE_CAP`; full-surface takeover → Task 9; nodes/ghosts/no-tags/no-
arrows → Task 3; whole-vault scope → Task 8's reads; title resolution moved →
Task 1; `allNoteIndex` → Task 2; lazy loading → Task 9 Step 8; pure layout with
two callers → Tasks 4 and 5; snapshot not subscription → Task 8 and Task 11;
visual encoding → Tasks 4 and 7; interaction → Tasks 6, 7 and 8; assistive
technology → Task 8; the testing section → Tasks 3–10; all five risks →
Task 9 Step 8, Task 10 Step 3, Task 11.

**Known loose ends, deliberately flagged rather than hidden.** Task 8 Step 6
carries two: `GraphCanvas` gains a `label` prop that supersedes Task 7's
placeholder key, and the three zoom buttons need `usePanZoom` lifted from
`GraphCanvas` into `GraphCanvasFrame`. Both are called out in the task with the
reason. They exist because the summary text is not computable until `GraphView`
knows the graph, which is one task later than the canvas.

**Type consistency.** `TitledNote` (Task 1) is what `allNoteIndex` returns
(Task 2) and what `buildGraph` consumes (Task 3). `Graph`/`GraphNode`/
`GraphEdge` (Task 3) flow to `layoutGraph` (Task 4), `runLayout` (Task 5),
`GraphCanvas` (Task 7) and `useGraphSnapshot` (Task 8). `Point` is declared
once, in Task 4. `nodeRadius` is shared between the collision force and the
drawn circle by design.
