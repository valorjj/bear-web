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
  // Unskipped by Task 3, which adds the note and account groups.
  it.skip('marks every irreversible command destructive', () => {
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

  // Unskipped by Task 3, which adds the note and account groups.
  it.skip('marks nothing else destructive', () => {
    const all = buildCommands(deps({ hasOpenNote: true, signedIn: true, hasQuery: true }));
    const flagged = all
      .filter((c) => c.destructive === true)
      .map((c) => c.id)
      .sort();

    expect(flagged).toEqual(['account.signOut', 'note.emptyTrash', 'note.trash']);
  });
});
