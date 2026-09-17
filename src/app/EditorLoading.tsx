import type { ReactElement } from 'react';

import { useT } from '@/i18n';

/**
 * What the editor pane shows while its chunk is in flight.
 *
 * `null` was rejected: on a desktop the pane is visible from first paint, and
 * a pane that is blank and then fills in reads as a bug rather than as
 * loading. This is deliberately quiet — no spinner — because on a warm cache
 * it is on screen for a single frame, and a spinner that flashes for 16ms is
 * worse than a label that does not move.
 */
export function EditorLoading(): ReactElement {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-ui text-faint">{t('editor.loading')}</p>
    </div>
  );
}
