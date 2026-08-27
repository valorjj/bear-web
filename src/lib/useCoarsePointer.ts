import { useEffect, useState } from 'react';

/**
 * "The pointer is a fingertip."
 *
 * Gates target size and the long-press gesture. Deliberately NOT the same test
 * as `HOVER_NONE_QUERY` below, even though no device this app will meet
 * separates them: a rule that grows a tap target should say it is about a
 * fingertip, and a rule that stops hiding a control should say it is about
 * hover. Each reads as the reason it exists.
 */
const COARSE_QUERY = '(pointer: coarse)';

/**
 * "This control can never be revealed."
 *
 * The literal statement of J2's defect. Reveals are gated on it in CSS — see
 * the `touch:` variant in `src/styles/tokens.css` and the `@media (hover: none)`
 * blocks in `src/styles/editor.css` — and this hook exists only for the JS side,
 * which needs the coarse-pointer test above.
 *
 * Exported so a test can prove the two constants have not been collapsed into
 * one by a well-meaning simplification.
 */
export const HOVER_NONE_QUERY = '(hover: none)';

function read(): boolean {
  return globalThis.matchMedia(COARSE_QUERY).matches;
}

/**
 * Whether the primary pointing device is a fingertip rather than a mouse.
 *
 * Seeded during the FIRST render, never from an effect, for the reason
 * `useLayoutMode` gives: there is no SSR here, so `matchMedia` answers
 * synchronously, and an effect-seeded value paints one frame of the wrong
 * behaviour on every load. Here that frame is a row whose long-press handler is
 * not yet attached — a gesture that silently does nothing is worse than one
 * that does not exist.
 *
 * Its test asserts the FIRST value the hook ever returns, which is the only
 * assertion that can tell a render-time seed from an effect-time one.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState<boolean>(read);

  useEffect(() => {
    const update = (): void => setCoarse(read());
    const query = globalThis.matchMedia(COARSE_QUERY);
    query.addEventListener('change', update);

    // Re-read on mount rather than trusting the seed, as `useLayoutMode` does:
    // the primary pointer can change between the first render and this effect
    // — a keyboard folio attached to a tablet — and the listener above only
    // fires on changes after it is attached.
    update();

    return () => query.removeEventListener('change', update);
  }, []);

  return coarse;
}
