import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { renderWithI18n } from '@/i18n/testing';

import { NoteEditor } from './NoteEditor';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.files.clear()]);
});

describe('NoteEditor', () => {
  it('seeds the textarea from the note', async () => {
    const note = await notes.create('hello');
    renderWithI18n(<NoteEditor note={note} />);

    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveValue('hello');
  });

  it('persists what the user types', async () => {
    const note = await notes.create('');
    const user = userEvent.setup();

    renderWithI18n(<NoteEditor note={note} />);
    await user.type(screen.getByRole('textbox', { name: 'Note text' }), 'Groceries');

    await waitFor(async () => {
      expect((await notes.get(note.id))?.text).toBe('Groceries');
    });
  });

  it('derives the title from what was typed', async () => {
    const note = await notes.create('');
    const user = userEvent.setup();

    renderWithI18n(<NoteEditor note={note} />);
    await user.type(screen.getByRole('textbox', { name: 'Note text' }), '# Groceries');

    await waitFor(async () => {
      expect((await notes.get(note.id))?.title).toBe('Groceries');
    });
  });

  it('flushes on blur without waiting for the debounce', async () => {
    const note = await notes.create('');
    const user = userEvent.setup();

    renderWithI18n(
      <>
        <NoteEditor note={note} />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.type(screen.getByRole('textbox', { name: 'Note text' }), 'x');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    // Real timers, but a timeout well under AUTOSAVE_DELAY_MS (300ms): the
    // ordinary debounce cannot have fired yet, so a pass can only mean the
    // blur handler triggered the write.
    await waitFor(
      async () => {
        expect((await notes.get(note.id))?.text).toBe('x');
      },
      { timeout: 150 },
    );
  });

  it('purges a note left empty when it unmounts', async () => {
    const note = await notes.create('');
    const { unmount } = renderWithI18n(<NoteEditor note={note} />);

    unmount();

    await waitFor(async () => {
      expect(await notes.get(note.id)).toBeUndefined();
    });
  });

  it('keeps a note that has any text at all', async () => {
    const note = await notes.create('');
    const user = userEvent.setup();

    const { unmount } = renderWithI18n(<NoteEditor note={note} />);
    await user.type(screen.getByRole('textbox', { name: 'Note text' }), 'a');
    unmount();

    await waitFor(async () => {
      expect((await notes.get(note.id))?.text).toBe('a');
    });
  });

  it('shows an inline message when a save fails, keeps the text on screen, and recovers once saves succeed again', async () => {
    const note = await notes.create('');
    const user = userEvent.setup();
    const save = vi.spyOn(notes, 'save').mockRejectedValue(new Error('QuotaExceededError'));

    renderWithI18n(
      <>
        <NoteEditor note={note} />
        <button type="button">elsewhere</button>
      </>,
    );
    const textarea = screen.getByRole('textbox', { name: 'Note text' });
    await user.type(textarea, 'precious');

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
    expect(textarea).toHaveValue('precious');
    // The attempted write carried the user's text, not a stale or empty
    // buffer.
    expect(save).toHaveBeenCalledWith(note.id, 'precious');

    // Restore the real repository and force another flush of the *same*
    // text (no further typing). This is the case that actually exercises
    // the failure-rollback: if the failed save had been mismarked as saved,
    // the next flush would see the pending text as already matching the
    // "saved" marker and skip the retry entirely, leaving the database
    // empty forever.
    save.mockRestore();
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    await waitFor(async () => {
      expect((await notes.get(note.id))?.text).toBe('precious');
    });
  });

  it('uses role="status", never role="alert"', async () => {
    // `role="alert"` belongs to the degraded-storage banner, and the e2e suite
    // asserts on it. A second alert would break those tests.
    const note = await notes.create('');
    const user = userEvent.setup();
    const save = vi.spyOn(notes, 'save').mockRejectedValue(new Error('nope'));

    renderWithI18n(<NoteEditor note={note} />);
    await user.type(screen.getByRole('textbox', { name: 'Note text' }), 'x');

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    save.mockRestore();
  });
});
