# U — Heading links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `[[Note/Heading]]` links to a heading inside another note — rendered
in full, followed with an unfold-scroll-flash, and offered by the `[[`
popover when you type `/`.

**Architecture:** One pure splitter (`splitLinkTarget`) owns the `/` rule and
is fed a known-title predicate by each of its four callers. The `noteLinks`
schema, `parseLinks` and `reindexNote` are untouched — the index keeps storing
the raw target, and `linksTo` grows a prefix query beside its exact one.
Following a link cannot use the editor handle, because `AppShell` keys the
editor by note id and the target editor does not exist at click time, so the
reveal travels as a nonce-carrying prop and is applied by an effect.

**Tech Stack:** TypeScript, Tiptap v3 / ProseMirror decorations, Dexie,
Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-u-heading-links-design.md`

## Global Constraints

- **`splitLinkTarget` is the only place the `/` rule exists.** A second
  implementation is this project's signature defect. Every consumer calls it.
- **No Dexie schema change.** No new table, no `db.version(n)`, no migration,
  no change to `reindexNote` or `parseLinks`.
- **Scan raw text, normalize per candidate.** `normalizeTitle` lowercases and
  collapses whitespace, so an offset taken from its output does not address
  the same character in the raw string.
- **No user-facing string is hardcoded in a component** — everything through
  `useT`, with the key added to `src/i18n/en.ts` and `ko.ts` (`ko.ts` is
  `Record<TranslationKey, string>`, so a missing translation is a compile
  error; add the translation, never weaken the annotation).
- **Every colour comes from a CSS custom property.** Literal hex or `rgb()`
  outside `src/styles/tokens.css` is a defect.
- **`src/data/` must not import from `src/features/`.** Heading extraction
  from stored Markdown therefore lives in `src/data/links/`.
- **Read the ruling before the diff:** `docs/rulings/tag-pills.md` (Tasks 5,
  6), `docs/rulings/notes-lifecycle.md` (Task 6), `docs/rulings/accessibility.md`
  (Task 8), `docs/rulings/testing-and-tooling.md` (Tasks 9, 10).
- **Gates before every commit:** `npm run typecheck`, `npm run lint`,
  `npm run format`, and the scoped test file. The full `npm test`,
  `npm run test:e2e`, `npm run build` and `npm run measure:check` run at the
  task-10 boundary, not per task — see CLAUDE.md's budget section.
- **Before any e2e run:** `lsof -ti:4173 | xargs -r kill -9`. A stale preview
  server on 4173 is silently reused and the suite then tests a stale build.

---

### Task 1: `splitLinkTarget`

**Files:**

- Create: `src/data/links/splitLinkTarget.ts`
- Create: `src/data/links/splitLinkTarget.test.ts`
- Modify: `src/data/links/index.ts` (add the two exports)
- Modify: `src/data/index.ts:60-61` (re-export through the barrel)

**Interfaces:**

- Consumes: `normalizeTitle` from `./parseLinks`.
- Produces: `splitLinkTarget(raw: string, isKnownTitle: (title: string) => boolean): LinkTarget`
  and `interface LinkTarget { title: string; heading: string | null; slash: number }`.
  Tasks 3, 4, 5 and 8 all import it from `@/data`.

- [ ] **Step 1: Write the failing test**

Create `src/data/links/splitLinkTarget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { splitLinkTarget } from './splitLinkTarget';

const known = (...titles: string[]) => {
  const set = new Set(titles);
  return (title: string) => set.has(title);
};

