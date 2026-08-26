import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Session } from '@/features/account';
import { ACTIVE_SCOPE } from '@/features/notes';
import { renderWithI18n } from '@/i18n/testing';

import { SidebarDrawer, type SidebarDrawerProps } from './SidebarDrawer';

// The footer's `AccountMenu` reads the session through context, and mocking it
// keeps the real provider's boot fetch out of every test here.
//
// The DEEP module, not the `@/features/account` barrel: `AccountMenu` imports
// `useSessionValue` from its sibling `./SessionContext`, so replacing the
// barrel's export replaces a binding nothing under test reads. Exactly the
// mistake `NoteEditor.test.tsx` made with `exportNote`, and it fails the same
// way — not with a mock error, but with the real implementation running.
vi.mock('@/features/account/SessionContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/account/SessionContext')>();
  return {
    ...actual,
    useSessionValue: (): Session => ({
      state: { status: 'signedOut' },
      signIn: vi.fn(),
      signOut: vi.fn(async () => {}),
    }),
  };
});

function renderDrawer(overrides: Partial<SidebarDrawerProps> = {}): {
  onClose: SidebarDrawerProps['onClose'];
  onScopeChange: SidebarDrawerProps['onScopeChange'];
} {
  const props: SidebarDrawerProps = {
    open: true,
    onClose: vi.fn(),
    scope: ACTIVE_SCOPE,
    onScopeChange: vi.fn(),
    counts: undefined,
    nodes: [],
    isCollapsed: () => false,
    onToggle: vi.fn(),
    ...overrides,
  };

  renderWithI18n(<SidebarDrawer {...props} />);

  return { onClose: props.onClose, onScopeChange: props.onScopeChange };
}

describe('SidebarDrawer', () => {
  it('renders nothing while closed', () => {
    renderDrawer({ open: false });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names itself, so it is not an unlabelled dialog', () => {
    renderDrawer();

    expect(screen.getByRole('dialog', { name: 'Tags and lists' })).toBeInTheDocument();
  });

  it('shows the same smart lists the desktop sidebar shows', () => {
    renderDrawer();

    expect(screen.getByRole('button', { name: /^Notes\b/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Trash\b/ })).toBeInTheDocument();
  });

  it('closes itself when a scope is chosen, so the filtered list is visible', async () => {
    // Leaving the drawer open would hide the result of the user's own action —
    // the list they just filtered is directly behind it.
    const user = userEvent.setup();
    const { onClose, onScopeChange } = renderDrawer();

    await user.click(screen.getByRole('button', { name: /^Trash\b/ }));

    expect(vi.mocked(onScopeChange)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onClose)).toHaveBeenCalledTimes(1);
  });

  it('is a modal dialog, so assistive tech treats the list behind it as inert', () => {
    renderDrawer();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
