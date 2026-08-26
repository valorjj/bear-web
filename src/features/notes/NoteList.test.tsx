import { cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '@/data';
import type { Session, SessionState } from '@/features/account';
import { ExportProgressProvider } from '@/features/export';
import { renderWithI18n } from '@/i18n/testing';

import { NoteList, type NoteListProps } from './NoteList';
import { ACTIVE_SCOPE, smartScope, tagScope, TRASHED_SCOPE } from './scope';

// The row menu reads the session through `useSessionValue()` (context) to
// decide whether PDF export is reachable. Mocked rather than provided, so no
// test in this file fires the real provider's boot fetch — the same technique,
// for the same reason, as `ExportMenu.test.tsx`.
let sessionState: SessionState = { status: 'signedOut' };

vi.mock('@/features/account', () => ({
  useSessionValue: (): Session => ({
    state: sessionState,
    signIn: vi.fn(),
    signOut: vi.fn(async () => {}),
  }),
}));

/**
 * `NoteList` runs an export from its row menu, so it needs the global PDF
 * progress flag above it — the real provider, since nothing here drives it.
 *
 * `rerender` is wrapped too. Testing Library's own `rerender` replaces the
 * whole element it was given, so a bare `rerender(<NoteList …/>)` would drop
 * the provider and throw — with a stack pointing at `useExportProgress`, not
 * at the test.
 */
function renderList(
  ui: React.ReactElement,
  locale?: 'en' | 'ko',
): ReturnType<typeof renderWithI18n> {
  const result = renderWithI18n(<ExportProgressProvider>{ui}</ExportProgressProvider>, locale);
  const { rerender } = result;
  return {
    ...result,
    rerender: (next) => rerender(<ExportProgressProvider>{next}</ExportProgressProvider>),
  };
}

function trashedNote(id: string, title: string): Note {
  return { ...makeNote(id, title), trashedAt: 1 };
}

function makeNote(id: string, title: string, text?: string): Note {
  return {
    id,
    title,
    text: text ?? `${title}\nbody of ${title}`,
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
    trashedAt: null,
    archivedAt: null,
  };
}

function props(overrides: Partial<NoteListProps> = {}): NoteListProps {
  return {
    scope: ACTIVE_SCOPE,
    items: [makeNote('a', 'Alpha'), makeNote('b', 'Beta')],
    selectedNoteId: null,
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onTrash: vi.fn(),
    onRestore: vi.fn(),
    onTogglePin: vi.fn(),
    onPurge: vi.fn(),
    onDuplicate: vi.fn(),
    mode: 'desktop',
    onOpenDrawer: vi.fn(),
    onEmptyTrash: vi.fn(),
    emptyTrashDisabled: false,
    hasUnfilteredItems: true,
    count: 2,
    scopeQuery: { order: { field: 'updated', newestFirst: true }, includeDescendants: true },
    previewSize: 'large',
    onOrderChange: vi.fn(),
    onPreviewSizeChange: vi.fn(),
    onIncludeDescendantsChange: vi.fn(),
    onScopeChange: vi.fn(),
    ...overrides,
  };
}

describe('NoteList', () => {
  it('renders one row per note, in the order given', () => {
    renderList(<NoteList {...props()} />);

    const titles = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(titles[0]).toContain('Alpha');
    expect(titles[1]).toContain('Beta');
  });

  it('reports the id of the clicked note', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderList(<NoteList {...props({ onSelect })} />);
    await user.click(screen.getByRole('button', { name: /Beta/ }));

    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('renders nothing but the header while the query is loading', () => {
    renderList(<NoteList {...props({ items: undefined })} />);

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.queryByText('No notes')).not.toBeInTheDocument();
  });

  it('shows the notes empty state when the active scope has no notes', () => {
    renderList(<NoteList {...props({ items: [] })} />);

    expect(screen.getByText('No notes')).toBeInTheDocument();
  });

  it('shows the trash empty state when the trashed scope has no notes', () => {
    renderList(<NoteList {...props({ scope: TRASHED_SCOPE, items: [] })} />);

    expect(screen.getByText('Trash is empty')).toBeInTheDocument();
  });

  it('always offers to create a note', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();

    renderList(<NoteList {...props({ scope: TRASHED_SCOPE, onCreate })} />);
    await user.click(screen.getByRole('button', { name: 'New note' }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('offers delete only for a selected note in the active scope', async () => {
    const onTrash = vi.fn();
    const user = userEvent.setup();

    const { rerender } = renderList(<NoteList {...props()} />);
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    rerender(<NoteList {...props({ selectedNoteId: 'a', onTrash })} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onTrash).toHaveBeenCalledWith('a');
  });

  it('offers delete for a selected note in a tag scope too', async () => {
    const onTrash = vi.fn();
    const user = userEvent.setup();

    renderList(<NoteList {...props({ scope: tagScope('work'), selectedNoteId: 'a', onTrash })} />);

    const trashButton = screen.getByRole('button', { name: 'Delete' });
    await user.click(trashButton);

    expect(onTrash).toHaveBeenCalledWith('a');
  });

  it('renders no destructive affordance in a locked scope, even with a note selected', () => {
    // Forced deliberately: Locked is permanently empty in the app, so
    // `selectedNoteId` is always null there and an app-level assertion passes
    // for free whatever `allowsTrash` returns. Driving `NoteList` directly is
    // what makes this able to fail, and it is the unit that owns the gate.
    renderList(<NoteList {...props({ scope: smartScope('locked'), selectedNoteId: 'a' })} />);

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('renders Delete in an ordinary scope with a note selected', () => {
    // The paired positive case. Without it, a gate that hides Delete
    // everywhere would pass the test above.
    renderList(<NoteList {...props({ scope: ACTIVE_SCOPE, selectedNoteId: 'a' })} />);

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('offers restore instead of delete in the trashed scope', async () => {
    const onRestore = vi.fn();
    const user = userEvent.setup();

    renderList(<NoteList {...props({ scope: TRASHED_SCOPE, selectedNoteId: 'a', onRestore })} />);

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(onRestore).toHaveBeenCalledWith('a');
  });

  it('offers delete forever and empty trash only in the trashed scope', () => {
    renderList(<NoteList {...props({ scope: ACTIVE_SCOPE, selectedNoteId: 'a' })} />);

    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Empty trash' })).not.toBeInTheDocument();
  });

  it('offers delete forever for a selected note in the trashed scope', async () => {
    const onPurge = vi.fn();
    const user = userEvent.setup();

    renderList(<NoteList {...props({ scope: TRASHED_SCOPE, selectedNoteId: 'a', onPurge })} />);

    await user.click(screen.getByRole('button', { name: 'Delete forever' }));

    expect(onPurge).toHaveBeenCalledWith('a');
  });

  it('does not offer delete forever in the trashed scope with nothing selected', () => {
    renderList(<NoteList {...props({ scope: TRASHED_SCOPE, selectedNoteId: null })} />);

    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
  });

  it('offers empty trash in the trashed scope regardless of selection', async () => {
    const onEmptyTrash = vi.fn();
    const user = userEvent.setup();

    renderList(
      <NoteList {...props({ scope: TRASHED_SCOPE, selectedNoteId: null, onEmptyTrash })} />,
    );

    const button = screen.getByRole('button', { name: 'Empty trash' });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(onEmptyTrash).toHaveBeenCalledTimes(1);
  });

  // The class Task 7 fixed for "Empty trash" via `emptyTrashDisabled`; these
  // three are the remaining instances. `items` is the query-narrowed view, so
  // a selected note a query has filtered out of view is not on screen, and a
  // control that acts on it (trash / restore / delete forever) must not
  // render — otherwise a query that hides the selected note leaves a live
  // "Delete forever" button next to an empty "No matching notes" list.
  it('hides Move to trash for a selected note the query has filtered out', () => {
    renderList(
      <NoteList
        {...props({
          scope: ACTIVE_SCOPE,
          items: [makeNote('b', 'Beta')],
          selectedNoteId: 'a',
        })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('hides Restore and Delete forever for a selected note the query has filtered out', () => {
    renderList(
      <NoteList
        {...props({
          scope: TRASHED_SCOPE,
          items: [makeNote('b', 'Beta')],
          selectedNoteId: 'a',
        })}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete forever' })).not.toBeInTheDocument();
  });

  it('disables empty trash when told to (loading or an empty trash)', () => {
    const { rerender } = renderList(
      <NoteList {...props({ scope: TRASHED_SCOPE, emptyTrashDisabled: true })} />,
    );
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeDisabled();

    rerender(<NoteList {...props({ scope: TRASHED_SCOPE, emptyTrashDisabled: false })} />);
    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeEnabled();
  });

  // The gating defect this closes: `items` here is the query-narrowed view.
  // A query that matches none of the trashed notes must not disable the
  // button that empties the whole trash regardless of the query — only
  // `emptyTrashDisabled` may do that.
  it('keeps empty trash enabled when a query matches nothing, as long as the trash itself is not empty', () => {
    renderList(
      <NoteList
        {...props({ scope: TRASHED_SCOPE, items: [], query: 'zzzzz', emptyTrashDisabled: false })}
      />,
    );

    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeEnabled();
  });
});

describe('icons', () => {
  it('renders New note as an icon button that still has a name', () => {
    renderList(<NoteList {...props({ items: [] })} />);

    const button = screen.getByRole('button', { name: 'New note' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent).toBe('');
  });

  // Destructive actions keep their words: an icon-only delete asks the user to
  // recall a glyph before doing something irreversible.
  it('keeps destructive controls as text', () => {
    renderList(<NoteList {...props({ selectedNoteId: 'a' })} />);

    expect(screen.getByRole('button', { name: 'Delete' }).textContent).not.toBe('');
  });
});

describe('search', () => {
  it('renders the query field', () => {
    renderList(<NoteList {...props({ items: [] })} />);

    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toBeInTheDocument();
  });

  it('shows the empty-list state when there is no query', () => {
    renderList(<NoteList {...props({ items: [], query: '' })} />);

    expect(screen.getByText('No notes')).toBeInTheDocument();
    expect(screen.queryByText('No matching notes')).toBeNull();
  });

  // Distinct copy, because an empty result caused by a query reads as "this
  // list is empty" otherwise — and the user cannot tell why.
  it('shows the no-results state when a query is responsible', () => {
    renderList(<NoteList {...props({ items: [], query: 'milk' })} />);

    expect(screen.getByText('No matching notes')).toBeInTheDocument();
    expect(screen.queryByText('No notes')).toBeNull();
  });

  // The collision this closes: Locked is always empty by construction, and
  // its empty copy exists specifically so a user does not read "your locked
  // notes are missing." Gating the no-results state on `hasQuery` alone let a
  // query win over that special case and assert exactly the false thing it
  // was written to prevent.
  it('does not let a query override the Locked empty copy', () => {
    renderList(
      <NoteList
        {...props({
          scope: smartScope('locked'),
          items: [],
          query: 'milk',
          hasUnfilteredItems: false,
        })}
      />,
    );

    expect(screen.getByText('Locked notes are not available yet')).toBeInTheDocument();
    expect(screen.queryByText('No matching notes')).toBeNull();
  });

  // Same mechanism, the Trash instance: a genuinely empty trash plus a query
  // must still say "Trash is empty", not "No matching notes".
  it('does not let a query override the Trash empty copy when the trash is genuinely empty', () => {
    renderList(
      <NoteList
        {...props({
          scope: TRASHED_SCOPE,
          items: [],
          query: 'milk',
          hasUnfilteredItems: false,
        })}
      />,
    );

    expect(screen.getByText('Trash is empty')).toBeInTheDocument();
    expect(screen.queryByText('No matching notes')).toBeNull();
  });

  // The paired positive case: when the trash DOES have notes and the query
  // matches none of them, the no-results copy is correct and must still show.
  it('shows no-results, not the Trash empty copy, when a non-empty trash has no matches', () => {
    renderList(
      <NoteList
        {...props({
          scope: TRASHED_SCOPE,
          items: [],
          query: 'milk',
          hasUnfilteredItems: true,
        })}
      />,
    );

    expect(screen.getByText('No matching notes')).toBeInTheDocument();
    expect(screen.queryByText('Trash is empty')).toBeNull();
  });

  it('passes the query down so rows can highlight', () => {
    const { container } = renderList(
      <NoteList
        {...props({ items: [makeNote('a', 'Groceries', 'Groceries\nmilk')], query: 'milk' })}
      />,
    );

    expect(container.querySelector('[data-match]')?.textContent).toBe('milk');
  });
});

describe('scope header', () => {
  it('names the current smart list on the header button', () => {
    renderList(<NoteList {...props({ scope: smartScope('todo') })} />);

    const header = screen.getByRole('button', { name: /Todo/ });
    expect(header).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('names the tag on the header button in a tag scope', () => {
    renderList(<NoteList {...props({ scope: tagScope('work/urgent') })} />);

    expect(screen.getByRole('button', { name: /work\/urgent/ })).toBeInTheDocument();
  });

  it('opens the menu and reports expansion', async () => {
    renderList(<NoteList {...props()} />);
    const header = screen.getByRole('button', { name: /Notes/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'List options' })).toBeInTheDocument();
  });

  it('closes the menu after choosing a scope', async () => {
    const onScopeChange = vi.fn();
    renderList(<NoteList {...props({ onScopeChange })} />);

    await userEvent.click(screen.getByRole('button', { name: /Notes/ }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Pinned/ }));

    expect(onScopeChange).toHaveBeenCalledWith(smartScope('pinned'));
    expect(screen.queryByRole('menu', { name: 'List options' })).not.toBeInTheDocument();
  });

  it('passes the unfiltered count to the menu, not the length of the narrowed list', async () => {
    // `items` here is the query-narrowed view. A search matching one note must
    // not relabel a 33-note list as "1 note" — the same distinction
    // emptyTrashDisabled and hasUnfilteredItems already draw.
    renderList(<NoteList {...props({ count: 33, items: [makeNote('a', 'Alpha')] })} />);

    await userEvent.click(screen.getByRole('button', { name: /Notes/ }));

    expect(screen.getByText('33 notes')).toBeInTheDocument();
  });

  it('renders rows at the given preview size', () => {
    const { container } = renderList(<NoteList {...props({ previewSize: 'small' })} />);

    expect(container.querySelector('.line-clamp-2')).toBeNull();
    expect(container.querySelector('.line-clamp-1')).toBeNull();
  });

  it('renders two snippet lines at large', () => {
    const { container } = renderList(<NoteList {...props({ previewSize: 'large' })} />);

    expect(container.querySelector('.line-clamp-2')).not.toBeNull();
  });
});

describe('row context menu', () => {
  /**
   * Replaces `navigator.clipboard.writeText`. Must run after
   * `userEvent.setup()`, which installs a clipboard stub of its own.
   */
  function stubClipboard(impl: () => Promise<void> = async () => {}): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(impl);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  }

  /** Right-clicks the row and returns once the menu is on screen. */
  async function openRowMenu(name: string): Promise<void> {
    fireEvent.contextMenu(screen.getByRole('button', { name: new RegExp(name) }));
    await screen.findByRole('menu', { name: 'Note actions' });
  }

  it('opens on a row right-click', async () => {
    renderList(<NoteList {...props()} />);

    await openRowMenu('Alpha');

    expect(screen.getByRole('menu', { name: 'Note actions' })).toBeInTheDocument();
  });

  it('acts on the row it was opened on, not on the selected note', async () => {
    // The whole point of the addressing: a right-click deliberately does not
    // change the selection, so a menu that read `selectedNoteId` would delete
    // the wrong note every time.
    const onTrash = vi.fn();
    const user = userEvent.setup();
    renderList(<NoteList {...props({ selectedNoteId: 'a', onTrash })} />);

    await openRowMenu('Beta');
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(onTrash).toHaveBeenCalledWith('b');
  });

  it('duplicates through the caller', async () => {
    const onDuplicate = vi.fn();
    const user = userEvent.setup();
    renderList(<NoteList {...props({ onDuplicate })} />);

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    expect(onDuplicate).toHaveBeenCalledWith('a');
  });

  it('toggles the pin of the row it was opened on', async () => {
    const onTogglePin = vi.fn();
    const user = userEvent.setup();
    renderList(<NoteList {...props({ onTogglePin })} />);

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Pin note' }));

    expect(onTogglePin).toHaveBeenCalledWith('a', true);
  });

  it('copies the note’s own text to the clipboard', async () => {
    const user = userEvent.setup();
    // Installed AFTER `userEvent.setup()`, which fits its own clipboard stub
    // over `navigator.clipboard` — stubbing first is silently overwritten.
    const writeText = stubClipboard();
    renderList(<NoteList {...props()} />);

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Copy text' }));

    // The TEXT, not the title: a row menu that copied the preview would be
    // silently lossy, and nothing on screen would say so.
    expect(writeText).toHaveBeenCalledWith('Alpha\nbody of Alpha');
  });

  it('says so when the clipboard refuses', async () => {
    // `writeText` rejects when the document is not focused, and the whole
    // clipboard API is absent over plain HTTP on a non-localhost origin.
    // Both are silent without the failure branch under test.
    const user = userEvent.setup();
    stubClipboard(() => Promise.reject(new Error('not focused')));
    renderList(<NoteList {...props()} />);

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Copy text' }));

    expect(await screen.findByRole('status')).toHaveTextContent('This note could not be copied.');
  });

  it('offers Restore and Delete forever on a trashed row', async () => {
    const onRestore = vi.fn();
    const user = userEvent.setup();
    renderList(
      <NoteList
        {...props({ scope: TRASHED_SCOPE, items: [trashedNote('a', 'Alpha')], onRestore })}
      />,
    );

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Restore' }));

    expect(onRestore).toHaveBeenCalledWith('a');
  });

  it('routes Delete forever through the caller’s confirmation, never straight to a purge', async () => {
    const onPurge = vi.fn();
    const user = userEvent.setup();
    renderList(
      <NoteList
        {...props({ scope: TRASHED_SCOPE, items: [trashedNote('a', 'Alpha')], onPurge })}
      />,
    );

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Delete forever' }));

    expect(onPurge).toHaveBeenCalledWith('a');
  });

  it('closes after an action', async () => {
    const user = userEvent.setup();
    renderList(<NoteList {...props()} />);

    await openRowMenu('Alpha');
    await user.click(screen.getByRole('menuitem', { name: 'Duplicate' }));

    expect(screen.queryByRole('menu', { name: 'Note actions' })).not.toBeInTheDocument();
  });
});

describe('phone header', () => {
  it('offers the drawer, and does not on desktop', () => {
    renderList(<NoteList {...props({ mode: 'phone' })} />);
    expect(screen.getByRole('button', { name: 'Show tags' })).toBeInTheDocument();

    cleanup();
    renderList(<NoteList {...props({ mode: 'desktop' })} />);
    expect(screen.queryByRole('button', { name: 'Show tags' })).not.toBeInTheDocument();
  });

  it('drops the selection actions, which act on a note the phone has navigated away from', () => {
    // Not "the header is smaller": the specific claim is that Delete and
    // Restore are gone, because on a phone selecting a note leaves the list.
    // They live in the row's context menu instead.
    renderList(<NoteList {...props({ mode: 'phone', selectedNoteId: 'a' })} />);

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('keeps the selection actions on desktop', () => {
    renderList(<NoteList {...props({ mode: 'desktop', selectedNoteId: 'a' })} />);

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('still offers Empty trash in the trash scope on a phone', () => {
    // Deliberately NOT moved into ScopeMenu: an irreversible action reads
    // worse buried in a menu of view preferences.
    renderList(<NoteList {...props({ mode: 'phone', scope: TRASHED_SCOPE })} />);

    expect(screen.getByRole('button', { name: 'Empty trash' })).toBeInTheDocument();
  });

  it('creates a note from the floating button below desktop', async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    renderList(<NoteList {...props({ mode: 'phone', onCreate })} />);

    await user.click(screen.getByRole('button', { name: 'New note' }));

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('names the floating button exactly as the desktop button names itself', () => {
    // One action must not announce two different ways depending on viewport.
    renderList(<NoteList {...props({ mode: 'phone' })} />);
    const fab = screen.getByRole('button', { name: 'New note' });

    cleanup();
    renderList(<NoteList {...props({ mode: 'desktop' })} />);

    expect(screen.getByRole('button', { name: 'New note' }).getAttribute('aria-label')).toBe(
      fab.getAttribute('aria-label'),
    );
  });
});
