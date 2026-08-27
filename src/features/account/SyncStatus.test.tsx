import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { syncSummary, SyncStatus } from './SyncStatus';
import type { SyncStatusValue } from './useSync';

const CASES: { status: SyncStatusValue; message: string | null; expected: string }[] = [
  { status: 'idle', message: null, expected: 'Notes are backed up' },
  { status: 'syncing', message: null, expected: 'Backing up…' },
  { status: 'offline', message: null, expected: 'Offline — your notes are safe on this device' },
  { status: 'error', message: 'Backup paused', expected: 'Backup paused' },
];

describe('SyncStatus', () => {
  it.each(CASES)('renders the translated string for $status', ({ status, message, expected }) => {
    const { container } = renderWithI18n(
      <SyncStatus status={status} message={message} lastSyncedAt={1000} />,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();

    // Every colour must be a token utility, never a literal.
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(container.innerHTML).not.toMatch(/rgb\(/);
    expect(container.querySelector('[style*="color"]')).toBeNull();
  });

  it('does not claim a backup before one has happened', () => {
    // `idle` is the resting state BOTH before the first sync and after a
    // successful one — most visibly while the adoption dialog is open, where
    // `useSync` parks on `idle` and blocks sync on the user's answer.
    // Rendering "Notes are backed up" there asserts a backup that has not
    // happened.
    renderWithI18n(<SyncStatus status="idle" message={null} lastSyncedAt={null} />);

    expect(screen.getByText('Not backed up yet')).toBeInTheDocument();
    expect(screen.queryByText('Notes are backed up')).toBeNull();
  });
});

describe('syncSummary', () => {
  const t = (key: string): string => key;

  it('is resting only when a sync has actually completed and nothing is running', () => {
    // `resting` is what decides whether the account button shows a badge at
    // all. Getting it wrong in one direction puts a permanent dot on the
    // chrome that the eye learns to ignore; in the other it hides the states
    // the badge exists for.
    expect(syncSummary({ status: 'idle', message: null, lastSyncedAt: 1000 }, t).resting).toBe(
      true,
    );
  });

  it.each([
    ['a sync in flight', { status: 'syncing', lastSyncedAt: 1000 }],
    ['being offline', { status: 'offline', lastSyncedAt: 1000 }],
    ['an error', { status: 'error', lastSyncedAt: 1000 }],
    ['signed in but never synced', { status: 'idle', lastSyncedAt: null }],
  ] as const)('is not resting for %s', (_what, input) => {
    expect(syncSummary({ ...input, message: null }, t).resting).toBe(false);
  });

  it('gives the badge the same sentence the menu line shows', () => {
    // The two surfaces must not drift: the badge is a colour, and the
    // button's accessible name is the only thing that says what it means.
    const summary = syncSummary({ status: 'error', message: 'Backup paused', lastSyncedAt: 1 }, t);

    expect(summary.label).toBe('Backup paused');
    expect(summary.tone).toBe('danger');
  });
});
