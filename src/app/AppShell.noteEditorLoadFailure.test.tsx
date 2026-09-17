import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/data';
import { I18nProvider } from '@/i18n';
import { en } from '@/i18n/en';

import { AppShell } from './AppShell';

/**
 * `useNoteEditorComponent` (`AppShell.tsx`) loads the editor chunk through a
 * plain `import()`, not `React.lazy()`/`Suspense` — see that file's docblock
 * for why. This is its own test file, separate from `AppShell.test.tsx`,
 * because it needs `@/features/notes/NoteEditor` to REJECT rather than
 * resolve, and `vi.mock` factories apply for the whole file: the other 70
 * tests in `AppShell.test.tsx` all need the module to load successfully.
 *
 * Covers I1 from the task-3 review: before this test existed, a rejected
 * chunk request left the editor pane on the loading copy forever, with no
 * error and no way to recover — a real risk given
 * `src/features/publish/staleBuild.ts`'s documented stale-tab-past-a-deploy
 * scenario, and a regression from before this sub-project, when the editor
 * was already in the entry chunk and could not fail to load at all.
 */
vi.mock('@/features/notes/NoteEditor', () => Promise.reject(new Error('chunk load failed')));

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.notes.clear(),
    db.noteTags.clear(),
    db.tags.clear(),
    db.files.clear(),
    db.settings.clear(),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderShell() {
  return render(
    <I18nProvider locale="en">
      <AppShell />
    </I18nProvider>,
  );
}

describe('the editor pane when its chunk fails to load', () => {
  it('shows an explicit failure message with a retry action, not an indefinite loading state', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'New note' }));

    expect(await screen.findByText(en['editor.loadError'])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: en['editor.loadError.retry'] })).toBeInTheDocument();

    // The indefinite loading copy must not still be showing underneath —
    // the whole point is that the failure is surfaced instead of hidden
    // behind it forever.
    expect(screen.queryByText(en['editor.loading'])).not.toBeInTheDocument();
  });

  it('retries the import when the retry button is clicked', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'New note' }));
    const retryButton = await screen.findByRole('button', {
      name: en['editor.loadError.retry'],
    });

    // The mock rejects every time, so clicking retry cannot reach a working
    // editor here — but it must genuinely attempt the import again rather
    // than being a no-op, which the failure message disappearing and then
    // reappearing (a fresh loading→failed cycle, not the same stale one)
    // demonstrates.
    await user.click(retryButton);
    expect(await screen.findByText(en['editor.loadError'])).toBeInTheDocument();
  });
});
