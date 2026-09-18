import type { ReactElement } from 'react';

import { useT } from '@/i18n';
import { Button } from '@/ui/Button';

export interface EditorLoadingProps {
  /**
   * `true` once the editor chunk's `import()` has rejected. Renders an
   * explicit failure state with a reload action instead of the quiet
   * loading copy — see the docblock below for why silence is wrong once
   * loading has actually failed, and why the action is a reload rather than
   * a retry.
   */
  failed?: boolean;
}

/**
 * What the editor pane shows while its chunk is in flight, or after it has
 * failed to load.
 *
 * `null` was rejected for the loading state: on a desktop the pane is
 * visible from first paint, and a pane that is blank and then fills in reads
 * as a bug rather than as loading. That state is deliberately quiet — no
 * spinner — because on a warm cache it is on screen for a single frame, and
 * a spinner that flashes for 16ms is worse than a label that does not move.
 *
 * The failure state is deliberately NOT quiet. `useNoteEditorComponent`
 * (`AppShell.tsx`) has no reason to assume the chunk request always
 * succeeds — `src/features/publish/staleBuild.ts` documents a real case
 * where a tab left open across a deploy requests a hashed asset the server
 * no longer serves — and before this sub-project the editor was already in
 * the entry chunk and in memory, so a failure here is a new way for a user
 * to lose the ability to edit any note. Silently staying on the loading copy
 * forever would hide that entirely; this renders an explicit message and a
 * reload button instead.
 *
 * The button reloads the page rather than re-running the same `import()`.
 * Per HTML's "fetch a single module script", a failed fetch leaves a
 * `null` entry in the browser's module map for that URL, and every later
 * `import()` of the same specifier resolves from that map without ever
 * making a network request — so a "try again" that re-runs the identical
 * import can never succeed, in either failure case this guards against: a
 * stale tab after a deploy (the hashed chunk is gone from the server for
 * good) or a transient dropped connection (the browser will not re-fetch a
 * URL it already recorded as failed). `location.reload()` is the one action
 * that actually re-requests `index.html` and, with it, a correct chunk URL —
 * so it is offered directly instead of being left in the prose below it.
 */
export function EditorLoading({ failed = false }: EditorLoadingProps): ReactElement {
  const t = useT();

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-ui text-faint">{t('editor.loadError')}</p>
        <Button onClick={() => window.location.reload()} variant="soft">
          {t('editor.loadError.retry')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <p className="text-ui text-faint">{t('editor.loading')}</p>
    </div>
  );
}
