import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Session, SessionState } from '@/features/account';
import { ExportProgressProvider } from '@/features/export';
import { I18nProvider } from '@/i18n';

import { NoteRowMenu, type NoteRowMenuRequest } from './NoteRowMenu';

// The session decides whether PDF export is reachable. Mocked rather than
// provided, so no test here fires the real provider's boot fetch — the same
// technique, for the same reason, as `ExportMenu.test.tsx`.
let sessionState: SessionState = { status: 'signedOut' };

vi.mock('@/features/account', () => ({
  useSessionValue: (): Session => ({
    state: sessionState,
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
  }),
}));

function renderMenu(
  overrides: {
    request?: Partial<NoteRowMenuRequest>;
    session?: SessionState;
  } = {},
): {
  onAction: ReturnType<typeof vi.fn>;
  onExport: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  sessionState = overrides.session ?? { status: 'signedOut' };

  const request: NoteRowMenuRequest = {
    noteId: 'n1',
    pinned: false,
    trashed: false,
    rect: new DOMRect(10, 20, 0, 0),
    ...overrides.request,
  };

  const onAction = vi.fn();
  const onExport = vi.fn();
  const onClose = vi.fn();

  render(
    <I18nProvider>
      <ExportProgressProvider>
        <NoteRowMenu request={request} onAction={onAction} onExport={onExport} onClose={onClose} />
      </ExportProgressProvider>
    </I18nProvider>,
  );

  return { onAction, onExport, onClose };
}

describe('NoteRowMenu', () => {
  it('names itself, so a screen reader can tell it apart from the list options menu', () => {
    renderMenu();
    expect(screen.getByRole('menu', { name: 'Note actions' })).toBeInTheDocument();
  });

  it('moves focus to the first item on open', () => {
    renderMenu();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Pin note' }));
  });

  it('flips the pin item’s words for a pinned note', () => {
    renderMenu({ request: { pinned: true } });

    expect(screen.getByRole('menuitem', { name: 'Unpin note' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Pin note' })).not.toBeInTheDocument();
  });

  it.each([
    ['Pin note', 'pin'],
    ['Duplicate', 'duplicate'],
    ['Copy text', 'copyText'],
    ['Delete', 'trash'],
  ])('reports %s as the %s action and closes', async (label, action) => {
    const user = userEvent.setup();
    const { onAction, onClose } = renderMenu();

    await user.click(screen.getByRole('menuitem', { name: label }));

    expect(onAction).toHaveBeenCalledWith(action);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('in the trash', () => {
    it('offers Restore and Delete forever instead of Delete', () => {
      renderMenu({ request: { trashed: true } });

      expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete forever' })).toBeInTheDocument();
      // Not merely "Delete forever is also present": an active-scope Delete
      // alongside it would trash an already-trashed note, which does nothing
      // the user can see.
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it.each([
      ['Restore', 'restore'],
      ['Delete forever', 'purge'],
    ])('reports %s as the %s action', async (label, action) => {
      const user = userEvent.setup();
      const { onAction } = renderMenu({ request: { trashed: true } });

      await user.click(screen.getByRole('menuitem', { name: label }));

      expect(onAction).toHaveBeenCalledWith(action);
    });
  });

  describe('export', () => {
    it('offers all three destinations', () => {
      renderMenu();

      for (const label of ['Markdown', 'HTML', 'PDF']) {
        expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
      }
    });

    it.each([
      ['Markdown', 'md'],
      ['HTML', 'html'],
    ])('exports as %s when signed out, since neither needs the server', async (label, format) => {
      const user = userEvent.setup();
      const { onExport, onClose } = renderMenu();

      await user.click(screen.getByRole('menuitem', { name: label }));

      expect(onExport).toHaveBeenCalledWith(format);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('marks PDF unavailable when signed out, and says why in its name', () => {
      renderMenu({ session: { status: 'signedOut' } });

      const pdf = screen.getByRole('menuitem', { name: /PDF/ });
      expect(pdf).toHaveAttribute('aria-disabled', 'true');
      // The reason has to be in the ACCESSIBLE NAME, not merely on screen:
      // `aria-disabled` keeps the item in the tab order precisely so a
      // keyboard user can reach it and find out what to do about it.
      expect(pdf).toHaveAccessibleName(/Sign in to export PDF/);
    });

    it('refuses the PDF action while unavailable, rather than only looking disabled', async () => {
      const user = userEvent.setup();
      const { onExport, onClose } = renderMenu({ session: { status: 'signedOut' } });

      await user.click(screen.getByRole('menuitem', { name: /PDF/ }));

      expect(onExport).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('exports as PDF when signed in', async () => {
      const user = userEvent.setup();
      const { onExport } = renderMenu({
        session: { status: 'signedIn', account: { userId: 'u1', email: 'a@example.com' } },
      });

      const pdf = screen.getByRole('menuitem', { name: /PDF/ });
      expect(pdf).not.toHaveAttribute('aria-disabled');

      await user.click(pdf);
      expect(onExport).toHaveBeenCalledWith('pdf');
    });
  });

  describe('dismissal', () => {
    it('closes on Escape', () => {
      const { onClose } = renderMenu();

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on a mousedown outside itself', () => {
      const { onClose } = renderMenu();

      fireEvent.mouseDown(document.body);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stays open on a mousedown inside itself', () => {
      const { onClose } = renderMenu();

      fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Duplicate' }));

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
