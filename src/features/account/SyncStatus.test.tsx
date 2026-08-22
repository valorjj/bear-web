import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { SyncStatus } from './SyncStatus';
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
