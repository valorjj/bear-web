import { type CSSProperties, type ReactElement, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { Icon, UserRound } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import { Status, SyncStatus } from './SyncStatus';
import { useSession } from './useSession';
import { useSync } from './useSync';

/** Matches the previous `w-64`, kept so the visual size is unchanged. */
const MENU_WIDTH = 256;
/** Breathing room from the trigger and from the viewport edge. */
const GAP = 8;

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
export function AccountMenu(): ReactElement {
  const t = useT();
  const { state, signIn, signOut } = useSession();
  const sync = useSync(state);
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

  /**
   * Identity, then the statement, then the action — and the STATEMENT is the
   * largest, highest-contrast line, not the address.
   *
   * That inversion is the design. Before it, the email, the action and the
   * disclosure were all `text-ui` in three greys: only one was clickable and
   * nothing said so, the address looked tappable, and the disclosure read as a
   * disabled row. Making "where your notes are" the headline is also the only
   * honest hierarchy here — in D1 signing in moves no note off this device, so
   * the address is a receipt and the statement is the answer.
   *
   * The address is set in the mono face: it is an identifier, not prose, mono
   * already carries code in this app, and truncating a monospaced string reads
   * as deliberate rather than broken.
   */
  function body(): ReactElement {
    if (state.status === 'loading') {
      // No spinner and no skeleton: the fetch resolves in milliseconds on a
      // reachable server, and a flash of chrome is worse than a still frame.
      return <Status label={t('account.menu')} tone="faint" />;
    }

    const status =
      state.status === 'unavailable'
        ? t('account.unavailable')
        : state.status === 'signedOut'
          ? t('account.signedOut')
          : t('account.signedIn');

    return (
      <div className="flex flex-col gap-2 pt-1">
        <Status label={status} tone={state.status === 'signedIn' ? 'accent' : 'faint'}>
          {state.status === 'signedIn' ? (
            <p className="text-ui-sm text-muted truncate font-mono">
              {state.account.email ?? state.account.userId}
            </p>
          ) : null}
        </Status>

        {state.status === 'signedIn' ? (
          <SyncStatus status={sync.status} message={sync.message} />
        ) : null}

        <p className="text-ui text-text px-2">{t('account.notesLocal')}</p>

        {state.status === 'unavailable' ? null : (
          <div className="border-border border-t pt-1">
            {state.status === 'signedIn'
              ? row(t('account.signOut'), () => void signOut())
              : row(t('account.signIn.google'), signIn)}
          </div>
        )}
      </div>
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
