import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { I18nProvider } from '@/i18n';
import { en } from '@/i18n/en';

import { AppShell } from './AppShell';

// jsdom has no layout engine, so ProseMirror's caret/scroll math
// (`coordsAtPos`, `posAtCoords`) throws on APIs jsdom never implements. These
// stubs return harmless empty geometry so `userEvent.type` can drive the
// contenteditable surface without crashing. Copied from the identical header
// in `src/features/notes/NoteEditor.test.tsx`, which is the canonical model
// per CLAUDE.md's toolchain notes; only the tag-seed-reopen test below needs
// to type into the editor.
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

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('tag scopes', () => {
  it('filters the note list to the clicked tag', async () => {
    await notes.create('alpha #work');
    await notes.create('beta #home');

    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^work\b/ }));

    // `deriveTitle` does not strip hashtags, so the rendered title is the
    // whole first line ("alpha #work"), not the bare word — hence the regex
    // matchers rather than exact strings. Anchored on the list-item button's
    // accessible name (as the pre-existing tests in this file do), not on
    // `getByText`: a bare prefix match on text would silently grab the wrong
    // row once a fixture adds a second note starting with the same word.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^alpha\b/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^beta\b/ })).not.toBeInTheDocument();
    });
  });

  it('seeds a note created inside a tag scope so it appears in that scope', async () => {
    await notes.create('alpha #work');

    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: /^work\b/ }));
    await screen.findByRole('button', { name: /^alpha\b/ });

    await userEvent.click(screen.getByRole('button', { name: 'New note' }));

    await waitFor(() => {
      const stored = screen.getByRole('textbox');
      expect(stored).toHaveTextContent('#work');
    });

    // The list still shows the tag scope and now holds two notes.
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(1));
  });

  it('falls back to all notes when the selected tag stops existing', async () => {
    const note = await notes.create('alpha #work');

    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: /^work\b/ }));
    await screen.findByRole('button', { name: /^alpha\b/ });

    await notes.save(note.id, 'alpha');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notes' })).toHaveAttribute('aria-current', 'page'),
    );
  });

  it('selecting a tag does not bounce back to Notes', async () => {
    await notes.create('alpha #work');

    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: /^work\b/ }));

    // This does NOT exercise the fallback effect's `tree.nodes === undefined`
    // branch: `TagSidebar` returns `null` until the tree has resolved, so the
    // "work" button above cannot even be clicked while the tree is loading.
    // That branch is unreachable from the app today (see the comment on the
    // effect in AppShell.tsx) and this fixture cannot make it reachable. What
    // this test actually checks is the ordinary, always-reachable path: after
    // a tag is selected, the "Notes" row must not spuriously regain
    // `aria-current`.
    expect(screen.getByRole('button', { name: 'Notes' })).not.toHaveAttribute('aria-current');
    await screen.findByRole('button', { name: /^alpha\b/ });
    expect(screen.getByRole('button', { name: 'Notes' })).not.toHaveAttribute('aria-current');
  });

  // The seed is keyed by id, so re-selecting the same just-created note keeps
  // handing `NoteEditor` the same `seedText` unless something clears it. That
  // makes the note vulnerable to the guard `NoteEditorProps` says was
  // rejected: editing real content into it, switching away, switching back,
  // then editing it back down to exactly its tag would have `isEmpty`
  // mistake it for the disposable creation seed and purge it — even though
  // the user deliberately kept content in it the whole time it was open the
  // second time. Full path: create inside a tag scope, type real content,
  // select another note, reselect the created one, edit it back to just the
  // tag, then unmount.
  it('does not re-arm the seed purge when a created note is reopened', async () => {
    const purge = vi.spyOn(notes, 'purge').mockResolvedValue(undefined);
    await notes.create('keeper #work');

    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: /^work\b/ }));
    // Captured once and reused for every later click on this row: after the
    // seeded note is typed into, its title changes, so re-querying by name
    // would either miss it or (worse) risk matching a future fixture's note
    // that happens to share a word. The row's identity, not its label, is
    // what this test needs.
    const keeperRow = await screen.findByRole('button', { name: /^keeper\b/ });

    await userEvent.click(screen.getByRole('button', { name: 'New note' }));
    const created = await screen.findByRole('textbox');
    // The just-created note's row is the only one with `aria-current="true"`
    // (`ScopeSidebar`/`TagSidebar` rows use `aria-current="page"`), which
    // identifies it without depending on its title text.
    const createdRow = screen.getByRole('button', { current: true });

    // Type real content into the freshly created note. The caret lands at
    // the end of the seeded "#work" text, hence the leading space rather
    // than typing before it — typing flush against the tag would merge into
    // it and stop it parsing as a tag at all, which is not what this test is
    // about.
    await userEvent.click(created);
    await userEvent.type(created, ' urgent');

    // Switch away — this note now holds real content, so it is saved, not
    // discarded, and its editor unmounts.
    await userEvent.click(keeperRow);

    // Switch back to the created note via the captured row. If `seed` was
    // never cleared, AppShell still passes the ORIGINAL creation `seedText`
    // for this id.
    await userEvent.click(createdRow);
    const reopened = await screen.findByRole('textbox');

    // Edit the reopened note back down to exactly its tag line — content the
    // user is deliberately choosing to keep, since they just typed it.
    await userEvent.click(reopened);
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.keyboard('{Backspace}');
    await userEvent.type(reopened, '#work');

    // Switch away again to unmount the reopened editor and run the discard
    // check.
    await userEvent.click(keeperRow);

    await waitFor(() => expect(purge).not.toHaveBeenCalled());
  });
});
