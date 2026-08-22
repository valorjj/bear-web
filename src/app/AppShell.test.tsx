import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { I18nProvider } from '@/i18n';
import { en } from '@/i18n/en';
import type { NoteEditorProps } from '@/features/notes';

import { AppShell } from './AppShell';

// Lets one test simulate `useTagTree`'s pre-resolution `undefined` without
// timing games against the real `dexie-react-hooks` subscription. `vi.mock`
// factories are hoisted above the rest of the module, so the flag they close
// over must be created through `vi.hoisted` rather than a plain module-level
// `let` — referencing the latter would throw at import time.
const tagTreeOverride = vi.hoisted(() => ({ forceLoading: false }));

// Captures the exact `onActivateTag` prop `AppShell` passes down to
// `NoteEditor`, so a test can call it directly. Also created via
// `vi.hoisted` for the same hoisting reason as above.
const capturedActivateTag = vi.hoisted(() => ({
  current: undefined as ((tag: string) => boolean) | undefined,
}));

// Every `scope` value `AppShell` has ever rendered with, in order. A guard
// that sets a scope and lets the vanished-tag effect revert it a moment
// later is NOT the same as a guard that never sets it — but by the time a
// test can look at the DOM again, both converge on an identical final state,
// because `act` flushes the setting render, the reverting effect, and the
// reverted render all within one synchronous batch (there is no real
// browser frame in between for a transient scope to be observed in). Scope
// itself is exactly what `useNotes` is called with on every render of
// `AppShell`, so recording its argument there — a call that happens
// synchronously during render, before any effect can revert anything —
// is what makes a transient, later-reverted scope change visible to a test
// at all.
const scopeHistory = vi.hoisted(() => [] as Array<import('@/features/notes').NoteScope>);

// `handleActivateTag` lives deep inside `AppShell`, past `NoteEditor` and
// `RichEditor`, and the real gesture it answers to (a Mod-click on a tag
// pill) is driven, everywhere else in this project, by faking
// `EditorView.posAtCoords` — jsdom has no layout engine, so the real method
// never resolves a screen coordinate to a document position (see
// `RichEditor.test.tsx`'s `activateFirstTag` and `tagPill.test.ts`'s
// `mousedownAt`). Reaching the mounted `EditorView` instance from here, three
// components down and with no ref threaded through any of them, would need
// new production plumbing whose only customer is a test.
//
// A first attempt rendered a real, clickable escape-hatch button inside a
// wrapped `NoteEditor` instead — but any extra `<input>` there collides with
// `getByRole('textbox')` (the real editor's own role) used everywhere else in
// this file, including by fixtures this test does not own. So this wrapper
// renders nothing extra; it only captures the exact `onActivateTag` prop
// `AppShell` passes down, via a ref-like module value, so a test can invoke
// it directly — the brief's named fallback. Every other test in this file
// still exercises the real, unwrapped `NoteEditor`.
vi.mock('@/features/notes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/notes')>();

  function TestNoteEditor(props: NoteEditorProps) {
    useEffect(() => {
      capturedActivateTag.current = props.onActivateTag;
      return () => {
        capturedActivateTag.current = undefined;
      };
    }, [props.onActivateTag]);
    return <actual.NoteEditor {...props} />;
  }

  return {
    ...actual,
    NoteEditor: TestNoteEditor,
    // Records the scope argument on every render — see `scopeHistory` above
    // for why this, and not a DOM assertion, is what can catch a scope that
    // was set and then reverted within a single synchronous test flush.
    // `...rest`, not just `scope`: this wrapper swallowed every later argument
    // until A added the ScopeQuery, at which point the sort silently never
    // reached `listForScope` and the list simply never re-ordered under test.
    // Forward everything; record only what this spy exists to record.
    useNotes: (
      scope: import('@/features/notes').NoteScope,
      ...rest: [import('@/features/notes').ScopeQuery?]
    ) => {
      scopeHistory.push(scope);
      return actual.useNotes(scope, ...rest);
    },
  };
});

// Real `useTagTree`, real subscriptions, real `reveal`/`toggle` — only
// `nodes` is forced to `undefined` when `tagTreeOverride.forceLoading` is set,
// to simulate the live query's pre-resolution state on demand.
vi.mock('@/features/tags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tags')>();
  return {
    ...actual,
    useTagTree: () => {
      const real = actual.useTagTree();
      return tagTreeOverride.forceLoading ? { ...real, nodes: undefined } : real;
    },
  };
});

