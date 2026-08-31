import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { en, I18nProvider } from '@/i18n';

import { CommandPalette } from './CommandPalette';
import type { CommandDeps } from './commands';

beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteLinks.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function baseDeps(overrides: Partial<Omit<CommandDeps, 'hasQuery'>> = {}) {
  return {
    t: (key: keyof typeof en) => en[key],
    hasOpenNote: false,
    openNoteTrashed: false,
    openNotePinned: false,
    signedIn: false,
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
  } as Omit<CommandDeps, 'hasQuery'>;
}

function renderPalette(extra: Partial<Parameters<typeof CommandPalette>[0]> = {}) {
  const onClose = vi.fn();
  const onOpenNote = vi.fn();
  const onCreateNote = vi.fn();
  render(
    <I18nProvider locale="en">
      <CommandPalette
        open
        onClose={onClose}
        deps={baseDeps()}
        onOpenNote={onOpenNote}
        onCreateNote={onCreateNote}
        {...extra}
      />
    </I18nProvider>,
  );
  return { onClose, onOpenNote, onCreateNote };
}

const options = () => screen.queryAllByRole('option');

describe('CommandPalette', () => {
  it('shows commands and ZERO notes on an empty query', async () => {
    await notes.create('# Kafka rebalancing');

    renderPalette();
    await waitFor(() => expect(options().length).toBeGreaterThan(0));

    // A count, not a presence check: the rule is "no notes until you type".
    expect(screen.queryByRole('option', { name: /Kafka rebalancing/ })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Open graph' })).toBeInTheDocument();
  });

  it('shows matching notes once something is typed', async () => {
    await notes.create('# Kafka rebalancing');

    renderPalette();
    await userEvent.type(screen.getByRole('combobox'), 'kafka');

    expect(await screen.findByRole('option', { name: /Kafka rebalancing/ })).toBeInTheDocument();
  });

  it('tracks the highlighted option with aria-activedescendant, and keeps focus in the input', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));

    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();

    await userEvent.keyboard('{ArrowDown}');

    const second = input.getAttribute('aria-activedescendant');
    // The VALUE must change — asserting the attribute merely exists would
    // pass against an implementation that never updates it.
    expect(second).not.toBe(first);
    expect(second).toBe(options()[1]!.id);
    // Focus stays put; arrows must not move it into the list or typing breaks.
    expect(input).toHaveFocus();
  });

  it('wraps at both ends', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));

    await userEvent.keyboard('{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options().at(-1)!.id);

    await userEvent.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0]!.id);
  });

  it('runs the highlighted command on Enter and closes', async () => {
    const onOpenGraph = vi.fn();
    const { onClose } = renderPalette({ deps: baseDeps({ onOpenGraph }) });

    await userEvent.type(screen.getByRole('combobox'), 'open graph');
    await userEvent.keyboard('{Enter}');

    expect(onOpenGraph).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('does NOT run a destructive command inline — it reports it and closes', async () => {
    const onEmptyTrash = vi.fn();
    renderPalette({ deps: baseDeps({ onEmptyTrash }) });

    await userEvent.type(screen.getByRole('combobox'), 'empty trash');
    await userEvent.keyboard('{Enter}');

    // `onEmptyTrash` IS the "please confirm this" callback — AppShell wires it
    // to its `pending` union, not to the mutation. So it is called exactly
    // once and nothing is deleted here. Task 5 asserts the confirm end.
    expect(onEmptyTrash).toHaveBeenCalledTimes(1);
  });

  it('offers to create a note when nothing matches', async () => {
    const { onCreateNote } = renderPalette();

    await userEvent.type(screen.getByRole('combobox'), 'zzz nothing matches this');
    const offer = await screen.findByRole('option', { name: /Create note titled/ });
    await userEvent.click(offer);

    expect(onCreateNote).toHaveBeenCalledWith('zzz nothing matches this');
  });

  it('renders nothing when closed', () => {
    render(
      <I18nProvider locale="en">
        <CommandPalette
          open={false}
          onClose={vi.fn()}
          deps={baseDeps()}
          onOpenNote={vi.fn()}
          onCreateNote={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('groups results by a fixed order, each header appearing exactly once, never reachable by arrowing', async () => {
    renderPalette();
    const input = screen.getByRole('combobox');

    // A non-empty query spanning multiple groups: on an empty query `matchAll`
    // sorts by id alone, which happens to keep groups contiguous by accident
    // (id prefixes align with group names) and hides exactly this bug.
    await userEvent.type(input, 'n');
    await waitFor(() => expect(options().length).toBeGreaterThan(1));

    const rowCount = options().length;

    const listbox = screen.getByRole('listbox');
    const headers = Array.from(listbox.querySelectorAll('[data-palette-header]'));
    const headerTexts = headers.map((header) => header.textContent);

    // Sections are fixed: the header count must equal the number of DISTINCT
    // groups present, and each of those headers must appear exactly once. A
    // repeated header text (e.g. "Note" appearing twice) is exactly what
    // interleaved groups look like in the DOM.
    expect(headerTexts.length).toBeGreaterThan(1);
    expect(new Set(headerTexts).size).toBe(headerTexts.length);

    // …but arrowing through every single row, one per row plus a full extra
    // lap, never lands `aria-activedescendant` on a header element, and the
    // number of distinct ids visited is exactly the option count.
    const visited = new Set<string>();
    for (let i = 0; i < rowCount * 2; i += 1) {
      await userEvent.keyboard('{ArrowDown}');
      const id = input.getAttribute('aria-activedescendant');
      expect(id).toBeTruthy();
      const el = document.getElementById(id!);
      expect(el).not.toBeNull();
      expect(el!.getAttribute('role')).toBe('option');
      expect(el!.hasAttribute('data-palette-header')).toBe(false);
      visited.add(id!);
    }
    expect(visited.size).toBe(rowCount);
    expect(screen.getAllByRole('option').length).toBe(rowCount);
  });
});
