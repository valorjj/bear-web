import { describe, expect, it, vi } from 'vitest';

import { SMART_LIST_IDS, smartScope } from '@/features/notes';
import { en } from '@/i18n';

import { buildCommands, type CommandDeps } from './commands';

/** Every dep a no-op, every state flag false. Tests override what they need. */
function deps(overrides: Partial<CommandDeps> = {}): CommandDeps {
  return {
    t: (key) => en[key],
    hasOpenNote: false,
    openNoteTrashed: false,
    openNotePinned: false,
    signedIn: false,
    hasQuery: false,
    onScope: vi.fn(),
    onOpenGraph: vi.fn(),
    onFocusSearch: vi.fn(),
    onNewNote: vi.fn(),
    onDuplicateNote: vi.fn(),
    onTogglePin: vi.fn(),
    onTrashNote: vi.fn(),
    onRestoreNote: vi.fn(),
    onEmptyTrash: vi.fn(),
    onExport: vi.fn(),
    onSetTheme: vi.fn(),
    onSetPreviewSize: vi.fn(),
    onSetOrder: vi.fn(),
    onToggleHideSubTagNotes: vi.fn(),
    onSignIn: vi.fn(),
    onSignOut: vi.fn(),
    onSyncNow: vi.fn(),
    ...overrides,
  };
}

const ids = (d: CommandDeps) => buildCommands(d).map((c) => c.id);

describe('buildCommands — navigation', () => {
  it('offers all seven smart lists plus graph and search', () => {
    const list = ids(deps());

    for (const id of ['all', 'untagged', 'todo', 'today', 'pinned', 'locked', 'trash']) {
      expect(list).toContain(`go.${id}`);
    }
    expect(list).toContain('go.graph');
    expect(list).toContain('go.search');
  });

  it.each(SMART_LIST_IDS)("routes go.%s to that list's own scope", (list) => {
    const onScope = vi.fn();
    buildCommands(deps({ onScope }))
      .find((c) => c.id === `go.${list}`)!
      .run();

    expect(onScope).toHaveBeenCalledWith(smartScope(list));
  });

  it('routes go.graph to onOpenGraph, and not onFocusSearch', () => {
    const onOpenGraph = vi.fn();
    const onFocusSearch = vi.fn();
    buildCommands(deps({ onOpenGraph, onFocusSearch }))
      .find((c) => c.id === 'go.graph')!
      .run();

    expect(onOpenGraph).toHaveBeenCalledTimes(1);
    expect(onFocusSearch).not.toHaveBeenCalled();
  });

  it('routes go.search to onFocusSearch, and not onOpenGraph', () => {
    const onOpenGraph = vi.fn();
    const onFocusSearch = vi.fn();
    buildCommands(deps({ onOpenGraph, onFocusSearch }))
      .find((c) => c.id === 'go.search')!
      .run();

    expect(onFocusSearch).toHaveBeenCalledTimes(1);
    expect(onOpenGraph).not.toHaveBeenCalled();
  });
});

describe('buildCommands — appearance', () => {
  it('omits theme commands with no query, so the empty state stays legible', () => {
    // 16 theme rows would drown the "what can this app do?" list.
    expect(ids(deps({ hasQuery: false })).filter((id) => id.startsWith('theme.'))).toEqual([]);
  });

  it('offers one command per theme once something is typed', () => {
    const themeIds = ids(deps({ hasQuery: true })).filter((id) => id.startsWith('theme.'));

    expect(themeIds.length).toBeGreaterThanOrEqual(16);
  });

  it('routes a theme command through onSetTheme', () => {
    const onSetTheme = vi.fn();
    const command = buildCommands(deps({ hasQuery: true, onSetTheme })).find((c) =>
      c.id.startsWith('theme.'),
    )!;
    command.run();

    expect(onSetTheme).toHaveBeenCalledTimes(1);
  });
});

describe('buildCommands — the destructive invariant', () => {
  it('marks every irreversible command destructive', () => {
    // A rule that rots silently as commands are added. `emptyTrash` and
    // `signOut` have no undo; `trashNote` is reversible but still guarded,
    // matching how the note-row menu already treats it.
    const all = buildCommands(deps({ hasOpenNote: true, signedIn: true, hasQuery: true }));
    const mustGuard = ['note.trash', 'note.emptyTrash', 'account.signOut'];

    for (const id of mustGuard) {
      const command = all.find((c) => c.id === id);
      expect(command, `${id} missing`).toBeDefined();
      expect(command!.destructive, `${id} not marked destructive`).toBe(true);
    }
  });

  it('marks nothing else destructive', () => {
    const all = buildCommands(deps({ hasOpenNote: true, signedIn: true, hasQuery: true }));
    const flagged = all
      .filter((c) => c.destructive === true)
      .map((c) => c.id)
      .sort();

    expect(flagged).toEqual(['account.signOut', 'note.emptyTrash', 'note.trash']);
  });
});

describe('buildCommands — note actions follow the open note', () => {
  it('offers only New note when nothing is open', () => {
    const noteIds = ids(deps({ hasOpenNote: false })).filter((id) => id.startsWith('note.'));

    expect(noteIds).toEqual(['note.new']);
  });

  it('offers duplicate, pin and trash when a live note is open', () => {
    const noteIds = ids(deps({ hasOpenNote: true }));

    expect(noteIds).toContain('note.duplicate');
    expect(noteIds).toContain('note.pin');
    expect(noteIds).toContain('note.trash');
    expect(noteIds).not.toContain('note.restore');
  });

  it('swaps pin for unpin when the note is pinned', () => {
    const noteIds = ids(deps({ hasOpenNote: true, openNotePinned: true }));

    expect(noteIds).toContain('note.unpin');
    expect(noteIds).not.toContain('note.pin');
  });

  it('offers restore and NOT trash when the open note is trashed', () => {
    const noteIds = ids(deps({ hasOpenNote: true, openNoteTrashed: true }));

    expect(noteIds).toContain('note.restore');
    expect(noteIds).not.toContain('note.trash');
    // Exporting a trashed note is not a thing the app offers anywhere else.
    expect(noteIds).not.toContain('note.exportPdf');
  });

  it('offers all three exports for a live note, but PDF only when signed in', () => {
    const guest = ids(deps({ hasOpenNote: true, signedIn: false }));
    expect(guest).toContain('note.exportMarkdown');
    expect(guest).toContain('note.exportHtml');
    // PDF renders server-side and does not exist without an account — the
    // export menu already marks it aria-disabled when signed out.
    expect(guest).not.toContain('note.exportPdf');

    expect(ids(deps({ hasOpenNote: true, signedIn: true }))).toContain('note.exportPdf');
  });

  it('routes each export through onExport with its format', () => {
    const onExport = vi.fn();
    buildCommands(deps({ hasOpenNote: true, onExport }))
      .find((c) => c.id === 'note.exportHtml')!
      .run();

    expect(onExport).toHaveBeenCalledWith('html');
  });
});

describe('buildCommands — account', () => {
  it('offers sign in when signed out, and sign out plus sync when signed in', () => {
    expect(ids(deps({ signedIn: false }))).toContain('account.signIn');
    expect(ids(deps({ signedIn: false }))).not.toContain('account.syncNow');

    const member = ids(deps({ signedIn: true }));
    expect(member).toContain('account.signOut');
    expect(member).toContain('account.syncNow');
    expect(member).not.toContain('account.signIn');
  });
});