/**
 * Invokes the exact `onActivateTag` prop `AppShell` supplied to the currently
 * mounted `NoteEditor`, captured by the mock above, and returns its answer.
 * Requires a note to already be selected — the prop only exists while
 * `NoteEditor` is mounted.
 *
 * The returned boolean is not incidental: it is what the tag-pill plugin gates
 * `event.preventDefault()` on, so it decides whether a declined Mod-click
 * still places the caret like a plain click. An assertion on the DOM alone
 * cannot see it — "declined and returned false" and "declined and returned
 * true" render identically here and differ only in the browser.
 */
async function activateTag(tag: string): Promise<boolean> {
  const activate = capturedActivateTag.current;
  if (activate === undefined) throw new Error('activateTag: no NoteEditor is mounted');
  let answer: boolean | undefined;
  await act(async () => {
    answer = activate(tag);
  });
  return answer!;
}

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
  tagTreeOverride.forceLoading = false;
  scopeHistory.length = 0;
});

function renderShell() {
  return render(
    <I18nProvider locale="en">
      <AppShell />
    </I18nProvider>,
  );
}

// Creates a note via "New note" and types `text` into its editor, leaving it
// selected. Used by the destructive-action tests below, which need a real
// title in the trash list rather than "Untitled".
async function createNoteWithText(text: string) {
  await userEvent.click(screen.getByRole('button', { name: 'New note' }));
  const editor = await screen.findByRole('textbox');
  await userEvent.click(editor);
  await userEvent.type(editor, text);
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

    // These rows now carry a live count alongside the label ("Notes 0"), so
    // the accessible name is matched by prefix rather than exact string —
    // the count itself is not what this test is about.
    expect(
      screen.getByRole('button', { name: new RegExp(`^${en['smartList.all']}\\b`) }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(`^${en['smartList.trash']}\\b`) }),
    ).toBeInTheDocument();
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
  // `settings` too, from A onward: the note-list sort and preview density are
  // durable preferences, so a test that changes one would otherwise leak it
  // into every test that runs after it.
  await Promise.all([db.notes.clear(), db.noteTags.clear(), db.files.clear(), db.settings.clear()]);
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

    await user.click(screen.getByRole('button', { name: /^Trash\b/ }));
    await user.click(await screen.findByRole('button', { name: /Groceries/ }));
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    await user.click(screen.getByRole('button', { name: /^Notes\b/ }));
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

    await user.click(screen.getByRole('button', { name: /^Trash\b/ }));
    await user.click(screen.getByRole('button', { name: 'New note' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Notes\b/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
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

  it('shows a Phase 2 explanation in Locked, not "no notes"', async () => {
    await renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^Locked\b/ }));

    // A user who sees "No notes" here concludes their locked notes were lost.
    expect(await screen.findByText('Locked notes are not available yet')).toBeInTheDocument();
    expect(screen.queryByText('No notes')).not.toBeInTheDocument();
  });

  it('bounces to Notes when creating inside a list that could not show the note', async () => {
    await renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^Pinned\b/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New note' }));

    // A note created in Pinned is not pinned, so it would vanish instantly.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Notes\b/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('stays put when creating inside a list that can show the note', async () => {
    await renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^Untagged\b/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New note' }));

    // A new note genuinely has no tags, so Untagged can hold it.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Untagged\b/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
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
      expect(screen.getByRole('button', { name: /^Notes\b/ })).toHaveAttribute(
        'aria-current',
        'page',
      ),
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
    expect(screen.getByRole('button', { name: /^Notes\b/ })).not.toHaveAttribute('aria-current');
    await screen.findByRole('button', { name: /^alpha\b/ });
    expect(screen.getByRole('button', { name: /^Notes\b/ })).not.toHaveAttribute('aria-current');
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
    // (`SmartListSidebar`/`TagSidebar` rows use `aria-current="page"`), which
    // identifies it without depending on its title text.
    //
    // `findByRole`, not `getByRole`: the row arrives ASYNCHRONOUSLY and this
    // query previously had a ceiling of zero. The editor's textbox above
    // mounts as soon as `AppShell` sets the selected id, but the LIST row
    // carrying `aria-current` needs the notes `useLiveQuery` to re-emit — a
    // separate Dexie round trip — and D2's Task 5 put a `syncState` get+put
    // inside `notes.create` (and `save`/`purge`), lengthening exactly this
    // path. The result was a flake that failed FAST, in ~363ms, with
    // `Unable to find an accessible element with the role "button"` and no
    // name qualifier, which is what a `{ current: true }` query prints.
    // Measured at ~7ms unloaded; running the same zero-budget query one tick
    // earlier reproduces that exact error 6 times in 6, and awaiting it at
    // the same point passes — a timing ceiling, not a row that never
    // arrives. Vitest has no retries in CI, so one such flake turns `main`
    // red; see ca40a16 and `NoteEditor.test.tsx`'s seeded-purge ceiling for
    // the same fix.
    const createdRow = await screen.findByRole('button', { current: true }, { timeout: 5000 });

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

describe('activating a tag from the editor', () => {
  it('filters the note list by a tag the sidebar knows', async () => {
    await notes.create('alpha #work');
    await notes.create('beta');

    renderShell();

    // Select a note so `NoteEditor` (and the `onActivateTag` prop) mounts.
    await userEvent.click(await screen.findByRole('button', { name: /^alpha\b/ }));
    // Wait for the sidebar to know about the tag, so the guard this test is
    // NOT about (the loading guard) cannot be what makes it pass.
    await screen.findByRole('button', { name: /^work\b/ });

    // `true` is the app reporting it acted, which is what licenses the plugin
    // to consume the event and keep the caret out of the tag.
    expect(await activateTag('work')).toBe(true);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^alpha\b/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^beta\b/ })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^work\b/ })).toHaveAttribute('aria-current', 'page');
  });

  it('reveals a collapsed ancestor so the activated row is actually rendered', async () => {
    await notes.create('alpha #work/urgent');
    await notes.create('beta');

    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^alpha\b/ }));
    // The nested tag's row only exists once its ancestor is expanded — expand
    // once to find it, then collapse the ancestor again so this test starts
    // from the state `reveal` exists to fix.
    await screen.findByRole('button', { name: /^work\b/ });
    await userEvent.click(screen.getByRole('button', { name: en['tags.toggle'] }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^urgent\b/ })).not.toBeInTheDocument(),
    );

    expect(await activateTag('work/urgent')).toBe(true);

    // The nested row must now be rendered AND current — `reveal` opening the
    // collapsed ancestor is what makes the second half possible at all.
    //
    // The ceiling is raised past testing-library's 1000ms default because this
    // is the longest async chain in the file: `reveal` sets state, the tag tree
    // re-queries through Dexie, and only then does the row mount. It failed
    // once on a loaded CI runner and never locally; lowering the ceiling to
    // 40ms reproduces that exact error here, which is what identifies it as a
    // timing ceiling rather than a row that never arrives — `activateTag`
    // returning true above has already proved the mechanism ran. Vitest has no
    // retries in CI, so one such flake turns main red.
    const nested = await screen.findByRole('button', { name: /^urgent\b/ }, { timeout: 5000 });
    expect(nested).toHaveAttribute('aria-current', 'page');
  });

  it('does nothing for a tag that is not in the index', async () => {
    await notes.create('alpha #work');
    await notes.create('beta');

    renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^alpha\b/ }));
    // Wait for the tree to resolve — a real tag must be visible before this
    // test can mean anything about an UNKNOWN one.
    await screen.findByRole('button', { name: /^work\b/ });
    scopeHistory.length = 0;

    // A lying pill: painted by the plugin, absent from `parseTags`' index —
    // see the two documented classes in CLAUDE.md. Setting a scope for it
    // would trip the vanished-tag effect and bounce back to All Notes; that
    // bounce happens within the same synchronous test flush as the setting
    // render, so by the time the DOM can be inspected again a "set, then
    // reverted" scope and a "never set" scope render identically — see
    // `scopeHistory` above for why this asserts against the full render
    // history instead.
    // Reporting the refusal is the whole point: the plugin gates
    // `preventDefault()` on this, so `false` is what turns a Mod-click on a
    // lying pill into an ordinary caret-placing click instead of a gesture
    // that does nothing at all. `undefined` here — a handler that forgets to
    // return — reads as declined too, but only by accident, so the assertion
    // is on `false` exactly.
    expect(await activateTag('ghost')).toBe(false);

    expect(scopeHistory).not.toContainEqual({ kind: 'tag', tag: 'ghost' });
    expect(screen.getByRole('button', { name: /^alpha\b/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^beta\b/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: new RegExp(`^${en['smartList.all']}\\b`) }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('does nothing while the tag tree is still loading', async () => {
    await notes.create('alpha #work');

    const { rerender } = renderShell();
    await userEvent.click(await screen.findByRole('button', { name: /^alpha\b/ }));
    // Establish the tree has genuinely resolved once, with the real tag
    // visible, before forcing the loading state — otherwise this test could
    // pass merely because the tag was never in the index to begin with (the
    // previous test's failure mode).
    await screen.findByRole('button', { name: /^work\b/ });

    tagTreeOverride.forceLoading = true;
    // Force `AppShell` to re-render with the override applied: the mocked
    // `useTagTree` re-runs on this render and now reports `nodes: undefined`,
    // which is what recomputes `handleActivateTag`'s closure before the
    // capture below reads it.
    rerender(
      <I18nProvider locale="en">
        <AppShell />
      </I18nProvider>,
    );
    scopeHistory.length = 0;

    // A prior version of this test only asserted the final rendered state,
    // which passes for two different reasons that must not be conflated:
    // deleting the `tree.nodes === undefined` guard entirely makes
    // `hasTag(tree.nodes, tag)` THROW (a `TypeError` on `undefined.some`),
    // which also leaves "All Notes" current — but only because the whole
    // handler crashed, not because it behaved. Capture and assert on the
    // thrown value explicitly, separately from the scope-history assertion
    // below, so a crash cannot masquerade as "did nothing".
    let thrown: unknown;
    let answer: boolean | undefined;
    try {
      answer = await activateTag('work');
    } catch (error) {
      thrown = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(thrown).toBeUndefined();
    // Declined, and it said so — so the user still gets the caret a plain
    // click would have given rather than a swallowed gesture.
    expect(answer).toBe(false);
    // `undefined` must be treated as "not loaded", never as "no tags" — the
    // same mistake the vanished-tag effect already guards against. Checked
    // against the full render history (see `scopeHistory` above), not just
    // the final DOM state, for the same reason the unknown-tag test above
    // does: a scope that was set and then reverted can render identically to
    // one that was never set.
    expect(scopeHistory).not.toContainEqual({ kind: 'tag', tag: 'work' });
    expect(
      screen.getByRole('button', { name: new RegExp(`^${en['smartList.all']}\\b`) }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

describe('trash management', () => {
  it('purges a single note only after confirmation', async () => {
    await renderShell();
    await createNoteWithText('doomed');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));
    // Anchored on the list row's accessible name, not `getByText`: the
    // just-created note's own editor also renders "doomed" as its
    // contenteditable content, so a bare text query matches both and throws
    // for being ambiguous. Same convention as the tag-scope tests above.
    await userEvent.click(await screen.findByRole('button', { name: /^doomed/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));

    // Still there — the dialog is open and nothing has happened yet.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^doomed/ })).toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete forever' }),
    );

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^doomed/ })).not.toBeInTheDocument(),
    );
  });

  it('leaves the note alone when the confirmation is cancelled', async () => {
    await renderShell();
    await createNoteWithText('spared');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));
    // See the identical comment above: anchored on the row, not `getByText`.
    await userEvent.click(await screen.findByRole('button', { name: /^spared/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^spared/ })).toBeInTheDocument();
  });

  it('does not purge twice when confirm is clicked twice rapidly', async () => {
    await renderShell();
    await createNoteWithText('doubled');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^doubled/ }));

    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    const confirmButton = within(await screen.findByRole('alertdialog')).getByRole('button', {
      name: 'Delete forever',
    });

    const purgeSpy = vi.spyOn(notes, 'purge');

    // `fireEvent`, not `userEvent`: both clicks must land synchronously,
    // before `confirmPending`'s first `await notes.purge(...)` resolves —
    // the same double-fire race the "New note" guard above exists for.
    // `confirmPending` clears `pending` BEFORE awaiting specifically so this
    // second click sees a closed dialog and does nothing; clearing it AFTER
    // awaiting would let this click read the same stale `pending` and start
    // a second purge of the same note.
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(purgeSpy).toHaveBeenCalledTimes(1));
  });

  it('disables Empty trash when the trash is empty', async () => {
    await renderShell();

    await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));

    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled();
  });

  it('empties the trash after confirmation', async () => {
    await renderShell();
    await createNoteWithText('one');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Trash/ }));

    const emptyTrash = await screen.findByRole('button', { name: 'Empty trash' });
    await waitFor(() => expect(emptyTrash).toBeEnabled());
    await userEvent.click(emptyTrash);

    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Empty trash' }),
    );

    await waitFor(() => expect(screen.queryByText('one')).not.toBeInTheDocument());
  });

  it('offers neither destructive trash action outside the trash', async () => {
    await renderShell();
    await createNoteWithText('safe');

    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Empty trash' })).not.toBeInTheDocument();
  });
});

