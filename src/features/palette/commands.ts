import type { ThemeChoice } from '@/app/theme';
import type { NoteOrder } from '@/data';
import { SMART_LIST_IDS, smartScope, type NoteScope, type PreviewSize } from '@/features/notes';
import type { TranslationKey } from '@/i18n';
import { THEMES } from '@/styles/themes';

import type { Matchable } from './matchCommands';

export type CommandGroup = 'navigation' | 'note' | 'appearance' | 'account';

export interface Command extends Matchable {
  id: string;
  group: CommandGroup;
  /** Already translated. What the matcher ranks against. */
  label: string;
  /** A shortcut hint, already formatted for display. */
  hint?: string;
  /**
   * Routed through `ConfirmDialog` by the caller instead of run inline.
   * Every irreversible command carries it; `commands.test.ts` asserts the
   * exact set, so adding one without the flag fails loudly.
   */
  destructive?: boolean;
  run: () => void;
}

export interface CommandDeps {
  t: (key: TranslationKey) => string;

  /** State the command set depends on. */
  hasOpenNote: boolean;
  openNoteTrashed: boolean;
  openNotePinned: boolean;
  signedIn: boolean;
  /** Whether the user has typed anything. Gates the sixteen theme commands. */
  hasQuery: boolean;

  onScope: (scope: NoteScope) => void;
  onOpenGraph: () => void;
  onFocusSearch: () => void;
  onNewNote: () => void;
  onDuplicateNote: () => void;
  onTogglePin: () => void;
  onTrashNote: () => void;
  onRestoreNote: () => void;
  onEmptyTrash: () => void;
  onExport: (format: 'markdown' | 'html' | 'pdf') => void;
  onSetTheme: (choice: ThemeChoice) => void;
  onSetPreviewSize: (size: PreviewSize) => void;
  onSetOrder: (order: NoteOrder) => void;
  onToggleHideSubTagNotes: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onSyncNow: () => void;
}

/**
 * Every command valid for the CURRENT state, and no others.
 *
 * Absent rather than disabled, deliberately: an entry you can arrow onto and
 * press Enter on, which then does nothing, is worse than one that is not
 * there. It also makes the tests assertions about which commands EXIST for a
 * given state, which is where the bugs are.
 *
 * Pure — no React, no DOM, no database. `AppShell` owns every handler and
 * passes it in, which is what keeps `src/features/palette/` from importing
 * `src/app/` for anything but a type.
 */
export function buildCommands(deps: CommandDeps): Command[] {
  const { t } = deps;
  const commands: Command[] = [];

  for (const list of SMART_LIST_IDS) {
    commands.push({
      id: `go.${list}`,
      group: 'navigation',
      label: t(`smartList.${list}` as TranslationKey),
      run: () => deps.onScope(smartScope(list)),
    });
  }

  commands.push({
    id: 'go.graph',
    group: 'navigation',
    label: t('palette.command.openGraph'),
    hint: '⇧⌘G',
    run: deps.onOpenGraph,
  });

  commands.push({
    id: 'go.search',
    group: 'navigation',
    label: t('palette.command.search'),
    hint: '⌘F',
    run: deps.onFocusSearch,
  });

  // Sixteen theme rows would swamp the empty state, whose job is to answer
  // "what can this app do?". Typing anything at all brings them back.
  if (deps.hasQuery) {
    for (const theme of THEMES) {
      commands.push({
        id: `theme.${theme.id}`,
        group: 'appearance',
        label: `${t('palette.command.theme')}: ${t(theme.labelKey)}`,
        run: () => deps.onSetTheme(theme.id),
      });
    }
  }

  commands.push({
    id: 'appearance.hideSubTagNotes',
    group: 'appearance',
    label: t('palette.command.hideSubTagNotes'),
    run: deps.onToggleHideSubTagNotes,
  });

  commands.push({
    id: 'note.new',
    group: 'note',
    label: t('palette.command.newNote'),
    run: deps.onNewNote,
  });

  if (deps.hasOpenNote && !deps.openNoteTrashed) {
    commands.push({
      id: 'note.duplicate',
      group: 'note',
      label: t('palette.command.duplicateNote'),
      run: deps.onDuplicateNote,
    });

    commands.push(
      deps.openNotePinned
        ? {
            id: 'note.unpin',
            group: 'note',
            label: t('palette.command.unpinNote'),
            run: deps.onTogglePin,
          }
        : {
            id: 'note.pin',
            group: 'note',
            label: t('palette.command.pinNote'),
            run: deps.onTogglePin,
          },
    );

    commands.push({
      id: 'note.trash',
      group: 'note',
      label: t('palette.command.trashNote'),
      destructive: true,
      run: deps.onTrashNote,
    });

    commands.push({
      id: 'note.exportMarkdown',
      group: 'note',
      label: t('palette.command.exportMarkdown'),
      run: () => deps.onExport('markdown'),
    });

    commands.push({
      id: 'note.exportHtml',
      group: 'note',
      label: t('palette.command.exportHtml'),
      run: () => deps.onExport('html'),
    });

    // PDF is rendered server-side and is the first capability in this app that
    // does not exist without an account. Absent rather than disabled here,
    // matching how `buildCommands` treats every other invalid command.
    if (deps.signedIn) {
      commands.push({
        id: 'note.exportPdf',
        group: 'note',
        label: t('palette.command.exportPdf'),
        run: () => deps.onExport('pdf'),
      });
    }
  }

  if (deps.hasOpenNote && deps.openNoteTrashed) {
    commands.push({
      id: 'note.restore',
      group: 'note',
      label: t('palette.command.restoreNote'),
      run: deps.onRestoreNote,
    });
  }

  // Gated on `hasOpenNote`, matching every other note-group command below
  // `note.new`. The brief's own test ("offers only New note when nothing is
  // open") requires this absent with no note open; `CommandDeps` has no
  // trash-count or scope flag to gate it on the more natural condition
  // ("there is something in the trash"), so this is the only state
  // available to satisfy that test without inventing a new field.
  if (deps.hasOpenNote) {
    commands.push({
      id: 'note.emptyTrash',
      group: 'note',
      label: t('palette.command.emptyTrash'),
      destructive: true,
      run: deps.onEmptyTrash,
    });
  }

  if (deps.signedIn) {
    commands.push({
      id: 'account.signOut',
      group: 'account',
      label: t('palette.command.signOut'),
      destructive: true,
      run: deps.onSignOut,
    });

    commands.push({
      id: 'account.syncNow',
      group: 'account',
      label: t('palette.command.syncNow'),
      run: deps.onSyncNow,
    });
  } else {
    commands.push({
      id: 'account.signIn',
      group: 'account',
      label: t('palette.command.signIn'),
      run: deps.onSignIn,
    });
  }

  return commands;
}
