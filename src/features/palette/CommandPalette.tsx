import { Fragment, type ReactElement, useEffect, useMemo, useState } from 'react';

import { notes as notesRepo, type TitledNote } from '@/data';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { Dialog } from '@/ui/Dialog';

import { buildCommands, type Command, type CommandDeps, type CommandGroup } from './commands';
import { matchAll } from './matchCommands';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Everything buildCommands needs EXCEPT `hasQuery`, which the palette owns. */
  deps: Omit<CommandDeps, 'hasQuery'>;
  /** Called with a note id when a note result is chosen. */
  onOpenNote: (id: string) => void;
  /** Called with the raw query when the create-note offer is chosen. */
  onCreateNote: (title: string) => void;
}

/** How many note results the list will show. */
const NOTE_LIMIT = 8;

/** The synthetic group notes are filed under, purely for its header label. */
const NOTES_GROUP = 'notes' as const;
type RowGroup = CommandGroup | typeof NOTES_GROUP;

type Row =
  | { kind: 'command'; id: string; group: RowGroup; label: string; hint?: string; run: () => void }
  | { kind: 'note'; id: string; group: RowGroup; label: string }
  | { kind: 'create'; id: string; group: RowGroup; label: string };

/**
 * `rows` is deliberately option-ONLY: every entry in it becomes exactly one
 * `role="option"` element, and `aria-activedescendant`/the arrow arithmetic
 * both run over this single flat array. Group headers are a second,
 * presentation-only thing layered on top while rendering — see the render
 * loop below — and are never added to `rows`, so they cannot be reached by
 * Arrow keys and never shift the index math.
 */
export function CommandPalette({
  open,
  onClose,
  deps,
  onOpenNote,
  onCreateNote,
}: CommandPaletteProps): ReactElement | null {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [noteIndex, setNoteIndex] = useState<TitledNote[]>([]);

  // A snapshot taken when the palette opens, not a live subscription: it is
  // open for seconds, and a list reordering under the cursor mid-keystroke is
  // worse than being one save stale.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void notesRepo.allNoteIndex().then((rows) => {
      if (live) setNoteIndex(rows);
    });
    return () => {
      live = false;
    };
  }, [open]);

  // Reopening starts clean rather than resuming someone else's half-typed query.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const commands = useMemo(
    () => buildCommands({ ...deps, hasQuery: query.trim() !== '' }),
    [deps, query],
  );

  const rows = useMemo<Row[]>(() => {
    const matchedCommands = matchAll(commands, query).map((command: Command): Row => ({
      kind: 'command',
      id: `cmd-${command.id}`,
      group: command.group,
      label: command.label,
      hint: command.hint,
      run: command.run,
    }));

    const trimmed = query.trim();
    const matchedNotes =
      trimmed === ''
        ? []
        : matchAll(
            noteIndex.map((note) => ({ id: note.id, label: note.title })),
            query,
          )
            .slice(0, NOTE_LIMIT)
            .map((note): Row => ({
              kind: 'note',
              id: `note-${note.id}`,
              group: NOTES_GROUP,
              label: note.label,
            }));

    if (matchedCommands.length === 0 && matchedNotes.length === 0 && trimmed !== '') {
      return [
        {
          kind: 'create',
          id: 'create',
          group: NOTES_GROUP,
          label: `${t('palette.createNote')} "${trimmed}"`,
        },
      ];
    }

    return [...matchedCommands, ...matchedNotes];
  }, [commands, noteIndex, query, t]);

  // Without this the cursor stays at an index that now names a different row.
  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const active = rows[Math.min(index, rows.length - 1)];

  function choose(row: Row | undefined): void {
    if (row === undefined) return;
    if (row.kind === 'command') row.run();
    else if (row.kind === 'note') onOpenNote(row.id.slice('note-'.length));
    else onCreateNote(query.trim());
    onClose();
  }

  // The group each row belongs to, only where it DIFFERS from the row before
  // it — that difference is where a header renders. `rows` itself carries no
  // header entries, so this walk never touches the index space arrows use.
  let previousGroup: RowGroup | undefined;

  return (
    <Dialog open onClose={onClose} label={t('palette.label')} className="w-full max-w-xl p-0">
      <input
        // No `ref` needed: `Dialog` already focuses the first focusable
        // element inside it on open (`panelRef.current?.querySelector(FOCUSABLE)`),
        // which is this input — `autoFocus` below is what makes THAT visible
        // to a reader of this file without following it into `Dialog.tsx`,
        // not a second, competing focus mechanism.
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={active?.id}
        aria-label={t('palette.label')}
        placeholder={t('palette.placeholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (rows.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((current) => (current + 1) % rows.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((current) => (current - 1 + rows.length) % rows.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(active);
          }
        }}
        className="border-border text-text w-full border-b bg-transparent px-4 py-3 text-ui outline-none"
      />

      <ul
        id="palette-list"
        role="listbox"
        aria-label={t('palette.label')}
        className="max-h-80 overflow-y-auto py-1"
      >
        {rows.length === 0 && (
          <li className="text-muted px-4 py-3 text-ui-sm">{t('palette.empty')}</li>
        )}
        {rows.map((row, position) => {
          const showHeader = row.group !== previousGroup;
          previousGroup = row.group;

          return (
            <Fragment key={row.id}>
              {showHeader && (
                <li
                  data-palette-header
                  role="presentation"
                  className="text-faint px-4 pb-1 pt-3 text-ui-xs font-medium uppercase tracking-wide first:pt-1"
                >
                  {t(`palette.group.${row.group}` as TranslationKey)}
                </li>
              )}
              <li
                id={row.id}
                role="option"
                aria-selected={position === index}
                onMouseEnter={() => setIndex(position)}
                onClick={() => choose(row)}
                className={`flex cursor-pointer items-center justify-between px-4 py-2 text-ui ${
                  position === index ? 'bg-selected text-text' : 'text-muted'
                }`}
              >
                <span>{row.label}</span>
                {row.kind === 'command' && row.hint !== undefined && (
                  // Decorative: the keyboard shortcut is redundant with the
                  // command itself and must not leak into the option's
                  // accessible name, which is the label alone.
                  <span aria-hidden="true" className="text-faint text-ui-xs">
                    {row.hint}
                  </span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>
    </Dialog>
  );
}

export default CommandPalette;
