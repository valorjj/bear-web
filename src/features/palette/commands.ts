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

  return commands;
}
