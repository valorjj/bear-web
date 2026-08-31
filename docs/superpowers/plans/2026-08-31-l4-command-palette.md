# L4 Command Palette Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `⌘K` input that reaches every capability in the app by name, plus jump-to-note by title.

**Architecture:** Two pure modules do the thinking — `matchCommands` ranks candidates by an explicit six-rule order, and `buildCommands` emits only the commands valid for the current state. `CommandPalette` is a dumb consumer built on the existing `Dialog`, reached through `React.lazy` because the bundle has 1,650 B of headroom. `AppShell` supplies every handler through one `CommandDeps` object and routes destructive commands into the `ConfirmDialog` it already owns.

**Tech Stack:** React 19, TypeScript 6, Tailwind v4, Dexie, Vitest, Playwright. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-08-31-l4-command-palette-design.md`

## Global Constraints

- **No new dependency may be added.** The matcher is hand-written; a fuzzy-match library is disqualified by the bundle headroom.
- **The bundle ceiling is 340,000 B gzipped and must NOT be raised by this branch.** `main` measured **338,350 B** after L3 — **1,650 B of headroom**. If `scripts/bundleSize.test.ts` fails, something leaked across the lazy boundary; find the leak and report BLOCKED rather than raising the number.
- **Every user-facing string goes through `useT`.** Add each key to BOTH `src/i18n/en.ts` and `src/i18n/ko.ts`. `ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error — **never weaken that annotation.**
- **Korean WORDING is explicitly not a gate for L4.** The user will swap Korean labels by hand afterwards. Supply a correct, compiling Korean string for every key and do not block on phrasing. **English labels ARE in scope** — they are what the matcher ranks against and what the tests assert.
- **Reuse existing keys wherever they exist.** The seven smart lists already have `smartList.all` … `smartList.trash`; every theme already has a `labelKey` in `THEMES`; sign-out already has `account.signOut.title` / `.body` / `.confirm` / `.cancel`. Do not duplicate these.
- **Every colour comes from a `--bear-*` token.** A literal hex or `rgb()` outside `src/styles/tokens.css` fails `scripts/sourceLint.test.ts`.
- **`lucide-react` may be imported only by `src/ui/Icon.tsx`**; other files use the glyphs it re-exports.
- **`src/features/palette/` must not import VALUES from `src/app/`.** Every handler arrives through `CommandDeps` — the palette never reaches into the shell. A **type-only** import is permitted and expected: `import type { ThemeChoice } from '@/app/theme'`, which is exactly what `src/features/appearance/ThemePicker.tsx` and `ThemeDialog.tsx` already do. `scripts/sourceLint.test.ts` guards `src/ui`, `src/lib` and `src/data`, not `src/features` → `src/app`, so this is a convention rather than an enforced rule — keep to it anyway.
- **Components reach persistence only through `src/data/index.ts`.**
- `import type` for every type-only import (`verbatimModuleSyntax`). No `enum`, no parameter properties, no namespaces (`erasableSyntaxOnly`). `noUnusedLocals` and `noUnusedParameters` are on. Prettier: 2-space, single quotes, semicolons, trailing commas, width 100.
- **Repetition targets FILES, never the suite:** `npx vitest run src/features/palette/`, not `npm test`.

---

### Task 1: `matchCommands` — the ranking rule

**Files:**

- Create: `src/features/palette/matchCommands.ts`
- Create: `src/features/palette/matchCommands.test.ts`

**Interfaces:**

- Consumes: `normalizeForSearch` from `@/features/notes` (it is `(text: string) => text.normalize('NFC').toLowerCase()`).
- Produces:

```ts
export interface Matchable { id: string; label: string }
export function matchOne(label: string, query: string): MatchQuality | null
export function matchAll<T extends Matchable>(items: readonly T[], query: string): T[]
export interface MatchQuality {
  startsWith: boolean;
  allBoundary: boolean;
  boundaryCount: number;
  span: number;
  length: number;
}
```

- [ ] **Step 1: Write the failing test**

`src/features/palette/matchCommands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { matchAll, matchOne } from './matchCommands';

const item = (id: string, label: string) => ({ id, label });

describe('matchOne', () => {
  it('matches a subsequence, not just a substring', () => {
    // "epdf" -> Export as PDF. This is the whole reason for a custom matcher.
    expect(matchOne('Export as PDF', 'epdf')).not.toBeNull();
  });

  it('rejects characters that are out of order', () => {
    expect(matchOne('Export as PDF', 'fdpe')).toBeNull();
  });

  it('rejects a character the label does not contain', () => {
    expect(matchOne('Export as PDF', 'epdfz')).toBeNull();
  });

  it('matches everything on an empty query', () => {
    expect(matchOne('Anything', '')).not.toBeNull();
  });

  it('folds case and normalizes', () => {
    expect(matchOne('Export as PDF', 'EXPORT')).not.toBeNull();
  });

  it('reports whether every matched character landed on a word boundary', () => {
    // "eap" -> E(xport) a(s) P(DF): three boundaries, nothing mid-word.
    expect(matchOne('Export as PDF', 'eap')?.allBoundary).toBe(true);
    // "xp" lands mid-word in "Export".
    expect(matchOne('Export as PDF', 'xp')?.allBoundary).toBe(false);
  });
});

describe('matchAll ranking', () => {
  it('puts a prefix match first', () => {
    const items = [item('trash-empty', 'Empty trash'), item('trash-move', 'Move to trash')];

    // Neither starts with "trash"; both match. Now add one that does.
    const withPrefix = [...items, item('trash-go', 'Trash')];
    expect(matchAll(withPrefix, 'trash')[0]!.id).toBe('trash-go');
  });

  it('prefers an all-boundary match over a mid-word one', () => {
    const items = [item('mid', 'Sync export'), item('bound', 'Export as PDF')];

    // "exp" is a prefix of "Export" in `bound` (boundary at index 0) but lands
    // mid-label in `mid`.
    expect(matchAll(items, 'exp')[0]!.id).toBe('bound');
  });

  it('prefers a tighter span when boundary quality ties', () => {
    const items = [item('loose', 'New note from template'), item('tight', 'New note')];

    expect(matchAll(items, 'nn')[0]!.id).toBe('tight');
  });

  it('prefers the shorter label when everything else ties', () => {
    const items = [item('long', 'Pin note to the top'), item('short', 'Pin note')];

    expect(matchAll(items, 'pin')[0]!.id).toBe('short');
  });

  it('breaks remaining ties by id, so the order is stable', () => {
    // Identical labels: only the id can decide, and it must decide the same
    // way every run — an unstable order is an unstable UI and untestable.
    const items = [item('b', 'Same label'), item('a', 'Same label')];

    expect(matchAll(items, 'same').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('returns every item, in id order, for an empty query', () => {
    const items = [item('b', 'Beta'), item('a', 'Alpha')];

    expect(matchAll(items, '   ').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('drops non-matching items entirely', () => {
    const items = [item('a', 'Alpha'), item('b', 'Beta')];

    expect(matchAll(items, 'alp').map((i) => i.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/palette/matchCommands.test.ts`
