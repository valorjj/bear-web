import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as data from '@/data';
import { db } from '@/data';
import { I18nProvider } from '@/i18n';

import { ImportGate } from './useImportGate';

function page(text: string, title = 'Shared'): string {
  const json = JSON.stringify({ title, text });
  return `<!doctype html><html lang="en"><body><script type="application/json" id="bear-source">${json}</script></body></html>`;
}

function setUrl(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

describe('ImportGate', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all([db.notes.clear(), db.files.clear(), db.syncState.clear()]);
    setUrl('');
    // The stash lives in sessionStorage, which (unlike IndexedDB above)
    // nothing else in this suite clears between tests.
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does nothing without an import parameter', () => {
    const doFetch = vi.fn();
    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    expect(doFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the note named by the parameter, writing nothing yet', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n\nbody\n')));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Shared')).toBeInTheDocument();
    // The confirmation is the point: nothing is in the database yet.
    expect(await db.notes.count()).toBe(0);
  });

  it('writes the note on confirm and clears the URL', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n\nbody\n')));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add to my notes' }));

    await waitFor(async () => expect(await db.notes.count()).toBe(1));
    expect(window.location.search).toBe('');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('writes nothing on cancel, and still clears the URL', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n')));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await db.notes.count()).toBe(0);
    // Cleared on cancel too: otherwise a reload re-offers a note the user has
    // already declined.
    expect(window.location.search).toBe('');
  });

  it('reports a failure for a page that carries no payload', async () => {
    setUrl('?import=old');
    const doFetch = vi.fn(async () => new Response('<!doctype html><html><body>hi</body></html>'));

    render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('This note could not be added.')).toBeInTheDocument(),
    );
    expect(await db.notes.count()).toBe(0);
  });

  it('fetches once, not once per render', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n')));
    // A NEW function reference on every render, deliberately: if the effect
    // were guarded only by its dependency array (`[fetch]`), a changed
    // reference would make it re-run and re-fetch. Passing the same `doFetch`
    // reference on both renders would leave the dependency array unchanged,
    // which lets a broken (missing ref-guard) implementation pass by
    // accident — this only proves the guard if the dependency actually
    // changes between renders.
    const wrap = () => (() => doFetch()) as unknown as typeof fetch;

    const { rerender } = render(
      <I18nProvider>
        <ImportGate fetch={wrap()} />
      </I18nProvider>,
    );
    rerender(
      <I18nProvider>
        <ImportGate fetch={wrap()} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it('survives a full navigation away and back, and clears the stash on confirm', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n\nbody\n')));

    // First "page load": the id is read from the URL and stashed.
    const first = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    first.unmount();

    // Simulate the OAuth round trip: "Sign in with Google" is a real
    // `window.location.assign` away from this origin and the server's
    // callback redirects back with no query string at all. sessionStorage
    // survives that; the URL does not.
    setUrl('');

    const second = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('Shared')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Add to my notes' }));
    await waitFor(async () => expect(await db.notes.count()).toBe(1));
    second.unmount();

    // A third "page load" with nothing in the URL and nothing left stashed:
    // the note the user already added is not offered again.
    const third = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(2);
    third.unmount();
  });

  it('clears the stash on cancel too, not just the URL', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n')));

    const first = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    first.unmount();

    setUrl('');
    const second = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it('clears the parameter and stash when the write itself fails, not just on cancel', async () => {
    setUrl('?import=page1');
    const doFetch = vi.fn(async () => new Response(page('Shared\n\nbody\n')));
    vi.spyOn(data, 'importNote').mockRejectedValueOnce(new Error('boom'));

    const first = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add to my notes' }));

    await waitFor(() =>
      expect(screen.getByText('This note could not be added.')).toBeInTheDocument(),
    );
    // Cleared immediately on the rejection, not only when Cancel is later
    // clicked: `importNote` creates the note before its image loop, so a
    // rejected write may already have left a partial note behind, and a
    // reload before the user dismisses the failure must not re-offer it.
    expect(window.location.search).toBe('');
    first.unmount();

    setUrl('');
    const second = render(
      <I18nProvider>
        <ImportGate fetch={doFetch as unknown as typeof globalThis.fetch} />
      </I18nProvider>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(doFetch).toHaveBeenCalledTimes(1);
    second.unmount();
  });
});