describe('search', () => {
  it('narrows the note list to matching notes', async () => {
    renderShell();
    await createNoteWithText('Groceries\nmilk and bread');
    await createNoteWithText('Sprint\nplanning');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'milk');

    expect(await screen.findByRole('button', { name: /Groceries/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sprint/ })).toBeNull();
    });
  });

  // The positive assertion is the point. An "is not visible" test alone passes
  // for a build where creation is broken outright — the vacuous shape M6
  // shipped once and had to move.
  it('clears the query when a note is created, so the new note is visible', async () => {
    renderShell();
    await createNoteWithText('Groceries\nmilk and bread');

    const field = screen.getByRole('searchbox', { name: 'Search notes' });
    await userEvent.type(field, 'milk');
    await waitFor(() => expect(field).toHaveValue('milk'));

    await userEvent.click(screen.getByRole('button', { name: 'New note' }));

    await waitFor(() => expect(field).toHaveValue(''));
    expect(await screen.findByRole('button', { name: /Untitled/ })).toBeInTheDocument();
  });

  it('keeps the query when the scope changes', async () => {
    renderShell();
    await createNoteWithText('Groceries\nmilk and bread');

    const field = screen.getByRole('searchbox', { name: 'Search notes' });
    await userEvent.type(field, 'milk');
    await waitFor(() => expect(field).toHaveValue('milk'));

    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Lists' })).getByRole('button', {
        name: /^Trash\b/,
      }),
    );

    expect(field).toHaveValue('milk');
  });

  // Same rule as the tag filter: a note the user is editing must not be pulled
  // out from under them because their query stopped matching it.
  it('keeps the open note open when the query stops matching it', async () => {
    renderShell();
    await createNoteWithText('Groceries\nmilk and bread');

    await userEvent.click(await screen.findByRole('button', { name: /Groceries/ }));
    expect(await screen.findByRole('textbox', { name: 'Note text' })).toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'zzzzz');

    await waitFor(() => {
      expect(screen.getByText('No matching notes')).toBeInTheDocument();
    });
    // Not just present — still showing THIS note's content, proving the
    // editor was never remounted or handed a different (or blank) note.
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveTextContent('Groceries');
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveTextContent('milk and bread');
  });

  // Same rule as the previous test, from the other direction: a search whose
  // query matches nothing in the trash must not disable "Empty trash" — the
  // button acts on every trashed note regardless of the query, and the
  // dialog copy says so. Closes a defect where `emptyTrashDisabled` was
  // computed from the query-narrowed list instead of the unfiltered one.
  it('keeps Empty trash enabled when a query matches nothing in a non-empty trash', async () => {
    renderShell();
    await createNoteWithText('Groceries\nmilk and bread');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Trash\b/ }));

    const emptyTrash = await screen.findByRole('button', { name: 'Empty trash' });
    await waitFor(() => expect(emptyTrash).toBeEnabled());

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notes' }), 'zzzzz');

    await waitFor(() => {
      expect(screen.getByText('No matching notes')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeEnabled();
  });

  // Finding 3: Cmd/Ctrl+F must not steal focus into the search field while a
  // destructive confirmation is pending — `ConfirmDialog` traps focus, and
  // moving focus out from under it would leave Tab free to walk the page
  // behind the still-open modal.
  it('does not focus search when Cmd/Ctrl+F is pressed while a confirmation is pending', async () => {
    renderShell();
    await createNoteWithText('doomed');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Trash\b/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^doomed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    await screen.findByRole('alertdialog');

    await userEvent.keyboard('{Control>}f{/Control}');

    expect(screen.getByRole('searchbox', { name: 'Search notes' })).not.toHaveFocus();
  });
});

