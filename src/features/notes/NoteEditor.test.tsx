import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import type { Note } from '@/data';
import * as editor from '@/features/editor';
import { renderWithI18n } from '@/i18n/testing';

import { NoteEditor } from './NoteEditor';

// jsdom has no layout engine, so ProseMirror's caret/scroll math
// (`coordsAtPos`, `posAtCoords`) throws on APIs jsdom never implements.
// These stubs return harmless empty geometry so `userEvent.type` can drive
// the contenteditable surface without crashing; see the toolchain note in
// CLAUDE.md about jsdom lacking `setPointerCapture` for the same class of gap.
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
};
Range.prototype.getBoundingClientRect = () => emptyRect;
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.files.clear()]);
});

// `vi.spyOn` on an already-spied method returns the SAME mock and keeps its
// call history; several tests in this file spy on `notes.save` or
// `normalizeMarkdown` without restoring, so a later test's assertion of "not
// called" would otherwise see an earlier test's calls. Restore after every
// test rather than relying on each test to remember to.
afterEach(() => {
  vi.restoreAllMocks();
});

async function createNote(text: string): Promise<Note> {
  const created = await notes.create();
  await notes.save(created.id, text);
  const stored = await notes.get(created.id);
  if (stored === undefined) throw new Error('note vanished');
  return stored;
}

describe('NoteEditor', () => {
  it('seeds the textarea from the note', async () => {
    const note = await notes.create('hello');
    renderWithI18n(<NoteEditor note={note} />);

    // A ProseMirror `contenteditable` has no `value`; assert its text content
    // instead. `<textarea>`-only assertion, migrated for the same reason as
    // the four e2e assertions in `e2e/notes.spec.ts`.
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveTextContent('hello');
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
    expect(textarea).toHaveTextContent('precious');
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

describe('opening a note', () => {
  it('does not write when a note is merely opened', async () => {
    // The ruling: savedRef is seeded from the SERIALIZED document, not from
    // note.text. Seeded the obvious way, every non-canonical note in the
    // database would differ from its own serialization the instant it opened,
    // and autosave would write it back — churning updatedAt, reordering the
    // note list, and re-running the tag reindex, for a note the user only
    // looked at.
    const note = await createNote('* asterisk bullet');
    const save = vi.spyOn(notes, 'save');

    renderWithI18n(<NoteEditor key={note.id} note={note} />);
    await screen.findByLabelText('Note text');

    expect(save).not.toHaveBeenCalled();
  });

  it('leaves non-canonical markdown untouched on disk until the user edits', async () => {
    const note = await createNote('* asterisk bullet');

    const { unmount } = renderWithI18n(<NoteEditor key={note.id} note={note} />);
    await screen.findByLabelText('Note text');
    unmount();

    expect((await notes.get(note.id))?.text).toBe('* asterisk bullet');
  });
});

describe('serialization failure', () => {
  it('never calls save when serialization throws', async () => {
    const note = await createNote('# Hello');
    const save = vi.spyOn(notes, 'save');
    vi.spyOn(editor, 'normalizeMarkdown').mockImplementation(() => {
      throw new Error('serialization failed');
    });

    renderWithI18n(<NoteEditor key={note.id} note={note} />);
    await screen.findByLabelText('Note text');

    expect(save).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
