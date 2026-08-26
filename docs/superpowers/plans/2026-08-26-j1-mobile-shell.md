# J1 — Responsive shell and navigation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bear-web usable on a phone — one pane at a time, a drawer for the tag sidebar, and a working back gesture — without changing the desktop layout at all.

**Architecture:** A `useLayoutMode()` hook over `matchMedia` returns `'phone' | 'tablet' | 'desktop'`, and `AppShell` renders a different set of children per mode. The phone's current screen is DERIVED from `selectedNoteId` rather than stored. A small `useOverlayHistory` hook pushes one history entry per open overlay so Android's back button and iOS's edge-swipe work, without a router and without touching the URL.

**Tech Stack:** React 19, TypeScript (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`), Tailwind v4, Vitest + Testing Library, Playwright, oxlint, Prettier.

**Spec:** `docs/superpowers/specs/2026-08-26-j1-mobile-shell-design.md`

## Global Constraints

- **All six gates must pass before any commit:** `npm run typecheck`, `npm run lint`, `npm run format`, `npm test -- --run --maxWorkers=4`, `npm run build`, `npm run test:e2e`. The cheap tier (`typecheck`, `lint`, `format`) runs on every task; the expensive tier at the task boundaries this plan names.
- **The desktop layout at `≥ 1024px` must not change.** A differing desktop screenshot is a defect, not a trade-off.
- **No user-facing string is hardcoded.** Every string goes through `useT`; add the key to `src/i18n/en.ts` AND `src/i18n/ko.ts` (`ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error — never weaken that annotation).
- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` is a defect.
- **Spacing utilities come from the permitted subset** enforced by `scripts/sourceLint.test.ts`: `0 0.5 1 2 3 4 6 8 12 px auto full`. `pl-5` is NOT permitted.
- **`src/lib/` must import nothing** from `src/app/`, `src/data/`, `src/features/` or `src/i18n/`. Enforced by `scripts/sourceLint.test.ts`.
- **Icons come only from `src/ui/Icon.tsx`**, which is the sole `lucide-react` importer. Add a glyph to its re-export list rather than importing lucide elsewhere.
- **Before any e2e run that follows a source change:** `lsof -ti:4173 | xargs -r kill -9`. The config hardcodes port 4173 with `reuseExistingServer`, so a stale preview server silently tests an old build.
- **Repetition targets FILES, never the suite.** `npx vitest run <file>` is ~2s against ~80 CPU-seconds for the full run.

---

### Task 1: `matchMedia` stub and `useLayoutMode`

**Files:**

- Create: `src/lib/useLayoutMode.ts`
- Create: `src/lib/useLayoutMode.test.ts`
- Modify: `vitest.setup.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export type LayoutMode = 'phone' | 'tablet' | 'desktop'`; `export function useLayoutMode(): LayoutMode`; `export const TABLET_MIN_WIDTH = 640`; `export const DESKTOP_MIN_WIDTH = 1024`; and from `vitest.setup.ts`, a `matchMedia` implementation driven by `globalThis.__setViewportWidth(width: number)`.

- [ ] **Step 1: Add the `matchMedia` stub to `vitest.setup.ts`**

jsdom does not implement `matchMedia` at all — `window.matchMedia` is `undefined`, so any component calling it throws `TypeError`. Append to `vitest.setup.ts`:

```ts
/**
 * jsdom implements no `matchMedia` whatsoever — the property is absent, so a
 * component that calls it throws `TypeError: window.matchMedia is not a
 * function`. This stub parses the only query shape this app writes,
 * `(min-width: Npx)`, against a viewport width a test can set.
 *
 * Deliberately NOT a `vi.fn()` returning `matches: false` for everything: that
 * would silently pin every test to the phone layout, and a desktop regression
 * would look green.
 */
let viewportWidth = 1280;

const listeners = new Set<() => void>();

globalThis.__setViewportWidth = (width: number): void => {
  viewportWidth = width;
  for (const notify of [...listeners]) notify();
};

const matches = (query: string): boolean => {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return viewportWidth >= Number(min[1]);
  throw new Error(`matchMedia stub does not understand: ${query}`);
};

globalThis.matchMedia = ((query: string) => {
  const mql = {
    get matches() {
      return matches(query);
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, handler: () => void) => void listeners.add(handler),
    removeEventListener: (_: string, handler: () => void) => void listeners.delete(handler),
    addListener: (handler: () => void) => void listeners.add(handler),
    removeListener: (handler: () => void) => void listeners.delete(handler),
    dispatchEvent: () => false,
  };
  return mql as unknown as MediaQueryList;
}) as typeof matchMedia;

afterEach(() => {
  viewportWidth = 1280;
  listeners.clear();
});
```

Add the declaration so `tsc` accepts `globalThis.__setViewportWidth`. `vitest.setup.ts` belongs to the `node` tsconfig project, so this goes in that file:

```ts
declare global {
  // eslint-disable-next-line no-var
  var __setViewportWidth: (width: number) => void;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/useLayoutMode.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DESKTOP_MIN_WIDTH, TABLET_MIN_WIDTH, useLayoutMode } from './useLayoutMode';

