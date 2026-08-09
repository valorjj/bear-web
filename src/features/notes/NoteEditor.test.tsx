import { act, screen, waitFor } from '@testing-library/react';
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

/**
 * Forces `useFlushTriggers`' `visibilitychange` listener to fire, the same
 * path a real tab switch or mobile backgrounding takes. jsdom's
 * `document.visibilityState` is a read-only getter, so it has to be
 * redefined before the event is dispatched — restored afterward so it
 * doesn't leak into later tests.
 */
async function triggerVisibilityFlush(): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });
  try {
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // `flush`'s save is fire-and-forget (`void save(...).then(...)`); drain
    // the microtask queue so a would-be call has actually happened by the
    // time the assertion runs, rather than racing it.
    await act(async () => undefined);
  } finally {
    if (original) {
      Object.defineProperty(document, 'visibilityState', original);
    } else {
      delete (document as { visibilityState?: string }).visibilityState;
    }
  }
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
  // The ruling: savedRef is seeded from the SERIALIZED document, not from
  // note.text. Seeded the obvious way, every non-canonical note in the
  // database would differ from its own serialization the instant it opened,
  // and autosave would write it back — churning updatedAt, reordering the
  // note list, and re-running the tag reindex, for a note the user only
  // looked at.
  //
  // Both tests below assert on the `notes.save` SPY, not on disk content
  // read back afterward: `flush`'s write is a fire-and-forget promise
  // (`void save(...).then(...)`), so reading the note back immediately races
  // it and can pass on timing luck alone. Spying is deterministic — no
  // polling, no delay, no race.

  it('a flush after opening still writes nothing', async () => {
    const note = await createNote('* asterisk bullet');
    const save = vi.spyOn(notes, 'save');

    renderWithI18n(<NoteEditor key={note.id} note={note} />);
    await screen.findByLabelText('Note text');

    // Force a real flush — the note was opened, never edited. `flush`'s own
    // dedupe (`pending === attemptedRef.current`) is exactly what this test
    // is checking: it only holds if `attemptedRef` (seeded from `initial`)
    // already equals the editor's serialized document.
    await triggerVisibilityFlush();

    expect(save).not.toHaveBeenCalled();
  });

  it('unmounting after opening still writes nothing', async () => {
    const note = await createNote('* asterisk bullet');
    const save = vi.spyOn(notes, 'save');

    const { unmount } = renderWithI18n(<NoteEditor key={note.id} note={note} />);
    await screen.findByLabelText('Note text');

    act(() => {
      unmount();
    });
    // The unmount cleanup's flush is also fire-and-forget; drain the
    // microtask queue before asserting.
    await act(async () => undefined);

    expect(save).not.toHaveBeenCalled();
    // Weaker, secondary check: the note is untouched on disk. Kept alongside
    // the spy assertion above (which is what actually makes this test
    // deterministic), not in place of it.
    expect((await notes.get(note.id))?.text).toBe('* asterisk bullet');
  });
});

/**
 * The property the whole editor rests on, asserted through the REAL component
 * rather than against `MarkdownManager` standalone.
 *
 * Every serializer test drives the manager on its own. Nothing asserted that
 * the manager and the MOUNTED ProseMirror schema agree — and `NoteEditor`'s
 * correctness is exactly that agreement. When they disagreed, opening a note
 * and closing it again could rewrite it, or (for `'1. '`, `'# '`) DELETE it:
 * the manager emitted a schema-invalid node, ProseMirror silently dropped it,
 * and the shorter document was written back.
 *
 * Each input below is stored verbatim and then merely opened and closed. No
 * write and no purge may occur, for any of them.
 */
describe('manager/schema agreement', () => {
  const DEGENERATE: ReadonlyArray<{ name: string; markdown: string }> = [
    // The reproduction from the final review, byte for byte: typing '1. ' in a
    // new note stored '1. \n\n', and reopening it purged the note outright.
    { name: 'empty ordered list item', markdown: '1. ' },
    { name: 'empty ordered list item, as stored', markdown: '1. \n\n' },
    { name: 'empty heading', markdown: '# ' },
    { name: 'empty bullet', markdown: '- ' },
    { name: 'empty blockquote', markdown: '> ' },
    { name: 'ordered list with a trailing empty item', markdown: '1. Milk\n2. ' },
    { name: 'empty heading above a body', markdown: '# \n\nReal body text here' },
    // Non-idempotent normalization is the other way opening a note can write:
    // '<br>' at the end of a block serializes to '  \n', which parses back as
    // plain text, so the seed and the editor's reading differed forever.
    { name: 'trailing hard break', markdown: 'a<br>' },
    { name: 'trailing two-space break', markdown: 'a  \n' },
    // Whitespace-only notes survived M3's textarea and must keep surviving.
    { name: 'whitespace only', markdown: '   ' },
  ];

  describe.each(DEGENERATE)('$name', ({ markdown }) => {
    it('is neither written nor purged by opening and closing it', async () => {
      const note = await createNote(markdown);
      const save = vi.spyOn(notes, 'save');
      const purge = vi.spyOn(notes, 'purge');

      const { unmount } = renderWithI18n(<NoteEditor key={note.id} note={note} />);
      await screen.findByLabelText('Note text');

      await triggerVisibilityFlush();
      act(() => {
        unmount();
      });
      await act(async () => undefined);

      expect(save).not.toHaveBeenCalled();
      expect(purge).not.toHaveBeenCalled();
      expect((await notes.get(note.id))?.text).toBe(markdown);
    });
  });
});

describe('the keyed remount', () => {
  // `NoteEditor` must be rendered with `key={note.id}` so React remounts it
  // on every switch — the doc comment on the component says so, but nothing
  // in this file pinned the mechanism directly. `AppShell.test.tsx`'s
  // equivalent test cannot: `useNotes` routes every selection change through
  // a transient `undefined`, which unmounts `NoteEditor` regardless of `key`
  // and masks its absence for that specific click sequence (see the Task 10
  // report). This test drives `NoteEditor` directly, with no `useNotes` in
  // between, so the `key` is the only thing that can produce isolation.
  it('shows the new note after a keyed switch, never the previous note', async () => {
    const noteA = await notes.create('First note text');
    const noteB = await notes.create('Second note text');

    const { rerender } = renderWithI18n(<NoteEditor key={noteA.id} note={noteA} />);
    await screen.findByText('First note text');

    rerender(<NoteEditor key={noteB.id} note={noteB} />);

    const editor = await screen.findByLabelText('Note text');
    expect(editor).toHaveTextContent('Second note text');
    expect(editor).not.toHaveTextContent('First note text');
  });

  // The falsification: the SAME key across a `note` prop change is exactly
  // the bug the real `key={note.id}` prevents. React reuses the fiber, the
  // rich editor's `useState(() => normalizeMarkdown(note.text))` seed only
  // ever runs once, and the surface keeps showing note A's text after
  // "switching" to note B — the "wrote note A's text over note B" class of
  // bug in visible form.
  it('WITHOUT a change of key: keeps showing the previous note (falsification)', async () => {
    const noteA = await notes.create('First note text');
    const noteB = await notes.create('Second note text');

    const { rerender } = renderWithI18n(<NoteEditor key="constant" note={noteA} />);
    await screen.findByText('First note text');

    rerender(<NoteEditor key="constant" note={noteB} />);

    // No remount happens, so there is nothing to await; assert immediately.
    const editor = screen.getByLabelText('Note text');
    expect(editor).toHaveTextContent('First note text');
    expect(editor).not.toHaveTextContent('Second note text');
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
