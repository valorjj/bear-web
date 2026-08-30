import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { db, notes } from '@/data';
import { I18nProvider } from '@/i18n';

import { BacklinksPanel } from './BacklinksPanel';

/**
 * Real Dexie (fake-indexeddb) throughout, matching `notes.test.ts` and
 * `AppShell.test.tsx` — `notes.linksTo` is exercised for real, not mocked, so
 * these tests catch a wrong query the same way a stubbed repository could
 * not.
 */
beforeEach(async () => {
  await db.open();
  await Promise.all([db.notes.clear(), db.noteLinks.clear()]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPanel(title: string, onOpenNote: (id: string) => void) {
  return render(
    <I18nProvider locale="en">
      <BacklinksPanel title={title} onOpenNote={onOpenNote} />
    </I18nProvider>,
  );
}

describe('BacklinksPanel', () => {
  it('renders nothing when there are no backlinks', async () => {
    await notes.create('Solo note\n\nno links here');

    const { container } = renderPanel('Solo note', vi.fn());

    // Give the live query a chance to resolve before asserting absence —
    // otherwise this would pass trivially on "not loaded yet" rather than on
    // "loaded, and there are none".
    await waitFor(async () => {
      expect(await notes.linksTo('solo note')).toHaveLength(0);
    });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('lists each linking note by title', async () => {
    await notes.create('Target note');
    await notes.create('Referrer One\n\nsee [[Target note]]');
    await notes.create('Referrer Two\n\nsee [[Target note]]');

    renderPanel('Target note', vi.fn());

    expect(await screen.findByText('Referrer One')).toBeInTheDocument();
    expect(await screen.findByText('Referrer Two')).toBeInTheDocument();
  });

  it("calls onOpenNote with the clicked row's note id", async () => {
    const user = userEvent.setup();
    await notes.create('Target note');
    const referrer = await notes.create('Referrer\n\nsee [[Target note]]');

    const onOpenNote = vi.fn();
    renderPanel('Target note', onOpenNote);

    const row = await screen.findByText('Referrer');
    await user.click(row);

    expect(onOpenNote).toHaveBeenCalledTimes(1);
    expect(onOpenNote).toHaveBeenCalledWith(referrer.id);
  });

  it('shows a count in the header that matches the number of rows', async () => {
    await notes.create('Target note');
    await notes.create('Referrer One\n\nsee [[Target note]]');
    await notes.create('Referrer Two\n\nsee [[Target note]]');
    await notes.create('Referrer Three\n\nsee [[Target note]]');

    renderPanel('Target note', vi.fn());

    // A specific count, not "greater than zero" — that would pass against an
    // implementation counting something unrelated entirely. The exact-text
    // match (rather than a substring) also stops "3" passing against a
    // count of, say, 13.
    const heading = await screen.findByRole('heading');
    await waitFor(() => {
      expect(heading.textContent).toBe('Linked from 3');
    });
  });
});
