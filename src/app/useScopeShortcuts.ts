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
 * Matching is on `event.code`, never `event.key`: with Shift held, `key` for
 * the 1 key is `'!'` on a US layout and shifts again under 두벌식. `code` is
 * the physical key regardless of layout or modifier.
 */
export function useScopeShortcuts({
  onScope,
  onSearch,
  enabled = true,
}: ScopeShortcutHandlers): void {
  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent): void {
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

      const scope = BY_CODE.get(event.code);
      if (scope === undefined) return;

      event.preventDefault();
      onScope(scope);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onScope, onSearch, enabled]);
}
