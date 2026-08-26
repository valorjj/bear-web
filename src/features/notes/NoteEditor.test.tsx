import { act, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type ReactElement, type ReactNode, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/styles/editor.css';

import { db, folds, notes } from '@/data';
import type { Note } from '@/data';
import * as editor from '@/features/editor';
import { foldedKeys, headingSections, type RichEditorHandle } from '@/features/editor';
import {
  exportNote,
  ExportProgressProvider,
  PdfExportError,
  useExportProgress,
} from '@/features/export';
import { I18nProvider } from '@/i18n';
import type { Locale } from '@/i18n';

import { NoteEditor } from './NoteEditor';

// `exportNote` is the only thing about `@/features/export` this file needs to
// control directly (to make a PDF export fail on demand); everything else —
// `ExportProgressProvider`, `useExportProgress`, `PdfExportError` — passes
// through to the real module, the same technique `normalizeMarkdown` below
// uses via `vi.spyOn` rather than a full mock.
// The DEEP module, not the `@/features/export` barrel. `useExportRunner` —
// which is what actually calls `exportNote` now — imports it as `./exportNote`
// rather than through its own barrel, so mocking the barrel replaces a binding
// nothing in the path under test reads. The barrel re-exports whatever this
// module resolves to, so `vi.mocked(exportNote)` imported from the barrel is
// still this same spy.
vi.mock('@/features/export/exportNote', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/export/exportNote')>();
  return { ...actual, exportNote: vi.fn(actual.exportNote) };
});

/**
 * `NoteEditor` now reads `useExportProgress()` (for the PDF loader's
 * begin/end pair), which throws without an `ExportProgressProvider` above
 * it. Every render in this file goes through `renderWithI18n` already, so
 * wrapping it here — rather than touching each of the ~25 call sites —
 * keeps every existing call site unchanged. Shadows the imported helper
 * deliberately, not renamed, so nothing else in the file has to change.
 *
 * Built on RTL's own `render` with a `wrapper` option, NOT by wrapping `ui`
 * inline: RTL's `rerender` reapplies whatever `wrapper` a render was given,
 * but only what was passed as `wrapper` — a provider wrapped around `ui` by
 * hand is captured in that FIRST call's tree only, and vanishes on
 * `rerender(<NoteEditor .../>)`, which several tests below do directly.
 * This file's own "keyed remount" tests caught exactly that when this was
 * first written as the simpler inline-wrap version.
 */
function renderWithI18n(ui: ReactNode, locale: Locale = 'en'): RenderResult {
  return render(ui, {
    wrapper: ({ children }) => (
      <I18nProvider locale={locale}>
        <ExportProgressProvider>{children}</ExportProgressProvider>
      </I18nProvider>
    ),
  });
}

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
 * Renders `NoteEditor` with an externally-owned `handleRef`, so a test can
 * reach the mounted Tiptap instance (`handle.current.editor`) the same way
 * `RichEditor.test.tsx` does. Nothing in the app passes this ref itself —
 * `AppShell` never needs the editor instance — it exists purely so tests
 * don't each grow their own parallel ref plumbing.
 */
