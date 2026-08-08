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
  // `key={note.id}` on `NoteEditor`, switching notes keeps the old editor
  // instance mounted, so its flush-on-switch (an unmount effect) never runs
  // and its save callbacks — closed over the *old* note's id — end up
  // writing whatever is still in the buffer into the *new* note.
  it('never writes one note text into the other when switching between them', async () => {
    const user = userEvent.setup();
    const first = await notes.create('First note original text');
    const second = await notes.create('Second note original text');

    renderShell();

    await user.click(await screen.findByRole('button', { name: /First note/ }));

    const textarea = await screen.findByRole('textbox', { name: 'Note text' });
    await user.clear(textarea);
    await user.type(textarea, 'First note EDITED');

    // Switch before the debounce fires and without blurring the textarea
    // first: `fireEvent.click` dispatches only the click event, unlike
    // `userEvent.click`, which would also blur the textarea and flush
    // through `onBlur` while `note.id` still points at the first note —
    // masking exactly the race this test exists to catch. The scenario
    // under test is the pending *debounce* timer firing after the switch,
    // which is what a missing `key` mis-targets.
    fireEvent.click(screen.getByRole('button', { name: /Second note/ }));

    await waitFor(async () => {
      const savedFirst = await notes.get(first.id);
      expect(savedFirst?.text).toBe('First note EDITED');
    });

    const savedSecond = await notes.get(second.id);
    expect(savedSecond?.text).toBe('Second note original text');
  });
});