describe('useLayoutMode', () => {
  it.each([
    [390, 'phone'],
    [TABLET_MIN_WIDTH - 1, 'phone'],
    [TABLET_MIN_WIDTH, 'tablet'],
    [834, 'tablet'],
    [DESKTOP_MIN_WIDTH - 1, 'tablet'],
    [DESKTOP_MIN_WIDTH, 'desktop'],
    [1280, 'desktop'],
  ])('reports %ipx as %s', (width, expected) => {
    globalThis.__setViewportWidth(width);
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current).toBe(expected);
  });

  it('updates when the viewport crosses a breakpoint', () => {
    // The whole point of a hook over a one-time read: rotating a phone or
    // dragging a desktop window across the breakpoint has to re-render.
    globalThis.__setViewportWidth(1280);
    const { result } = renderHook(() => useLayoutMode());
    expect(result.current).toBe('desktop');

    act(() => globalThis.__setViewportWidth(390));

    expect(result.current).toBe('phone');
  });

  it('reads the width during the FIRST render, not in an effect', () => {
    // An effect-seeded hook renders once as the wrong mode before correcting
    // itself, which is a visible layout flash on every load.
    globalThis.__setViewportWidth(390);
    const seen: string[] = [];
    renderHook(() => {
      seen.push(useLayoutMode());
      return null;
    });
    expect(seen[0]).toBe('phone');
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/lib/useLayoutMode.test.ts`
Expected: FAIL — `Failed to resolve import "./useLayoutMode"`.

- [ ] **Step 4: Implement `src/lib/useLayoutMode.ts`**

```ts
import { useEffect, useState } from 'react';

/**
 * Where the note list stops needing the whole screen and can share it with the
 * editor. A comfort threshold, not a hard limit: two panes physically fit from
 * about 520px (a 320px list, the shell's chrome, and the 160px
 * `MIN_PANE_WIDTH`), but at 640 the editor gets ~280px, which is the narrowest
 * column worth writing a sentence in.
 */
export const TABLET_MIN_WIDTH = 640;

/**
 * Where all three panes fit: 240 sidebar + 320 list + the shell's chrome still
 * leaves the editor over 400px.
 *
 * Chosen against a constraint, not by taste. `playwright.config.ts` runs
 * `devices['Desktop Chrome']` at 1280x720, so a desktop breakpoint at or below
 * 1280 keeps the seven existing e2e assertions that the shell has three panes
 * valid. Lowering the Playwright viewport below this number breaks all seven;
 * `e2e/mobile.spec.ts` guards that with a named assertion.
 */
export const DESKTOP_MIN_WIDTH = 1024;

export type LayoutMode = 'phone' | 'tablet' | 'desktop';

const TABLET_QUERY = `(min-width: ${TABLET_MIN_WIDTH}px)`;
const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;

function read(): LayoutMode {
  if (globalThis.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
  if (globalThis.matchMedia(TABLET_QUERY).matches) return 'tablet';
  return 'phone';
}

/**
 * Which shell layout the viewport calls for.
 *
 * A hook rather than CSS alone, for four reasons CSS cannot address: the
 * resizers must not MOUNT (a `display: none` separator stays in the tab order
 * and the accessibility tree), the drawer needs open state and a focus trap,
 * `Pane`'s width is an inline style computed in JS, and the shell renders a
 * different set of children per mode.
 *
 * Seeded during the first render, never from an effect: there is no SSR here,
 * so `matchMedia` is available synchronously, and an effect-seeded value paints
 * one frame of the wrong layout on every load.
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(read);

  useEffect(() => {
    const update = (): void => setMode(read());
    const queries = [globalThis.matchMedia(TABLET_QUERY), globalThis.matchMedia(DESKTOP_QUERY)];
    for (const query of queries) query.addEventListener('change', update);
    // Re-read on mount: the viewport can change between the first render and
    // this effect (a rotation during load), and the listeners above only fire
    // on later changes.
    update();
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);

  return mode;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/lib/useLayoutMode.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Confirm the stub did not break the existing suite**

Run: `npm test -- --run --maxWorkers=4`
Expected: PASS. This is a gate boundary — the stub touches every test file's environment, so the full suite is warranted exactly here.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add vitest.setup.ts src/lib/useLayoutMode.ts src/lib/useLayoutMode.test.ts
git commit -m "feat(mobile): a hook that says which layout the viewport calls for"
```

---

### Task 2: viewport-aware pane clamp

**Files:**

- Modify: `src/app/paneWidths.ts`
- Modify: `src/app/paneWidths.test.ts`

**Interfaces:**

- Consumes: `MIN_PANE_WIDTH`, `MAX_PANE_WIDTH`, `clampPaneWidth` (all already exported).
- Produces: `export const SHELL_CHROME_WIDTH = 56`; `export function maxPaneWidth(viewportWidth: number, otherPaneWidth: number): number`; `clampPaneWidth(width: number, fallback?: number, max?: number)` — a third optional parameter, defaulting to `MAX_PANE_WIDTH`, so every existing call site is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `src/app/paneWidths.test.ts`:

```ts
describe('maxPaneWidth', () => {
  it('allows the full maximum when the viewport is wide', () => {
    expect(maxPaneWidth(1920, DEFAULT_NOTE_LIST_WIDTH)).toBe(MAX_PANE_WIDTH);
  });

  it('leaves the third pane at least its minimum in a narrow window', () => {
    // The bug this closes: both panes dragged wide in a 1024px window pushed
    // the editor to a negative width, because each pane was clamped only
    // against 160..560 and never against the room actually available.
    const room = maxPaneWidth(1024, DEFAULT_NOTE_LIST_WIDTH);
    expect(1024 - room - DEFAULT_NOTE_LIST_WIDTH - SHELL_CHROME_WIDTH).toBeGreaterThanOrEqual(
      MIN_PANE_WIDTH,
    );
  });

  it('never returns less than the minimum, however cramped', () => {
    // Below the desktop breakpoint no resizer renders at all, so this is
    // defence rather than a reachable state — but returning 0 or a negative
    // would make `clampPaneWidth` invert its own bounds.
    expect(maxPaneWidth(320, DEFAULT_NOTE_LIST_WIDTH)).toBe(MIN_PANE_WIDTH);
  });
});

describe('clampPaneWidth with an explicit maximum', () => {
  it('honours a maximum below MAX_PANE_WIDTH', () => {
    expect(clampPaneWidth(9999, DEFAULT_SIDEBAR_WIDTH, 300)).toBe(300);
  });

  it('still honours the floor when the maximum is below it', () => {
    expect(clampPaneWidth(10, DEFAULT_SIDEBAR_WIDTH, 100)).toBe(MIN_PANE_WIDTH);
  });
});
```

Extend the existing import at the top of the file to include `maxPaneWidth` and `SHELL_CHROME_WIDTH`.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/app/paneWidths.test.ts`
Expected: FAIL — `maxPaneWidth is not a function`.

- [ ] **Step 3: Implement**

In `src/app/paneWidths.ts`:

```ts
/**
 * Everything in the shell that is neither of the two sized panes nor the
 * editor: `<main>`'s 8px padding either side, the four 8px flex gaps, and the
 * two 8px resizer tracks.
 *
 * A constant rather than a measurement, and therefore falsifiable rather than
 * asserted: `e2e/mobile.spec.ts` drags both panes to their maximum at 1024px
 * and asserts the editor still measures at least `MIN_PANE_WIDTH`. If the
 * shell's padding or gaps change, that test fails and this number is what to
 * fix.
 */
export const SHELL_CHROME_WIDTH = 56;

/**
 * The widest one pane may be drawn without squeezing the editor below
 * `MIN_PANE_WIDTH`.
 *
 * Closes a pre-existing bug: `clampPaneWidth` bounded each pane to 160..560
 * with no knowledge of the viewport, so a sidebar and a note list both dragged
 * wide in a 1024px window left the editor a NEGATIVE width.
 */
export function maxPaneWidth(viewportWidth: number, otherPaneWidth: number): number {
  const room = viewportWidth - otherPaneWidth - SHELL_CHROME_WIDTH - MIN_PANE_WIDTH;
  return Math.max(MIN_PANE_WIDTH, Math.min(MAX_PANE_WIDTH, room));
}
```

And widen the existing clamp — note the third parameter is optional, so no existing call site changes:

```ts
export function clampPaneWidth(
  width: number,
  fallback: number = DEFAULT_SIDEBAR_WIDTH,
  max: number = MAX_PANE_WIDTH,
): number {
  if (!Number.isFinite(width)) return fallback;
  return Math.min(Math.max(max, MIN_PANE_WIDTH), Math.max(MIN_PANE_WIDTH, Math.round(width)));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/app/paneWidths.test.ts`
Expected: PASS.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app/paneWidths.ts src/app/paneWidths.test.ts
git commit -m "fix(shell): a pane clamp that cannot squeeze the editor to a negative width"
```

---

### Task 3: `useOverlayHistory`

**Files:**

- Create: `src/lib/useOverlayHistory.ts`
- Create: `src/lib/useOverlayHistory.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function useOverlayHistory(isOpen: boolean, onClose: () => void, id: string): void`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/useOverlayHistory.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useOverlayHistory } from './useOverlayHistory';

describe('useOverlayHistory', () => {
  it('pushes exactly one history entry when the overlay opens', () => {
    const push = vi.spyOn(history, 'pushState');

    renderHook(() => useOverlayHistory(true, vi.fn(), 'drawer'));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toEqual({ bearOverlay: 'drawer' });
    push.mockRestore();
  });

  it('pushes nothing while the overlay is closed', () => {
    const push = vi.spyOn(history, 'pushState');

    renderHook(() => useOverlayHistory(false, vi.fn(), 'drawer'));

    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
  });

  it('pushes ONE entry under StrictMode, not two', () => {
    // StrictMode mounts, cleans up, and mounts again. Two entries would mean
    // the user needs two backs to dismiss one drawer — and this is the exact
    // shape of the `useSession` defect that passed all six gates and was found
    // only by running the app.
    const push = vi.spyOn(history, 'pushState');

    renderHook(() => useOverlayHistory(true, vi.fn(), 'drawer'), { wrapper: StrictMode });

    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('closes the overlay on popstate', () => {
    const onClose = vi.fn();
    renderHook(() => useOverlayHistory(true, onClose, 'drawer'));

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('consumes its own entry when the overlay closes by another route', () => {
    // Closing via the back chevron or Escape must not leave a dead entry on
    // the stack: the next back press would then do nothing visible.
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useOverlayHistory(open, vi.fn(), 'drawer'),
      { initialProps: { open: true } },
    );

    rerender({ open: false });

    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it('does not call back after a popstate already consumed the entry', () => {
    // Otherwise the browser goes back TWICE for one press and the user is
    // thrown out of the app.
    const back = vi.spyOn(history, 'back').mockImplementation(() => {});
    const { rerender } = renderHook(
      ({ open }: { open: boolean }) => useOverlayHistory(open, vi.fn(), 'drawer'),
      { initialProps: { open: true } },
    );

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    rerender({ open: false });

    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/useOverlayHistory.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/useOverlayHistory.ts`**

```ts
import { useEffect, useRef } from 'react';

/**
 * One history entry per open overlay, so the platform's own back gesture
 * dismisses it.
 *
 * Android's hardware back button and iOS Safari's edge-swipe both drive
 * `popstate`, so neither needs to know anything about this app — but only if
 * there is an entry for them to pop. Without this, the first thing anyone tries
 * on a phone closes the whole app instead of the drawer.
 *
 * **The URL never changes.** `pushState` is called with `location.href`, so
 * there is no scheme to design, no GitHub Pages sub-path to get wrong, and no
 * 404 on refresh. Refreshing lands on the note list, which is already this
 * app's contract — selection is ephemeral by design.
 *
 * Deliberately NOT a router. The app's three phases have never needed one, and
 * introducing one would touch every e2e test's assumption about a single page.
 */
export function useOverlayHistory(isOpen: boolean, onClose: () => void, id: string): void {
  // Whether OUR entry is currently on the stack. A ref, not state: it must
  // survive the render that closing triggers, and nothing renders from it.
  const pushedRef = useRef(false);

  // The latest `onClose` without making it an effect dependency — a caller
  // passing an inline arrow would otherwise tear down and re-push the entry on
  // every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // StrictMode mounts, cleans up, then mounts again. The cleanup below
    // consumes the entry and clears the flag, so this second mount pushes
    // exactly one replacement — net one entry, not two.
    pushedRef.current = true;
    history.pushState({ bearOverlay: id }, '', location.href);

    const onPopState = (): void => {
      // The browser already removed our entry; calling `history.back()` in the
      // cleanup below would then go back TWICE for one press.
      pushedRef.current = false;
      onCloseRef.current();
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (!pushedRef.current) return;
      pushedRef.current = false;
      history.back();
    };
  }, [isOpen, id]);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/lib/useOverlayHistory.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the StrictMode test can fail**

Temporarily replace the effect body's first two lines with an unconditional push that ignores `pushedRef`, i.e. delete the cleanup's `history.back()` call. Re-run: the StrictMode test must FAIL. Restore the code. A test for an idempotence guard that passes against a non-idempotent implementation is worth nothing, and this repo has shipped that mistake before.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/lib/useOverlayHistory.ts src/lib/useOverlayHistory.test.ts
git commit -m "feat(mobile): one history entry per overlay, so back dismisses it"
```

---

### Task 4: extract `SidebarContent`, build `SidebarDrawer`

**Files:**

- Create: `src/app/SidebarContent.tsx`
- Create: `src/app/SidebarDrawer.tsx`
- Create: `src/app/SidebarDrawer.test.tsx`
- Modify: `src/app/AppShell.tsx` (the sidebar `Pane`'s children only)
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `useOverlayHistory` (Task 3); the existing `Dialog` from `src/ui/Dialog.tsx`; `SmartListSidebar`, `TagSidebar`, `ThemePicker`, `AccountMenu`.
- Produces:
  - `export interface SidebarContentProps { scope: NoteScope; onScopeChange: (next: NoteScope) => void; counts: SmartListCounts; nodes: TagNode[] | undefined; isCollapsed: (tag: string) => boolean; onToggle: (tag: string) => void; }`
  - `export function SidebarContent(props: SidebarContentProps): ReactElement`
  - `export interface SidebarDrawerProps extends SidebarContentProps { open: boolean; onClose: () => void; }`
  - `export function SidebarDrawer(props: SidebarDrawerProps): ReactElement | null`
  - i18n keys `'sidebar.open'` (`'Show tags'` / `'태그 보기'`) and `'sidebar.drawer'` (`'Tags and lists'` / `'태그 및 목록'`).

- [ ] **Step 1: Extract `SidebarContent` with no behaviour change**

Move the sidebar `Pane`'s children out of `AppShell.tsx` verbatim — the scroller div, `SmartListSidebar`, `TagSidebar`, and the footer holding `ThemePicker` and `AccountMenu` — into `src/app/SidebarContent.tsx`. Read the exact prop types off the existing call site rather than guessing them; a plan's sketch is not a signature reference, and this project has been bitten by exactly that.

`AppShell`'s sidebar `Pane` then contains only `<SidebarContent {...} />`.

- [ ] **Step 2: Run the existing suite to prove the extraction changed nothing**

Run: `npx vitest run src/app/AppShell.test.tsx`
Expected: PASS, unchanged count. A pure move must not need a single test edited. If one fails, the move was not pure — fix the move, not the test.

- [ ] **Step 3: Write the failing drawer test**

Create `src/app/SidebarDrawer.test.tsx`. Model the render helper on `src/features/notes/NoteList.test.tsx` — the same `renderWithI18n` from `@/i18n/testing`. Assertions:

```tsx
it('renders nothing while closed', () => {
  renderDrawer({ open: false });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('names itself, so it is not an unlabelled dialog', () => {
  renderDrawer({ open: true });
  expect(screen.getByRole('dialog', { name: 'Tags and lists' })).toBeInTheDocument();
});

it('shows the same smart lists and tags the desktop sidebar shows', () => {
  renderDrawer({ open: true });
  expect(screen.getByRole('button', { name: /^Notes\b/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Trash\b/ })).toBeInTheDocument();
});

it('closes itself when a scope is chosen, so the filtered list is visible', () => {
  const onClose = vi.fn();
  const onScopeChange = vi.fn();
  renderDrawer({ open: true, onClose, onScopeChange });

  fireEvent.click(screen.getByRole('button', { name: /^Trash\b/ }));

  expect(onScopeChange).toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run src/app/SidebarDrawer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement `SidebarDrawer`**

```tsx
/**
 * The tag sidebar as an overlay, for every layout narrower than `desktop`.
 *
 * Built on `Dialog` rather than a second overlay of its own: `Dialog` already
 * carries the wide-selector focus trap, Escape, the backdrop, and focus
 * restore to whatever opened it. `accessibility.md` records why that trap must
 * use the wide selector and not `'button'` — a trap that skips a focusable
 * lets Tab walk out into the page behind, where the user cannot see where
 * focus went, which is worse than no trap at all. A second, narrower trap here
 * would reintroduce exactly that.
 *
 * Its content is `SidebarContent` verbatim — the same component the desktop
 * pane renders. There is no mobile variant of the tag tree to keep in step.
 */
export function SidebarDrawer({ open, onClose, ...content }: SidebarDrawerProps) {
  useOverlayHistory(open, onClose, 'sidebar');

  return (
    <Dialog
      open={open}
      onClose={onClose}
      label={t('sidebar.drawer')}
      // Edge-anchored, not centred: `Dialog` sizes its panel from this
      // className, so a drawer needs no change to `Dialog` itself.
      className="bg-sidebar mr-12 flex h-full w-full max-w-xs flex-col rounded-none"
    >
      <SidebarContent
        {...content}
        onScopeChange={(next) => {
          content.onScopeChange(next);
          onClose();
        }}
      />
    </Dialog>
  );
}
```

**If `Dialog`'s own wrapper centres the panel in a way this className cannot override**, do NOT append an overriding utility — class-attribute order does not decide the cascade, stylesheet order does, and this project has already lost a day to that (`Pane`'s `shadow-none`). Add a `placement?: 'center' | 'start'` prop to `Dialog` instead, defaulting to `'center'` so every existing caller is unchanged.

- [ ] **Step 6: Run the test and confirm it passes, then run the app**

Run: `npx vitest run src/app/SidebarDrawer.test.tsx src/app/AppShell.test.tsx`
Expected: PASS.

- [ ] **Step 7: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app/SidebarContent.tsx src/app/SidebarDrawer.tsx src/app/SidebarDrawer.test.tsx src/app/AppShell.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(mobile): the tag sidebar as a drawer, on the dialog the app already has"
```

---

### Task 5: `AppShell` renders by mode

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`

**Interfaces:**

- Consumes: `useLayoutMode`, `LayoutMode` (Task 1); `maxPaneWidth` (Task 2); `SidebarDrawer` (Task 4).
- Produces: no new exports. `AppShell` gains `const mode = useLayoutMode()` and `const [drawerOpen, setDrawerOpen] = useState(false)`.

- [ ] **Step 1: Write the failing tests**

Add a `layout modes` describe to `src/app/AppShell.test.tsx`:

```tsx
describe('layout modes', () => {
  it('renders three panes and two resizers on a desktop viewport', async () => {
    // The non-goal, guarded: this work must not change the desktop layout.
    globalThis.__setViewportWidth(1280);
    renderShell();

    await waitFor(() => {
      expect(document.querySelectorAll('section[aria-label]')).toHaveLength(3);
    });
    expect(screen.getAllByRole('separator')).toHaveLength(2);
  });

  it('renders two panes and no resizers on a tablet viewport', async () => {
    globalThis.__setViewportWidth(834);
    renderShell();

    await waitFor(() => {
      expect(document.querySelectorAll('section[aria-label]')).toHaveLength(2);
    });
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('renders one pane and no resizers on a phone viewport', async () => {
    globalThis.__setViewportWidth(390);
    renderShell();

    await waitFor(() => {
      expect(document.querySelectorAll('section[aria-label]')).toHaveLength(1);
    });
    expect(screen.queryAllByRole('separator')).toHaveLength(0);
  });

  it('offers the drawer below desktop and not above it', async () => {
    globalThis.__setViewportWidth(390);
    const { unmount } = renderShell();
    expect(await screen.findByRole('button', { name: 'Show tags' })).toBeInTheDocument();
    unmount();

    globalThis.__setViewportWidth(1280);
    renderShell();
    await waitFor(() => {
      expect(document.querySelectorAll('section[aria-label]')).toHaveLength(3);
    });
    expect(screen.queryByRole('button', { name: 'Show tags' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/app/AppShell.test.tsx -t 'layout modes'`
Expected: FAIL — three panes at every width.

- [ ] **Step 3: Implement the mode split in `AppShell`**

Inside `<main>`, the sidebar `Pane` and the sidebar `Resizer` render only when `mode === 'desktop'`; the note-list `Resizer` renders only when `mode === 'desktop'`. Render `<SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} … />` when `mode !== 'desktop'`.

Pane widths per mode — the table from the spec, and the reason it is not simply "undefined below desktop":

```tsx
// `undefined` makes a Pane `flex-1`. On a tablet BOTH the list and the editor
// would then be flex-1 and split the screen in half, giving a 400px note list
// beside a 400px editor. The list keeps its stored width there; only the
// editor flexes.
const noteListPaneWidth = mode === 'phone' ? undefined : widths.noteListWidth;
```

Clamp the two resizers against the viewport using `maxPaneWidth`:

```tsx
max={maxPaneWidth(window.innerWidth, widths.noteListWidth)}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run src/app/AppShell.test.tsx`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app/AppShell.tsx src/app/AppShell.test.tsx
git commit -m "feat(mobile): the shell renders one, two or three panes by viewport"
```

---

### Task 6: the phone's list ↔ editor screens

**Files:**

- Modify: `src/app/AppShell.tsx`
- Modify: `src/app/AppShell.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `useOverlayHistory` (Task 3), `useLayoutMode` (Task 1).
- Produces: i18n key `'nav.backToList'` (`'Back to notes'` / `'메모 목록으로'`).

- [ ] **Step 1: Write the failing tests**

```tsx
describe('phone screens', () => {
  it('shows the list, and only the list, with no note selected', async () => {
    globalThis.__setViewportWidth(390);
    await notes.create('Groceries');
    renderShell();

    expect(await screen.findByRole('button', { name: /Groceries/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note text' })).not.toBeInTheDocument();
  });

  it('replaces the list with the editor when a note is opened', async () => {
    globalThis.__setViewportWidth(390);
    const user = userEvent.setup();
    await notes.create('Groceries');
    renderShell();

    await user.click(await screen.findByRole('button', { name: /Groceries/ }));

    expect(await screen.findByRole('textbox', { name: 'Note text' })).toBeInTheDocument();
    // Not merely "the editor is present": on a phone the list must be GONE,
    // which is the whole difference from the desktop layout.
    expect(screen.queryByRole('button', { name: /Groceries/ })).not.toBeInTheDocument();
  });

  it('returns to the list from the back control', async () => {
    globalThis.__setViewportWidth(390);
    const user = userEvent.setup();
    await notes.create('Groceries');
    renderShell();

    await user.click(await screen.findByRole('button', { name: /Groceries/ }));
    await user.click(await screen.findByRole('button', { name: 'Back to notes' }));

    expect(await screen.findByRole('button', { name: /Groceries/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Note text' })).not.toBeInTheDocument();
  });

  it('keeps both panes on a tablet, where opening a note does not hide the list', async () => {
    globalThis.__setViewportWidth(834);
    const user = userEvent.setup();
    await notes.create('Groceries');
    renderShell();

    await user.click(await screen.findByRole('button', { name: /Groceries/ }));

    expect(await screen.findByRole('textbox', { name: 'Note text' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Groceries/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/app/AppShell.test.tsx -t 'phone screens'`

- [ ] **Step 3: Implement**

```tsx
// DERIVED, never stored. A stored screen can disagree with the selection — an
// editor showing no note, a note open behind a list — and nothing makes those
// unreachable. Deriving makes them unrepresentable, and every existing
// transition then does the right thing for free: creating selects, so the
// editor opens; trashing clears the selection, so the list returns.
//
// From `selectedNoteId`, NOT `selectedNote`: `useNotes` routes every selection
// change through a transient `undefined` on the note OBJECT
// (`notes-lifecycle.md`), so a screen derived from the object flickers back to
// the list mid-switch.
const phoneScreen = selectedNoteId === null ? 'list' : 'editor';
```

On phone, render the note-list `Pane` when `phoneScreen === 'list'` and the editor `Pane` when it is `'editor'`. The editor pane gains a back control labelled `t('nav.backToList')` that calls `select(null)`. Wire `useOverlayHistory(mode === 'phone' && phoneScreen === 'editor', () => select(null), 'editor')`.

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/app/AppShell.test.tsx`

- [ ] **Step 5: Gate boundary — full unit suite**

Run: `npm test -- --run --maxWorkers=4`
Expected: PASS. The shell now renders conditionally, and this is the point where an unrelated component test would notice.

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/app/AppShell.tsx src/app/AppShell.test.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(mobile): a phone shows the list or the note, and can get back"
```

---

### Task 7: the phone's list header and the FAB

**Files:**

- Modify: `src/features/notes/NoteList.tsx`
- Modify: `src/features/notes/NoteList.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`
- Modify: `src/ui/Icon.tsx` (re-export `Menu` and `Plus` from lucide)

**Interfaces:**

- Consumes: `LayoutMode` (Task 1).
- Produces: `NoteListProps` gains `mode: LayoutMode` and `onOpenDrawer: () => void`.

**Deviation from the spec, stated deliberately:** the spec said Empty trash moves into `ScopeMenu`. This plan keeps it in the header, shown only in the Trash scope as it already is. At 390px the header holds ☰ (40) + `Trash ⌄` (~90) + `Empty trash` (~90) + 🔍 (40) = ~260px, which fits — and putting an irreversible action into a menu of view preferences reads worse than leaving it beside the scope it belongs to. `ScopeMenu` is untouched.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('phone header', () => {
  it('offers the drawer, the scope and search — and not the selection actions', () => {
    // Delete/Restore act on the SELECTED note, and on a phone selecting a note
    // means leaving the list, so they were never coherent here. They live in
    // the row context menu, which is what makes this header shrinkable.
    renderList(<NoteList {...props({ mode: 'phone', selectedNoteId: 'a' })} />);

    expect(screen.getByRole('button', { name: 'Show tags' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /List options/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('keeps the selection actions on desktop', () => {
    renderList(<NoteList {...props({ mode: 'desktop', selectedNoteId: 'a' })} />);
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show tags' })).not.toBeInTheDocument();
  });

  it('creates a note from the floating button below desktop', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderList(<NoteList {...props({ mode: 'phone', onCreate })} />);

    await user.click(screen.getByRole('button', { name: 'New note' }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('still offers Empty trash in the trash scope on a phone', () => {
    renderList(<NoteList {...props({ mode: 'phone', scope: TRASHED_SCOPE })} />);
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeInTheDocument();
  });
});
```

Add `mode: 'desktop'` and `onOpenDrawer: vi.fn()` to the existing `props()` helper's defaults so every current test keeps passing unchanged.

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/features/notes/NoteList.test.tsx -t 'phone header'`

- [ ] **Step 3: Implement**

Add `Menu` and `Plus` to `src/ui/Icon.tsx`'s re-export list. In `NoteList`, branch the header strip on `mode === 'desktop'`, and render the FAB below desktop:

```tsx
{/*
  `env(safe-area-inset-bottom)` on the FAB alone. General safe-area handling
  is J4, but a floating control placed in the exact spot the OS reserves for
  the home indicator cannot wait for it — it would sit under the indicator on
  every notched phone.
*/}
<button
  type="button"
  aria-label={t('noteList.create')}
  onClick={onCreate}
  style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
  className="bg-accent shadow-popover absolute right-4 z-10 flex h-12 w-12 items-center justify-center rounded-full text-white"
>
  <Icon glyph={Plus} />
</button>
```

The FAB reuses `noteList.create` rather than inventing a second string, so the accessible name is identical to the desktop button's — the same action must not announce two ways.

- [ ] **Step 4: Run and confirm they pass**

Run: `npx vitest run src/features/notes/NoteList.test.tsx`

- [ ] **Step 5: Wire `mode` and `onOpenDrawer` from `AppShell` and re-run its tests**

Run: `npx vitest run src/app/AppShell.test.tsx src/features/notes/NoteList.test.tsx`

- [ ] **Step 6: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/notes/NoteList.tsx src/features/notes/NoteList.test.tsx src/app/AppShell.tsx src/ui/Icon.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(mobile): a phone header of drawer, scope and search, and a FAB"
```

---

### Task 8: collapsible search that does not zoom iOS

**Files:**

- Modify: `src/features/notes/SearchField.tsx`
- Modify: `src/features/notes/SearchField.test.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**

- Consumes: `LayoutMode` (Task 1).
- Produces: `SearchFieldProps` gains `collapsible: boolean`. i18n key `'search.open'` (`'Search notes'` / `'메모 검색'`).

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders as a button until opened, when collapsible', async () => {
  const user = userEvent.setup();
  renderField({ collapsible: true });

  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Search notes' }));

  expect(screen.getByRole('searchbox')).toHaveFocus();
});

it('stays an always-visible field when not collapsible', () => {
  renderField({ collapsible: false });
  expect(screen.getByRole('searchbox')).toBeInTheDocument();
});

it('takes a 16px font, which is what stops iOS zooming the page on focus', () => {
  // `--bear-text-ui` is 13px. Safari zooms the viewport when an input below
  // 16px takes focus, and the user is then left zoomed in with no way back
  // except pinching. This is the only typography exception J1 makes.
  renderField({ collapsible: true, open: true });
  expect(screen.getByRole('searchbox').className).toContain('text-ui-lg');
});
```

- [ ] **Step 2: Run and confirm they fail**

Run: `npx vitest run src/features/notes/SearchField.test.tsx`

- [ ] **Step 3: Implement**

Add the collapsed state and the 16px class. `--bear-text-ui-lg` is exactly `1rem`, so `text-ui-lg` is the token-respecting way to reach 16px — do not write a literal `text-[16px]`.

- [ ] **Step 4: Run and confirm they pass, then verify in a real browser**

Run: `npx vitest run src/features/notes/SearchField.test.tsx`

A class-name assertion is weak on its own: it proves the class is present, not that it computes to 16px. Task 9's e2e adds the `toHaveCSS('font-size', '16px')` check that actually can fail if the token changes.

- [ ] **Step 5: Cheap gates and commit**

```bash
npm run typecheck && npm run lint && npm run format
git add src/features/notes/SearchField.tsx src/features/notes/SearchField.test.tsx src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(mobile): search collapses to a button, and stops iOS zooming on focus"
```

---

### Task 9: end-to-end journeys, the viewport guard, and phone screenshots

**Files:**

- Create: `e2e/mobile.spec.ts`
- Create: `e2e/shots-mobile.spec.ts`
- Modify: `package.json` (a `shots:mobile` script)

**Interfaces:**

- Consumes: everything above; `seedDatabase` and `CORPUS` from `e2e/fixtures/`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `e2e/mobile.spec.ts`**

```ts
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
```

Cover, each as its own test:

1. **list → note → back.** Tap a row; the note's text is visible; the list is not. Tap the back control; the list is back.
2. **the drawer.** Tap `Show tags`; tap a tag row; the drawer closes and the list is filtered to that tag.
3. **`page.goBack()` from the editor returns to the list**, and from the drawer closes it. This is the Android-back contract and the only reason `useOverlayHistory` exists.
4. **the FAB creates a note and opens it.**
5. **the search input computes to 16px** — `await expect(input).toHaveCSS('font-size', '16px')`. This is the zoom bug and a class-name assertion cannot see it.
6. **nothing overflows horizontally:** `await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)`. This is the assertion that would have caught today's defect.

- [ ] **Step 2: The guard on the guard**

In the same file, outside the mobile `test.use` (use `test.describe` with its own `use`), assert the desktop contract:

```ts
test('the configured desktop viewport is at or above the desktop breakpoint', async ({ page }) => {
  // Seven existing assertions that the shell has three panes depend on this:
  // `codePalette.spec.ts:19,39,107`, `contrast.spec.ts:138`, and
  // `appearance.spec.ts:302,418,901`. Lowering the Playwright viewport below
  // 1024 turns all seven into confusing failures about missing panes; this one
  // fails honestly instead.
  expect(page.viewportSize()!.width).toBeGreaterThanOrEqual(1024);
});
```

- [ ] **Step 3: Run the e2e suite**

```bash
lsof -ti:4173 | xargs -r kill -9
npm run test:e2e
```

Expected: PASS, previous count + the new tests. If a pre-existing test fails, check `uptime` before concluding this diff broke it — several are load-sensitive and the failures look like regressions.

- [ ] **Step 4: Prove test 6 can fail**

Temporarily set the note-list `Pane`'s width to a fixed `320` on phone. Re-run test 6 only: it must FAIL on `scrollWidth`. Restore.

- [ ] **Step 5: Write `e2e/shots-mobile.spec.ts`**

Tagged `@shots` in its title so the existing `grepInvert: /@shots|@measure/` keeps it out of `npm run test:e2e`. Four shots into `docs/design/shots/mobile/` — list, drawer, editor, search open — in the default theme only. The desktop shots already cover the theme roster; this is a layout check, not a colour one. Add `"shots:mobile": "playwright test e2e/shots-mobile.spec.ts --grep @shots"` to `package.json`.

**Count the files afterwards; do not trust the exit code.** A spec that silently matched nothing exits 0.

- [ ] **Step 6: Look at the four screenshots**

Nothing in the test suite can see "renders wrong". Open all four. Check specifically: the FAB clears the home indicator, the header's three controls do not collide at 390px, the drawer does not cover the whole screen, and Korean labels do not wrap.

- [ ] **Step 7: Commit**

```bash
git add e2e/mobile.spec.ts e2e/shots-mobile.spec.ts package.json
git commit -m "test(mobile): the phone journeys, and a guard on the desktop viewport"
```

---

### Task 10: rulings and CLAUDE.md

**Files:**

- Modify: `docs/rulings/design-tokens-and-layout.md`, `docs/rulings/accessibility.md`, `docs/rulings/deferred.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/NEXT.md`

- [ ] **Step 1: Add the rulings**

`design-tokens-and-layout.md` — extend the trigger line with `src/lib/useLayoutMode.ts` and `src/app/SidebarDrawer.tsx`, and record: the three modes and why 1024 is chosen against Playwright's viewport rather than by taste; that resizers are not RENDERED below desktop rather than hidden, because a `display: none` separator stays in the tab order; that a tablet's note list keeps its stored width because two `flex-1` panes split the screen in half; and the 16px search input against iOS zoom.

`accessibility.md` — the drawer is a `Dialog` and must keep the wide-selector trap; focus moves to the editor's back control on open and returns to the row on close; the FAB shares `noteList.create`'s accessible name with the desktop button rather than inventing a second string.

`deferred.md` — pane-width persistence is a named trigger there; record that the clamp is now viewport-aware and that widths are written in desktop mode only.

- [ ] **Step 2: Update CLAUDE.md**

Add the J row to the status table. Add two toolchain surprises: **jsdom implements no `matchMedia` at all** (the property is absent, not stubbed — a component calling it throws `TypeError`, and `vitest.setup.ts` now supplies one driven by `__setViewportWidth`); and **seven e2e assertions silently depend on the Playwright viewport being ≥1024**, guarded by a named test. Update the unit and e2e test counts from the real run output — do not estimate them.

- [ ] **Step 3: Update NEXT.md**

Add J with its four sub-projects, J1 marked shipped and J2–J4 named and unscheduled.

- [ ] **Step 4: Final gate — everything, on the merged result**

```bash
npm run typecheck && npm run lint && npm run format
npm test -- --run --maxWorkers=4
npm run build
lsof -ti:4173 | xargs -r kill -9 && npm run test:e2e
```

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs(j1): record the mobile shell's rulings"
```

---

## Self-review

**Spec coverage.** Layout modes → Task 1, 5. Navigation state → Task 6. Back → Task 3, 6, 9. Drawer → Task 4. Resizers and pane widths → Task 2, 5. Phone chrome (top bar, FAB, safe area) → Task 7. Search and the 16px rule → Task 8. Testing, shots, viewport guard → Task 9. Docs → Task 10. **One deliberate deviation**, stated in Task 7: Empty trash stays in the header rather than moving into `ScopeMenu`.

**Placeholders.** None. Every code step carries real code; the two steps that describe rather than show (Task 4 Step 1's extraction, Task 9 Step 1's journey list) are moves and test enumerations where naming the exact assertions is the content.

**Type consistency.** `LayoutMode` is produced by Task 1 and consumed by Tasks 5, 7, 8 under that exact name. `maxPaneWidth(viewportWidth, otherPaneWidth)` is defined in Task 2 and called with that argument order in Task 5. `useOverlayHistory(isOpen, onClose, id)` is defined in Task 3 and called with that arity in Tasks 4 and 6. `SidebarContentProps` is produced by Task 4 and extended by `SidebarDrawerProps` in the same task. `NoteListProps.mode` and `.onOpenDrawer` are added in Task 7 and passed from `AppShell` in the same task.
