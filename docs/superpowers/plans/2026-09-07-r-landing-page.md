# R. Landing page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-visit screen offering Google sign-in or guest mode, followed by one seeded welcome note that teaches hashtag organisation by being itself.

**Architecture:** `App` renders `<Landing />` in place of `<AppShell />` while a `localStorage` gate is open — no router, no change to `main.tsx`. `Landing` mounts its own `SessionProvider` (AppShell keeps mounting its own; the two are never live at once). The welcome note is seeded from a component inside AppShell's existing provider subtree, because the sign-in branch necessarily seeds on the boot *after* the OAuth redirect, by which time `Landing` has unmounted.

**Tech Stack:** React 19, TypeScript, Tailwind v4 with `--bear-*` tokens, Dexie, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-07-r-landing-page-design.md`

## Global Constraints

- **Six gates before any commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`. The cheap tier (`typecheck`, `lint`, `format`) runs every task; the expensive tier runs at the task boundaries this plan names.
- **Cap workers on this machine:** `npm test -- --run --maxWorkers=4`.
- **Kill any stale preview server before trusting an e2e result:** `lsof -ti:4173 | xargs -r kill -9`.
- **No user-facing string hardcoded in a component.** Every landing string goes through `useT`; keys are added to `src/i18n/en.ts` and `src/i18n/ko.ts`. `ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error — add the translation, never weaken the annotation.
- **Every colour is a `--bear-*` token.** The single exception in this whole sub-project is the Google mark's four brand hex values, scoped to `GoogleMark.tsx`, documented in place.
- **The i18n helper is `I18nProvider`.** There is no `TestI18nProvider`.
- **`Icon`'s prop is `glyph`, not `of`.**
- **Duck-type in tests, never `instanceof`** — `vitest.setup.ts` swaps the global `Blob`.
- **Byte-check every file touched:** `python3 -c "d=open(PATH).read(); print(d.count(chr(0xA0)), d.count(chr(0x200B)))"` must print `0 0`.
- **Bundle ceiling is `351_000` B** (`scripts/bundleSize.test.ts:409`), with ~1,640 B headroom. Task 6 measures and decides; no task before it may raise the ceiling.
- Storage keys follow the existing convention `bear-web:<area>:<name>`.

---

## File Structure

**Create — `src/features/landing/`** (new feature directory):

| File | Responsibility |
| --- | --- |
| `gate.ts` | The two storage keys and their throw-safe read/write helpers. No React. |
| `gate.test.ts` | Unit tests for the above, including `localStorage` throwing. |
| `useLandingGate.ts` | `{ open, dismiss }` — the App-level gate state. |
| `useLandingGate.test.tsx` | Unit tests for the hook. |
| `GoogleMark.tsx` | The four-colour brand SVG. The only literal hex in the sub-project. |
| `Landing.tsx` | `SessionProvider` + the screen. |
| `Landing.test.tsx` | Component tests: buttons, pending state, EN/KO, dismissal timing. |
| `welcomeNote.ts` | `Record<Locale, string>` — the seeded Markdown, EN and KO. |
| `seedWelcomeNote.ts` | The async seed decision, dependency-injected and pure of React. |
| `seedWelcomeNote.test.ts` | Every row of the spec's seed table. |
| `WelcomeSeeder.tsx` | Renders `null`; runs the seed at the right moment. |
| `WelcomeSeeder.test.tsx` | The timing rules: settle, offline, already-seeded. |
| `index.ts` | Barrel. |

**Modify:**

| File | Change |
| --- | --- |
| `src/app/App.tsx` | Branch on the gate. |
| `src/app/AppShell.tsx:508` | Mount `<WelcomeSeeder />` inside `<SessionProvider>`. |
| `src/i18n/en.ts`, `src/i18n/ko.ts` | Five new keys. |
| `playwright.config.ts:18` | `use.storageState` pre-dismissing the gate. |
| `vitest.setup.ts` | `beforeEach` pre-dismissing the gate. |
| `e2e/contrast.spec.ts` | Landing surface, with a `storageState` opt-out. |
| `e2e/shots.spec.ts` | Landing shot, with a `storageState` opt-out. |

**Create — tests/docs:** `e2e/landing.spec.ts`, plus doc edits in Task 6.

**Import-cycle note:** `src/features/landing/` must not import `src/features/editor/` even transitively. `scripts/sourceLint.test.ts` enforces this repo-wide; it runs as part of `npm test`.

---

## Task 1: The gate — storage keys and the App-level hook

**Files:**
- Create: `src/features/landing/gate.ts`, `src/features/landing/gate.test.ts`
- Create: `src/features/landing/useLandingGate.ts`, `src/features/landing/useLandingGate.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `LANDING_SEEN_KEY = 'bear-web:landing:seen'`, `LANDING_SEEDED_KEY = 'bear-web:landing:seeded'`
  - `hasLandingBeenSeen(): boolean`, `markLandingSeen(): void`
  - `hasSeededWelcome(): boolean`, `markWelcomeSeeded(): void`
  - `useLandingGate(): { open: boolean; dismiss: () => void }`

- [ ] **Step 1: Write the failing tests for `gate.ts`**

Create `src/features/landing/gate.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasLandingBeenSeen,
  hasSeededWelcome,
  LANDING_SEEDED_KEY,
  LANDING_SEEN_KEY,
  markLandingSeen,
  markWelcomeSeeded,
} from './gate';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('gate', () => {
  it('reports unseen when the key is absent', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    expect(hasLandingBeenSeen()).toBe(false);
  });

  it('reports seen once marked', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    markLandingSeen();
    expect(localStorage.getItem(LANDING_SEEN_KEY)).toBe('1');
    expect(hasLandingBeenSeen()).toBe(true);
  });

  it('treats any value other than "1" as unseen', () => {
    localStorage.setItem(LANDING_SEEN_KEY, 'yes');
    expect(hasLandingBeenSeen()).toBe(false);
  });

  // localStorage throws outright in some private-window and blocked-site-data
  // contexts. An unreadable gate must behave exactly like an absent one, or a
  // visitor in a private window sees a blank branch instead of the landing.
  it('treats a throwing getItem as unseen', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasLandingBeenSeen()).toBe(false);
    expect(hasSeededWelcome()).toBe(false);
  });

  it('does not throw when setItem throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => markLandingSeen()).not.toThrow();
    expect(() => markWelcomeSeeded()).not.toThrow();
  });

  it('tracks the seeded flag independently of the seen flag', () => {
    localStorage.clear();
    markLandingSeen();
    expect(hasSeededWelcome()).toBe(false);
    markWelcomeSeeded();
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe('1');
    expect(hasSeededWelcome()).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/features/landing/gate.test.ts`
Expected: FAIL — `Failed to resolve import "./gate"`.

- [ ] **Step 3: Implement `gate.ts`**

Create `src/features/landing/gate.ts`:

