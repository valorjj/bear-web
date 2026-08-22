import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { AdoptNotesDialog } from './AdoptNotesDialog';

function renderDialog(overrides: Partial<{ open: boolean; count: number }> = {}) {
  const onAdopt = vi.fn();
  const onDiscard = vi.fn();
  render(
    <I18nProvider>
      <AdoptNotesDialog
        open={overrides.open ?? true}
        count={overrides.count ?? 3}
        onAdopt={onAdopt}
        onDiscard={onDiscard}
      />
    </I18nProvider>,
  );
  return { onAdopt, onDiscard };
}

describe('AdoptNotesDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('shows the note count in the body', () => {
    renderDialog({ count: 7 });
    expect(screen.getByRole('alertdialog')).toHaveTextContent('7');
  });

  it('clicking "Add them" calls onAdopt and not onDiscard', () => {
    const { onAdopt, onDiscard } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Add them' }));
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('clicking "Discard them" calls onDiscard', () => {
    const { onAdopt, onDiscard } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Discard them' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  // ConfirmDialog focuses Cancel first and maps Escape to it deliberately:
  // these dialogs guard an action a user might not have meant to trigger, and
  // an Enter or Escape already in flight when the dialog opens must not land
  // on the irreversible branch. Here the "cancel" position is "Add them" —
  // the non-destructive choice — so dismissing the dialog must never discard
  // the user's notes.
  it('Escape calls onAdopt, not onDiscard', () => {
    const { onAdopt, onDiscard } = renderDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
