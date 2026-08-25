import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Session, SessionState } from '@/features/account';
import { I18nProvider } from '@/i18n';

import { ExportMenu, type ExportMenuProps } from './ExportMenu';

// `ExportMenu` reads the session through `useSessionValue()` (context), not
// through a prop — `RichEditor` has no business knowing about accounts. The
// module is mocked here so each test can drive the session state directly,
// without a real `SessionProvider` firing its own boot fetch.
let sessionState: SessionState = { status: 'signedOut' };

vi.mock('@/features/account', () => ({
  useSessionValue: (): Session => ({
    state: sessionState,
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
  }),
}));

function renderMenu(
  overrides: { session?: SessionState; onChoose?: ExportMenuProps['onChoose'] } = {},
): { onChoose: ExportMenuProps['onChoose']; onDismiss: () => void } {
  sessionState = overrides.session ?? { status: 'signedOut' };
  const onChoose = overrides.onChoose ?? vi.fn();
  const onDismiss = vi.fn();

  render(
    <I18nProvider>
      <ExportMenu onChoose={onChoose} onDismiss={onDismiss} />
    </I18nProvider>,
  );

  return { onChoose, onDismiss };
}

describe('ExportMenu', () => {
  it('disables PDF when signed out, and says why', () => {
    renderMenu({ session: { status: 'signedOut' } });
    const pdf = screen.getByRole('menuitem', { name: /PDF/ });

    // aria-disabled, NOT disabled: a disabled button is skipped by the tab
    // order, so a keyboard user cannot reach it to discover why it is off.
    expect(pdf).toHaveAttribute('aria-disabled', 'true');
    expect(pdf).not.toBeDisabled();
    expect(pdf).toHaveAccessibleName(/sign in/i);
  });

  it('does not fire onChoose for a disabled PDF item', async () => {
    const onChoose = vi.fn();
    renderMenu({ session: { status: 'signedOut' }, onChoose });
    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('leaves Markdown and HTML enabled when signed out', () => {
    renderMenu({ session: { status: 'signedOut' } });
    expect(screen.getByRole('menuitem', { name: /Markdown/ })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('menuitem', { name: 'HTML' })).not.toHaveAttribute('aria-disabled');
  });

  it('enables PDF when signed in', () => {
    renderMenu({
      session: { status: 'signedIn', account: { userId: 'u1', email: 'a@b.c' } },
    });
    expect(screen.getByRole('menuitem', { name: 'PDF' })).not.toHaveAttribute('aria-disabled');
  });

  it('fires onChoose for PDF when signed in', async () => {
    const onChoose = vi.fn();
    renderMenu({
      session: { status: 'signedIn', account: { userId: 'u1', email: 'a@b.c' } },
      onChoose,
    });
    await userEvent.click(screen.getByRole('menuitem', { name: 'PDF' }));
    expect(onChoose).toHaveBeenCalledWith('pdf');
  });

  it.each([{ status: 'loading' } as const, { status: 'unavailable' } as const])(
    'also disables PDF while the session is %s',
    (session) => {
      renderMenu({ session });
      expect(screen.getByRole('menuitem', { name: /PDF/ })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    },
  );
});