Expected: FAIL — cannot resolve `./matchCommands`.

- [ ] **Step 3: Write the implementation**

`src/features/palette/matchCommands.ts`:

```ts
import { normalizeForSearch } from '@/features/notes';

/** The minimum a thing needs to be rankable: a stable id and a display label. */
export interface Matchable {
  id: string;
  label: string;
}

export interface MatchQuality {
  /** The label begins with the query. The strongest signal. */
  startsWith: boolean;
  /** Every matched character landed on a word boundary. */
  allBoundary: boolean;
  /** How many matched characters landed on a word boundary. */
  boundaryCount: number;
  /** First to last matched character, inclusive. Tighter is better. */
  span: number;
  /** Label length. Shorter is better, all else equal. */
  length: number;
}

/** A character is on a boundary if it opens the label or follows one of these. */
const BOUNDARIES = new Set([' ', '/', '-', ':']);

/**
 * How well `query` matches `label`, or `null` if it does not match at all.
 *
 * A match means the query's characters appear in the label IN ORDER — a
 * subsequence, not a substring, so `epdf` finds "Export as PDF". Both sides
 * fold through `normalizeForSearch`, which is NFC + lowercase, so this works
 * in Korean as well as English.
 *
 * The scan is greedy: it takes the first available position for each query
 * character rather than searching for the tightest possible arrangement.
 * Greedy is not always span-optimal, but it is O(n), deterministic, and the
 * difference cannot be seen on labels this short.
 */
export function matchOne(label: string, query: string): MatchQuality | null {
  const haystack = normalizeForSearch(label);
  const needle = normalizeForSearch(query.trim());

  if (needle === '') {
    return { startsWith: true, allBoundary: true, boundaryCount: 0, span: 0, length: label.length };
  }

  let qi = 0;
  let first = -1;
  let last = -1;
  let boundaryCount = 0;
  let allBoundary = true;

  for (let i = 0; i < haystack.length && qi < needle.length; i += 1) {
    if (haystack[i] !== needle[qi]) continue;

    const onBoundary = i === 0 || BOUNDARIES.has(haystack[i - 1]!);
    if (onBoundary) boundaryCount += 1;
    else allBoundary = false;

    if (first === -1) first = i;
    last = i;
    qi += 1;
  }

  if (qi < needle.length) return null;

  return {
    startsWith: haystack.startsWith(needle),
    allBoundary,
    boundaryCount,
    span: last - first + 1,
    length: label.length,
  };
}

/** Negative if `a` should rank before `b`. The spec's six rules, in order. */
function compare(a: MatchQuality, b: MatchQuality, aId: string, bId: string): number {
  if (a.startsWith !== b.startsWith) return a.startsWith ? -1 : 1;
  if (a.allBoundary !== b.allBoundary) return a.allBoundary ? -1 : 1;
  if (a.boundaryCount !== b.boundaryCount) return b.boundaryCount - a.boundaryCount;
  if (a.span !== b.span) return a.span - b.span;
  if (a.length !== b.length) return a.length - b.length;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/**
 * The matching items, best first.
 *
 * Rule 6 — the `id` tie-break — is not decoration. Without it two equally
 * good matches would order by whatever `sort` happened to do, which makes the
 * highlighted row move between renders and makes the tests unassertable.
 */
export function matchAll<T extends Matchable>(items: readonly T[], query: string): T[] {
  const scored: { item: T; quality: MatchQuality }[] = [];

  for (const item of items) {
    const quality = matchOne(item.label, query);
    if (quality !== null) scored.push({ item, quality });
  }

  scored.sort((a, b) => compare(a.quality, b.quality, a.item.id, b.item.id));
  return scored.map((entry) => entry.item);
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/features/palette/matchCommands.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/palette/matchCommands.ts src/features/palette/matchCommands.test.ts
git commit -m "feat(l4): rank palette candidates by an explicit six-rule order"
```

---

### Task 2: `commands.ts` — types, and the navigation + appearance groups

**Files:**

- Create: `src/features/palette/commands.ts`
- Create: `src/features/palette/commands.test.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `Matchable` from Task 1; `SMART_LIST_IDS`, `smartScope`, `type NoteScope`, `type NoteOrder`, `type PreviewSize` from `@/features/notes`; `THEMES` from `@/styles/themes`; `type ThemeChoice` from `@/app/theme` — **type-only, so it does not breach the no-`src/app/` rule for VALUES**; `TranslationKey` from `@/i18n`.
- Produces:

```ts
export type CommandGroup = 'navigation' | 'note' | 'appearance' | 'account';
export interface Command extends Matchable {
  id: string;
  group: CommandGroup;
  label: string;
  hint?: string;
  destructive?: boolean;
  run: () => void;
}
export interface CommandDeps { /* full shape in Step 3 */ }
export function buildCommands(deps: CommandDeps): Command[]
```

- [ ] **Step 1: Add the i18n keys**

Only these are new. The seven smart lists reuse `smartList.*`, every theme reuses its `labelKey` from `THEMES`, and sign-out reuses `account.signOut.*`.

`src/i18n/en.ts`:

```ts
  'palette.label': 'Command palette',
  'palette.placeholder': 'Type a command or search notes…',
  'palette.group.navigation': 'Go to',
  'palette.group.note': 'Note',
  'palette.group.appearance': 'Appearance',
  'palette.group.account': 'Account',
  'palette.group.notes': 'Notes',
  'palette.empty': 'No matches',
  'palette.createNote': 'Create note titled',
  'palette.command.openGraph': 'Open graph',
  'palette.command.search': 'Search notes',
  'palette.command.theme': 'Theme',
  'palette.command.newNote': 'New note',
  'palette.command.duplicateNote': 'Duplicate note',
  'palette.command.pinNote': 'Pin note',
  'palette.command.unpinNote': 'Unpin note',
  'palette.command.trashNote': 'Move note to trash',
  'palette.command.restoreNote': 'Restore note',
  'palette.command.emptyTrash': 'Empty trash',
  'palette.command.exportMarkdown': 'Export as Markdown',
  'palette.command.exportHtml': 'Export as HTML',
  'palette.command.exportPdf': 'Export as PDF',
  'palette.command.previewSize': 'Preview size',
  'palette.command.sortBy': 'Sort by',
  'palette.command.hideSubTagNotes': 'Toggle hiding sub-tag notes',
  'palette.command.signIn': 'Sign in',
  'palette.command.signOut': 'Sign out',
  'palette.command.syncNow': 'Sync now',
