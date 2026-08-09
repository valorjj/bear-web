import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { db, notes } from '@/data';
import { I18nProvider } from '@/i18n';
import { en } from '@/i18n/en';

import { AppShell } from './AppShell';

function renderShell() {
  return render(
    <I18nProvider locale="en">
      <AppShell />
    </I18nProvider>,
  );
}

describe('AppShell', () => {
  it('renders all three panes as labelled regions', () => {
    renderShell();

    expect(screen.getByRole('region', { name: en['pane.sidebar'] })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: en['pane.noteList'] })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: en['pane.editor'] })).toBeInTheDocument();
  });

  it('shows the scope rows in the sidebar and empty states elsewhere', async () => {
    renderShell();

    expect(screen.getByRole('button', { name: en['scope.notes'] })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['scope.trash'] })).toBeInTheDocument();
    expect(screen.getByText(en['editor.empty.title'])).toBeInTheDocument();

    // The note list renders nothing until the live query resolves, so that a
    // reload does not flash "No notes" before the notes arrive.
    expect(await screen.findByText(en['noteList.empty.title'])).toBeInTheDocument();
  });

  it('renders a resizer between each adjacent pair of panes', () => {
    renderShell();

    expect(screen.getAllByRole('separator')).toHaveLength(2);
    expect(screen.getByRole('separator', { name: en['resizer.sidebar'] })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: en['resizer.noteList'] })).toBeInTheDocument();
  });

  it('renders in Korean when the locale is Korean', async () => {
    const { ko } = await import('@/i18n/ko');

    render(
      <I18nProvider locale="ko">
        <AppShell />
      </I18nProvider>,
    );

    expect(screen.getByRole('region', { name: ko['pane.sidebar'] })).toBeInTheDocument();
    expect(await screen.findByText(ko['noteList.empty.title'])).toBeInTheDocument();
  });
});

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.files.clear()]);
});

describe('AppShell notes', () => {
  it('creates a note and opens it in the editor', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'New note' }));

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Note text' })).toBeInTheDocument();
    });
  });

  it('moves a note to the trash and restores it', async () => {
    const user = userEvent.setup();
    await notes.create('Groceries');

    renderShell();

    await user.click(await screen.findByRole('button', { name: /Groceries/ }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    // `NoteList` only renders `Delete` when a note is selected in the active
    // scope, so its disappearance is proof the selection was actually
    // cleared by `useNotes` reconciliation — not just that the row left the
    // list, which the next assertion alone cannot distinguish. Reconciliation
    // clears the selection via an async probe, hence `waitFor`.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Groceries/ })).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Trash' }));
    await user.click(await screen.findByRole('button', { name: /Groceries/ }));
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await user.click(screen.getByRole('button', { name: 'Notes' }));
    expect(await screen.findByRole('button', { name: /Groceries/ })).toBeInTheDocument();
  });

  it('discards a note the user never typed into', async () => {
    const user = userEvent.setup();
    const keeper = await notes.create('Keeper');

    renderShell();

    await user.click(screen.getByRole('button', { name: 'New note' }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Note text' })).toBeInTheDocument();
    });

    await user.click(await screen.findByRole('button', { name: /Keeper/ }));

    await waitFor(async () => {
      expect(await notes.listActive()).toHaveLength(1);
    });
    expect((await notes.listActive())[0]?.id).toBe(keeper.id);
  });

  it('does not create a second note when "New note" is double-clicked', async () => {
    renderShell();

    const createButton = screen.getByRole('button', { name: 'New note' });

    // `fireEvent`, not `userEvent`, deliberately: both clicks must land
    // synchronously, before the first `notes.create()` await resolves — the
    // double-click race the guard in `handleCreate` exists for. Awaiting
    // between the two clicks would let the guard's `finally` clear before the
    // second click, and the test would pass whether or not the fix exists.
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Note text' })).toBeInTheDocument();
    });

    expect(await notes.listActive()).toHaveLength(1);
  });

  it('creating from the trash scope returns to the notes scope', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Trash' }));
    await user.click(screen.getByRole('button', { name: 'New note' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page');
    });
  });

  // Regression test for the keyed remount described in AppShell: without
  // `key={note.id}` on `NoteEditor`, switching notes reuses the same editor
  // fiber. `useAutosave`'s `useState(initial)` only reads `initial` at
  // mount, so a reused fiber keeps displaying the *previous* note's text
  // after the switch — 100% reproducible with an ordinary click, no timing
  // games required. (An earlier version of this test tried to catch a
  // pending-debounce cross-write via `fireEvent.click`, on the theory that
  // skipping the realistic blur would expose a stale `saveRef`. That path
  // turned out to be unreachable through the real UI: `NoteListItem` is a
  // plain `<button>`, so any real focus transfer onto it — mouse or
  // keyboard — blurs the textarea and flushes correctly before `onSelect`
  // runs, regardless of the key. That test was deleted in favor of this one,
  // which asserts the actual, always-reachable symptom.)
  it("shows each note's own text after switching, not the previous note's", async () => {
    const user = userEvent.setup();
    await notes.create('First note text');
    await notes.create('Second note text');

    renderShell();

    await user.click(await screen.findByRole('button', { name: /First note/ }));
    // A ProseMirror `contenteditable` has no `value`; assert its text content
    // instead. Same migration as the four `toHaveValue` assertions in
    // `e2e/notes.spec.ts`, forced by the same textarea-to-contenteditable
    // swap (Task 10).
    expect(await screen.findByRole('textbox', { name: 'Note text' })).toHaveTextContent(
      'First note text',
    );

    await user.click(await screen.findByRole('button', { name: /Second note/ }));
    expect(await screen.findByRole('textbox', { name: 'Note text' })).toHaveTextContent(
      'Second note text',
    );
  });
});
