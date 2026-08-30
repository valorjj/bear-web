import { type CSSProperties, type ReactElement, useLayoutEffect, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
import { Icon, UserRound } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import { formatBytes } from '@/lib/formatBytes';

import { AdoptNotesDialog } from './AdoptNotesDialog';
import { useSessionValue } from './SessionContext';
import { Status, syncSummary, SyncStatus, type StatusTone } from './SyncStatus';
import { useImageUsage } from './useImageUsage';
import { useSync, type SyncStatusValue } from './useSync';

/**
 * The badge's fill, keyed by the same tone `SyncStatus` uses for its dot, so
 * the two surfaces cannot disagree about what a state looks like.
 */
const BADGE_TONE: Record<StatusTone, string> = {
  accent: 'bg-accent',
  faint: 'bg-faint',
  danger: 'bg-danger',
};

/**
 * The filled fraction of the quota bar, clamped.
 *
 * Clamped at both ends rather than trusted: a bar wider than its track breaks
 * the rounded corner it sits in, and the server's `used` can legitimately
 * exceed `limit` for an account that was over quota before the limit changed.
 */
function usagePercent(used: number, limit: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

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
  const { state, signIn, signOut } = useSessionValue();
  const sync = useSync(state);
  const [open, setOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  // Fetched only while the menu is open — see `useImageUsage`.
  const usage = useImageUsage(open && state.status === 'signedIn');

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
          <SyncStatus
            status={sync.status}
            message={sync.message}
            lastSyncedAt={sync.lastSyncedAt}
          />
        ) : null}

        {usage === null ? null : (
          <div className="flex flex-col gap-1 px-2 py-1">
            <div className="text-ui-sm flex items-baseline justify-between gap-2">
              {/*
                "Images", not "Storage". The quota counts image bytes only —
                notes are text and are negligible beside them — so the broader
                word would be a small lie, and the first confusing thing about
                it would be that the number never matches the disk.
              */}
              <span className="text-muted">{t('account.images')}</span>
              <span className="text-text font-mono tabular-nums">
                {t('account.images.used')
                  .replace('{used}', formatBytes(usage.used))
                  .replace('{limit}', formatBytes(usage.limit))}
              </span>
            </div>
            <div
              className="bg-hover h-1 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={usage.limit}
              aria-valuenow={usage.used}
              aria-label={t('account.images')}
            >
              <div
                className="bg-accent h-full rounded-full"
                // The one inline style here, and it has to be: the width is a
                // computed percentage, which no utility class can express.
                style={{ width: `${String(usagePercent(usage.used, usage.limit))}%` }}
              />
            </div>
          </div>
        )}

        <p className="text-ui text-text px-2">{t('account.notesLocal')}</p>

        {state.status === 'unavailable' ? null : (
          <div className="border-border border-t pt-1">
            {state.status === 'signedIn'
              ? row(t('account.signOut'), () => setConfirmingSignOut(true))
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

  /**
   * The account button's corner badge, or `null` when there is nothing worth
   * saying.
   *
   * Signed out is `null` on purpose: there is no sync to report, and a badge
   * on a signed-out account would read as a problem rather than as an absence.
   * The RESTING signed-in state is `null` too — "backed up, nothing happening"
   * is the state the app is in almost all the time, and a permanent dot for it
   * would train the eye to ignore the one that matters. What remains is every
   * state a user would actually want surfaced without opening a menu to hunt
   * for it: syncing, offline, an error, and signed-in-but-never-synced.
   */
  const badge: { label: string; tone: StatusTone; state: SyncStatusValue } | null = (() => {
    if (state.status !== 'signedIn') return null;

    const summary = syncSummary(
      { status: sync.status, message: sync.message, lastSyncedAt: sync.lastSyncedAt },
      t,
    );
    return summary.resting ? null : { ...summary, state: sync.status };
  })();

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        // The badge is a colour, and a colour alone is not a status. The
        // button's accessible name carries the same sentence the menu's own
        // status line shows, from the same `syncSummary` call, so a screen
        // reader hears what a sighted user sees without opening the menu.
        aria-label={badge === null ? t('account.menu') : `${t('account.menu')}, ${badge.label}`}
        onClick={() => setOpen((previous) => !previous)}
        className="text-muted hover:bg-hover hover:text-text ease-bear relative flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon glyph={UserRound} size="md" />
        {badge !== null ? (
          <span
            aria-hidden="true"
            data-sync-badge={badge.state}
            // `ring-bg`, not a gap: the dot sits on the icon's corner and
            // needs to read as separate from it whatever the icon is doing
            // underneath — a hairline of pane background does that at any
            // theme, where a margin only moves the overlap somewhere else.
            className={`absolute top-1 right-1 size-1.5 rounded-full ring-2 ring-bg ${BADGE_TONE[badge.tone]} ${badge.state === 'syncing' ? 'animate-pulse' : ''}`}
          />
        ) : null}
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

      <ConfirmDialog
        open={confirmingSignOut}
        title={t('account.signOut.title')}
        body={t('account.signOut.body')}
        confirmLabel={t('account.signOut.confirm')}
        cancelLabel={t('account.signOut.cancel')}
        onConfirm={() => {
          setConfirmingSignOut(false);
          void signOut();
        }}
        onCancel={() => setConfirmingSignOut(false)}
      />

      {/*
        Mounted independent of the popover: it must block sync — and be
        visible — even if the user closed the menu before answering.
      */}
      {sync.adoption !== null ? (
        <AdoptNotesDialog
          open
          count={sync.adoption.count}
          onAdopt={sync.onAdopt}
          onDiscard={sync.onDiscard}
        />
      ) : null}
    </div>
  );
}