```

`src/i18n/ko.ts` — same keys. Supply a correct, compiling Korean string for each; the user swaps the wording later, so do not agonise:

```ts
  'palette.label': '명령 팔레트',
  'palette.placeholder': '명령을 입력하거나 노트를 검색하세요…',
  'palette.group.navigation': '이동',
  'palette.group.note': '노트',
  'palette.group.appearance': '모양',
  'palette.group.account': '계정',
  'palette.group.notes': '노트',
  'palette.empty': '일치하는 항목이 없습니다',
  'palette.createNote': '이 제목으로 노트 만들기',
  'palette.command.openGraph': '그래프 열기',
  'palette.command.search': '노트 검색',
  'palette.command.theme': '테마',
  'palette.command.newNote': '새 노트',
  'palette.command.duplicateNote': '노트 복제',
  'palette.command.pinNote': '노트 고정',
  'palette.command.unpinNote': '노트 고정 해제',
  'palette.command.trashNote': '노트를 휴지통으로',
  'palette.command.restoreNote': '노트 복원',
  'palette.command.emptyTrash': '휴지통 비우기',
  'palette.command.exportMarkdown': 'Markdown으로 내보내기',
  'palette.command.exportHtml': 'HTML로 내보내기',
  'palette.command.exportPdf': 'PDF로 내보내기',
  'palette.command.previewSize': '미리보기 크기',
  'palette.command.sortBy': '정렬 기준',
  'palette.command.hideSubTagNotes': '하위 태그 노트 숨기기 전환',
  'palette.command.signIn': '로그인',
  'palette.command.signOut': '로그아웃',
  'palette.command.syncNow': '지금 동기화',
```

- [ ] **Step 2: Write the failing test**

`src/features/palette/commands.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';

import { en } from '@/i18n';

import { buildCommands, type CommandDeps } from './commands';

/** Every dep a no-op, every state flag false. Tests override what they need. */
function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    t: (key) => en[key],
    hasOpenNote: false,
    openNoteTrashed: false,
    openNotePinned: false,
    signedIn: false,
    hasQuery: false,
    onScope: vi.fn(),
    onOpenGraph: vi.fn(),
    onFocusSearch: vi.fn(),
    onNewNote: vi.fn(),
    onDuplicateNote: vi.fn(),
    onTogglePin: vi.fn(),
    onTrashNote: vi.fn(),
    onRestoreNote: vi.fn(),
    onEmptyTrash: vi.fn(),
    onExport: vi.fn(),
    onSetTheme: vi.fn(),
    onSetPreviewSize: vi.fn(),
    onSetOrder: vi.fn(),
    onToggleHideSubTagNotes: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onSyncNow: vi.fn(),
    ...overrides,
  };
}

const ids = (d: CommandDeps) => buildCommands(d).map((c) => c.id);

describe('buildCommands — navigation', () => {
  it('offers all seven smart lists plus graph and search', () => {
    const list = ids(deps());

    for (const id of ['all', 'untagged', 'todo', 'today', 'pinned', 'locked', 'trash']) {
      expect(list).toContain(`go.${id}`);
    }
    expect(list).toContain('go.graph');
    expect(list).toContain('go.search');
  });

  it('routes a smart-list command through onScope', () => {
    const onScope = vi.fn();
    buildCommands(deps({ onScope }))
      .find((c) => c.id === 'go.trash')!
      .run();

    expect(onScope).toHaveBeenCalledTimes(1);
  });
});

describe('buildCommands — appearance', () => {
  it('omits theme commands with no query, so the empty state stays legible', () => {
    // 16 theme rows would drown the "what can this app do?" list.
    expect(ids(deps({ hasQuery: false })).filter((id) => id.startsWith('theme.'))).toEqual([]);
  });

  it('offers one command per theme once something is typed', () => {
    const themeIds = ids(deps({ hasQuery: true })).filter((id) => id.startsWith('theme.'));

    expect(themeIds.length).toBeGreaterThanOrEqual(16);
  });

  it('routes a theme command through onSetTheme', () => {
    const onSetTheme = vi.fn();
    const command = buildCommands(deps({ hasQuery: true, onSetTheme })).find((c) =>
      c.id.startsWith('theme.'),
    )!;
    command.run();

    expect(onSetTheme).toHaveBeenCalledTimes(1);
  });
});