```ts
/**
 * The landing gate's two durable markers.
 *
 * Both follow `useSession`'s pattern rather than reading `localStorage`
 * directly: the API throws outright in some private-window and
 * blocked-site-data contexts, and an unreadable marker must behave exactly
 * like an absent one. A visitor in a private window gets the landing screen,
 * which is the correct answer for a browser that has never chosen.
 */

/** Written once the visitor has completed a choice on the landing screen. */
export const LANDING_SEEN_KEY = 'bear-web:landing:seen';

/**
 * Written once this device has seeded its welcome note.
 *
 * Separate from `LANDING_SEEN_KEY` because the two answer different
 * questions, and the sign-in branch necessarily separates them in time: the
 * click navigates to Google and ends this JS context, so the seed happens on
 * the boot *after* the redirect. It also means deleting the welcome note and
 * reloading does not bring it back.
 */
export const LANDING_SEEDED_KEY = 'bear-web:landing:seeded';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Best effort, exactly as `useSession`'s markers are. A lost flag costs
    // one extra landing screen on the next boot, never a wrong state.
  }
}

export function hasLandingBeenSeen(): boolean {
  return readFlag(LANDING_SEEN_KEY);
}

export function markLandingSeen(): void {
  writeFlag(LANDING_SEEN_KEY);
}

export function hasSeededWelcome(): boolean {
  return readFlag(LANDING_SEEDED_KEY);
}

export function markWelcomeSeeded(): void {
  writeFlag(LANDING_SEEDED_KEY);
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run src/features/landing/gate.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for `useLandingGate`**

Create `src/features/landing/useLandingGate.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LANDING_SEEN_KEY } from './gate';
import { useLandingGate } from './useLandingGate';

afterEach(() => localStorage.clear());

describe('useLandingGate', () => {
  it('opens when the flag is absent', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    const { result } = renderHook(() => useLandingGate());
    expect(result.current.open).toBe(true);
  });

  it('stays closed when the flag is present', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const { result } = renderHook(() => useLandingGate());
    expect(result.current.open).toBe(false);
  });

  it('closes and persists on dismiss', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    const { result } = renderHook(() => useLandingGate());
    act(() => result.current.dismiss());
    expect(result.current.open).toBe(false);
    expect(localStorage.getItem(LANDING_SEEN_KEY)).toBe('1');
  });

  // The flag is read in a lazy initialiser, so it is read once at mount and
  // never again. Without that, a re-render would re-read storage on the
  // render path — cheap here, but the wrong shape, and it makes `dismiss`
  // the only thing that can close the gate.
  it('does not reopen when storage is cleared after mount', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const { result, rerender } = renderHook(() => useLandingGate());
    localStorage.clear();
    rerender();
    expect(result.current.open).toBe(false);
  });
});
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npx vitest run src/features/landing/useLandingGate.test.tsx`
Expected: FAIL — `Failed to resolve import "./useLandingGate"`.

- [ ] **Step 7: Implement `useLandingGate.ts`**

```tsx
import { useCallback, useState } from 'react';

import { hasLandingBeenSeen, markLandingSeen } from './gate';

export interface LandingGate {
  /** True while the landing screen should be shown instead of the app. */
  open: boolean;
  /** Records the choice and closes the gate for good on this device. */
  dismiss: () => void;
}

/**
 * Whether to show the landing screen, decided once at mount.
 *
 * The flag is read in a lazy initialiser rather than on every render, so the
 * gate's state is owned by React from the first frame and `dismiss` is the
 * only thing that can close it. That matters for the sign-in branch, which
 * dismisses from an effect rather than from a click handler.
 */
export function useLandingGate(): LandingGate {
  const [open, setOpen] = useState(() => !hasLandingBeenSeen());

  const dismiss = useCallback(() => {
    // Written before the state change, not after: the state change can trigger
    // a render that unmounts this hook's owner, and the durable marker must
    // not depend on surviving that.
    markLandingSeen();
    setOpen(false);
  }, []);

  return { open, dismiss };
}
```

- [ ] **Step 8: Run both test files and verify they pass**

Run: `npx vitest run src/features/landing/`
Expected: PASS, 10 tests.

- [ ] **Step 9: Cheap gates and byte check**

```bash
npm run typecheck && npm run lint && npm run format
python3 -c "
import glob
for p in glob.glob('src/features/landing/*'):
    d = open(p).read()
    print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
```
Expected: all clean, every file reporting `0 0`.

- [ ] **Step 10: Commit**

```bash
git add src/features/landing/
git commit -m "feat(landing): the first-visit gate and its two durable markers

Both markers read through a throw-safe helper: localStorage throws
outright in private windows and with site data blocked, and an
unreadable gate must behave exactly like an absent one.

The seen and seeded flags are separate because the sign-in branch
separates them in time -- its click navigates to Google and ends the JS
context, so the seed necessarily happens on the boot after the redirect."
```

---

## Task 2: The landing screen

**Files:**
- Create: `src/features/landing/GoogleMark.tsx`, `src/features/landing/Landing.tsx`, `src/features/landing/Landing.test.tsx`, `src/features/landing/index.ts`
- Modify: `src/i18n/en.ts`, `src/i18n/ko.ts`

**Interfaces:**
- Consumes: `useLandingGate` is *not* used here — `Landing` takes `onEnter` from its parent. From `@/features/account`: `SessionProvider`, `useSessionValue`, `Session`, `SessionState`. From `@/data`: `hasSignedInBefore(): boolean`. From `@/ui/Button`: `Button` with `variant` in `'default' | 'primary' | 'danger' | 'ghost' | 'soft'` and `size` in `'sm' | 'md' | 'touch'`.
- Produces: `Landing({ onEnter }: { onEnter: () => void }): ReactElement`, exported from `src/features/landing/index.ts`.

- [ ] **Step 1: Add the i18n keys**

In `src/i18n/en.ts`, after the `account.*` block:

```ts
  'landing.wordmark': 'markflowing',
  'landing.tagline': 'Markdown notes that stay on your device.',
  'landing.signIn': 'Sign in with Google',
  'landing.guest': 'Continue as guest',
  'landing.pending': 'Signing you in…',
```

In `src/i18n/ko.ts`, at the matching position:

```ts
  'landing.wordmark': 'markflowing',
  'landing.tagline': '내 기기에 머무는 마크다운 메모.',
  'landing.signIn': 'Google로 로그인',
  'landing.guest': '게스트로 계속하기',
  'landing.pending': '로그인하는 중…',
```

Note `landing.signIn` reuses the wording of the existing `account.signIn.google` rather than sharing the key: the two surfaces may diverge, and a landing button borrowing a menu item's key couples them for no reason.

- [ ] **Step 2: Write the failing component test**

Create `src/features/landing/Landing.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { SESSION_HINT_KEY } from '@/data';

import { Landing } from './Landing';

const signIn = vi.fn();
let state: { status: string; account?: unknown } = { status: 'signedOut' };

