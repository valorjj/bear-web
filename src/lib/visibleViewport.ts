import { useEffect, useState } from 'react';

/**
 * The bottom of the area the user can actually see, in CLIENT coordinates —
 * the same coordinate space `getBoundingClientRect()` reports in.
 *
 * `window.innerHeight` is the LAYOUT viewport, and on iOS a virtual keyboard
 * does not change it. It shrinks `visualViewport.height` instead, which is
 * exactly the distinction that matters: read `innerHeight` and the app believes
 * it has a full screen while a third of it is under a keyboard.
 *
 * `offsetTop` is included because the visual viewport can be scrolled WITHIN
 * the layout viewport — pinch-zoom, or iOS scrolling the page up to keep the
 * focused field visible. Its bottom edge in client coordinates is therefore
 * `offsetTop + height`, not `height`.
 *
 * Falls back to `innerHeight` where `visualViewport` is absent. That is a real
 * browser rather than a hypothetical, so it is tested rather than assumed away.
 */
export function visibleBottom(): number {
  const vv = globalThis.visualViewport;
  if (vv == null) return globalThis.innerHeight;
  return vv.offsetTop + vv.height;
}

/**
 * How many pixels at the bottom of the window are hidden — by a virtual
 * keyboard, in practice.
 *
 * **The arithmetic is what makes two mechanisms safe to run together.**
 * `index.html` asks the browser for `interactive-widget=resizes-content`, and
 * where that is honoured the browser shrinks the LAYOUT viewport too — so
 * `innerHeight` and the visual viewport agree, this returns 0, and the
 * JavaScript fallback has nothing left to correct. It cannot double-apply, and
 * that holds without feature detection, which is fortunate: there is no
 * reliable way to detect `interactive-widget` support.
 */
export function keyboardInset(): number {
  return Math.max(0, globalThis.innerHeight - visibleBottom());
}

/**
 * `keyboardInset()`, kept current.
 *
 * Seeded during the FIRST render rather than from an effect, the rule
 * `useLayoutMode` and `useCoarsePointer` both follow: an effect-seeded value
 * paints one frame with the toolbar in the wrong place every time the keyboard
 * opens, which is a visible jump rather than a theoretical one.
 *
 * Both `resize` AND `scroll` are observed: the visual viewport emits `scroll`
 * when it moves within the layout viewport without changing size, which is what
 * iOS does when it lifts the page to keep a focused field above the keyboard.
 * Listening to `resize` alone leaves the toolbar behind on exactly that motion.
 */
export function useVisibleViewport(): number {
  const [inset, setInset] = useState<number>(keyboardInset);

  useEffect(() => {
    const update = (): void => setInset(keyboardInset());
    const vv = globalThis.visualViewport;

    // No `visualViewport` means no keyboard signal at all. `window`'s own
    // `resize` is still worth observing — a desktop window resize, or an
    // Android browser that resizes the layout viewport outright.
    globalThis.addEventListener('resize', update);
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);

    // Re-read on mount rather than trusting the seed: the keyboard can open
    // between the first render and this effect, and the listeners above fire
    // only on changes after they are attached.
    update();

    return () => {
      globalThis.removeEventListener('resize', update);
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