describe('buildCommands — the destructive invariant', () => {
  it('marks every irreversible command destructive', () => {
    // A rule that rots silently as commands are added. `emptyTrash` and
    // `signOut` have no undo; `trashNote` is reversible but still guarded,
    // matching how the note-row menu already treats it.
    const all = buildCommands(deps({ hasOpenNote: true, signedIn: true, hasQuery: true }));
    const mustGuard = ['note.trash', 'note.emptyTrash', 'account.signOut'];

    for (const id of mustGuard) {
      const command = all.find((c) => c.id === id);
      expect(command, `${id} missing`).toBeDefined();
      expect(command!.destructive, `${id} not marked destructive`).toBe(true);
    }
  });

  it('marks nothing else destructive', () => {
    const all = buildCommands(deps({ hasOpenNote: true, signedIn: true, hasQuery: true }));
    const flagged = all.filter((c) => c.destructive === true).map((c) => c.id).sort();

    expect(flagged).toEqual(['account.signOut', 'note.emptyTrash', 'note.trash']);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run src/features/palette/commands.test.ts`
Expected: FAIL — cannot resolve `./commands`.

- [ ] **Step 4: Write the implementation**

`src/features/palette/commands.ts`. Note the two halves: navigation and appearance here; note actions and account arrive in Task 3, so leave the `deps` fields they need declared but unused for now — `noUnusedLocals` applies to locals, not to interface members, so a declared-and-unread dep is fine.

```ts
import type { ThemeChoice } from '@/app/theme';
import {
  type NoteOrder,
  type PreviewSize,
  SMART_LIST_IDS,
  smartScope,
  type NoteScope,
} from '@/features/notes';
import type { TranslationKey } from '@/i18n';
import { THEMES } from '@/styles/themes';

import type { Matchable } from './matchCommands';

export type CommandGroup = 'navigation' | 'note' | 'appearance' | 'account';

export interface Command extends Matchable {
  id: string;
  group: CommandGroup;
  /** Already translated. What the matcher ranks against. */
  label: string;
  /** A shortcut hint, already formatted for display. */
  hint?: string;
  /**
   * Routed through `ConfirmDialog` by the caller instead of run inline.
   * Every irreversible command carries it; `commands.test.ts` asserts the
   * exact set, so adding one without the flag fails loudly.
   */
  destructive?: boolean;
  run: () => void;
}

export interface CommandDeps {
  t: (key: TranslationKey) => string;

  /** State the command set depends on. */
  hasOpenNote: boolean;
  openNoteTrashed: boolean;
  openNotePinned: boolean;
  signedIn: boolean;
  /** Whether the user has typed anything. Gates the sixteen theme commands. */
  hasQuery: boolean;

  onScope: (scope: NoteScope) => void;
  onOpenGraph: () => void;
  onFocusSearch: () => void;
  onNewNote: () => void;
  onDuplicateNote: () => void;
  onTogglePin: () => void;
  onTrashNote: () => void;
  onRestoreNote: () => void;
  onEmptyTrash: () => void;
  onExport: (format: 'markdown' | 'html' | 'pdf') => void;
  onSetTheme: (choice: ThemeChoice) => void;
  onSetPreviewSize: (size: PreviewSize) => void;
  onSetOrder: (order: NoteOrder) => void;
  onToggleHideSubTagNotes: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
}

/**
 * Every command valid for the CURRENT state, and no others.
 *
 * Absent rather than disabled, deliberately: an entry you can arrow onto and
 * press Enter on, which then does nothing, is worse than one that is not
 * there. It also makes the tests assertions about which commands EXIST for a
 * given state, which is where the bugs are.
 *
 * Pure — no React, no DOM, no database. `AppShell` owns every handler and
 * passes it in, which is what keeps `src/features/palette/` from importing
 * `src/app/` for anything but a type.
 */
export function buildCommands(deps: CommandDeps): Command[] {
  const { t } = deps;
  const commands: Command[] = [];

  for (const list of SMART_LIST_IDS) {
    commands.push({
      id: `go.${list}`,
      group: 'navigation',
      label: t(`smartList.${list}` as TranslationKey),
      run: () => deps.onScope(smartScope(list)),
    });
  }

  commands.push({
    id: 'go.graph',
    group: 'navigation',
    label: t('palette.command.openGraph'),
    hint: '⇧⌘G',
    run: deps.onOpenGraph,
  });

  commands.push({
    id: 'go.search',
    group: 'navigation',
    label: t('palette.command.search'),
    hint: '⌘F',
    run: deps.onFocusSearch,
  });

  // Sixteen theme rows would swamp the empty state, whose job is to answer
  // "what can this app do?". Typing anything at all brings them back.
  if (deps.hasQuery) {
    for (const theme of THEMES) {
      commands.push({
        id: `theme.${theme.id}`,
        group: 'appearance',
        label: `${t('palette.command.theme')}: ${t(theme.labelKey)}`,
        run: () => deps.onSetTheme(theme.id),
      });
    }
  }

  commands.push({
    id: 'appearance.hideSubTagNotes',
    group: 'appearance',
    label: t('palette.command.hideSubTagNotes'),
    run: deps.onToggleHideSubTagNotes,
  });

  return commands;
}
```

- [ ] **Step 5: Run it and watch the destructive tests fail, the rest pass**

Run: `npx vitest run src/features/palette/commands.test.ts`
Expected: the navigation and appearance describes PASS; the two "destructive invariant" tests FAIL, because `note.*` and `account.*` commands arrive in Task 3.

**Mark those two tests `it.skip` with the comment `// Unskipped by Task 3, which adds the note and account groups.`** Do not delete them — they are Task 3's acceptance criteria and a deleted test is one nobody remembers to write.

- [ ] **Step 6: Re-run, cheap gates, commit**

```bash
npx vitest run src/features/palette/
npm run typecheck && npm run lint && npm run format
git add src/features/palette/ src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(l4): command types, plus the navigation and appearance groups"
```

---

### Task 3: note actions and the account group

**Files:**

- Modify: `src/features/palette/commands.ts`
- Modify: `src/features/palette/commands.test.ts`

**Interfaces:**

- Consumes: everything from Task 2.
- Produces: no new exports. Adds command ids `note.new`, `note.duplicate`, `note.pin`, `note.unpin`, `note.trash`, `note.restore`, `note.emptyTrash`, `note.exportMarkdown`, `note.exportHtml`, `note.exportPdf`, `account.signIn`, `account.signOut`, `account.syncNow`.

- [ ] **Step 1: Unskip the two invariant tests and add the state tests**

Remove the `it.skip` markers added in Task 2. Then add:

```ts
describe('buildCommands — note actions follow the open note', () => {
  it('offers only New note when nothing is open', () => {
    const noteIds = ids(deps({ hasOpenNote: false })).filter((id) => id.startsWith('note.'));

    expect(noteIds).toEqual(['note.new']);
  });

  it('offers duplicate, pin and trash when a live note is open', () => {
    const noteIds = ids(deps({ hasOpenNote: true }));

    expect(noteIds).toContain('note.duplicate');
    expect(noteIds).toContain('note.pin');
    expect(noteIds).toContain('note.trash');
    expect(noteIds).not.toContain('note.restore');
  });

  it('swaps pin for unpin when the note is pinned', () => {
    const noteIds = ids(deps({ hasOpenNote: true, openNotePinned: true }));

    expect(noteIds).toContain('note.unpin');
    expect(noteIds).not.toContain('note.pin');
  });

  it('offers restore and NOT trash when the open note is trashed', () => {
    const noteIds = ids(deps({ hasOpenNote: true, openNoteTrashed: true }));

    expect(noteIds).toContain('note.restore');
    expect(noteIds).not.toContain('note.trash');
    // Exporting a trashed note is not a thing the app offers anywhere else.
    expect(noteIds).not.toContain('note.exportPdf');
  });

  it('offers all three exports for a live note, but PDF only when signed in', () => {
    const guest = ids(deps({ hasOpenNote: true, signedIn: false }));
    expect(guest).toContain('note.exportMarkdown');
    expect(guest).toContain('note.exportHtml');
    // PDF renders server-side and does not exist without an account — the
    // export menu already marks it aria-disabled when signed out.
    expect(guest).not.toContain('note.exportPdf');

    expect(ids(deps({ hasOpenNote: true, signedIn: true }))).toContain('note.exportPdf');
  });

  it('routes each export through onExport with its format', () => {
    const onExport = vi.fn();
    buildCommands(deps({ hasOpenNote: true, onExport }))
      .find((c) => c.id === 'note.exportHtml')!
      .run();

    expect(onExport).toHaveBeenCalledWith('html');
  });
});

describe('buildCommands — account', () => {
  it('offers sign in when signed out, and sign out plus sync when signed in', () => {
    expect(ids(deps({ signedIn: false }))).toContain('account.signIn');
    expect(ids(deps({ signedIn: false }))).not.toContain('account.syncNow');

    const member = ids(deps({ signedIn: true }));
    expect(member).toContain('account.signOut');
    expect(member).toContain('account.syncNow');
    expect(member).not.toContain('account.signIn');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/features/palette/commands.test.ts`
Expected: FAIL — the new `note.*` and `account.*` ids do not exist, and both invariant tests fail.

- [ ] **Step 3: Implement, appending to `buildCommands` before its `return`**

```ts
  commands.push({
    id: 'note.new',
    group: 'note',
    label: t('palette.command.newNote'),
    run: deps.onNewNote,
  });

  if (deps.hasOpenNote && !deps.openNoteTrashed) {
    commands.push({
      id: 'note.duplicate',
      group: 'note',
      label: t('palette.command.duplicateNote'),
      run: deps.onDuplicateNote,
    });

    commands.push(
      deps.openNotePinned
        ? {
            id: 'note.unpin',
            group: 'note',
            label: t('palette.command.unpinNote'),
            run: deps.onTogglePin,
          }
        : {
            id: 'note.pin',
            group: 'note',
            label: t('palette.command.pinNote'),
            run: deps.onTogglePin,
          },
    );

    commands.push({
      id: 'note.trash',
      group: 'note',
      label: t('palette.command.trashNote'),
      destructive: true,
      run: deps.onTrashNote,
    });

    commands.push({
      id: 'note.exportMarkdown',
      group: 'note',
      label: t('palette.command.exportMarkdown'),
      run: () => deps.onExport('markdown'),
    });

    commands.push({
      id: 'note.exportHtml',
      group: 'note',
      label: t('palette.command.exportHtml'),
      run: () => deps.onExport('html'),
    });

    // PDF is rendered server-side and is the first capability in this app that
    // does not exist without an account. Absent rather than disabled here,
    // matching how `buildCommands` treats every other invalid command.
    if (deps.signedIn) {
      commands.push({
        id: 'note.exportPdf',
        group: 'note',
        label: t('palette.command.exportPdf'),
        run: () => deps.onExport('pdf'),
      });
    }
  }

  if (deps.hasOpenNote && deps.openNoteTrashed) {
    commands.push({
      id: 'note.restore',
      group: 'note',
      label: t('palette.command.restoreNote'),
      run: deps.onRestoreNote,
    });
  }

  commands.push({
    id: 'note.emptyTrash',
    group: 'note',
    label: t('palette.command.emptyTrash'),
    destructive: true,
    run: deps.onEmptyTrash,
  });

  if (deps.signedIn) {
    commands.push({
      id: 'account.signOut',
      group: 'account',
      label: t('palette.command.signOut'),
      destructive: true,
      run: deps.onSignOut,
    });

    commands.push({
      id: 'account.syncNow',
      group: 'account',
      label: t('palette.command.syncNow'),
      run: deps.onSyncNow,
    });
  } else {
    commands.push({
      id: 'account.signIn',
      group: 'account',
      label: t('palette.command.signIn'),
      run: deps.onSignIn,
    });
  }
```

- [ ] **Step 4: Run and watch everything pass**

Run: `npx vitest run src/features/palette/commands.test.ts`
Expected: PASS — all describes, including both previously-skipped invariant tests.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/palette/commands.ts src/features/palette/commands.test.ts
git commit -m "feat(l4): note-action and account commands, gated on real state"
```

---

### Task 4: `CommandPalette` — the surface

**Files:**

- Create: `src/features/palette/CommandPalette.tsx`
- Create: `src/features/palette/commandPalette.test.tsx`

**Interfaces:**

- Consumes: `buildCommands`, `Command`, `CommandDeps` (Tasks 2-3); `matchAll` (Task 1); `notes.allNoteIndex()` from `@/data`; `Dialog` from `@/ui/Dialog`; `useT` from `@/i18n`.
- Produces:

```ts
export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Everything buildCommands needs EXCEPT `hasQuery`, which the palette owns. */
  deps: Omit<CommandDeps, 'hasQuery'>;
  /** Called with a note id when a note result is chosen. */
  onOpenNote: (id: string) => void;
  /** Called with the raw query when the create-note offer is chosen. */
  onCreateNote: (title: string) => void;
}
export function CommandPalette(props: CommandPaletteProps): ReactElement | null
export default CommandPalette   // React.lazy needs a default
```

- [ ] **Step 1: Write the failing test**

`src/features/palette/commandPalette.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { en, I18nProvider } from '@/i18n';

import { CommandPalette } from './CommandPalette';
import type { CommandDeps } from './commands';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteLinks.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function baseDeps(overrides: Partial<Omit<CommandDeps, 'hasQuery'>> = {}) {
  return {
    t: (key: keyof typeof en) => en[key],
    hasOpenNote: false,
    openNoteTrashed: false,
    openNotePinned: false,
    signedIn: false,
    onScope: vi.fn(),
    onOpenGraph: vi.fn(),
    onFocusSearch: vi.fn(),
    onNewNote: vi.fn(),
    onDuplicateNote: vi.fn(),
    onTogglePin: vi.fn(),
    onTrashNote: vi.fn(),
    onRestoreNote: vi.fn(),
    onEmptyTrash: vi.fn(),
    onExport: vi.fn(),
    onSetTheme: vi.fn(),
    onSetPreviewSize: vi.fn(),
    onSetOrder: vi.fn(),
    onToggleHideSubTagNotes: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onSyncNow: vi.fn(),
    ...overrides,
  } as Omit<CommandDeps, 'hasQuery'>;
}

function renderPalette(extra: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenNote = vi.fn();
  const onCreateNote = vi.fn();
  render(
    <I18nProvider locale="en">
      <CommandPalette
        open
        onClose={onClose}
        deps={baseDeps()}
        onOpenNote={onOpenNote}
        onCreateNote={onCreateNote}
        {...extra}
      />
    </I18nProvider>,
  );
  return { onClose, onOpenNote, onCreateNote };
}

const options = () => screen.queryAllByRole('option');

describe('CommandPalette', () => {
  it('shows commands and ZERO notes on an empty query', async () => {
    await notes.create('# Kafka rebalancing');

    renderPalette();
    await waitFor(() => expect(options().length).toBeGreaterThan(0));

    // A count, not a presence check: the rule is "no notes until you type".
    expect(screen.queryByRole('option', { name: /Kafka rebalancing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Open graph' })).toBeInTheDocument();
  });

  it('shows matching notes once something is typed', async () => {
    await notes.create('# Kafka rebalancing');

    renderPalette();
    await userEvent.type(screen.getByRole('combobox'), 'kafka');

    expect(await screen.findByRole('option', { name: /Kafka rebalancing/ })).toBeInTheDocument();
  });

  it('tracks the highlighted option with aria-activedescendant, and keeps focus in the input', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));

    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();

    await userEvent.keyboard('{ArrowDown}');

    const second = input.getAttribute('aria-activedescendant');
    // The VALUE must change — asserting the attribute merely exists would
    // pass against an implementation that never updates it.
    expect(second).not.toBe(first);
    expect(second).toBe(options()[1]!.id);
    // Focus stays put; arrows must not move it into the list or typing breaks.
    expect(input).toHaveFocus();
  });

  it('wraps at both ends', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));

    await userEvent.keyboard('{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id);

    await userEvent.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });

  it('runs the highlighted command on Enter and closes', async () => {
    const onOpenGraph = vi.fn();
    const { onClose } = renderPalette({ deps: baseDeps({ onOpenGraph }) });

    await userEvent.type(screen.getByRole('combobox'), 'open graph');
    await userEvent.keyboard('{Enter}');

    expect(onOpenGraph).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT run a destructive command inline — it reports it and closes', async () => {
    const onEmptyTrash = vi.fn();
    renderPalette({ deps: baseDeps({ onEmptyTrash }) });

    await userEvent.type(screen.getByRole('combobox'), 'empty trash');
    await userEvent.keyboard('{Enter}');

    // `onEmptyTrash` IS the "please confirm this" callback — AppShell wires it
    // to its `pending` union, not to the mutation. So it is called exactly
    // once and nothing is deleted here. Task 5 asserts the confirm end.
    expect(onEmptyTrash).toHaveBeenCalledTimes(1);
  });

  it('offers to create a note when nothing matches', async () => {
    const { onCreateNote } = renderPalette();

    await userEvent.type(screen.getByRole('combobox'), 'zzz nothing matches this');
    const offer = await screen.findByRole('option', { name: /Create note titled/ });
    await userEvent.click(offer);

    expect(onCreateNote).toHaveBeenCalledWith('zzz nothing matches this');
  });

  it('renders nothing when closed', () => {
    render(
      <I18nProvider locale="en">
        <CommandPalette
          open={false}
          onClose={vi.fn()}
          deps={baseDeps()}
          onOpenNote={vi.fn()}
          onCreateNote={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/features/palette/commandPalette.test.tsx`
Expected: FAIL — cannot resolve `./CommandPalette`.

- [ ] **Step 3: Implement**

`src/features/palette/CommandPalette.tsx`. Key points, all load-bearing:

- `open === false` returns `null` before any hook that reads the database, so a closed palette costs nothing.
- Note titles come from `notes.allNoteIndex()` in a `useEffect` that runs when `open` flips to true — a snapshot, matching the graph's reasoning.
- The highlighted index resets to 0 on every query change, or the cursor lands on whatever row happens to be at the old index.
- Results are one flat array with section headers rendered between groups, so `aria-activedescendant` and arrow arithmetic work over a single index space. Two separate lists would need two cursors.

```tsx
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

import { notes as notesRepo, type TitledNote } from '@/data';
import { useT } from '@/i18n';
import { Dialog } from '@/ui/Dialog';

import { buildCommands, type Command, type CommandDeps } from './commands';
import { matchAll } from './matchCommands';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  deps: Omit<CommandDeps, 'hasQuery'>;
  onOpenNote: (id: string) => void;
  onCreateNote: (title: string) => void;
}

/** How many note results the list will show. */
const NOTE_LIMIT = 8;

type Row =
  | { kind: 'command'; id: string; label: string; hint?: string; run: () => void }
  | { kind: 'note'; id: string; label: string }
  | { kind: 'create'; id: string; label: string };

export function CommandPalette({
  open,
  onClose,
  deps,
  onOpenNote,
  onCreateNote,
}: CommandPaletteProps): ReactElement | null {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState<TitledNote[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // A snapshot taken when the palette opens, not a live subscription: it is
  // open for seconds, and a list reordering under the cursor mid-keystroke is
  // worse than being one save stale.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void notesRepo.allNoteIndex().then((rows) => {
      if (live) setNoteIndex(rows);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // Reopening starts clean rather than resuming someone else's half-typed query.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const commands = useMemo(
    () => buildCommands({ ...deps, hasQuery: query.trim() !== '' }),
    [deps, query],
  );

  const rows = useMemo<Row[]>(() => {
    const matchedCommands = matchAll(commands, query).map(
      (command: Command): Row => ({
        kind: 'command',
        id: `cmd-${command.id}`,
        label: command.label,
        hint: command.hint,
        run: command.run,
      }),
    );

    const trimmed = query.trim();
    const matchedNotes =
      trimmed === ''
        ? []
        : matchAll(
            noteIndex.map((note) => ({ id: note.id, label: note.title })),
            query,
          )
            .slice(0, NOTE_LIMIT)
            .map((note): Row => ({ kind: 'note', id: `note-${note.id}`, label: note.label }));

    if (matchedCommands.length === 0 && matchedNotes.length === 0 && trimmed !== '') {
      return [
        {
          kind: 'create',
          id: 'create',
          label: `${t('palette.createNote')} "${trimmed}"`,
        },
      ];
    }

    return [...matchedCommands, ...matchedNotes];
  }, [commands, noteIndex, query, t]);

  // Without this the cursor stays at an index that now names a different row.
  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const active = rows[Math.min(index, rows.length - 1)];

  function choose(row: Row | undefined): void {
    if (row === undefined) return;
    if (row.kind === 'command') row.run();
    else if (row.kind === 'note') onOpenNote(row.id.slice('note-'.length));
    else onCreateNote(query.trim());
    onClose();
  }

  return (
    <Dialog open onClose={onClose} label={t('palette.label')} className="w-full max-w-xl p-0">
      <input
        ref={inputRef}
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={active?.id}
        aria-label={t('palette.label')}
        placeholder={t('palette.placeholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (rows.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((current) => (current + 1) % rows.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((current) => (current - 1 + rows.length) % rows.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(active);
          }
        }}
        className="border-border text-text w-full border-b bg-transparent px-4 py-3 text-ui outline-none"
      />

      <ul id="palette-list" role="listbox" aria-label={t('palette.label')} className="max-h-80 overflow-y-auto py-1">
        {rows.length === 0 && (
          <li className="text-muted px-4 py-3 text-ui-sm">{t('palette.empty')}</li>
        )}
        {rows.map((row, position) => (
          <li
            key={row.id}
            id={row.id}
            role="option"
            aria-selected={position === index}
            onMouseEnter={() => setIndex(position)}
            onClick={() => choose(row)}
            className={`flex cursor-pointer items-center justify-between px-4 py-2 text-ui ${
              position === index ? 'bg-selected text-text' : 'text-muted'
            }`}
          >
            <span>{row.label}</span>
            {row.kind === 'command' && row.hint !== undefined && (
              <span className="text-faint text-ui-xs">{row.hint}</span>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export default CommandPalette;
```

**Implementer note:** the group headers described in the spec are deliberately NOT in this sketch, because they interact with the flat index space. Add them as non-`option` `<li>` elements rendered between groups, and make sure they are skipped by the arrow arithmetic — the simplest correct way is to keep `rows` as the option-only array (as above) and render a header before the first row of each new group while mapping. Add a test asserting headers are not reachable by arrowing.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/features/palette/commandPalette.test.tsx`
Expected: PASS, 8 tests plus your header test.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/palette/CommandPalette.tsx src/features/palette/commandPalette.test.tsx
git commit -m "feat(l4): the palette surface, combobox semantics and keyboard model"
```

---

### Task 5: wire it into the shell, lazily

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/useScopeShortcuts.ts`
- Modify: `src/app/useScopeShortcuts.test.tsx`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**

- Consumes: `CommandPalette`'s default export (Task 4).
- Produces: no new exports. `useScopeShortcuts` gains `onPalette`.

- [ ] **Step 1: Write the failing shortcut test**

Add to `src/app/useScopeShortcuts.test.tsx`, matching the file's existing render helper:

```tsx
it('opens the palette on Mod+K', () => {
  const onPalette = vi.fn();
  renderHook(() =>
    useScopeShortcuts({ onScope: vi.fn(), onSearch: vi.fn(), onGraph: vi.fn(), onPalette }),
  );

  fireEvent.keyDown(window, { code: 'KeyK', metaKey: true });

  expect(onPalette).toHaveBeenCalledTimes(1);
});

it('leaves Mod+Shift+K and Mod+Alt+K alone', () => {
  const onPalette = vi.fn();
  renderHook(() =>
    useScopeShortcuts({ onScope: vi.fn(), onSearch: vi.fn(), onGraph: vi.fn(), onPalette }),
  );

  fireEvent.keyDown(window, { code: 'KeyK', metaKey: true, shiftKey: true });
  fireEvent.keyDown(window, { code: 'KeyK', metaKey: true, altKey: true });

  expect(onPalette).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/useScopeShortcuts.test.tsx`
Expected: FAIL — `onPalette` is not a recognised handler.

- [ ] **Step 3: Extend the hook**

Add to `ScopeShortcutHandlers`:

```ts
  /** Opens L4's command palette. */
  onPalette: () => void;
```

and inside `onKeyDown`, beside the existing `KeyF` branch (which is the same shape — a bare `Mod` chord with no Shift and no Alt):

```ts
      if (event.code === 'KeyK' && !event.shiftKey && !event.altKey) {
        // Firefox binds Cmd/Ctrl+K to its search bar; preventDefault stops it.
        event.preventDefault();
        onPalette();
        return;
      }
```

Add `onPalette` to the dependency array. Extend the docblock to record that `Mod-k` was verified unbound in `node_modules/@tiptap`.

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/app/useScopeShortcuts.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the lazy boundary and state in `AppShell`**

```tsx
/**
 * Lazy, and structurally so — not an optimisation.
 *
 * `scripts/bundleSize.test.ts` caps the main bundle at 340,000 B gzipped and
 * `main` measured 338,350 B after L3: 1,650 bytes of headroom. The palette,
 * its registry and its matcher do not fit. If that guard fails on this
 * branch, something leaked across this boundary — find the leak; do not raise
 * the number.
 */
const CommandPalette = lazy(() => import('@/features/palette/CommandPalette'));
```

Beside the other state:

```tsx
  const [paletteOpen, setPaletteOpen] = useState(false);
```

Extend the existing `pending` union to carry the palette's destructive commands:

```tsx
  const [pending, setPending] = useState<
    | { kind: 'purge'; id: string }
    | { kind: 'empty' }
    | { kind: 'trash'; id: string }
    | { kind: 'signOut' }
    | null
  >(null);
```

Extend `confirmPending` to handle the two new kinds, and the `ConfirmDialog`'s title/body/confirm-label selection to name them — reusing `account.signOut.title` / `.body` / `.confirm` / `.cancel`, which already exist for `AccountMenu`'s own confirm.

- [ ] **Step 6: Build `CommandDeps` and render the palette**

Assemble the deps object with `useMemo` (it feeds `buildCommands`, which runs on every keystroke), pass `t`, the state flags derived from `selectedNote` and the session, and the handlers. Destructive handlers set `pending` rather than mutating:

```tsx
    onTrashNote: () => {
      if (selectedNoteId !== null) setPending({ kind: 'trash', id: selectedNoteId });
    },
    onEmptyTrash: () => setPending({ kind: 'empty' }),
    onSignOut: () => setPending({ kind: 'signOut' }),
```

Render inside the existing `SessionProvider`, alongside the graph branch:

```tsx
        {paletteOpen && (
          <Suspense fallback={null}>
            <CommandPalette
              open
              onClose={() => setPaletteOpen(false)}
              deps={commandDeps}
              onOpenNote={(id) => {
                select(id);
                setView('notes');
              }}
              onCreateNote={(title) => void createNoteTitled(title)}
            />
          </Suspense>
        )}
```

`createNoteTitled` is a small local helper: `notes.create(\`# ${title}\n\n\`)` then `select(created.id)`.

Pass `onPalette: () => setPaletteOpen(true)` into `useScopeShortcuts`, and keep the existing `enabled: pending === null` guard — a palette opening over a confirm dialog would escape its focus trap.

- [ ] **Step 7: Write the integration test that matters**

Add to `src/app/AppShell.test.tsx`:

```tsx
it('routes a destructive palette command through the confirm dialog and mutates nothing until confirmed', async () => {
  const note = await notes.create('# Doomed');
  renderShell();
  await screen.findByRole('button', { name: /Doomed/ });

  fireEvent.keyDown(window, { code: 'KeyK', metaKey: true });
  await userEvent.type(await screen.findByRole('combobox'), 'empty trash');
  await userEvent.keyboard('{Enter}');

  // The dialog is up AND the data is untouched. Asserting only that a dialog
  // appeared would pass against an implementation that deleted first.
  expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
  expect(await notes.get(note.id)).toBeDefined();
});
```

- [ ] **Step 8: Run, then the gate — this is a gate boundary**

```bash
lsof -ti:4173 | xargs -r kill -9
npx vitest run src/app/ src/features/palette/
npm run typecheck && npm run lint && npm run format
NODE_ENV=production npm run build
node -e "
const {readdirSync,statSync,readFileSync}=require('fs');const {gzipSync}=require('zlib');
const rows=readdirSync('dist/assets').filter(n=>n.endsWith('.js'))
  .map(n=>({n,gz:gzipSync(readFileSync('dist/assets/'+n)).length})).sort((a,b)=>b.gz-a.gz);
rows.slice(0,8).forEach(r=>console.log(r.n,r.gz));
console.log('largest:',rows[0].gz,'headroom:',340000-rows[0].gz);
"
npm test -- --run --maxWorkers=4
```

A SEPARATE `CommandPalette-*.js` chunk must appear and the largest asset must stay under 340,000. **Do not raise `CEILING_BYTES`** — report BLOCKED instead.

Note: Vite's own build log reports a gzip figure that disagrees with `gzipSync` (it read ~341 kB for a 338,116 B asset during L3). Trust the node measurement above and the guard, never the log line.

- [ ] **Step 9: Commit**

```bash
git add src/app/
git commit -m "feat(l4): open the palette from the shell behind a lazy boundary"
```

---

### Task 6: end-to-end, and the documentation

**Files:**

- Create: `e2e/palette.spec.ts`
- Modify: `CLAUDE.md`, `docs/superpowers/NEXT.md`
- Modify: `docs/rulings/accessibility.md`

- [ ] **Step 1: Write the e2e spec**

Read `e2e/graph.spec.ts` first for this repo's seeding shape (`seedDatabase(page, CORPUS)` from `./fixtures/seed.ts` and `./fixtures/corpus.ts`, note the `.ts` extensions). Cover exactly these:

```ts
// 1. Meta+K opens the palette; the combobox has focus.
// 2. An empty query lists commands and ZERO note options (assert a count).
// 3. Typing a corpus note's title surfaces it, and Enter opens that note.
// 4. ArrowDown changes the input's aria-activedescendant VALUE.
// 5. Escape closes it.
// 6. A destructive command ("empty trash") opens the confirm dialog and the
//    note count is unchanged until confirmed.
```

**Then prove two of them can fail**, and report the observed failures:

- Break `aria-activedescendant` (never update it) → test 4 must go red.
- Make the empty query include notes → test 2 must go red.

Before every Playwright run: `lsof -ti:4173 | xargs -r kill -9`.

- [ ] **Step 2: Run it**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/palette.spec.ts
```

Run it **three times** sequentially and report all three, per this repo's contention history — `e2e/graph.spec.ts` is already documented as load-sensitive and this file will run alongside it.

- [ ] **Step 3: Record the accessibility ruling**

In `docs/rulings/accessibility.md`, record the combobox contract, because it is the part most likely to be "tidied" into something broken: the input is `role="combobox"` with `aria-expanded` / `aria-controls`, the list is a `listbox` of `option`s, the highlighted row is tracked by `aria-activedescendant` and **focus never moves into the list** — moving it breaks typing outright. Note that the test asserts the attribute's VALUE changes, because one asserting merely that options carry ids would pass against an implementation that never updates it. Extend that file's `**Trigger:**` line and the matching row in `CLAUDE.md`'s rulings table.

- [ ] **Step 4: Update the status docs**

`CLAUDE.md`: add the L4 row as complete, and update the unit/e2e test counts from your real final run — measure, do not compute.

`docs/superpowers/NEXT.md`: move L4 out of the open table, record what shipped, and carry forward two things: that navigation and theme commands needed **no new i18n keys** (the `smartList.*` keys and `THEMES[].labelKey` already existed), and that the bundle ceiling is now the binding constraint on every feature — **two sub-projects in a row have been shaped by it, and a deliberate measured raise is likely due before L5.**

Leave L5 (Mermaid) as next.

- [ ] **Step 5: The full gate, then commit**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run build
npm run test:e2e
npm run measure:check
```

All must pass. If something fails, check `uptime` before concluding the diff broke it — several e2e specs here fail under load in ways that look like regressions — then re-run once quiet.

`npm run shots` is NOT required: the palette is a modal over the existing shell and adds no themed surface to the fixed corpus shots. If you disagree after seeing it, say so rather than adding 16 files silently.

```bash
git add -A
git commit -m "docs(l4): rule the combobox contract, and record what shipped"
```

---

## Self-review

**Spec coverage.** Every section maps to a task: the six-rule ranking → Task 1; commands-and-notes scope, the four groups, `buildCommands` validity, the destructive set → Tasks 2-3; empty-query rule, fixed section order, no-match offer, keyboard model, combobox ARIA → Task 4; lazy boundary, `⌘K`, destructive confirm routing → Task 5; testing section, the four risks, keyboard-only decision → Tasks 5-6.

**Known deviation from the spec, stated rather than hidden.** The spec says the palette offers "open the theme picker". It does not: `ThemePicker` owns its dialog in local state and `ThemeDialog` is not exported, so reaching it would mean refactoring a working component. Instead the palette emits **one command per theme** via `useTheme().setChoice`, which is faster anyway — and gates them behind a non-empty query so sixteen rows do not swamp the empty state. That trade-off costs discoverability: nothing in the empty state advertises that themes exist. Flagged for the user at handoff.

**Placeholder scan.** No TBDs. Two places deliberately hand judgement to the implementer, both with the reason and a required test: the group-header rendering in Task 4 (interacts with the flat index space) and the e2e assertions in Task 6 (must be written against the corpus that actually exists).

**Type consistency.** `Matchable` (Task 1) is extended by `Command` (Task 2). `CommandDeps` is defined once in Task 2 and only added to in Task 3 — no field is renamed. `CommandPalette` takes `Omit<CommandDeps, 'hasQuery'>` because the palette owns the query, which is consistent with Task 2's `hasQuery` gate. `notes.allNoteIndex()` returns `TitledNote[]`, the L3 type, used unchanged.