describe('StrictMode', () => {
  it('creates a note that survives the remount cycle', async () => {
    // React mounts, cleans up and remounts every component under StrictMode in
    // development. `NoteEditor`'s unmount cleanup purges a blank note, and
    // `useNotes` already routes every selection change through a transient
    // `undefined` that unmounts the editor — so under StrictMode a just-created
    // note was purged milliseconds after `notes.create` returned it, and NO
    // note could be created at all in `npm run dev`.
    //
    // Nothing in the suite could see it: every other test here renders without
    // StrictMode, and `npm run test:e2e` runs the production build, where the
    // extra cycle does not happen.
    render(
      <StrictMode>
        <I18nProvider locale="en">
          <AppShell />
        </I18nProvider>
      </StrictMode>,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'New note' }));

    await waitFor(async () => expect(await db.notes.count()).toBe(1));

    // Let any deferred discard fire before declaring victory.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await db.notes.count()).toBe(1);
  });
});

describe('AppShell list preferences', () => {
  it('re-orders the list when a sort is chosen, and keeps it across a remount', async () => {
    const user = userEvent.setup();
    // The timestamps are pinned, not left to the clock. `notes.create` stamps
    // `Date.now()`, so two creations in the same millisecond tie on
    // `updatedAt` and `compareNotes` falls back to its `id` tiebreaker — which
    // is a random id, making the DEFAULT order nondeterministic and this test
    // flaky in a way that has nothing to do with what it tests.
    //
    // Banana newer, so the default newest-first order is Banana, Apple — the
    // reverse of the title-ascending order this test chooses. If the two
    // orders coincided the test could not fail.
    const apple = await notes.create('Apple');
    const banana = await notes.create('Banana');
    await db.notes.update(apple.id, { updatedAt: 1000 });
    await db.notes.update(banana.id, { updatedAt: 2000 });

    const first = renderShell();
    await screen.findByRole('button', { name: /Apple/ });

    const noteRows = (): string[] =>
      within(screen.getByRole('region', { name: 'Note list' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent ?? '');

    // The default order, so the assertions below are known to be a change.
    await waitFor(() => expect(noteRows()[0]).toContain('Banana'));

    await user.click(screen.getByRole('button', { name: /^List options/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Title' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Newest first' }));

    // Apple before Banana, i.e. ascending by title.
    //
    // A longer budget than the 1s default, deliberately: settling takes TWO
    // chained IndexedDB round trips — the `settings` live query delivers the
    // new order, which re-keys the notes live query, which then re-queries.
    // At 1s this failed roughly one run in three under full-suite contention.
    await waitFor(
      () => {
        expect(noteRows()[0]).toContain('Apple');
        expect(noteRows()[1]).toContain('Banana');
      },
      { timeout: 3000 },
    );

    first.unmount();
    renderShell();

    // The preference is durable, so the remounted shell must not fall back to
    // the default newest-first ordering.
    await waitFor(
      () => {
        expect(noteRows()[0]).toContain('Apple');
        expect(noteRows()[1]).toContain('Banana');
      },
      { timeout: 3000 },
    );
  });

  it('keeps a chosen preview density across a remount', async () => {
    const user = userEvent.setup();
    await notes.create('Groceries\nmilk and bread');

    const first = renderShell();
    expect(await screen.findByText('milk and bread')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^List options/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Small' }));

    await waitFor(() => expect(screen.queryByText('milk and bread')).toBeNull());

    first.unmount();
    renderShell();

    await screen.findByRole('button', { name: /Groceries/ });

    // `waitFor`, not a bare assertion: `useSetting` renders at the fallback for
    // the first frame rather than blocking on IndexedDB, so a freshly mounted
    // shell genuinely shows the default `large` row until the stored value
    // resolves. Asserting immediately raced that frame and failed
    // intermittently.
    await waitFor(() => expect(screen.queryByText('milk and bread')).toBeNull());
  });
});
