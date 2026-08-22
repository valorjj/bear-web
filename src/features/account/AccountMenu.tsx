import { type CSSProperties, type ReactElement, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { Icon, UserRound } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import { useSession } from './useSession';

/**
 * The sidebar footer's account control, beside the theme picker.
 *
 * Deliberately a sibling of `ThemePicker` rather than a new chrome region: both
 * are app-level settings reached rarely, and the footer already exists with the
 * right affordance.
 *
 * No colour is written here. Every value is a token utility, so a palette edit
 * updates this menu for free.
 */
/** Matches the previous `w-64`, kept so the visual size is unchanged by the fix. */
const MENU_WIDTH = 256;
/** Breathing room from the trigger and from the viewport edge. */
const GAP = 8;

export function AccountMenu(): ReactElement {
  const t = useT();
  const { state, signIn, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);

  function row(label: string, onClick: () => void): ReactElement {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClick();
          setOpen(false);
        }}
        className="text-ui ease-bear text-text hover:bg-hover flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-[var(--bear-duration-fast)]"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }

  function body(): ReactElement {
    if (state.status === 'loading') {
      return <p className="text-ui text-muted px-2 py-1">{t('account.menu')}</p>;
    }

    if (state.status === 'unavailable') {
      return (
        <div className="px-2 py-1">
          <p className="text-ui text-text">{t('account.unavailable')}</p>
          <p className="text-ui text-muted mt-1">{t('account.unavailable.body')}</p>
        </div>
      );
    }

    if (state.status === 'signedOut') {
      return (
        <>
          <p className="text-ui text-muted px-2 py-1">{t('account.signedOut')}</p>
          {row(t('account.signIn.google'), signIn)}
        </>
      );
    }

    return (
      <>
        <p className="text-ui text-muted truncate px-2 py-1">
          {state.account.email ?? state.account.userId}
        </p>
        {row(t('account.signOut'), () => void signOut())}
        <p className="text-ui text-faint px-2 py-1">{t('account.signOut.note')}</p>
      </>
    );
  }

  /**
   * Places the surface in VIEWPORT coordinates, above the trigger.
   *
   * It cannot be `absolute`. The sidebar `Pane` carries `overflow-hidden` so
   * the tag tree scrolls under a pinned footer, and that clips any descendant
   * wider than the pane — at a 240px sidebar a 256px menu loses its right
   * edge, and the disclosure line is cut mid-sentence. `position: fixed`
   * escapes the clip because no ancestor establishes a containing block (no
   * `transform`, `filter` or `will-change` anywhere in the layout — verified,
   * and the reason this works at all). Introducing one above this menu would
   * silently re-clip it.
   *
   * Read in `useLayoutEffect` so the measurement happens before paint; a
   * `useEffect` here would show the surface at the wrong place for one frame.
   */
  useLayoutEffect(() => {
    if (!open) return;

    function place(): void {
      const trigger = triggerRef.current;
      if (trigger === null) return;

      const rect = trigger.getBoundingClientRect();
      const width = Math.min(MENU_WIDTH, window.innerWidth - GAP * 2);
      // Clamped so a narrow window pushes the surface inward rather than off
      // the right edge, which `fixed` would otherwise happily allow.
      const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP));

      setPlacement({
        position: 'fixed',
        left,
        bottom: window.innerHeight - rect.top + GAP,
        width,
      });
    }

    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account.menu')}
        onClick={() => setOpen((previous) => !previous)}
        className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon glyph={UserRound} size="md" />
      </button>

      {open && placement !== null ? (
        <Popover
          open
          onClose={() => setOpen(false)}
          label={t('account.menu')}
          className="z-20"
          style={placement}
        >
          {body()}
        </Popover>
      ) : null}
    </div>
  );
}