function renderEditor(note: Note): RenderResult & { handle: RefObject<RichEditorHandle | null> } {
  const handle = createRef<RichEditorHandle>();
  const result = renderWithI18n(<NoteEditor note={note} handleRef={handle} />);
  return { ...result, handle };
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

  it('does not purge a blank note that has been trashed', async () => {
    // Delete must mean the same thing everywhere. Before M6 the unmount discard
    // purged a blank note the instant it was trashed, so the same button was
    // recoverable or not depending on invisible state.
    const note = await notes.create('');
    await notes.trash(note.id);

    const { unmount } = renderWithI18n(<NoteEditor note={(await notes.get(note.id))!} />);
    unmount();

    await waitFor(async () => expect(await notes.get(note.id)).toBeDefined());
    expect((await notes.get(note.id))!.trashedAt).not.toBeNull();
  });

  it('still purges a blank note that was never trashed', async () => {
    // The reclaim path must survive: navigating away from an untouched blank
    // note still discards it.
    const note = await notes.create('');

    const { unmount } = renderWithI18n(<NoteEditor note={note} />);
    unmount();

    await waitFor(async () => expect(await notes.get(note.id)).toBeUndefined());
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

  // `AppShell`'s own tests prove `handleActivateTag` obeys the three
  // activation rulings; `RichEditor`'s own tests prove it threads whatever
  // callback it is given into the tag-pill plugin. Neither proves this
  // component's own middle hop: that the `onActivateTag` prop `NoteEditor`
  // receives is the SAME one it hands to `RichEditor`, rather than, say, a
  // wrapper, `undefined`, or (as a refactor could do by accident) simply
  // dropped. `vi.spyOn` on the `RichEditor` binding — the same technique this
  // file already uses for `normalizeMarkdown` — calls through to the real
  // component (so the editor still mounts normally) while recording the
  // props it was actually invoked with.
  it('passes its onActivateTag prop through to RichEditor unchanged', async () => {
    const onActivateTag = vi.fn(() => true);
    const note = await notes.create('hello');
    const richEditorSpy = vi.spyOn(editor, 'RichEditor');

    renderWithI18n(<NoteEditor note={note} onActivateTag={onActivateTag} />);
    await screen.findByRole('textbox');

    const lastCall = richEditorSpy.mock.calls.at(-1);
    expect(lastCall?.[0].onActivateTag).toBe(onActivateTag);
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

describe('seeded notes', () => {
  it('purges a seeded note left untouched', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    const note = await notes.create('\n#work');

    const { unmount } = renderWithI18n(<NoteEditor note={note} seedText={'\n#work'} />);
    await screen.findByRole('textbox');

    unmount();

    await waitFor(() => expect(purge).toHaveBeenCalledWith(note.id));
  });

  it('keeps a seeded note the user typed into', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    const save = vi.spyOn(notes, 'save');
    const note = await notes.create('\n#work');

    const { unmount } = renderWithI18n(<NoteEditor note={note} seedText={'\n#work'} />);
    const editorEl = await screen.findByRole('textbox');

    await userEvent.click(editorEl);
    await userEvent.type(editorEl, 'a plan');

    unmount();

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(purge).not.toHaveBeenCalled();
  });

  it('never purges a note whose text merely equals some other note seed', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    const note = await notes.create('\n#work');

    // No seedText: this is an existing note that happens to hold that text.
    const { unmount } = renderWithI18n(<NoteEditor note={note} />);
    await screen.findByRole('textbox');

    unmount();

    await waitFor(() => expect(purge).not.toHaveBeenCalled());
  });

  // The test above is guarded twice over and neither guard is exercised by
  // it: `isEmpty` is false because `normalizedSeedText` is `undefined` (no
  // `seedText` prop here), AND `hadTextAtMountRef` is `true` with `editedRef`
  // `false`, so `discard` early-returns regardless of what `isEmpty` says.
  // It would stay green even under the rejected design — `isEmpty: (text) =>
  // text === '' || containsOnlyTags(text)` — because that test never edits,
  // so `editedRef` never flips and `discard`'s early return fires first. This
  // test closes that gap: it types and deletes, so `editedRef` is `true` and
  // `discard` actually falls through to comparing `isEmpty`'s verdict. Only
  // this path exercises the real risk the rejected design carried: a user
  // opens an existing tags-only note, edits it, deletes back to tags-only,
  // and closes it — under the rejected design that purges a note the user
  // deliberately kept.
  it('never purges an unseeded tags-only note the user edited', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    const note = await notes.create('#work');

    // No seedText: an existing note the user deliberately filled with only tags.
    const { unmount } = renderWithI18n(<NoteEditor note={note} />);
    const el = await screen.findByRole('textbox');

    await userEvent.click(el);
    await userEvent.type(el, 'x{Backspace}');

    unmount();

    await waitFor(() => expect(purge).not.toHaveBeenCalled());
  });

  // The intended, correct counterpart: a SEEDED note the user typed into and
  // then deleted back down to exactly the seed IS purged at unmount.
  // Everything user-authored is gone and only the app-generated tag line
  // remains, so there is nothing left worth keeping. This is the behaviour
  // most likely to surprise a future reader; pinning it here makes it read as
  // intended rather than as an accident.
  it('purges a seeded note the user typed into and then deleted back to the seed', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    const note = await notes.create('\n#work');

    const handleRef = createRef<RichEditorHandle>();
    const { unmount } = renderWithI18n(
      <NoteEditor note={note} seedText={'\n#work'} handleRef={handleRef} />,
    );
    const el = await screen.findByRole('textbox');
    // Typed through the DOM, reverted through UNDO — deliberately not through
    // a Backspace, and this is the fix for a real CI failure on 2026-08-26.
    //
    // The test used to click, type `x`, then send `{Backspace}`, resting on
    // "ProseMirror always leaves the caret directly after the character it
    // just inserted". That is not true in jsdom: CI failed with
    // `expected 'x#wor' to be '#work'` — the `x` had landed at position 0
    // while the caret sat at the end, so the backspace deleted the `k`. jsdom
    // has no layout, `document.elementFromPoint` is stubbed to null and every
    // Range rect is zero, so `posAtCoords` resolves nothing and a click places
    // the caret nowhere in particular.
    //
    // **This fix is argued structurally, not demonstrated by reproduction, and
    // that limit is worth stating.** The failure did not reproduce locally: 5
    // scoped runs, 3 full-suite runs (one at load 24), and two deliberate
    // attempts to force it by planting the caret at a hostile position — all
    // green, with the OLD backspace code too. So "the new version fixes it"
    // rests on the mechanism rather than on a red-to-green transition: the
    // revert no longer READS the caret. Undo reverses the last transaction
    // wherever it happened, so the class of failure CI hit cannot arise here,
    // whether or not that class is reachable on this machine.
    //
    // Undo is also a real user gesture rather than a test-only escape hatch,
    // so the path under test — edited, then returned to the seed, so `discard`
    // purges — is still driven the way a user drives it. The `not.toBe` wait
    // above keeps it honest: if the insert never landed, undo would have
    // nothing to reverse and this test would pass vacuously.
    await userEvent.click(el);
    await userEvent.type(el, 'x');
    await waitFor(() => expect(el.textContent).not.toBe('#work'));

    act(() => {
      handleRef.current?.editor?.commands.undo();
    });
    // Fails HERE, naming the text it found, rather than surfacing five seconds
    // later as an unexplained timeout on an assertion about `purge`.
    await waitFor(() => expect(el.textContent).toBe('#work'));

    unmount();

    // The ceiling is raised past testing-library's 1000ms default because
    // this path measured a real failure at ~1077ms on a loaded runner.
    //
    // 5000ms is ALSO Vitest's default `testTimeout`, so a per-assertion
    // ceiling of exactly 5000 can never fire — the test is killed first and
    // the failure reads `Test timed out in 5000ms`, naming no assertion at
    // all. That is why this `it` carries its own 15000ms timeout below: the
    // ceiling is now reachable, so an overrun fails as "purge was not
    // called", which is the sentence a reader needs.
    await waitFor(() => expect(purge).toHaveBeenCalledWith(note.id), { timeout: 5000 });
  }, 15000);

  it('still purges a genuinely blank new note', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    const note = await notes.create('');

    const { unmount } = renderWithI18n(<NoteEditor note={note} />);
    await screen.findByRole('textbox');

    unmount();

    await waitFor(() => expect(purge).toHaveBeenCalledWith(note.id));
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

describe('fold persistence', () => {
  it('applies the stored fold set when the note opens', async () => {
    const note = await notes.create('Title\n\n## A\n\nbody');
    await folds.set(note.id, ['2:0:A']);

    renderEditor(note);

    await waitFor(() => {
      expect(screen.getByText('body')).not.toBeVisible();
    });
  });

  it('writes the new fold set when a section is folded', async () => {
    const note = await notes.create('Title\n\n## A\n\nbody');
    const set = vi.spyOn(folds, 'set');

    const { handle } = renderEditor(note);
    await waitFor(() => expect(handle.current?.editor).not.toBeNull());
    const [section] = headingSections(handle.current!.editor!.state.doc);
    handle.current!.editor!.commands.toggleHeadingFold(section!.pos);

    // Asserted directly against plugin state too, the same pattern
    // `headingFold.test.ts` uses: it needs no stylesheet and no jsdom
    // visibility semantics, unlike the CSS-based assertion above.
    expect(foldedKeys(handle.current!.editor!.state)).toEqual(['2:0:A']);

    await waitFor(() => {
      expect(set).toHaveBeenCalledWith(note.id, ['2:0:A']);
    });
  });

  it('opening a note produces no fold write', async () => {
    const note = await notes.create('Title\n\n## A\n\nbody');
    await folds.set(note.id, ['2:0:A']);
    const set = vi.spyOn(folds, 'set');

    renderEditor(note);

    // Proves the restore actually happened — not merely that render
    // finished — before the "no write" assertion below is allowed to mean
    // anything.
    await waitFor(() => {
      expect(screen.getByText('body')).not.toBeVisible();
    });

    // The persist effect debounces at 300ms (`FOLD_PERSIST_DELAY_MS` in
    // `NoteEditor.tsx`). A window shorter than that cannot distinguish "no
    // write happened" from "the write just hasn't fired yet" — this test
    // used to assert synchronously right after the heading text appeared,
    // which passed even when a restore-triggered write was scheduled a
    // moment later. Waiting past the debounce is what makes this a real
    // guard rather than a race the assertion always wins.
    await new Promise((resolve) => setTimeout(resolve, 400));

    // Mirrors the standing rule that opening a note produces no write. A
    // persistence layer that rewrites on mount churns a row on every note
    // switch, and this app switches notes constantly.
    expect(set).not.toHaveBeenCalled();
  }, 10000);

  // The entire justification for a separate `noteFolds` table, rather than a
  // field on the note record, is that folding must not move `updatedAt` and
  // reorder the note list. That is true today only because Tiptap gates its
  // `onUpdate` callback on `tr.docChanged` and a fold transaction carries no
  // steps (only meta) — an upstream detail nothing in THIS codebase asserts.
  // This pins it: toggling a fold, waited well past the autosave debounce,
  // must never call `notes.save`.
  it('folding a section never calls notes.save — folding must not touch the note', async () => {
    const note = await notes.create('Title\n\n## A\n\nbody');
    const save = vi.spyOn(notes, 'save');

    const { handle } = renderEditor(note);
    await waitFor(() => expect(handle.current?.editor).not.toBeNull());
    const [section] = headingSections(handle.current!.editor!.state.doc);
    handle.current!.editor!.commands.toggleHeadingFold(section!.pos);

    expect(foldedKeys(handle.current!.editor!.state)).toEqual(['2:0:A']);

    // Real timers, well past AUTOSAVE_DELAY_MS (300ms) — long enough for an
    // autosave that SHOULD NOT have been scheduled to have fired if it had
    // been.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(save).not.toHaveBeenCalled();
  }, 10000);

  it('flushes a pending fold to storage when the note is closed', async () => {
    const note = await notes.create('Title\n\n## A\n\nbody');
    const set = vi.spyOn(folds, 'set');

    const { handle, unmount } = renderEditor(note);
    await waitFor(() => expect(handle.current?.editor).not.toBeNull());
    const [section] = headingSections(handle.current!.editor!.state.doc);
    handle.current!.editor!.commands.toggleHeadingFold(section!.pos);

    // Unmounted well before the 300ms debounce could have fired on its own —
    // `NoteEditor` remounts on every note switch, so a fold made moments
    // before switching notes must reach storage anyway, the same way
    // `useAutosave` flushes unsaved text on unmount rather than dropping it.
    unmount();

    await waitFor(() => {
      expect(set).toHaveBeenCalledWith(note.id, ['2:0:A']);
    });
  });
});

/** Reads the global flag directly, so a test can assert its VALUE rather
 * than infer it from a side effect (the error message alone would prove the
 * `catch` ran, not that the `finally` ever cleared the flag). */
function ProgressProbe(): ReactElement {
  const { pending } = useExportProgress();
  return <div data-testid="progress-probe" data-pending={pending ? 'true' : 'false'} />;
}

describe('PDF export progress', () => {
  /**
   * The load-bearing test: a PDF export that fails must still clear the
   * global pending flag. `NoteEditor.handleExport` pairs `beginExportProgress()`
   * with `endExportProgress()` through `try`/`finally` for exactly this — if
   * that `finally` were a plain statement after the `await` (or removed
   * outright), a rejection would skip it and this assertion would see
   * `pending` stuck `true` forever, which is the "worse than no loader"
   * failure mode this task exists to prevent.
   */
  it('clears the pending flag after a rejected PDF export, via the finally', async () => {
    const note = await notes.create('hello');
    vi.mocked(exportNote).mockRejectedValueOnce(new PdfExportError('offline'));
    // Spied BEFORE render: `vi.spyOn` does not retroactively record calls
    // that already happened, so this has to be in place while `NoteEditor`
    // first renders `RichEditor` — the same ordering
    // "passes its onActivateTag prop through to RichEditor unchanged" uses.
    const richEditorSpy = vi.spyOn(editor, 'RichEditor');

    render(
      <I18nProvider>
        <ExportProgressProvider>
          <ProgressProbe />
          <NoteEditor note={note} />
        </ExportProgressProvider>
      </I18nProvider>,
    );
    await screen.findByRole('textbox');
    // Captures the real `onExport` prop `NoteEditor` hands to `RichEditor`
    // and calls it directly, rather than driving `ExportMenu`'s UI (which
    // needs a signed-in session this test has no reason to fake).
    const onExport = richEditorSpy.mock.calls.at(-1)?.[0].onExport;
    expect(onExport).toBeDefined();

    expect(screen.getByTestId('progress-probe')).toHaveAttribute('data-pending', 'false');

    act(() => {
      onExport!('pdf');
    });

    // `beginExportProgress()` runs synchronously — before `exportNote`'s
    // returned promise has any chance to settle — so the flag is already up
    // by the time this synchronous `act` returns.
    expect(screen.getByTestId('progress-probe')).toHaveAttribute('data-pending', 'true');

    await waitFor(() => {
      expect(screen.getByTestId('progress-probe')).toHaveAttribute('data-pending', 'false');
    });

    // The failure is also visible to the user, through the existing
    // `role="status"` banner — proving the `catch` ran, distinct from
    // proving the `finally` cleared the flag above.
    expect(screen.getByRole('status')).toHaveTextContent(/connection/i);
  });

  it('sets and clears the pending flag around a successful PDF export too', async () => {
    const note = await notes.create('hello');
    let resolveExport: (() => void) | undefined;
    vi.mocked(exportNote).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveExport = () => resolve();
        }),
    );
    const richEditorSpy = vi.spyOn(editor, 'RichEditor');

    render(
      <I18nProvider>
        <ExportProgressProvider>
          <ProgressProbe />
          <NoteEditor note={note} />
        </ExportProgressProvider>
      </I18nProvider>,
    );
    await screen.findByRole('textbox');
    const onExport = richEditorSpy.mock.calls.at(-1)?.[0].onExport;

    act(() => {
      onExport!('pdf');
    });
    expect(screen.getByTestId('progress-probe')).toHaveAttribute('data-pending', 'true');

    await act(async () => {
      resolveExport?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByTestId('progress-probe')).toHaveAttribute('data-pending', 'false');
    });
  });
});
