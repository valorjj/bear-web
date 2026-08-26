import { useEffect, useState } from 'react';

/**
 * Where the note list stops needing the whole screen and can share it with the
 * editor.
 *
 * A comfort threshold, not a hard limit, and the arithmetic says so rather
 * than pretending otherwise: two panes physically fit from about 520px (a
 * 320px list, the shell's chrome, and the 160px `MIN_PANE_WIDTH`). At 640 the
 * editor gets ~280px, which is the narrowest column worth writing a sentence
 * in. If a real device disagrees, this is the number to move — nothing else
 * depends on it.
 */
export const TABLET_MIN_WIDTH = 640;

/**
 * Where all three panes fit: 240 sidebar + 320 list + the shell's chrome still
 * leaves the editor over 400px.
 *
 * Chosen against a constraint, not by taste. `playwright.config.ts` runs
 * `devices['Desktop Chrome']` at 1280×720, so a desktop breakpoint at or below
 * 1280 keeps valid the seven existing e2e assertions that the shell has three
 * panes. Lowering the configured Playwright viewport below this number turns
 * all seven into confusing failures about missing panes; `e2e/mobile.spec.ts`
 * guards that with one honest assertion instead.
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
 * and in the accessibility tree, which is worse than either showing it or not
 * building it), the drawer needs open state and a focus trap, `Pane`'s width
 * is an inline style computed in JS, and the shell renders a different set of
 * children per mode.
 *
 * Seeded during the FIRST render, never from an effect: there is no SSR here,
 * so `matchMedia` is available synchronously, and an effect-seeded value
 * paints one frame of the wrong layout on every single load.
 */
export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(read);

  useEffect(() => {
    const update = (): void => setMode(read());
    const queries = [globalThis.matchMedia(TABLET_QUERY), globalThis.matchMedia(DESKTOP_QUERY)];
    for (const query of queries) query.addEventListener('change', update);

    // Re-read on mount rather than trusting the seed: the viewport can change
    // between the first render and this effect — a rotation during load — and
    // the listeners above only fire on changes after they are attached.
    update();

    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);

  return mode;
}