vi.mock('@/features/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/account')>();
  return {
    ...actual,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    useSessionValue: () => ({ state, signIn, signOut: vi.fn() }),
  };
});

function renderLanding(onEnter = vi.fn()) {
  render(
    <I18nProvider>
      <Landing onEnter={onEnter} />
    </I18nProvider>,
  );
  return onEnter;
}

beforeEach(() => {
  signIn.mockClear();
  state = { status: 'signedOut' };
  localStorage.clear();
});

describe('Landing', () => {
  it('offers both ways in', () => {
    renderLanding();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue as guest' })).toBeInTheDocument();
  });

  it('names the app in a heading', () => {
    renderLanding();
    expect(screen.getByRole('heading', { name: 'markflowing' })).toBeInTheDocument();
  });

  it('enters immediately on the guest choice', async () => {
    const onEnter = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: 'Continue as guest' }));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  // The whole point of the asymmetry: an abandoned OAuth trip must return to
  // this screen, not to a signed-out app with no explanation. Writing the
  // flag on click would make that impossible.
  it('does NOT enter on the sign-in click', async () => {
    const onEnter = renderLanding();
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('enters once the session resolves signed in', () => {
    state = { status: 'signedIn', account: { email: 'a@b.c' } };
    const onEnter = renderLanding();
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('does not enter when the server is unavailable', () => {
    state = { status: 'unavailable' };
    const onEnter = renderLanding();
    expect(onEnter).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue as guest' })).toBeInTheDocument();
  });

  // signIn() writes SESSION_HINT_KEY before navigating away, so the boot after
  // the redirect starts in `loading` WITH the hint. Rendering the buttons then
  // flashes them on every return from Google.
  it('shows a pending state while resolving a returning sign-in', () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    state = { status: 'loading' };
    renderLanding();
    expect(screen.getByText('Signing you in…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });

  it('shows the buttons while loading with no prior session', () => {
    state = { status: 'loading' };
    renderLanding();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run src/features/landing/Landing.test.tsx`
Expected: FAIL — `Failed to resolve import "./Landing"`.

- [ ] **Step 4: Implement `GoogleMark.tsx`**

```tsx
import type { ReactElement } from 'react';

/**
 * Google's "G", in Google's own four brand colours.
 *
 * **This is the only literal colour in the app outside `tokens.css`, and it
 * is a deliberate, scoped exception to that ruling.** These four values are a
 * third party's trademark rather than a value in this palette: they must not
 * shift with the theme, and they are not ours to adjust for contrast. See
 * `docs/rulings/design-tokens-and-layout.md`.
 *
 * It deliberately does NOT live in `src/ui/Icon.tsx`. That file holds verbatim
 * lucide `__iconNode` arrays, and `Icon.test.tsx` walks them as single-colour
 * shapes; a multi-colour brand mark is not a member of that enumeration and
 * would weaken the test that guards it.
 *
 * `aria-hidden` because the button beside it already carries the accessible
 * name — announcing "Google logo, Sign in with Google" is a duplication.
 */
export function GoogleMark(): ReactElement {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
```

- [ ] **Step 5: Implement `Landing.tsx`**

```tsx
import { useEffect, type ReactElement } from 'react';

import { hasSignedInBefore } from '@/data';
import { SessionProvider, useSessionValue } from '@/features/account';
import { useT } from '@/i18n';
import { Button } from '@/ui/Button';

import { GoogleMark } from './GoogleMark';

export interface LandingProps {
  /** Closes the gate. Called once a choice has actually been completed. */
  onEnter: () => void;
}

/**
 * The first-visit door.
 *
 * It mounts its OWN `SessionProvider` rather than reading one from above.
 * `AppShell` mounts its own too, and the two are branches of the same ternary
 * in `App`, so there is never more than one live `useSession` — hoisting the
 * provider into `App` instead would have meant editing `AppShell` and the four
 * bare `<AppShell />` renders in `AppShell.test.tsx` that rely on it being
 * self-contained. The cost is one duplicate `GET /me` at the moment the gate
 * closes on the sign-in branch, once per device, and only for a visitor who
 * actually signed in.
 */
export function Landing({ onEnter }: LandingProps): ReactElement {
  return (
    <SessionProvider>
      <LandingScreen onEnter={onEnter} />
    </SessionProvider>
  );
}

function LandingScreen({ onEnter }: LandingProps): ReactElement {
  const t = useT();
  const { state, signIn } = useSessionValue();

  // The sign-in half of the gate's deliberate asymmetry. The guest button
  // dismisses from its click handler; this branch cannot, because the click
  // navigates to Google and ends the JS context. Dismissing here — after the
  // redirect, once /me has actually answered — is what makes an abandoned or
  // failed OAuth trip return to this screen instead of dropping the visitor
  // into a signed-out app with no way back.
  useEffect(() => {
    if (state.status === 'signedIn') onEnter();
  }, [state.status, onEnter]);

  // `signIn()` writes the session hint BEFORE navigating away, so the boot
  // after the redirect starts in `loading` with the hint present. Without this
  // branch the two buttons flash on screen during every return from Google.
  // `unavailable` is deliberately not pending: it is a resolved answer, and a
  // guest choice has to stay reachable while the Mini is asleep.
  const resolving = state.status === 'loading' && hasSignedInBefore();

  return (
    <main className="bg-canvas flex h-dvh flex-col items-center justify-center px-6">
      <div className="animate-in fade-in ease-bear flex w-full max-w-[360px] flex-col items-center gap-8 duration-[var(--bear-duration-slow)]">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-text text-2xl font-semibold tracking-tight">
            {t('landing.wordmark')}
          </h1>
          <p className="text-muted text-ui text-balance">{t('landing.tagline')}</p>
        </div>

        {resolving ? (
          <p className="text-muted text-ui" role="status">
            {t('landing.pending')}
          </p>
        ) : (
          <div className="flex w-full flex-col items-center gap-3">
            <Button variant="default" onClick={signIn} className="h-11 w-full justify-center gap-3">
              <GoogleMark />
              <span>{t('landing.signIn')}</span>
            </Button>
            <Button variant="ghost" onClick={onEnter} className="h-11 w-full justify-center">
              {t('landing.guest')}
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
```

If `Button` does not accept a `className` that overrides its height, check `src/ui/Button.tsx`'s `SIZES` map first — two `h-*` utilities in the same layer are resolved by **stylesheet order, not class-attribute order** (the trap `Pane`'s `shadow-none` cost this project a day). If the override does not take, add a `size` that omits the height rather than fighting it with a second utility.

- [ ] **Step 6: Create the barrel `src/features/landing/index.ts`**

```ts
export { hasLandingBeenSeen, hasSeededWelcome, LANDING_SEEDED_KEY, LANDING_SEEN_KEY } from './gate';
export { Landing } from './Landing';
export type { LandingProps } from './Landing';
export { useLandingGate } from './useLandingGate';
export type { LandingGate } from './useLandingGate';
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `npx vitest run src/features/landing/`
Expected: PASS, 18 tests.

- [ ] **Step 8: Prove the pending-state test can fail**

Temporarily change `resolving` to `const resolving = false;`. Re-run.
Expected: the "shows a pending state" test FAILS. Revert the change and re-run to green. A test that cannot fail against a broken implementation is not evidence.

- [ ] **Step 9: Cheap gates and byte check**

```bash
npm run typecheck && npm run lint && npm run format
python3 -c "
import glob
for p in glob.glob('src/features/landing/*') + ['src/i18n/en.ts', 'src/i18n/ko.ts']:
    d = open(p).read()
    print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
```
Expected: clean, every file `0 0`. The Korean strings are a real risk here — a `…` is fine, a non-breaking space is not.

- [ ] **Step 10: Commit**

```bash
git add src/features/landing/ src/i18n/en.ts src/i18n/ko.ts
git commit -m "feat(landing): the first-visit screen, in both locales

Landing mounts its own SessionProvider rather than hoisting AppShell's:
the two are branches of the same ternary so only one is ever live, and
hoisting would have broken the four bare AppShell renders that rely on
it being self-contained.

The sign-in branch dismisses from an effect, not a click handler,
because the click ends the JS context. That is what makes an abandoned
OAuth trip come back to this screen.

The Google mark carries the only literal colours outside tokens.css --
a scoped, documented exception, and deliberately not in Icon.tsx."
```

---

## Task 3: Wire the gate into `App`, and stop it breaking every existing test

**This task's two halves must land together.** Wiring `Landing` into `App` without the harness defaults turns all 37 e2e specs and a large share of the component suite red at once.

**Files:**
- Modify: `src/app/App.tsx`, `src/app/App.test.tsx`
- Modify: `playwright.config.ts`, `vitest.setup.ts`

**Interfaces:**
- Consumes: `useLandingGate`, `Landing`, `LANDING_SEEN_KEY`, `LANDING_SEEDED_KEY` from `@/features/landing`.
- Produces: nothing new; `App`'s signature is unchanged.

- [ ] **Step 1: Add the Vitest harness default**

In `vitest.setup.ts`, add `beforeEach` to the existing `vitest` import and append:

```ts
/**
 * Every component test lands in the app, not on the landing screen.
 *
 * Set here rather than in each test file for the reason the e2e default
 * exists: a test written months from now cannot forget it. A test that
 * genuinely wants the landing screen clears these two keys itself.
 *
 * `localStorage` is reached through `globalThis` with a local shape because
 * this file lives in the `node` tsconfig project (`lib: ["ES2023"]`, no DOM)
 * on purpose — the same reason the `matchMedia` stub declares its own type.
 * jsdom supplies the real object at runtime.
 */
interface StorageStub {
  setItem(key: string, value: string): void;
}

beforeEach(() => {
  const storage = (globalThis as { localStorage?: StorageStub }).localStorage;
  storage?.setItem('bear-web:landing:seen', '1');
  storage?.setItem('bear-web:landing:seeded', '1');
});
```

The keys are written as literals, not imported from `src/features/landing/gate`: `vitest.setup.ts` is in the `node` project and must not import from `src/`. Task 5 adds a test that pins them against drift.

- [ ] **Step 2: Add the Playwright harness default**

In `playwright.config.ts`, extend the `use` block at line 18:

```ts
  use: {
    baseURL: 'http://localhost:4173',
    /**
     * Every spec lands in the app, not on the landing screen.
     *
     * Solved here rather than with a `dismissLanding(page)` helper called from
     * each spec: a helper leaves a trap, and a spec written months from now
     * that forgets the call presents as "my new test mysteriously sees a login
     * page" with nothing pointing at the cause. A config default cannot be
     * forgotten. `e2e/landing.spec.ts` opts out explicitly.
     *
     * BOTH keys, not just `seen`. Setting only `seen` closes the gate but
     * leaves the SEED condition live, and the 13 specs that start with an
     * empty database would each get a welcome note injected into the list they
     * assert against — a selective failure that looks unrelated to this change.
     */
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:4173',
          localStorage: [
            { name: 'bear-web:landing:seen', value: '1' },
            { name: 'bear-web:landing:seeded', value: '1' },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 3: Write the failing test for `App`**

Append to `src/app/App.test.tsx` (keep the existing imports; add `LANDING_SEEN_KEY`):

```tsx
describe('the landing gate', () => {
  it('renders the landing screen when the gate is open', () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    render(<App status="ready" />);
    expect(screen.getByRole('heading', { name: 'markflowing' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Sidebar' })).not.toBeInTheDocument();
  });

  it('renders the app shell when the gate is closed', () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    render(<App status="ready" />);
    expect(screen.queryByRole('heading', { name: 'markflowing' })).not.toBeInTheDocument();
  });
});
```

Check `src/app/App.test.tsx`'s existing renders for the real `status` value and the real accessible name of the sidebar region before running — use what is already there rather than these placeholders if they differ.

- [ ] **Step 4: Run it and verify it fails**

Run: `npx vitest run src/app/App.test.tsx`
Expected: FAIL — the landing heading is not found, because `App` still renders `AppShell` unconditionally.

- [ ] **Step 5: Wire `App.tsx`**

```tsx
import type { ReactElement } from 'react';

import type { DatabaseStatus } from '@/data';
import { Landing, useLandingGate } from '@/features/landing';
import { I18nProvider } from '@/i18n';

import { AppShell } from './AppShell';
import { DatabaseStatusProvider } from './DatabaseStatusContext';
import { UnavailableBanner } from './UnavailableBanner';

export default function App({ status }: { status: DatabaseStatus }): ReactElement {
  // A state, not a route. The landing screen has no URL of its own: adding the
  // first client router to this app for one screen would also mean a Pages 404
  // fallback, and there is no second entry point to route to.
  const gate = useLandingGate();

  return (
    <I18nProvider>
      <DatabaseStatusProvider status={status}>
        {gate.open ? (
          <Landing onEnter={gate.dismiss} />
        ) : (
          <div className="flex h-dvh flex-col">
            <UnavailableBanner />
            <div className="min-h-0 flex-1">
              <AppShell />
            </div>
          </div>
        )}
      </DatabaseStatusProvider>
    </I18nProvider>
  );
}
```

- [ ] **Step 6: Run the unit suite and verify nothing else broke**

Run: `npm test -- --run --maxWorkers=4`
Expected: PASS. Read the **exit code**, not the pass count — an uncaught error makes `vitest run` exit 1 with every assertion passing.

- [ ] **Step 7: Run the full e2e suite — this is a named gate boundary**

```bash
lsof -ti:4173 | xargs -r kill -9
uptime
npm run test:e2e
```

Expected: 245 pass, 1 skip — **unchanged from `main`**. This is the step that proves the `storageState` default works; if specs fail on missing panes, the default is not being applied.

If failures appear, check `uptime` before concluding the diff broke anything — under load, timing-sensitive specs in `smoke.spec.ts`, `appearance.spec.ts` and `graph.spec.ts` fail on a different assertion each run. Re-run once quiet. A failure about a **missing pane** is real and is this change; a failure about elevation or pane-resize persistence is probably not.

- [ ] **Step 8: Cheap gates**

Run: `npm run typecheck && npm run lint && npm run format`

- [ ] **Step 9: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx playwright.config.ts vitest.setup.ts
git commit -m "feat(landing): render the landing screen when the gate is open

The gate is a state, not a route -- adding the first client router to
this app for one screen would also mean a Pages 404 fallback, for no
second entry point.

Both harnesses pre-dismiss the gate in configuration rather than per
spec. All 37 e2e specs would otherwise open onto the landing screen,
and a dismissLanding() helper leaves a trap a future spec can forget.
Both keys are set: seen alone closes the gate but leaves the seed
condition live, which would inject a welcome note into the 13 specs
that start with an empty database."
```

---

## Task 4: The welcome note and its seed decision

**Files:**
- Create: `src/features/landing/welcomeNote.ts`, `src/features/landing/seedWelcomeNote.ts`, `src/features/landing/seedWelcomeNote.test.ts`

**Interfaces:**
- Consumes: `Locale` from `@/i18n`; `hasLandingBeenSeen`, `hasSeededWelcome`, `markWelcomeSeeded` from `./gate`.
- Produces:
  - `WELCOME_NOTE: Record<Locale, string>`
  - `interface SeedDeps { listActive: () => Promise<readonly unknown[]>; create: (text: string) => Promise<unknown>; locale: Locale }`
  - `seedWelcomeNote(deps: SeedDeps): Promise<boolean>` — resolves `true` when a note was created.

- [ ] **Step 1: Write `welcomeNote.ts`**

```ts
import type { Locale } from '@/i18n';

/**
 * The one note a first-run device is given.
 *
 * Deliberately NOT in `src/i18n/en.ts` and `ko.ts`, and that is a considered
 * deviation from "no user-facing string is hardcoded outside the translation
 * bundles". This is seeded *content*, not UI chrome: a twelve-line Markdown
 * blob in the bundles would pollute the `TranslationKey` union that every
 * actual UI string is checked against. `Record<Locale, string>` gives the
 * identical compile-time completeness guarantee — a missing locale is a type
 * error, exactly as `ko.ts`'s own annotation makes a missing translation one.
 *
 * It does three jobs and stops: one inline tag so the sidebar is populated on
 * first sight, one checkbox so the task affordance is discoverable, and one
 * sentence about hashtags rather than folders — which is the single least
 * guessable thing about this app. It is an ordinary note: editable, taggable,
 * trashable.
 */
export const WELCOME_NOTE: Record<Locale, string> = {
  en: `# Welcome

This is a note. Edit it, or delete it — nothing here is special.

Notes are organised by tags you write inline, not by folders. This one is
tagged #inbox, so it shows up under that tag in the sidebar. Type a new one
anywhere and it appears there too.

- [ ] Try writing your own tag
`,
  ko: `# 시작하기

메모입니다. 자유롭게 수정하거나 삭제하세요. 특별한 메모가 아닙니다.

메모는 폴더가 아니라 본문에 직접 쓴 태그로 정리됩니다. 이 메모에는 #inbox
태그가 붙어 있어서 사이드바의 해당 태그 아래에 나타납니다. 어디에든 새 태그를
쓰면 똑같이 나타납니다.

- [ ] 직접 태그를 하나 써 보세요
`,
};
```

- [ ] **Step 2: Write the failing test**

Create `src/features/landing/seedWelcomeNote.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LANDING_SEEDED_KEY, LANDING_SEEN_KEY } from './gate';
import { seedWelcomeNote } from './seedWelcomeNote';
import { WELCOME_NOTE } from './welcomeNote';

const create = vi.fn(async () => ({ id: 'n1' }));

function deps(notes: readonly unknown[], locale: 'en' | 'ko' = 'en') {
  return { listActive: async () => notes, create, locale };
}

beforeEach(() => {
  localStorage.clear();
  create.mockClear();
});

afterEach(() => vi.restoreAllMocks());

describe('seedWelcomeNote', () => {
  it('seeds when the gate has been seen, nothing is seeded, and there are no notes', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    await expect(seedWelcomeNote(deps([]))).resolves.toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(WELCOME_NOTE.en);
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe('1');
  });

  it('seeds the Korean note for a Korean locale', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    await seedWelcomeNote(deps([], 'ko'));
    expect(create).toHaveBeenCalledWith(WELCOME_NOTE.ko);
  });

  // This is the assertion that stops a second device receiving a duplicate:
  // sync has settled, the account's notes have arrived, so there is nothing
  // to teach and nothing to add.
  it('does NOT seed when notes already exist', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    await expect(seedWelcomeNote(deps([{ id: 'existing' }]))).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe(null);
  });

  it('does NOT seed twice on the same device', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    localStorage.setItem(LANDING_SEEDED_KEY, '1');
    await expect(seedWelcomeNote(deps([]))).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  // Ties the seed to the landing flow rather than to every boot. Without it,
  // a user who empties their trash to zero notes gets a welcome note back.
  it('does NOT seed before a landing choice has been made', async () => {
    localStorage.removeItem(LANDING_SEEN_KEY);
    await expect(seedWelcomeNote(deps([]))).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it('marks seeded only after create resolves', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    const failing = {
      listActive: async () => [],
      create: async () => {
        throw new Error('quota');
      },
      locale: 'en' as const,
    };
    await expect(seedWelcomeNote(failing)).resolves.toBe(false);
    expect(localStorage.getItem(LANDING_SEEDED_KEY)).toBe(null);
  });

  // Cheapest checks first: a device that has already seeded must not pay for
  // a full listActive() read of a large account.
  it('does not read the note list when the seeded flag is already set', async () => {
    localStorage.setItem(LANDING_SEEN_KEY, '1');
    localStorage.setItem(LANDING_SEEDED_KEY, '1');
    const listActive = vi.fn(async () => []);
    await seedWelcomeNote({ listActive, create, locale: 'en' });
    expect(listActive).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run src/features/landing/seedWelcomeNote.test.ts`
Expected: FAIL — `Failed to resolve import "./seedWelcomeNote"`.

- [ ] **Step 4: Implement `seedWelcomeNote.ts`**

```ts
import type { Locale } from '@/i18n';

import { hasLandingBeenSeen, hasSeededWelcome, markWelcomeSeeded } from './gate';
import { WELCOME_NOTE } from './welcomeNote';

export interface SeedDeps {
  /** Injected rather than imported, so this is testable without Dexie. */
  listActive: () => Promise<readonly unknown[]>;
  create: (text: string) => Promise<unknown>;
  locale: Locale;
}

/**
 * Creates the welcome note, if this device should have one.
 *
 * The emptiness check is what stops a second device receiving a duplicate:
 * by the time this runs for a signed-in user, sync has settled and the
 * account's notes have arrived, so the count is non-zero and nothing is
 * added. See the spec's seed table.
 *
 * The checks are ordered cheapest-first on purpose. `listActive()` reads
 * every active note, which for a large account is real work; a device that
 * has already seeded, or has not yet made a landing choice, must not pay for
 * it. In practice this runs at most once per device ever.
 *
 * The seeded flag is written only after `create` RESOLVES. Marking first
 * would let a failed write (a quota error, a closed database) permanently
 * consume the device's one chance to seed.
 *
 * @returns whether a note was actually created.
 */
export async function seedWelcomeNote({ listActive, create, locale }: SeedDeps): Promise<boolean> {
  if (!hasLandingBeenSeen()) return false;
  if (hasSeededWelcome()) return false;

  const existing = await listActive();
  if (existing.length > 0) return false;

  try {
    await create(WELCOME_NOTE[locale]);
  } catch {
    // Leave the flag unset so a later boot can try again. A visitor with no
    // welcome note is a smaller failure than one who can never get it.
    return false;
  }

  markWelcomeSeeded();
  return true;
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/features/landing/seedWelcomeNote.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Prove the duplicate guard can fail**

Temporarily delete the `if (existing.length > 0) return false;` line. Re-run.
Expected: "does NOT seed when notes already exist" FAILS. Revert and re-run to green.

This is the assertion the whole no-duplicates guarantee rests on, and `CLAUDE.md` records three near-vacuous assertions in sub-project H that passed against sabotaged implementations. Do not skip this step.

- [ ] **Step 7: Cheap gates and byte check**

```bash
npm run typecheck && npm run lint && npm run format
python3 -c "
for p in ['src/features/landing/welcomeNote.ts', 'src/features/landing/seedWelcomeNote.ts', 'src/features/landing/seedWelcomeNote.test.ts']:
    d = open(p).read()
    print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
```
Expected: every file `0 0`. The Korean note body is the highest-risk file in this plan for a stray U+00A0 — an editor will substitute one silently and the diff shows nothing.

- [ ] **Step 8: Commit**

```bash
git add src/features/landing/welcomeNote.ts src/features/landing/seedWelcomeNote.ts src/features/landing/seedWelcomeNote.test.ts
git commit -m "feat(landing): the welcome note and the decision to seed it

The emptiness check is the whole no-duplicates guarantee: by the time
this runs for a signed-in user, sync has settled and the account's
notes have arrived, so a second device adds nothing.

Checks run cheapest-first so an already-seeded device never pays for a
full listActive() read, and the seeded flag is written only after
create resolves -- marking first would let one failed write consume
the device's only chance.

The note text is a Record<Locale, string> rather than translation keys:
a twelve-line Markdown blob is content, not chrome, and the Record
gives the same compile-time completeness guarantee."
```

---

## Task 5: Run the seed at the right moment

**Files:**
- Create: `src/features/landing/WelcomeSeeder.tsx`, `src/features/landing/WelcomeSeeder.test.tsx`
- Create: `src/features/landing/harnessDefaults.test.ts`
- Modify: `src/features/landing/index.ts`, `src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `seedWelcomeNote`, `SeedDeps` from `./seedWelcomeNote`; `useSessionValue`, `useSync`, `SyncController` from `@/features/account`; `notes` from `@/data`; `useLocale` from `@/i18n`.
- Produces: `WelcomeSeeder(): null`, exported from the barrel.

- [ ] **Step 1: Write the failing test**

Create `src/features/landing/WelcomeSeeder.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LANDING_SEEN_KEY } from './gate';
import { WelcomeSeeder } from './WelcomeSeeder';

const seed = vi.fn(async () => true);
vi.mock('./seedWelcomeNote', () => ({ seedWelcomeNote: (...args: unknown[]) => seed(...args) }));

let session = { status: 'signedOut' as string };
let sync = { status: 'idle' as string, lastSyncedAt: null as number | null };

vi.mock('@/features/account', () => ({
  useSessionValue: () => ({ state: session }),
  useSync: () => sync,
}));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANDING_SEEN_KEY, '1');
  seed.mockClear();
  session = { status: 'signedOut' };
  sync = { status: 'idle', lastSyncedAt: null };
});

describe('WelcomeSeeder', () => {
  it('seeds immediately for a signed-out visitor', async () => {
    render(<WelcomeSeeder />);
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
  });

  it('renders nothing', () => {
    const { container } = render(<WelcomeSeeder />);
    expect(container).toBeEmptyDOMElement();
  });

  // A signed-in device must not seed before its account's notes have arrived,
  // or every device after the first receives a duplicate.
  it('does NOT seed while a signed-in device is still syncing', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'syncing', lastSyncedAt: null };
    render(<WelcomeSeeder />);
    await new Promise((r) => setTimeout(r, 10));
    expect(seed).not.toHaveBeenCalled();
  });

  // "Settled" is lastSyncedAt, not an idle/syncing transition. A sync that
  // completes before this component mounts never shows a `syncing` status
  // here, and a transition-based rule would then miss the seed on every boot.
  it('seeds once a signed-in device has completed a sync', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'idle', lastSyncedAt: 1_700_000_000_000 };
    render(<WelcomeSeeder />);
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
  });

  it('does NOT seed for a signed-in device that has never synced', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'idle', lastSyncedAt: null };
    render(<WelcomeSeeder />);
    await new Promise((r) => setTimeout(r, 10));
    expect(seed).not.toHaveBeenCalled();
  });

  it('does NOT seed while the server is unreachable', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'offline', lastSyncedAt: null };
    render(<WelcomeSeeder />);
    await new Promise((r) => setTimeout(r, 10));
    expect(seed).not.toHaveBeenCalled();
  });

  it('seeds at most once across re-renders', async () => {
    const { rerender } = render(<WelcomeSeeder />);
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
    rerender(<WelcomeSeeder />);
    rerender(<WelcomeSeeder />);
    expect(seed).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run src/features/landing/WelcomeSeeder.test.tsx`
Expected: FAIL — `Failed to resolve import "./WelcomeSeeder"`.

- [ ] **Step 3: Implement `WelcomeSeeder.tsx`**

```tsx
import { useEffect, useRef } from 'react';

import { notes } from '@/data';
import { useSessionValue, useSync } from '@/features/account';
import { useLocale } from '@/i18n';

import { seedWelcomeNote } from './seedWelcomeNote';

/**
 * Runs the welcome-note seed at the one moment it is safe to.
 *
 * Renders nothing. It lives inside `AppShell`'s `SessionProvider` rather than
 * inside `Landing` because the sign-in branch cannot seed from the landing
 * screen at all: that click navigates to Google and ends the JS context, so
 * the seed necessarily happens on the boot AFTER the redirect, by which time
 * `Landing` has unmounted and `AppShell` is mounted instead.
 *
 * **"Settled" is `lastSyncedAt`, not an idle-after-syncing transition.** A
 * sync that completes before this component mounts never shows a `syncing`
 * status here, and a transition-based rule would then miss the seed on every
 * boot, forever, for exactly the accounts that sync fastest.
 *
 * A signed-in device whose server is unreachable never settles, so nothing is
 * seeded and the device flag stays unset — a later boot tries again. That is
 * deliberate: seeding against an unreachable server would inject a note that
 * duplicates the moment the server answers.
 *
 * There is deliberately no `useLiveQuery` here. `docs/rulings/notes-lifecycle.md`
 * warns about writes gated on a live query, and this is a write; the note
 * count is read once, imperatively, inside `seedWelcomeNote`.
 */
export function WelcomeSeeder(): null {
  const { state } = useSessionValue();
  const sync = useSync(state);
  const { locale } = useLocale();
  const ran = useRef(false);

  const signedIn = state.status === 'signedIn';
  const settled = !signedIn || (sync.status === 'idle' && sync.lastSyncedAt !== null);

  useEffect(() => {
    if (ran.current || !settled) return;
    ran.current = true;
    void seedWelcomeNote({
      listActive: () => notes.listActive(),
      create: (text) => notes.create(text),
      locale,
    });
  }, [settled, locale]);

  return null;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/features/landing/WelcomeSeeder.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the settle guard can fail**

Temporarily change `settled` to `const settled = true;`. Re-run.
Expected: three tests FAIL — "does NOT seed while … still syncing", "never synced", and "server is unreachable". Revert and re-run to green.

- [ ] **Step 6: Pin the harness key literals against drift**

Create `src/features/landing/harnessDefaults.test.ts`:

```ts
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LANDING_SEEDED_KEY, LANDING_SEEN_KEY } from './gate';

/**
 * `vitest.setup.ts` and `playwright.config.ts` both pre-dismiss the landing
 * gate, and both must spell these keys as LITERALS — neither may import from
 * `src/` (the setup file is in the `node` tsconfig project; the config is in
 * `e2e`). A rename here would silently un-dismiss the gate in both harnesses
 * and turn 37 e2e specs and much of the component suite red at once, with the
 * cause nowhere near the failures.
 *
 * This test is the thing that makes that rename fail loudly, and here.
 */
describe('harness defaults', () => {
  it.each([
    ['vitest.setup.ts', 'vitest.setup.ts'],
    ['playwright.config.ts', 'playwright.config.ts'],
  ])('%s dismisses the landing gate by literal key', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    expect(source).toContain(LANDING_SEEN_KEY);
    expect(source).toContain(LANDING_SEEDED_KEY);
  });
});
```

Run: `npx vitest run src/features/landing/harnessDefaults.test.ts`
Expected: PASS, 2 tests. If the working directory makes the relative paths fail, resolve them from the repo root the way other `scripts/*.test.ts` files do — check one before guessing.

- [ ] **Step 7: Mount the seeder in `AppShell`**

In `src/app/AppShell.tsx`, add the import alongside the other feature imports:

```ts
import { WelcomeSeeder } from '@/features/landing';
```

and add it as the first child of `<SessionProvider>` at line 508:

```tsx
      <SessionProvider>
        <WelcomeSeeder />
        {view === 'graph' ? (
```

It must be inside `SessionProvider` — `useSync` can only be called from within that subtree, as the docblock at the foot of `AppShell.tsx` records.

- [ ] **Step 8: Export from the barrel**

Add to `src/features/landing/index.ts`:

```ts
export { seedWelcomeNote } from './seedWelcomeNote';
export type { SeedDeps } from './seedWelcomeNote';
export { WELCOME_NOTE } from './welcomeNote';
export { WelcomeSeeder } from './WelcomeSeeder';
```

- [ ] **Step 9: Run the full unit suite — named gate boundary**

Run: `npm test -- --run --maxWorkers=4`
Expected: PASS. Check the **exit code**. `scripts/sourceLint.test.ts`'s import-cycle walk is part of this run and is the thing that would catch `landing` reaching `editor` through a barrel.

- [ ] **Step 10: Cheap gates, byte check, commit**

```bash
npm run typecheck && npm run lint && npm run format
python3 -c "
import glob
for p in glob.glob('src/features/landing/*') + ['src/app/AppShell.tsx']:
    d = open(p).read()
    print(p, d.count(chr(0xA0)), d.count(chr(0x200B)))
"
git add src/features/landing/ src/app/AppShell.tsx
git commit -m "feat(landing): seed the welcome note once the moment is safe

Lives in AppShell's provider subtree, not in Landing: the sign-in click
navigates to Google and ends the JS context, so the seed necessarily
happens on the boot after the redirect, when Landing has unmounted.

Settled is lastSyncedAt, not an idle-after-syncing transition. A sync
that completes before this mounts never shows a syncing status here,
and a transition rule would miss the seed forever on exactly the
accounts that sync fastest.

harnessDefaults.test.ts pins the two key literals that vitest.setup.ts
and playwright.config.ts must spell by hand, so a rename fails here
rather than as 37 unrelated-looking e2e failures."
```

---

## Task 6: End-to-end proof, visual harnesses, the bundle decision, and docs

**Files:**
- Create: `e2e/landing.spec.ts`
- Modify: `e2e/contrast.spec.ts`, `e2e/shots.spec.ts`
- Modify: `CLAUDE.md`, `docs/superpowers/NEXT.md`, `docs/rulings/design-tokens-and-layout.md`, `docs/rulings/testing-and-tooling.md`, `docs/rulings/notes-lifecycle.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped sub-project.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/landing.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

/**
 * The only spec that opts OUT of the shared `storageState` in
 * `playwright.config.ts`, which pre-dismisses the landing gate for every
 * other spec in the suite. Without this override the app opens straight to
 * the shell and every assertion below would fail confusingly.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('a first-time visitor is offered both ways in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue as guest' })).toBeVisible();
  // The app itself must not be behind it.
  await expect(page.getByRole('button', { name: 'Continue as guest' })).toBeVisible();
  await expect(page.locator('[data-pane]')).toHaveCount(0);
});

test('the guest choice enters the app with one welcome note', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as guest' }).click();

  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeHidden();
  await expect(page.getByText('Welcome', { exact: false }).first()).toBeVisible();
  // The tag written inline in the note body reaches the sidebar through the
  // real parser and the real tag index, so this asserts the whole seed path.
  await expect(page.getByText('inbox').first()).toBeVisible({ timeout: 10_000 });
});

test('the landing screen never returns, and neither does a deleted welcome note', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as guest' }).click();
  await expect(page.getByText('Welcome', { exact: false }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeHidden();

  // Empty the database the way the app itself would, then reload: the seeded
  // flag must keep the note from coming back.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase('bear-web');
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'markflowing' })).toBeHidden();
  await expect(page.getByText('Welcome', { exact: false })).toHaveCount(0);
});
```

Before running, check `e2e/smoke.spec.ts` for the real selector the suite uses for a pane — `[data-pane]` above is a guess and must be replaced with whatever is actually there. Same for how other specs assert on a note title in the list.

- [ ] **Step 2: Run the new spec alone and verify it passes**

```bash
lsof -ti:4173 | xargs -r kill -9
npx playwright test e2e/landing.spec.ts
```
Expected: 3 pass.

If the app renders as a bare `#root` with no error, the cause is almost certainly a blocked IndexedDB upgrade — read the console for `Upgrade 'bear-web' blocked by other connection`.

- [ ] **Step 3: Add the landing to the contrast sweep**

In `e2e/contrast.spec.ts`, add a landing case that carries its **own** `storageState` override, and assert the landing heading is visible **before** measuring:

```ts
test.describe('landing', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  // ... measure the landing's text and buttons across the sixteen themes,
  // following whatever shape the existing cases in this file already use.
});
```

The visibility assertion is not optional. Without the `storageState` override this block silently measures the **app shell** instead and passes, which is exactly the shape of failure `parseColour`'s `NaN` had. The Google mark is excluded from the sweep — a fixed-colour trademark is not ours to recolour.

- [ ] **Step 4: Add the landing shot**

In `e2e/shots.spec.ts`, add a landing shot with the same `storageState` override and the same pre-assert. Then:

```bash
npm run shots
ls docs/design/shots/*.png | wc -l
```
Expected: **272** files (17 shots × 16 themes), up from 256. **Count the files; do not trust the exit code.** If the count is 256, the shot did not render; if it is 272 but every landing shot looks like the app shell, the `storageState` override is not applied.

- [ ] **Step 5: Measure the bundle and make the decision**

```bash
npm run build
npx vitest run scripts/bundleSize.test.ts
```

The ceiling is `351_000` B; the pre-R baseline is 349,360 B. Three outcomes:

- **Under the ceiling.** Record the measured number and move on. Nothing else to do.
- **Over it.** Do **not** raise the ceiling as a first move, and do **not** reach for `React.lazy` on the landing — it sits on the critical path for exactly the visitors with the coldest cache. Measure at least these two before choosing, and record both numbers whichever wins:
  1. lazying `Landing` (measure it even though the instinct is wrong — `NEXT.md` records that a fourth lazy root made the closure *worse* by 322 B, so the prediction is not reliable in either direction);
  2. trimming — the four `GoogleMark` paths and the two welcome-note bodies are the only new bulk.
- **Over it and neither helps.** Raising `CEILING_BYTES` is a decision for the user, not for the implementer. Stop and report the measured number.

Whatever happens, the measured number goes in the commit message. This repo has a documented record of confident bundle predictions being wrong.

- [ ] **Step 6: Full gates — the final boundary**

```bash
lsof -ti:4173 | xargs -r kill -9
uptime
npm test -- --run --maxWorkers=4
npm run test:e2e
npm run lint && npm run typecheck && npm run format && npm run build
npm run measure:check
```

Expected: unit green (check the exit code); e2e **248 pass, 1 skip** (245 + 3 new); all cheap gates green; `measure:check` green **unchanged** — the landing adds a surface but alters no existing geometry, so a diff there means something else moved. If it does diff, run `npm run measure` on `main` before blaming this branch.

- [ ] **Step 7: Write the three rulings**

- `docs/rulings/design-tokens-and-layout.md` — the Google mark's four brand hex values are the sole permitted literal colours outside `tokens.css`, scoped to `src/features/landing/GoogleMark.tsx`. They are a third party's trademark, must not shift with the theme, and are excluded from the contrast sweep. Extend the file's `**Trigger:**` line to name `GoogleMark.tsx`.
- `docs/rulings/testing-and-tooling.md` — `playwright.config.ts`'s `use.storageState` and `vitest.setup.ts`'s `beforeEach` both pre-dismiss the landing gate, with **both** keys. A test wanting the landing opts out explicitly. `src/features/landing/harnessDefaults.test.ts` pins the literals. Removing either default turns 37 e2e specs and much of the component suite red at once — the intended failure mode. Extend the `**Trigger:**` line.
- `docs/rulings/notes-lifecycle.md` — the welcome note is seeded through `notes.create()` on the ordinary path, gated on `seen && !seeded && count === 0 && settled`, where settled is `lastSyncedAt !== null` rather than an idle-after-syncing transition. No `useLiveQuery` gates this write. It is not sync-exempt and carries no special kind. Extend the `**Trigger:**` line to name `WelcomeSeeder.tsx` and `seedWelcomeNote.ts`.

- [ ] **Step 8: Update the status docs**

- `CLAUDE.md`: add `| R landing page: first-visit gate, guest mode, welcome note | complete |` to the status table; update the test counts to the numbers actually observed in Step 6; add the shots count change (256 → 272) to the `npm run shots` bullet; add a row to the rulings index only if a genuinely new area appeared (it did not — all three edits extend existing files, so **no new row**).
- `docs/superpowers/NEXT.md`: add an `### R. The landing page` section recording what shipped and why, and the measured bundle number from Step 5.

- [ ] **Step 9: Byte-check every touched file and commit**

```bash
python3 -c "
import subprocess
files = subprocess.check_output(['git','diff','--name-only','HEAD'],text=True).split()
for p in files:
    try:
        d = open(p).read()
    except Exception:
        continue
    n = (d.count(chr(0xA0)), d.count(chr(0x200B)))
    if n != (0,0): print('BAD', p, n)
print('checked', len(files))
"
git add -A
git commit -m "test(landing): end-to-end proof, visual harnesses, and the rulings

The e2e spec is the only one that opts out of the shared storageState.
The contrast and shots cases need the same override and assert the
landing heading before measuring -- without it they silently photograph
and measure the app shell instead, and pass.

Bundle measured at <NUMBER> B against the 351,000 ceiling.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

Replace `<NUMBER>` with the real measurement from Step 5.

---

## Self-review notes

Checked against the spec section by section.

- Decisions 1-6 each map to a task: 1 → Task 3, 2 → Tasks 1+2, 3 → Tasks 4+5, 4 → Task 2, 5 → Task 4, 6 → Task 3.
- Every spec test listed under "Testing" appears in a task, including the two fault-injection steps (Task 4 Step 6, Task 5 Step 5) that the spec asks for by name.
- Names are consistent across tasks: `hasLandingBeenSeen`, `hasSeededWelcome`, `markWelcomeSeeded`, `seedWelcomeNote`, `SeedDeps`, `WelcomeSeeder`, `useLandingGate`, `LandingGate`, `WELCOME_NOTE`.
- Three things this plan tells the implementer to **verify rather than trust**, because they were written from reading rather than running: the pane selector in `e2e/landing.spec.ts` Step 1, the `status` value and sidebar accessible name in `src/app/App.test.tsx` Task 3 Step 3, and whether `Button` honours a `className` height override in Task 2 Step 5. A plan's component-usage sketch is not a signature reference — check the real one.
