import type { Page } from '@playwright/test';

/**
 * Installs a controllable `visualViewport` before the app boots.
 *
 * **Why this fixture has to exist at all:** Playwright cannot open a virtual
 * keyboard, and on iOS a keyboard shrinks `visualViewport.height` WITHOUT
 * changing `window.innerHeight` — precisely the distinction
 * `src/lib/visibleViewport.ts` was written to handle. A viewport resize is
 * therefore not a substitute: it moves both numbers and would exercise the one
 * case the code does not need help with.
 *
 * **What it can and cannot prove.** It drives the exact code path a real
 * keyboard drives, so the toolbar's response is genuinely asserted. It says
 * nothing about `interactive-widget=resizes-content`, which is the browser's
 * own behaviour and is not emulable — these tests stay green with that token
 * misspelled. `scripts/sourceLint.test.ts` catches deletion of the token, and
 * the spec's real-device checklist covers the rest.
 *
 * Runs in an init script rather than after `goto` for the reason `seedDatabase`
 * does: `useVisibleViewport` seeds during the app's FIRST render, so a fake
 * installed after boot would be read for the first time only on the next
 * resize, and the seeding behaviour — which has its own unit test — would go
 * unexercised here.
 */
export async function installFakeViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<() => void>>();
    const state = { height: globalThis.innerHeight, offsetTop: 0 };

    const fake = {
      get height() {
        return state.height;
      },
      get width() {
        return globalThis.innerWidth;
      },
      get offsetTop() {
        return state.offsetTop;
      },
      get offsetLeft() {
        return 0;
      },
      get pageTop() {
        return state.offsetTop;
      },
      get pageLeft() {
        return 0;
      },
      get scale() {
        return 1;
      },
      addEventListener: (type: string, handler: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(handler);
      },
      removeEventListener: (type: string, handler: () => void) => {
        listeners.get(type)?.delete(handler);
      },
      dispatchEvent: () => true,
    };

    // `defineProperty`, because `window.visualViewport` is a readonly accessor
    // on the prototype and a plain assignment silently does nothing.
    Object.defineProperty(globalThis, 'visualViewport', {
      value: fake,
      configurable: true,
    });

    Object.defineProperty(globalThis, '__setKeyboardInset', {
      value: (inset: number) => {
        state.height = globalThis.innerHeight - inset;
        for (const handler of [...(listeners.get('resize') ?? [])]) handler();
      },
      configurable: true,
    });

    // Separate from the inset, because they are separate motions: iOS lifts
    // the page WITHIN the layout viewport to keep a focused field visible, and
    // emits `scroll` with no size change at all.
    Object.defineProperty(globalThis, '__setViewportOffset', {
      value: (offsetTop: number) => {
        state.offsetTop = offsetTop;
        for (const handler of [...(listeners.get('scroll') ?? [])]) handler();
      },
      configurable: true,
    });
  });
}

/** Opens a fake keyboard of `inset` pixels. `0` closes it. */
export async function setKeyboardInset(page: Page, inset: number): Promise<void> {
  await page.evaluate((px) => {
    (globalThis as unknown as { __setKeyboardInset: (n: number) => void }).__setKeyboardInset(px);
  }, inset);
}

/** Scrolls the visual viewport within the layout viewport, changing no size. */
export async function setViewportOffset(page: Page, offsetTop: number): Promise<void> {
  await page.evaluate((px) => {
    (globalThis as unknown as { __setViewportOffset: (n: number) => void }).__setViewportOffset(px);
  }, offsetTop);
}