describe('splitLinkTarget', () => {
  it('returns the whole string as a title when it names a note', () => {
    expect(splitLinkTarget('Deploy Checklist', known('deploy checklist'))).toEqual({
      title: 'deploy checklist',
      heading: null,
      slash: -1,
    });
  });

  // The branch that must stay FIRST: a note genuinely titled `A/B testing`
  // is a note, never note `A` plus heading `B testing`.
  it('prefers the whole string over a split when both would resolve', () => {
    expect(splitLinkTarget('A/B testing', known('a/b testing', 'a'))).toEqual({
      title: 'a/b testing',
      heading: null,
      slash: -1,
    });
  });

  it('splits at the slash when the prefix names a note', () => {
    expect(splitLinkTarget('Deploy Checklist/Rollback', known('deploy checklist'))).toEqual({
      title: 'deploy checklist',
      heading: 'rollback',
      slash: 16,
    });
  });

  // The LONGEST title prefix wins, so a heading may itself contain a slash.
  // The intuitive reading is the opposite, which is why this is pinned.
  it('takes the longest known prefix, leaving slashes in the heading', () => {
    expect(splitLinkTarget('A/B testing/Setup/Notes', known('a/b testing', 'a'))).toEqual({
      title: 'a/b testing',
      heading: 'setup/notes',
      slash: 11,
    });
  });

  it('reports a raw offset, not an offset into the normalized title', () => {
    // Two spaces and mixed case: `normalizeTitle` would shorten and lowercase
    // this, so an index taken from its output would point at the wrong
    // character in the text the pill actually decorates.
    const result = splitLinkTarget('Deploy  Checklist/Rollback', known('deploy checklist'));
    expect(result.slash).toBe(17);
    expect('Deploy  Checklist/Rollback'[result.slash]).toBe('/');
  });

  it('falls back to the whole string when nothing resolves', () => {
    expect(splitLinkTarget('Nowhere/At all', known('something else'))).toEqual({
      title: 'nowhere/at all',
      heading: null,
      slash: -1,
    });
  });

  it('ignores a candidate with an empty side', () => {
    expect(splitLinkTarget('Deploy Checklist/', known('deploy checklist'))).toEqual({
      title: 'deploy checklist/',
      heading: null,
      slash: -1,
    });
    expect(splitLinkTarget('/Rollback', known(''))).toEqual({
      title: '/rollback',
      heading: null,
      slash: -1,
    });
  });

  it('normalizes whitespace around the slash', () => {
    expect(splitLinkTarget('Deploy Checklist / Rollback', known('deploy checklist'))).toEqual({
      title: 'deploy checklist',
      heading: 'rollback',
      slash: 17,
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/data/links/splitLinkTarget.test.ts`
Expected: FAIL — `Failed to resolve import "./splitLinkTarget"`.

- [ ] **Step 3: Write the implementation**

Create `src/data/links/splitLinkTarget.ts`:

```ts
import { normalizeTitle } from './parseLinks';

export interface LinkTarget {
  /** Normalized note title — `normalizeTitle`'s output, the index key. */
  title: string;
  /** Normalized heading text, or `null` when the link names no heading. */
  heading: string | null;
  /** Raw index of the separating `/` in the input, or -1 when there is none. */
  slash: number;
}

/**
 * Where the note title ends and the heading begins in a `[[…]]` target.
 *
 * THE ONLY place the `/` rule exists. `LinkPill`, `buildGraph`,
 * `notes.linksTo` and the `[[` autocomplete all come through here — a second
 * implementation of this rule is the duplicated-grammar defect this project
 * has already paid for once (see `parseTags`/`findTagRanges` in
 * `docs/rulings/tag-grammar.md`).
 *
 * `isKnownTitle` is a PREDICATE rather than a set so each caller can feed
 * whatever it already holds: a `Set` in the editor plugin, `buildTitleIndex`'s
 * `Map` in the graph, a query in the repository. It is asked about NORMALIZED
 * titles only.
 *
 * The whole string is tried first, and that ordering is load-bearing: a note
 * genuinely titled `A/B testing` must resolve as itself and never as note `A`
 * with heading `B testing`. Titles containing a slash are ordinary
 * (`TCP/IP`, `2026/09/15`).
 *
 * The scan runs over the RAW text, normalizing each candidate as it goes.
 * `normalizeTitle` lowercases and collapses whitespace, so an index found in
 * its output would not address the same character in the raw string — and
 * `slash` exists precisely so the pill can cut the raw text it is decorating.
 */
export function splitLinkTarget(
  raw: string,
  isKnownTitle: (title: string) => boolean,
): LinkTarget {
  const whole = normalizeTitle(raw);
  if (isKnownTitle(whole)) return { title: whole, heading: null, slash: -1 };

  // Collected up front and reversed, rather than walked with a decrementing
  // `lastIndexOf`: `'/a'.lastIndexOf('/', -1)` returns 0, not -1, so the
  // obvious loop spins forever on a leading slash.
  const slashes = [...raw.matchAll(/\//g)].map((match) => match.index).reverse();

  for (const slash of slashes) {
    const title = normalizeTitle(raw.slice(0, slash));
    const heading = normalizeTitle(raw.slice(slash + 1));
    // Neither side may be empty: `[[Title/]]` names no heading, and `[[/x]]`
    // names no note. Both fall through to the unresolved form below.
    if (title === '' || heading === '') continue;
    if (isKnownTitle(title)) return { title, heading, slash };
  }

  return { title: whole, heading: null, slash: -1 };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/data/links/splitLinkTarget.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Export it**

In `src/data/links/index.ts`, add:

```ts
export { splitLinkTarget } from './splitLinkTarget';
export type { LinkTarget } from './splitLinkTarget';
```

In `src/data/index.ts`, extend the existing line 60/61 pair so the barrel
re-exports `splitLinkTarget` and the `LinkTarget` type alongside
`buildTitleIndex`, `findLinkRanges`, `normalizeTitle`, `parseLinks`.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npx vitest run src/data/links/
git add src/data/links src/data/index.ts
git commit -m "feat(data): splitLinkTarget, the one place the [[Note/Heading]] rule lives"
```

---

### Task 2: Heading extraction from stored Markdown

**Files:**

- Create: `src/data/links/findHeadings.ts`
- Create: `src/data/links/findHeadings.test.ts`
- Modify: `src/data/links/index.ts`, `src/data/index.ts` (exports)
- Modify: `src/data/repositories/notes.ts` (interface near `:58`, implementation near `:347`)
- Modify: `src/data/repositories/notes.test.ts`

**Interfaces:**

- Consumes: `maskCode` from `../markdown/mask`; `normalizeTitle`,
  `buildTitleIndex` already in the module.
- Produces: `findHeadings(markdown: string): string[]` (raw heading text, in
  document order) and `notes.headingsOf(title: string): Promise<string[]>`.
  Task 8 calls `notes.headingsOf`; Task 9 tests `findHeadings` against the
  document walker.

- [ ] **Step 1: Write the failing test**

Create `src/data/links/findHeadings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { findHeadings } from './findHeadings';

describe('findHeadings', () => {
  it('returns each ATX heading in document order', () => {
    expect(findHeadings('# Title\n\n## One\n\ntext\n\n### Two\n')).toEqual(['One', 'Two']);
  });

  // `headingSections` skips the document's first block, because that block is
  // the note's NAME, not a section. The two readers must agree, so this one
  // skips it too — see `headingAgreement.test.ts`.
  it('skips the note title, which is the first block', () => {
    expect(findHeadings('# Deploy Checklist\n\n## Rollback\n')).toEqual(['Rollback']);
  });

  it('does not skip a leading heading that is preceded by prose', () => {
    expect(findHeadings('intro line\n\n# Not the title\n')).toEqual(['Not the title']);
  });

  it('ignores a # inside a fenced code block', () => {
    expect(findHeadings('# Title\n\n```sh\n# not a heading\n```\n\n## Real\n')).toEqual(['Real']);
  });

  it('strips a closing hash sequence', () => {
    expect(findHeadings('# Title\n\n## Closed ##\n')).toEqual(['Closed']);
  });

  it('requires a space after the hashes', () => {
    expect(findHeadings('# Title\n\n##NotAHeading\n')).toEqual([]);
  });

  it('ignores a heading with no text', () => {
    expect(findHeadings('# Title\n\n##\n\n## Real\n')).toEqual(['Real']);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run src/data/links/findHeadings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/data/links/findHeadings.ts`:

```ts
import { maskCode } from '../markdown/mask';

/**
 * ATX headings only. Setext (`===` underlines) is not produced by this app's
 * serializer, so supporting it here would add a rule the document walker in
 * `headingSections` has no counterpart for — and the two must agree.
 */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*)$/;

/**
 * Every heading in a note's stored Markdown, in document order, EXCLUDING the
 * note's own title.
 *
 * Lives in `src/data/` rather than beside the editor because the `[[`
 * autocomplete needs the headings of a note that is NOT open, and
 * `src/data/` may not import from `src/features/`.
 *
 * This is the second of two heading readers, and the risk is named in the
 * spec rather than left to be discovered: `headingSections` walks the live
 * ProseMirror document and is authoritative for what is on screen, while this
 * one reads text for a note nobody has opened. They cannot be collapsed —
 * different inputs — so they share `normalizeTitle` as the comparison key and
 * `headingAgreement.test.ts` asserts they agree across the corpus.
 *
 * The first block is skipped for the same reason `headingSections` skips
 * offset 0: it is the note's name, not a section. "First block" means the
 * first NON-BLANK line, because Markdown drops leading blank lines on parse.
 */
export function findHeadings(markdown: string): string[] {
  const lines = markdown.split('\n');
  // Masked line-for-line, so a `#` inside a fence cannot open a heading. The
  // mask preserves length, so the two arrays stay index-aligned.
  const masked = maskCode(markdown).split('\n');

  const found: string[] = [];
  let seenBlock = false;

  lines.forEach((line, index) => {
    const maskedLine = masked[index] ?? '';
    if (maskedLine.trim() === '') return;

    const isHeading = HEADING.test(maskedLine);
    const wasFirst = !seenBlock;
    seenBlock = true;
    if (!isHeading || wasFirst) return;

    const match = HEADING.exec(line);
    if (match === null) return;
    // A closing sequence (`## Closed ##`) is decoration, not text.
    const text = (match[2] ?? '').replace(/\s+#+\s*$/, '').trim();
    if (text !== '') found.push(text);
  });

  return found;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run src/data/links/findHeadings.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add `notes.headingsOf`**

In `src/data/repositories/notes.ts`, add to the `NotesRepository` interface
beside `allNoteTitles` (near line 58):

```ts
  /**
   * Headings of the non-trashed note with this title, for the `[[` popover's
   * `/` mode. Empty when no note matches — never throws, because a query
   * typed one character at a time names a non-existent note most of the time.
   */
  headingsOf(title: string): Promise<string[]>;
```

And implement it beside `allNoteTitles` (near line 347):

```ts
    async headingsOf(title) {
      const key = normalizeTitle(title);
      // `buildTitleIndex` picks the most recently updated note when two share
      // a title, which is the same note `LinkPill` resolves the link to — so
      // the popover cannot offer headings from a different note than the one
      // the finished link will open.
      const index = buildTitleIndex(await this.allNoteIndex());
      const match = index.get(key);
      if (match === undefined) return [];
      const note = await db.notes.get(match.id);
      if (note === undefined || note.trashedAt !== null) return [];
      return findHeadings(note.text);
    },
```

Import `buildTitleIndex` and `findHeadings` at the top of the file alongside
the existing `normalizeTitle` import from `../links`.

> If `this` is not available in the object-literal style used by the
> surrounding methods, hoist `allNoteIndex`'s body into a local
> `async function noteIndex()` above the returned object and call that from
> both — do not duplicate the streaming projection, which exists to keep full
> note text out of memory.

- [ ] **Step 6: Test `headingsOf`**

Add to `src/data/repositories/notes.test.ts`, following the file's existing
setup:

```ts
  it('returns the headings of the named note, title excluded', async () => {
    await notes.create({ text: '# Deploy Checklist\n\n## Rollback\n\n## Smoke tests\n' });

    expect(await notes.headingsOf('deploy checklist')).toEqual(['Rollback', 'Smoke tests']);
  });

  it('returns nothing for a title no note has', async () => {
    expect(await notes.headingsOf('nowhere at all')).toEqual([]);
  });

  it('returns nothing for a trashed note', async () => {
    const note = await notes.create({ text: '# Gone\n\n## Section\n' });
    await notes.trash(note.id);

    expect(await notes.headingsOf('gone')).toEqual([]);
  });
```

- [ ] **Step 7: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npx vitest run src/data/links/ src/data/repositories/notes.test.ts
git add src/data
git commit -m "feat(data): findHeadings and notes.headingsOf for the [[ popover's / mode"
```

---

### Task 3: `linksTo` finds heading links

**Files:**

- Modify: `src/data/repositories/notes.ts:331-341`
- Modify: `src/data/repositories/notes.test.ts`

**Interfaces:**

- Consumes: `splitLinkTarget` is NOT used here — the query side works by
  prefix, because the stored key is raw.
- Produces: no signature change. `linksTo(title)` keeps returning `Note[]`.

- [ ] **Step 1: Write the failing test**

Add to `src/data/repositories/notes.test.ts`:

```ts
  it('counts a heading link as a backlink to the note', async () => {
    const target = await notes.create({ text: '# Deploy Checklist\n\n## Rollback\n' });
    await notes.create({ text: '# Release\n\nSee [[Deploy Checklist/Rollback]].' });

    const found = await notes.linksTo('Deploy Checklist');

    expect(found).toHaveLength(1);
    expect(found[0]?.text).toContain('See [[Deploy Checklist/Rollback]]');
    // The target note itself must not appear: `reindexNote` drops a note's
    // links to itself, and this asserts that still holds through the split.
    expect(found.map((note) => note.id)).not.toContain(target.id);
  });

  it('counts plain and heading links to one note once each', async () => {
    await notes.create({ text: '# Deploy Checklist\n\n## Rollback\n' });
    await notes.create({ text: '# A\n\n[[Deploy Checklist]]' });
    await notes.create({ text: '# B\n\n[[Deploy Checklist/Rollback]]' });

    expect(await notes.linksTo('Deploy Checklist')).toHaveLength(2);
  });

  // The false positive the prefix query would otherwise create: a note whose
  // TITLE is another note's title plus `/` plus more. The link below names
  // that second note directly and must not appear under the first.
  it('does not treat a link to a slash-titled note as a heading link', async () => {
    await notes.create({ text: '# Deploy Checklist\n' });
    await notes.create({ text: '# Deploy Checklist/Rollback\n' });
    await notes.create({ text: '# C\n\n[[Deploy Checklist/Rollback]]' });

    expect(await notes.linksTo('Deploy Checklist')).toHaveLength(0);
    expect(await notes.linksTo('Deploy Checklist/Rollback')).toHaveLength(1);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/data/repositories/notes.test.ts -t 'heading link'`
Expected: FAIL — `linksTo` returns 0 notes, because the stored key is
`deploy checklist/rollback` and the query asks for `deploy checklist`.

- [ ] **Step 3: Implement**

Replace the body of `linksTo` (`src/data/repositories/notes.ts:331-341`):

```ts
    async linksTo(title) {
      // `normalizeTitle` is the ONLY place a title becomes a key — normalizing
      // here, on the query side, so an un-normalized caller-supplied title
      // still finds what the index side stored normalized.
      const key = normalizeTitle(title);

      // Two queries, because the index stores a heading link's target RAW
      // (`deploy checklist/rollback`) — see the spec: splitting at index time
      // would make a note's derived rows depend on other notes existing.
      // `toTitle` is an index, so the prefix form is a range scan, not a
      // table scan.
      const exact = await db.noteLinks.where('toTitle').equals(key).toArray();
      const prefixed = await db.noteLinks
        .where('toTitle')
        .startsWith(`${key}/`)
        .toArray();

      let heading = prefixed;
      if (prefixed.length > 0) {
        // A prefix hit whose FULL key names a note of its own is a link to
        // THAT note, not a heading link into this one — a note titled
        // `Deploy checklist/rollback` is an ordinary target. Guarded on
        // `prefixed.length` so the common case (no slash links anywhere)
        // costs nothing: notes are scanned only when there is something to
        // disambiguate.
        const titles = new Set((await this.allNoteIndex()).map((n) => normalizeTitle(n.title)));
        heading = prefixed.filter((row) => !titles.has(row.toTitle));
      }

      const ids = [...new Set([...exact, ...heading].map((row) => row.noteId))];
      const found = await db.notes.bulkGet(ids);

      return found.filter((note): note is Note => note !== undefined && note.trashedAt === null);
    },
```

Apply the same `this`-avoidance note as Task 2 if the surrounding style
requires it.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/data/repositories/notes.test.ts`
Expected: PASS, including the three new cases.

- [ ] **Step 5: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/data/repositories
git commit -m "feat(data): linksTo counts [[Note/Heading]] as a backlink to the note"
```

---

### Task 4: The graph resolves heading links

**Files:**

- Modify: `src/features/graph/buildGraph.ts:61-62`
- Modify: `src/features/graph/buildGraph.test.ts`

**Interfaces:**

- Consumes: `splitLinkTarget` from `@/data` (Task 1).
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Add to `src/features/graph/buildGraph.test.ts`, matching the file's existing
`note(...)` / `link(...)` helpers:

```ts
  it('resolves a heading link to the note itself, not a ghost', () => {
    const graph = buildGraph(
      [note('a', 'Release'), note('b', 'Deploy Checklist')],
      [link('a', 'deploy checklist/rollback')],
    );

    expect(graph.nodes.filter((n) => n.kind === 'ghost')).toHaveLength(0);
    expect(graph.edges).toHaveLength(1);
  });

  it('draws one edge when a note links to two headings of the same note', () => {
    const graph = buildGraph(
      [note('a', 'Release'), note('b', 'Deploy Checklist')],
      [link('a', 'deploy checklist/rollback'), link('a', 'deploy checklist/smoke tests')],
    );

    expect(graph.edges).toHaveLength(1);
  });

  // Unchanged from before this sub-project, and deliberately so: splitting
  // requires a KNOWN title, and a missing note has none. Recorded because the
  // opposite is the intuitive expectation.
  it('still makes one ghost per distinct target when the note does not exist', () => {
    const graph = buildGraph(
      [note('a', 'Release')],
      [link('a', 'missing/one'), link('a', 'missing/two')],
    );

    expect(graph.nodes.filter((n) => n.kind === 'ghost')).toHaveLength(2);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/graph/buildGraph.test.ts`
Expected: FAIL — the first test reports 1 ghost and an edge to it.

- [ ] **Step 3: Implement**

In `src/features/graph/buildGraph.ts`, replace:

```ts
    const key = normalizeTitle(row.toTitle);
```

with:

```ts
    // The `/` rule lives in exactly one place; `byTitle` is already the
    // known-title lookup this needs, so the predicate costs nothing.
    const { title: key } = splitLinkTarget(row.toTitle, (candidate) => byTitle.has(candidate));
```

Add `splitLinkTarget` to the existing `@/data` import at line 1. `normalizeTitle`
may now be unused in this file — if `lint` says so, drop it from the import.

The ghost branch below is unchanged: when nothing resolves, `key` is the
whole normalized target and `row.toTitle` is still the right label.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/features/graph/buildGraph.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/graph
git commit -m "feat(graph): a heading link is an edge to the note, not a ghost"
```

---

### Task 5: The pill renders `Note / Heading`

**Read first:** `docs/rulings/tag-pills.md`.

**Files:**

- Modify: `src/features/editor/LinkPill.ts` (`linkHitsIn`, `LinkHit`,
  `linkDecorations`, `linkRangeAt`, `LinkPillOptions.onActivateLink`, the
  `mousedown` handler)
- Modify: `src/features/editor/linkPill.test.ts`
- Modify: `src/styles/editor.css` (the `.bear-link` block added on 2026-09-15)

**Interfaces:**

- Consumes: `splitLinkTarget` from `@/data`.
- Produces: `LinkHit` gains `raw: string`; `linkRangeAt(state, pos)` is
  unchanged in signature; `LinkPillOptions.onActivateLink` becomes
  `((title: string, heading: string | null) => boolean) | null`. Task 6
  depends on that two-argument shape.

- [ ] **Step 1: Write the failing test**

Add to `src/features/editor/linkPill.test.ts`, using the file's existing
editor helper and known-titles setup:

```ts
  it('renders a resolved heading link as note, slash and heading', () => {
    const container = mountWithTitles('Deploy Checklist', 'See [[Deploy Checklist/Rollback]] now');

    expect(container.querySelector('.bear-link__slash')?.textContent).toBe('/');
    expect(container.querySelector('.bear-link__heading')?.textContent).toBe('Rollback');
    // The note part is the span that is neither bracket, slash nor heading.
    const note = container.querySelector(
      '.bear-link:not(.bear-link__bracket):not(.bear-link__slash):not(.bear-link__heading)',
    );
    expect(note?.textContent).toBe('Deploy Checklist');
  });

  it('marks exactly one span as the tail, so only one glyph is drawn', () => {
    const container = mountWithTitles('Deploy Checklist', 'See [[Deploy Checklist/Rollback]] now');

    expect(container.querySelectorAll('.bear-link__tail')).toHaveLength(1);
    expect(container.querySelector('.bear-link__tail')?.textContent).toBe('Rollback');
  });

  it('marks the note span as the tail when there is no heading', () => {
    const container = mountWithTitles('Deploy Checklist', 'See [[Deploy Checklist]] now');

    expect(container.querySelectorAll('.bear-link__tail')).toHaveLength(1);
    expect(container.querySelector('.bear-link__tail')?.textContent).toBe('Deploy Checklist');
  });

  it('resolves on the note alone, so an unknown heading still resolves', () => {
    const container = mountWithTitles('Deploy Checklist', 'See [[Deploy Checklist/Gone]] now');

    expect(container.querySelector('.bear-link')?.getAttribute('data-resolved')).toBe('true');
  });

  it('gives an unresolved heading link no parts at all', () => {
    const container = mountWithTitles('Something else', 'See [[Nowhere/Rollback]] now');

    expect(container.querySelectorAll('.bear-link__slash')).toHaveLength(0);
    expect(container.querySelector('.bear-link')?.getAttribute('data-resolved')).toBe('false');
  });

  it('passes the heading to onActivateLink', () => {
    const calls: Array<[string, string | null]> = [];
    // …mount with `onActivateLink: (title, heading) => { calls.push([title, heading]); return true; }`
    // and click the pill, following the existing click test in this file.
    expect(calls).toEqual([['deploy checklist', 'rollback']]);
  });
```

> `mountWithTitles` is shorthand for this file's existing mount-plus-
> `setKnownNoteTitles` sequence. Use the real helper the file already has;
> do not add a second one.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/editor/linkPill.test.ts`
Expected: FAIL — no `.bear-link__slash` element exists.

- [ ] **Step 3: Implement the decorations**

In `LinkPill.ts`:

1. Add `raw: string` to `LinkHit` and populate it in `linkHitsIn` from
   `range.raw` (which `findLinkRanges` already returns).
2. In `linkDecorations`, after the existing suppression check, replace the
   single-decoration push with:

```ts
      const target = splitLinkTarget(hit.raw, (candidate) => knownTitles.has(candidate));
      const resolved = knownTitles.has(target.title);
      const attrs: Record<string, string> = {
        class: 'bear-link',
        'data-resolved': String(resolved),
      };
      if (activateHint !== null) attrs.title = activateHint;
      decorations.push(Decoration.inline(from, to, attrs, { resolved }));

      if (!resolved) continue;

      // The content, between the brackets. One decoration marks whichever
      // span ENDS the link as the tail: the `::after` glyph hangs off that
      // class, and without it an overlapping three-span link would draw
      // three arrows.
      const contentFrom = from + 2;
      const contentTo = to - 2;

      if (target.heading === null) {
        decorations.push(Decoration.inline(contentFrom, contentTo, { class: 'bear-link__tail' }));
        continue;
      }

      // `slash` is an index into the RAW inner text, and `contentFrom` is the
      // document position of that text's first character — see
      // `splitLinkTarget`'s docblock for why it is not an index into the
      // normalized title.
      const slashFrom = contentFrom + target.slash;
      decorations.push(
        Decoration.inline(slashFrom, slashFrom + 1, { class: 'bear-link__slash' }),
        Decoration.inline(slashFrom + 1, contentTo, { class: 'bear-link__heading' }),
        Decoration.inline(slashFrom + 1, contentTo, { class: 'bear-link__tail' }),
      );
```

3. `linkSyntaxDecorations` is unchanged — it reads `pill.spec.resolved`, which
   is still set on the whole-range decoration.

- [ ] **Step 4: Implement the activation**

Widen the option type:

```ts
  onActivateLink: ((title: string, heading: string | null) => boolean) | null;
```

In the `mousedown` handler, after `linkRangeAt` returns a hit, split and pass
both parts:

```ts
              const target = splitLinkTarget(hit.raw, (candidate) =>
                knownNoteTitles(view.state).has(candidate),
              );
              if (!onActivateLink(target.title, target.heading)) return false;
```

- [ ] **Step 5: Style it**

In `src/styles/editor.css`, inside the `.bear-link` block:

```css
/*
 * The `/` between a note and a heading. Dimmed rather than accented so the
 * eye finds the seam without the link reading as two separate objects — it is
 * one destination, more precisely named.
 */
.ProseMirror .bear-link__slash {
  color: var(--bear-faint);
}
```

And change the glyph's selector from
`.ProseMirror .bear-link[data-resolved='true']:not(.bear-link__bracket)::after`
to
`.ProseMirror .bear-link[data-resolved='true'].bear-link__tail::after`,
with a comment recording why: a heading link renders as several content spans,
and the old selector matched every one of them, so the arrow would be drawn
once per part.

- [ ] **Step 6: Run and watch it pass**

Run: `npx vitest run src/features/editor/linkPill.test.ts`
Expected: PASS.

- [ ] **Step 7: Look at it**

Follow the throwaway-spec recipe in Task 10's step 1, with a note containing
a resolved heading link, an unresolved one, and a heading link whose heading
does not exist. **Confirm by eye that exactly one arrow is drawn per link.**
No test in the repo can see a doubled glyph.

- [ ] **Step 8: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npx vitest run src/features/editor/
git add src/features/editor src/styles/editor.css
git commit -m "feat(editor): a heading link renders as note, dimmed slash and heading"
```

---

### Task 6: Plumb the reveal from the click to the editor

**Read first:** `docs/rulings/notes-lifecycle.md` — `AppShell`'s `key={…}` and
`seed`, and the rule about writes gated on a `useLiveQuery`.

**Files:**

- Modify: `src/app/AppShell.tsx` (`handleActivateLink` near `:345`, the
  `seed`-clearing effect near `:176`, the `NoteEditor` props near `:858`)
- Modify: `src/features/notes/NoteEditor.tsx:80,133,532`
- Modify: `src/features/editor/RichEditor.tsx:85,170,267-269,350-351`
- Modify: `src/app/appShell.test.tsx`

**Interfaces:**

- Consumes: `onActivateLink(title, heading)` from Task 5.
- Produces: a `revealHeading?: { text: string; nonce: number }` prop on both
  `NoteEditor` and `RichEditor`. Task 7 consumes it inside `RichEditor`.

- [ ] **Step 1: Write the failing test**

In `src/app/appShell.test.tsx`, following the file's existing render helper:

```ts
  it('passes the clicked heading down to the editor', async () => {
    // …render with two seeded notes, one linking [[Target/Section]] to the other
    // …click the pill
    expect(lastEditorProps().revealHeading?.text).toBe('section');
  });

  it('bumps the nonce when the same heading link is followed twice', async () => {
    // …click the same pill twice, with the target note ALREADY selected
    const first = lastEditorProps().revealHeading?.nonce;
    // …click again
    expect(lastEditorProps().revealHeading?.nonce).not.toBe(first);
  });

  it('clears the pending heading when the selection moves elsewhere', async () => {
    // …follow a heading link, then select a third note from the list
    expect(lastEditorProps().revealHeading).toBeUndefined();
  });
```

> `lastEditorProps` is whatever this file already uses to observe what
> `AppShell` renders. If it has no such helper, assert through the rendered
> DOM instead of inventing a mock: select the target note and assert the
> editor scrolled — but prefer the prop assertion if the harness allows it,
> because the DOM one cannot run in jsdom (no layout).

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/appShell.test.tsx`
Expected: FAIL — `revealHeading` is not a prop.

- [ ] **Step 3: Implement in `AppShell`**

```ts
  /**
   * The heading a just-followed link named, and a nonce that changes on every
   * follow.
   *
   * The nonce is load-bearing, not indirection to be tidied away. The editor
   * is keyed by note id, so following a link to ANOTHER note remounts it and
   * a read-once-at-mount prop would be enough — but a link to a heading in
   * the note you are ALREADY in does not remount anything, and without a
   * changing value there is nothing for the editor's effect to react to. That
   * case has no unit coverage in jsdom (no layout, no scrolling), so it is
   * made correct by construction rather than guarded.
   */
  const [reveal, setReveal] = useState<{ id: string; text: string; nonce: number } | null>(null);

  const handleActivateLink = (title: string, heading: string | null): boolean => {
    // `undefined` means the live query has not resolved yet — treated as
    // "not yet known", never as "no notes", the same discipline
    // `handleActivateTag` applies to `tree.nodes === undefined`.
    if (noteIndex === undefined) return false;

    const target = resolveLinkTarget(noteIndex, title);
    if (target === null) return false;

    setReveal(
      heading === null ? null : { id: target.id, text: heading, nonce: Date.now() + Math.random() },
    );
    select(target.id);
    return true;
  };
```

Clear it when the selection moves, in the same effect that already clears
`seed` (near `:176`) — add `if (reveal !== null && reveal.id !== selectedNoteId) setReveal(null);`
or extend the existing condition, whichever matches the surrounding shape.

Pass it down (near `:858`), guarding on identity so a stale reveal never
reaches a different note:

```tsx
                      revealHeading={
                        reveal !== null && reveal.id === selectedNote.id
                          ? { text: reveal.text, nonce: reveal.nonce }
                          : undefined
                      }
```

> `Date.now() + Math.random()` is deliberate: two follows inside one
> millisecond must still differ, and this value is never persisted, compared
> for ordering, or shown to anyone.

- [ ] **Step 4: Thread it through `NoteEditor` and `RichEditor`**

Add to both prop interfaces, with the docblock explaining the nonce (copy the
reasoning, not the sentence — `NoteEditor`'s is the one a reader reaches
first):

```ts
  /**
   * A heading to reveal after a `[[Note/Heading]]` link is followed. The
   * `nonce` changes on every follow so the same heading can be revealed
   * twice — see `AppShell`'s own comment for why a read-once prop is not
   * enough.
   */
  revealHeading?: { text: string; nonce: number };
```

`NoteEditor` passes it straight through to `RichEditor` beside
`onActivateLink` at `:532`. Also widen `onActivateLink` to
`(title: string, heading: string | null) => boolean` in both files, and update
`RichEditor`'s ref indirection at `:350-351`:

```ts
      onActivateLink:
        onActivateLink === undefined
          ? null
          : (title, heading) => activateLinkRef.current?.(title, heading) === true,
```

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run src/app/appShell.test.tsx src/features/notes/`
Expected: PASS.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app src/features/notes src/features/editor
git commit -m "feat(app): carry a followed link's heading to the editor, with a nonce"
```

---

### Task 7: Reveal — unfold, scroll, flash

**Files:**

- Create: `src/features/editor/HeadingReveal.ts`
- Create: `src/features/editor/headingReveal.test.ts`
- Modify: `src/features/editor/headingSections.ts` (add `keysRevealing`)
- Modify: `src/features/editor/headingSections.test.ts`
- Modify: `src/features/editor/extensions.ts` (register the extension)
- Modify: `src/features/editor/RichEditor.tsx` (the effect)
- Modify: `src/styles/editor.css`

**Interfaces:**

- Consumes: `headingSections`, `foldKeyOf`, `serializeFoldKey`,
  `hiddenRangesFor` from `./headingSections`; `foldedKeys` and the
  `setHeadingFolds` command from `./HeadingFold`; `normalizeTitle` from
  `@/data`.
- Produces: `keysRevealing(doc, folded, pos): string[]`, and a
  `revealHeading(text: string)` Tiptap command returning `boolean`.

- [ ] **Step 1: Write the failing test for `keysRevealing`**

Add to `src/features/editor/headingSections.test.ts`:

```ts
describe('keysRevealing', () => {
  it('drops the fold that hides the position', () => {
    // doc: h2 "One" (folded) > paragraph P
    const kept = keysRevealing(doc, [key('One')], posOfParagraphUnderOne);
    expect(kept).toEqual([]);
  });

  it('drops an ANCESTOR fold that hides the target heading itself', () => {
    // doc: h2 "One" (folded) > h3 "Two" > paragraph
    // Folding the h2 hides the h3's own heading line, so revealing the h3
    // means unfolding the h2 as well.
    expect(keysRevealing(doc, [key('One')], posOfHeadingTwo)).toEqual([]);
  });

  it('keeps folds that hide nothing relevant', () => {
    expect(keysRevealing(doc, [key('Three')], posOfHeadingTwo)).toEqual([key('Three')]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/editor/headingSections.test.ts`
Expected: FAIL — `keysRevealing` is not exported.

- [ ] **Step 3: Implement `keysRevealing`**

Append to `src/features/editor/headingSections.ts`:

```ts
/**
 * The fold set with every fold that hides `pos` removed.
 *
 * ANCESTORS included, which is the whole reason this is not a one-line
 * filter at the call site: a folded h2 hides its h3s, so the heading a link
 * targets can be invisible because of a section two levels above it. Removing
 * only the target's own fold would scroll to a line that is still display:none.
 *
 * Pure, so the unfold rule is testable without an editor — and so the caller
 * can hand the result to `setHeadingFolds` as an ordinary command rather than
 * dispatching inside another command, which throws `RangeError: Applying a
 * mismatched transaction` (see CLAUDE.md).
 */
export function keysRevealing(
  doc: Node,
  folded: readonly string[],
  pos: number,
): string[] {
  const hiding = new Set<string>();

  for (const section of headingSections(doc)) {
    const key = serializeFoldKey(foldKeyOf(section));
    if (!folded.includes(key)) continue;
    // `contentStart`..`end` is what the fold hides; `pos`..`contentStart` is
    // the heading line itself, which a fold on an ANCESTOR also hides.
    if (pos >= section.contentStart && pos < section.end) hiding.add(key);
  }

  return folded.filter((key) => !hiding.has(key));
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/features/editor/headingSections.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the extension**

Create `src/features/editor/headingReveal.test.ts`, modelled on
`headingFold.test.ts`'s headless-editor setup:

```ts
  it('finds the heading by normalized text and flashes it', () => {
    const editor = mount('# Title\n\n## Rollback\n\ntext\n');

    expect(editor.commands.revealHeading('rollback')).toBe(true);
    expect(dom(editor).querySelector('.bear-heading-revealed')?.textContent).toBe('Rollback');
  });

  it('clears the flash after the timeout', () => {
    vi.useFakeTimers();
    const editor = mount('# Title\n\n## Rollback\n');
    editor.commands.revealHeading('rollback');

    vi.advanceTimersByTime(1200);

    expect(dom(editor).querySelector('.bear-heading-revealed')).toBeNull();
    vi.useRealTimers();
  });

  it('returns false for a heading the note does not have', () => {
    const editor = mount('# Title\n\n## Rollback\n');

    expect(editor.commands.revealHeading('gone')).toBe(false);
  });

  it('takes the first of two headings sharing a name', () => {
    const editor = mount('# Title\n\n## Dup\n\na\n\n## Dup\n\nb\n');
    editor.commands.revealHeading('dup');

    expect(dom(editor).querySelectorAll('.bear-heading-revealed')).toHaveLength(1);
  });
```

- [ ] **Step 6: Implement the extension**

Create `src/features/editor/HeadingReveal.ts`. Shape:

- a `PluginKey<number | null>` holding the revealed heading's position;
- plugin `state.apply` reads a meta carrying `number | null`;
- `props.decorations` returns one `Decoration.node(pos, pos + node.nodeSize, { class: 'bear-heading-revealed' })`
  when the position is set and still names a heading;
- the `revealHeading(text)` command finds the section with
  `headingSections(state.doc).find((s) => normalizeTitle(s.text) === text)`,
  returns `false` when there is none, and otherwise dispatches
  `tr.setMeta(key, section.pos).setMeta(skipTrailingNodeMeta, true)`;
- the command schedules the clear with `setTimeout(…, REVEAL_MS)` dispatching
  `setMeta(key, null)` through `editor.view.dispatch`, guarded on
  `editor.isDestroyed`.

`skipTrailingNodeMeta` is required for the same reason `setKnownNoteTitles`
needs it: `TrailingNode`'s `appendTransaction` is not gated on `docChanged`,
so a meta-only dispatch on a note ending in a list would append a paragraph
and autosave it. See `docs/rulings/markdown-and-schema.md`.

Register it in `extensions.ts` beside `HeadingFold`. **Prefix any new option
with the extension name** — `buildEditorExtensions` spreads every extension's
options into one flat object and a bare name collides silently.

- [ ] **Step 7: Style the flash**

```css
/*
 * The landing flash after a `[[Note/Heading]]` link is followed. Fades itself
 * out; the decoration is removed about a second later, so the class is gone
 * before the animation could restart.
 *
 * `--bear-tag-fill` rather than a colour of its own: this is the same
 * "something is highlighted here" weight the pills use, and a second fill
 * token would have to be tuned across all sixteen themes to say the same
 * thing.
 */
.ProseMirror .bear-heading-revealed {
  border-radius: var(--bear-radius-sm);
  background-color: var(--bear-tag-fill);
  animation: bear-heading-reveal 1s ease-out forwards;
}

@keyframes bear-heading-reveal {
  from {
    background-color: var(--bear-tag-fill-strong);
  }
  to {
    background-color: transparent;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ProseMirror .bear-heading-revealed {
    animation: none;
  }
}
```

- [ ] **Step 8: Wire the effect in `RichEditor`**

Beside the existing `setKnownNoteTitles` effect (`:543-553`):

```ts
  // Keyed on the NONCE, not the text: following the same link twice must
  // reveal twice, and in the same-note case nothing else about this prop
  // changes. See `AppShell`'s comment on why the nonce exists.
  useEffect(() => {
    if (editor === null || revealHeading === undefined) return;

    const section = headingSections(editor.state.doc).find(
      (candidate) => normalizeTitle(candidate.text) === revealHeading.text,
    );
    // A heading that has been renamed or deleted since the link was written
    // costs the reader the scroll and nothing else — the note is already
    // open. This is the spec's answer to a stale heading, and it is why no
    // heading index exists.
    if (section === undefined) return;

    // Two separate commands, never one dispatching the other: a
    // `view.dispatch` inside a command body throws `RangeError: Applying a
    // mismatched transaction` (CLAUDE.md).
    editor.commands.setHeadingFolds(
      keysRevealing(editor.state.doc, foldedKeys(editor.state), section.pos),
    );
    editor.commands.revealHeading(revealHeading.text);

    // `block: 'start'` rather than `scrollIntoView()`: the latter scrolls the
    // minimum distance, which leaves the heading at the BOTTOM of the pane
    // when it was below the fold — technically visible, and useless.
    const node = editor.view.nodeDOM(section.pos);
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'start' });
  }, [editor, revealHeading]);
```

- [ ] **Step 9: Run and watch it pass**

Run: `npx vitest run src/features/editor/`
Expected: PASS.

- [ ] **Step 10: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/editor src/styles/editor.css
git commit -m "feat(editor): following a heading link unfolds, scrolls and flashes"
```

---

### Task 8: The `[[` popover's `/` mode

**Read first:** `docs/rulings/accessibility.md` — the combobox contract and
the row-glyph rule added on 2026-09-15.

**Files:**

- Modify: `src/features/editor/LinkAutocomplete.ts`
- Modify: `src/features/editor/linkAutocomplete.test.ts`
- Modify: `src/features/editor/RichEditor.tsx` (feed headings in)
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts` (the empty-state string)

**Interfaces:**

- Consumes: `splitLinkTarget`, `notes.headingsOf` (Tasks 1, 2).
- Produces: a `setLinkAutocompleteHeadings(title: string, headings: string[])`
  command and a `matchingHeadings(headings, query)` pure function.

- [ ] **Step 1: Write the failing test**

In `src/features/editor/linkAutocomplete.test.ts`:

```ts
  it('matches a heading query after the slash', () => {
    expect(matchingHeadings(['Rollback', 'Smoke tests'], 'smo')).toEqual(['Smoke tests']);
  });

  it('offers headings once the query has a slash and the prefix resolves', () => {
    // …mount with titles ['Deploy Checklist'] and headings for it,
    // …type `[[Deploy Checklist/`
    expect(rowTexts(container)).toEqual(['Rollback', 'Smoke tests']);
  });

  it('inserts the full Note/Heading form', () => {
    // …pick the first row
    expect(editor.getText()).toContain('[[Deploy Checklist/Rollback]]');
  });

  it('stays in note mode when the prefix names no note', () => {
    // …type `[[Nowhere/` with titles ['Deploy Checklist']
    // Nothing resolves, so the `/` is just a character in a title query.
    expect(rowTexts(container)).toEqual([]);
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/features/editor/linkAutocomplete.test.ts`
Expected: FAIL — `matchingHeadings` is not exported.

- [ ] **Step 3: Implement**

1. Add `matchingHeadings`, the exact shape of `matchingTitles` (prefix matches
   before substring, `MAX_RESULTS`, compared through `normalizeTitle`,
   returning the original casing). Do not generalise `matchingTitles` into a
   shared helper unless both end up identical line for line — a shared
   function that grows a `mode` flag is worse than two eight-line functions.
2. Extend the plugin state with `headings: { title: string; rows: readonly string[] } | null`
   and a `setLinkAutocompleteHeadings` command dispatching a meta, carrying
   `skipTrailingNodeMeta`.
3. In `decorations`, split the match's query with `splitLinkTarget` against
   the plugin's own `titles` (normalized on the fly). When it yields a
   heading — including the empty-heading case, which `splitLinkTarget` reports
   as no heading, so test the raw query for a trailing `/` separately — render
   heading rows instead of title rows, with the heading glyph.
4. `insertLink` composes `[[${title}/${heading}]]` in heading mode, inserting
   the stored casing of both.

In `RichEditor`, add an effect that watches the current match's resolved title
and fetches `notes.headingsOf(title)`, pushing the result in with the new
command. Read it through `useLiveQuery` on the title, or a plain effect with
an ignore-stale flag — but do NOT gate a write on a `useLiveQuery` whose deps
are not `[]` without reading `docs/rulings/notes-lifecycle.md` first.

Use `Heading1` for the row glyph — it is already in `ICON_NODES` (the fold
badge draws it), so no new verbatim copy and no new `Icon.test.tsx` row are
needed. Give the row a `bear-link-autocomplete-icon` span, which
`src/styles/editor.css` already styles from commit `ccd75f5`.

Add `linkAutocomplete.emptyHeadings` to `en.ts` and `ko.ts`.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/features/editor/linkAutocomplete.test.ts`
Expected: PASS.

- [ ] **Step 5: Look at it**

Screenshot the popover in both modes with the Task-10 recipe. Confirm the
rows line up with the note-mode rows and the glyph reads as a heading.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
npx vitest run src/features/editor/
git add src/features/editor src/i18n
git commit -m "feat(editor): typing / in the [[ popover offers the note's headings"
```

---

### Task 9: The two heading readers must agree

**Files:**

- Create: `src/features/editor/headingAgreement.test.ts`

**Interfaces:**

- Consumes: `findHeadings` (Task 2), `headingSections` and `parseMarkdown`
  from the editor.

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest';

import { findHeadings } from '@/data';

import { CORPUS } from '../../../e2e/fixtures/corpus';
import { headingSections } from './headingSections';
import { parseMarkdown } from './markdown';

/**
 * The spec names this as the risk of the whole sub-project: `findHeadings`
 * reads stored Markdown for a note nobody has opened, `headingSections` walks
 * the live document. They cannot be collapsed — different inputs — so this is
 * what keeps them from drifting.
 *
 * If this file is ever deleted, the symptom is a popover offering a heading
 * the navigator cannot find, which presents as "the link does nothing".
 */
describe('the two heading readers agree', () => {
  it.each(CORPUS.notes.map((note) => [note.title, note.text] as const))(
    'agrees on %s',
    (_title, text) => {
      const fromDoc = headingSections(parseMarkdown(text)).map((section) => section.text);

      expect(findHeadings(text)).toEqual(fromDoc);
    },
  );
});
```

> Check `parseMarkdown`'s real export name in
> `src/features/editor/markdown.ts` before writing this — and check the
> `e2e/` import is allowed from a `src/` test by `tsconfig.app.json`'s
> `include`. If it is not, copy three representative notes into a local
> fixture rather than widening the tsconfig.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/features/editor/headingAgreement.test.ts`
Expected: PASS. **If it fails, the bug is real** — fix the reader, not the
test. The likeliest divergence is the first-block rule.

- [ ] **Step 3: Commit**

```bash
git add src/features/editor/headingAgreement.test.ts
git commit -m "test(editor): pin the two heading readers to each other"
```

---

### Task 10: End-to-end, docs, and the full gate

**Files:**

- Create: `e2e/headingLinks.spec.ts`
- Modify: `e2e/fixtures/corpus.ts` — **only if unavoidable.** A note added
  here changes note-list geometry and drags `measurements.md` into an
  unrelated diff; type the links in the test instead, as
  `e2e/backlinks.spec.ts` does for its unresolved case.
- Modify: `docs/rulings/tag-pills.md`, `docs/rulings/accessibility.md`
- Modify: `CLAUDE.md` (status table row), `docs/superpowers/NEXT.md`

- [ ] **Step 1: Write the e2e spec**

Four tests, each asserting a value that changes with the behaviour:

```ts
test('a heading link opens the target note at that heading', async ({ page }) => {
  // seed two notes; click the pill; assert the target note's body is shown
  // AND that the heading is within the viewport — `toBeInViewport()`, not
  // `toBeVisible()`, which is true for anything rendered.
});

test('a heading link inside the current note scrolls without a remount', async ({ page }) => {
  // The nonce case. Assert the note did NOT change (the note-list row keeps
  // `aria-current`) and the heading is in the viewport.
});

test('a link to a folded section unfolds it', async ({ page }) => {
  // Fold the section first, then follow the link from the other note, and
  // assert the section's BODY TEXT is visible — not merely that a fold
  // attribute changed.
});

test('a link whose heading no longer exists still opens the note', async ({ page }) => {
  // Rename the heading, follow the link, assert the note opened and nothing
  // is marked broken.
});
```

- [ ] **Step 2: Run the e2e spec**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/headingLinks.spec.ts
```

- [ ] **Step 3: Prove the tests can fail**

For at least the unfold test and the nonce test, break the implementation on
purpose (delete the `setHeadingFolds` call; key the effect on `text` instead
of `nonce`), re-run, and confirm the right test fails. Restore afterwards.
Kill port 4173 before each run — a stale preview server silently serves the
old build and a fault injection then "passes".

- [ ] **Step 4: Update the rulings**

- `docs/rulings/tag-pills.md`: extend the trigger line with
  `splitLinkTarget.ts`, and add bullets for the `/` rule (whole string first,
  longest prefix, raw offsets), the tail-class glyph rule, and the nonce.
- `docs/rulings/accessibility.md`: the heading-mode rows and their glyph.

- [ ] **Step 5: Update the status docs**

Add a `U heading links` row to CLAUDE.md's table and a section to
`docs/superpowers/NEXT.md` describing what shipped and what was learned.
Update the test counts in CLAUDE.md from the real run in step 6.

- [ ] **Step 6: The full gate**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
npm run build
npm run measure:check
```

All six must pass. `measure:check` regenerates `docs/design/measurements.md`
— if it fails, regenerate and commit, and run `measure` on `main` too before
blaming this branch.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: heading links, end to end"
```

---

## Self-review

**Spec coverage.** Splitter → Task 1. Index unchanged, `linksTo` → Task 3.
`buildGraph` → Task 4. Rendering → Task 5. Following, nonce, unfold, scroll,
flash → Tasks 6 and 7. Autocomplete → Task 8. The two-readers risk → Task 9.
Testing section → spread across every task plus Task 10. Non-goals need no
task by construction: exports and publishing are untouched because `[[…]]` is
plain text, and no schema changes because no heading index exists.

**Placeholders.** Tasks 6, 8 and 10 describe test bodies rather than spelling
every line, because each depends on a harness helper whose real name must be
read from the file first — that is called out inline at each site rather than
left as "write tests for the above". Every pure function has complete code.

**Type consistency.** `LinkTarget { title, heading, slash }` is used with
those three names in Tasks 1, 4, 5 and 8. `onActivateLink(title, heading)` is
widened in Task 5 and consumed with that arity in Task 6.
`revealHeading { text, nonce }` is produced in Task 6 and consumed in Task 7.
`keysRevealing(doc, folded, pos)` is defined and called with that order in
Task 7.
