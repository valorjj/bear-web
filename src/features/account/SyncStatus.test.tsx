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
    const { container } = renderWithI18n(<SyncStatus status={status} message={message} />);

    expect(screen.getByText(expected)).toBeInTheDocument();

    // Every colour must be a token utility, never a literal.
    expect(container.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(container.innerHTML).not.toMatch(/rgb\(/);
    expect(container.querySelector('[style*="color"]')).toBeNull();
  });
});
