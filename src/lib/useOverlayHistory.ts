import { useEffect, useRef } from 'react';

/**
 * One history entry per open overlay, so the platform's own back gesture
 * dismisses it.
 *
 * Android's hardware back button and iOS Safari's edge-swipe both drive
 * `popstate`, so neither needs to know anything about this app — but only if
 * there is an entry for them to pop. Without this, the first thing anyone
 * tries on a phone closes the whole app instead of the drawer.
 *
 * **The URL never changes.** `pushState` is called with `location.href`, so
 * there is no scheme to design, no GitHub Pages sub-path to get wrong, and no
 * 404 on refresh. Refreshing lands on the note list, which is already this
 * app's contract — selection is ephemeral by design.
 *
 * Deliberately NOT a router. The app's phases have never needed one, and
 * introducing one would touch every e2e test's assumption about a single page.
 */
export function useOverlayHistory(isOpen: boolean, onClose: () => void, id: string): void {
  // Whether OUR entry is currently on the stack. A ref, not state: it must
  // survive the render that closing triggers, and nothing renders from it.
  const pushedRef = useRef(false);

  // The latest `onClose` without making it an effect dependency. A caller
  // passing an inline arrow re-renders with a new function every time, and a
  // dependency on it would tear down and re-push the entry on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // StrictMode mounts, cleans up, then mounts again. The cleanup below
    // consumes the entry and clears the flag, so this second mount pushes
    // exactly one replacement — net one entry, not two. Two would mean the
    // user needs two backs to dismiss one overlay.
    pushedRef.current = true;
    history.pushState({ bearOverlay: id }, '', location.href);

    const onPopState = (): void => {
      // The browser has already removed our entry. Clearing the flag first is
      // what stops the cleanup below calling `history.back()` as well, which
      // would go back TWICE for one press and throw the user out of the app.
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
