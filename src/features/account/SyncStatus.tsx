import type { ReactElement, ReactNode } from 'react';

import { useT } from '@/i18n';

import type { SyncStatusValue } from './useSync';

/** The dot's colour. `danger` is used only by the sync status's error state. */
export type StatusTone = 'accent' | 'faint' | 'danger';

const DOT_TONE: Record<StatusTone, string> = {
  accent: 'bg-accent',
  faint: 'bg-faint',
  danger: 'bg-danger',
};

/**
 * A status line: a dot, then a short state in the app's UI face.
 *
 * The dot is the menu's only ornament. It takes the accent only when a
 * session (or a healthy sync) exists, so the one saturated pixel in the
 * surface means something rather than decorating it; every other state
 * leaves it quiet. Shared by `AccountMenu`'s own status line and by
 * `SyncStatus` below, rather than each growing its own copy of the dot's
 * alignment rules — they would drift.
 */
export function Status({
  label,
  tone,
  children,
}: {
  label: string;
  tone: StatusTone;
  children?: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-start gap-2 px-2">
      <span
        aria-hidden="true"
        className={`mt-1 size-1.5 shrink-0 rounded-full ${DOT_TONE[tone]}`}
      />
      {/*
        The address hangs under the label from inside this column rather than
        from a hand-computed left padding. An arbitrary indent matching the dot
        plus the gap was the first attempt, and the spacing-scale guard in
        `sourceLint` rejected it — correctly, because a number that must be
        recomputed whenever the dot size or the gap changes is a misalignment
        waiting to happen. Flex keeps the two in one column by construction.
        (The guard scans comments too, so this one describes the utility
        rather than quoting it.)
      */}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-ui-sm text-muted truncate">{label}</p>
        {children}
      </div>
    </div>
  );
}

const TONE: Record<SyncStatusValue, StatusTone> = {
  idle: 'accent',
  syncing: 'faint',
  offline: 'faint',
  error: 'danger',
};

/**
 * The sync status line, mounted under the account status inside
 * `AccountMenu`'s signed-in branch.
 *
 * "Offline" is deliberately given the same quiet `faint` dot as `syncing`,
 * never `danger`: a machine that sleeps is offline constantly, and that is
 * the normal case, not a failure.
 */
export function SyncStatus({
  status,
  message,
}: {
  status: SyncStatusValue;
  message: string | null;
}): ReactElement {
  const t = useT();

  const label =
    status === 'error'
      ? (message ?? t('sync.error'))
      : status === 'syncing'
        ? t('sync.syncing')
        : status === 'offline'
          ? t('sync.offline')
          : t('sync.idle');

  return <Status label={label} tone={TONE[status]} />;
}
