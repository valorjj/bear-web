import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Session, SessionState } from '@/features/account';
import { I18nProvider } from '@/i18n';

import { ExportMenu, type ExportMenuProps } from './ExportMenu';
import type { ExportProgress } from './ExportProgressContext';

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

// Same technique, same reason, for the PDF loader's global flag: a real
// `ExportProgressProvider` can only be driven to `pending: true` by calling
// `begin()` from inside a component, which is exactly the interaction this
// file wants to control directly instead.
let exportPending = false;

vi.mock('./ExportProgressContext', () => ({
  useExportProgress: (): ExportProgress => ({
    pending: exportPending,
    begin: vi.fn(),
    end: vi.fn(),
  }),
}));

function renderMenu(
  overrides: {
    session?: SessionState;
    pending?: boolean;
    onChoose?: ExportMenuProps['onChoose'];
  } = {},
): { onChoose: ExportMenuProps['onChoose']; onDismiss: () => void } {
  sessionState = overrides.session ?? { status: 'signedOut' };
  exportPending = overrides.pending ?? false;
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

  const signedIn: SessionState = { status: 'signedIn', account: { userId: 'u1', email: 'a@b.c' } };

  it('marks the PDF item aria-busy and disabled while a PDF is rendering', () => {
    renderMenu({ session: signedIn, pending: true });
    const pdf = screen.getByRole('menuitem', { name: /PDF/ });

    expect(pdf).toHaveAttribute('aria-busy', 'true');
    // `aria-disabled`, not `disabled`, for the same reason the signed-out
    // case uses it: a keyboard user must still be able to Tab to the item to
    // discover why it did nothing.
    expect(pdf).toHaveAttribute('aria-disabled', 'true');
    expect(pdf).not.toBeDisabled();
    expect(pdf).toHaveAccessibleName(/pdf/i);
  });

  it('does not set aria-busy on PDF, or on the other items, when nothing is pending', () => {
    renderMenu({ session: signedIn, pending: false });
    expect(screen.getByRole('menuitem', { name: 'PDF' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('menuitem', { name: /Markdown/ })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('menuitem', { name: 'HTML' })).not.toHaveAttribute('aria-busy');
  });

  it('leaves Markdown and HTML clickable while a PDF renders', async () => {
    const onChoose = vi.fn();
    renderMenu({ session: signedIn, pending: true, onChoose });

    await userEvent.click(screen.getByRole('menuitem', { name: /Markdown/ }));
    expect(onChoose).toHaveBeenCalledWith('md');
  });

  it('does not fire onChoose for a busy PDF item', async () => {
    const onChoose = vi.fn();
    renderMenu({ session: signedIn, pending: true, onChoose });

    await userEvent.click(screen.getByRole('menuitem', { name: /PDF/ }));
    expect(onChoose).not.toHaveBeenCalled();
  });
});
