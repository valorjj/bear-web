import { useEffect } from 'react';

import {
  type NoteScope,
  SCOPE_SHORTCUT_DIGITS,
  SMART_LIST_IDS,
  smartScope,
} from '@/features/notes';

/** `Digit3` → the scope it selects. Built from the same constant the menu advertises. */
const BY_CODE = new Map<string, NoteScope>(
  SMART_LIST_IDS.map((list) => [`Digit${SCOPE_SHORTCUT_DIGITS[list]}`, smartScope(list)]),
);

export interface ScopeShortcutHandlers {
  onScope: (scope: NoteScope) => void;
  onSearch: () => void;
  /** Toggles L3's graph surface. */
  onGraph: () => void;
  /**
   * Closes whatever this handler's caller considers "the current overlay" —
   * today, only the graph (`AppShell` wires it to `closeGraph`, and only
   * while the graph is actually open; it is a no-op otherwise). Optional so
   * nothing else that mounts this hook has to invent a no-op.
   *
   * Deliberately does NOT call `event.preventDefault()`: `Escape` is also
   * consumed by `Popover`, `Dialog`, `SearchField`, `ExportMenu`,
   * `CalloutMenu`, `HeadingFold`, `LinkAutocomplete`, `HighlightPalette`,
   * `HighlightMenu` and `useAnchoredMenu` — each already stops its own
   * propagation or checks its own "am I open" state, and a preventDefault
   * here would not stop bubbling to them anyway (this listener is on
   * `window`, so it runs LAST, after every one of those). It exists only so
   * `Escape` has an effect when nothing else already claimed it.
   */
  onEscape?: () => void;
  /**
   * `false` while a modal is open. `ConfirmDialog` traps focus for a
   * destructive action, and both of these would escape it — the search
   * shortcut by stealing focus out of the trap, the scope shortcuts by
   * rearranging the list behind a dialog that names a note in it.
   */
  enabled?: boolean;
}

/**
 * Every global key binding in the app, in one place. Before A there was one,
 * declared inline in `AppShell`; seven more could not go beside it.
 *
 * `⇧⌘`, NOT `⌥⌘`: `@tiptap/extension-heading` binds `Mod-Alt-${level}` for
 * levels 1–6 and B1 shipped on it, so `⌥⌘1` with the editor focused would make
 * an H1 and switch scope at once — one keystroke, two unrelated effects,
 * differing by where focus happens to be. `Ctrl`+digit is free in Tiptap and
 * rejected anyway: `Ctrl+1`–`8` switches browser tabs on Windows and Linux,
 * and this ships to GitHub Pages. Verify any new binding against
 * `node_modules/@tiptap`, not only against browser shortcuts:
 *
 *   grep -rEn "Mod-Shift-[0-9]|Mod-Alt-[0-9]|Mod-Alt-\$\{" node_modules/@tiptap
 *
 * That grep is why 7, 8 and 9 are unbound here — ordered list, bullet list and
 * blockquote own them — and therefore why a future Archive list cannot take
 * `⇧⌘9`, which is the digit Bear gives it.
 *
 * `⇧⌘G` (L3's graph toggle) was verified unbound the same way:
 *
 *   grep -rEn "Mod-Shift-G|Mod-Alt-G|Mod-Alt-\$\{" node_modules/@tiptap
 *
 * Matching is on `event.code`, never `event.key`: with Shift held, `key` for
 * the 1 key is `'!'` on a US layout and shifts again under 두벌식. `code` is
 * the physical key regardless of layout or modifier.
 */
export function useScopeShortcuts({
  onScope,
  onSearch,
  onGraph,
  onEscape,
  enabled = true,
}: ScopeShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
      // Checked BEFORE the modifier guard below: `Escape` carries no
      // modifier of its own, so the `metaKey || ctrlKey` early return that
      // guards every other binding here would otherwise drop it entirely.
      if (event.code === 'Escape') {
        onEscape?.();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      if (event.code === 'KeyF' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        onSearch();
        return;
      }

      // Alt is REJECTED rather than merely unmatched: `⌥⇧⌘1` must not fire
      // this and a heading toggle both, which is the collision the whole
      // choice of modifier avoids.
      if (!event.shiftKey || event.altKey) return;

      if (event.code === 'KeyG') {
        event.preventDefault();
        onGraph();
        return;
      }

      const scope = BY_CODE.get(event.code);
      if (scope === undefined) return;

      event.preventDefault();
      onScope(scope);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onScope, onSearch, onGraph, onEscape, enabled]);
}
