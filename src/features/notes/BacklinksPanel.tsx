import type { ReactElement } from 'react';

import { useLiveQuery } from 'dexie-react-hooks';

import { notes } from '@/data';
import { useT } from '@/i18n';
import { SidebarRow } from '@/ui/SidebarRow';

export interface BacklinksPanelProps {
  /**
   * The open note's own title, exactly as stored. Raw, not normalized —
   * `notes.linksTo` normalizes internally, matching every other caller of it.
   */
  title: string;
  /** Called with a linking note's id when its row is clicked. */
  onOpenNote: (id: string) => void;
}

/**
 * The reverse of a `[[link]]` pill: every non-trashed note whose text links
 * to the open note, newest first. Renders nothing at all — not an empty
 * section — when there are none, because an always-present empty section on
 * every note is chrome that never earns its space and most notes will never
 * have a backlink.
 *
 * `useLiveQuery`'s deps are `[title]`, not `[]`. `NoteEditor` remounts on a
 * note SWITCH (keyed by id), but an in-place rename changes `title` without a
 * remount, and per `docs/rulings/notes-lifecycle.md` a `useLiveQuery` whose
 * deps can change must tag its result with the dependency value it was
 * computed for — trusting an untagged result would risk one tick where a
 * rename shows the PREVIOUS title's backlinks under the new heading.
 */
export function BacklinksPanel({ title, onOpenNote }: BacklinksPanelProps): ReactElement | null {
  const t = useT();

  const result = useLiveQuery(async () => {
    const list = await notes.linksTo(title);
    return { title, list };
  }, [title]);

  const backlinks = result?.title === title ? result.list : undefined;

  if (backlinks === undefined || backlinks.length === 0) return null;

  const sorted = [...backlinks].sort((a, b) => b.updatedAt - a.updatedAt);
  const heading = t('backlinks.title');

  return (
    <nav aria-label={heading} className="max-h-48 shrink-0 overflow-y-auto border-t border-border">
      <h2 className="px-4 pt-2 text-ui-xs font-semibold text-faint">
        {heading} <span data-count>{sorted.length}</span>
      </h2>
      <ul className="px-2 pb-2">
        {sorted.map((note) => (
          <SidebarRow
            key={note.id}
            label={note.title !== '' ? note.title : t('note.untitled')}
            selected={false}
            onSelect={() => onOpenNote(note.id)}
          />
        ))}
      </ul>
    </nav>
  );
}
