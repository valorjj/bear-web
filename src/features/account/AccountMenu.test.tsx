import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { AccountMenu } from './AccountMenu';
import { SessionProvider } from './SessionContext';
import { SESSION_HINT_KEY } from './useSession';

function mount(handler: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => handler(String(input))),
  );
  return render(
    <I18nProvider>
      <SessionProvider>
        <AccountMenu />
      </SessionProvider>
    </I18nProvider>,
  );
}

const signedIn = () =>
  new Response(JSON.stringify({ userId: 'u1', email: 'a@example.com' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

beforeEach(() => {
  localStorage.clear();
  // A returning user. Without the hint the hook never calls `/me` at all, so
  // every signed-in case below would render the signed-out menu.
  localStorage.setItem(SESSION_HINT_KEY, '1');
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('AccountMenu', () => {
  it('offers Google sign-in when signed out', async () => {
    mount(() => new Response('{}', { status: 401 }));

    await userEvent.click(await screen.findByRole('button', { name: /account/i }));

    expect(screen.getByRole('menuitem', { name: /sign in with google/i })).toBeInTheDocument();
  });

  it('shows the signed-in address and a sign-out row', async () => {
    mount(signedIn);

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    expect(screen.getByText('a@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('states where the notes are in every state, not only when signed in', async () => {
    // The statement is the menu's headline and is deliberately identical in
    // all states: in D1 signing in moves no note off this device, so a menu
    // that changed its answer here would be claiming a sync that does not
    // exist. Asserted on the signed-OUT state, because that is the one a
    // signed-in-only check would let regress.
    mount(() => new Response('{}', { status: 401 }));

    await userEvent.click(await screen.findByRole('button', { name: /account/i }));

    expect(screen.getByText(/stay on this device/i)).toBeInTheDocument();
    expect(screen.getByText(/not signed in/i)).toBeInTheDocument();
  });

  it('discloses that notes stay on the device', async () => {
    // Required by the spec, not decoration: the ruling that logout leaves
    // notes behind is only defensible if the user is told.
    mount(signedIn);

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    expect(screen.getByText(/stay on this device/i)).toBeInTheDocument();
  });

  it('says the server is unreachable rather than claiming signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(
      <I18nProvider>
        <SessionProvider>
          <AccountMenu />
        </SessionProvider>
      </I18nProvider>,
    );

    await userEvent.click(await screen.findByRole('button', { name: /account/i }));

    expect(screen.getByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /sign out/i })).not.toBeInTheDocument();
  });

  it('is announced as a menu trigger', async () => {
    mount(() => new Response('{}', { status: 401 }));

    const trigger = await screen.findByRole('button', { name: /account/i });

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the image usage meter', () => {
  const usage = (used: number, limit: number) =>
    new Response(JSON.stringify({ used, limit }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  function route(usageResponse: () => Response) {
    return (url: string) => (url.includes('/files/usage') ? usageResponse() : signedIn());
  }

  it('shows what is used against the server’s own limit', async () => {
    mount(route(() => usage(512 * 1024 * 1024, 2 * 1024 ** 3)));

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    // A specific rendered string, not merely "a meter exists". A formatter
    // dividing by 1000, or one reading a hardcoded limit, both fail here.
    expect(await screen.findByText('512 MB of 2 GB')).toBeInTheDocument();
  });

  it('reports the fraction through the progressbar, not only in text', async () => {
    mount(route(() => usage(1024 ** 3, 2 * 1024 ** 3)));

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    const bar = await screen.findByRole('progressbar', { name: 'Images' });
    expect(bar).toHaveAttribute('aria-valuenow', String(1024 ** 3));
    expect(bar).toHaveAttribute('aria-valuemax', String(2 * 1024 ** 3));
  });

  it('says Images, never Storage — the quota counts image bytes only', async () => {
    mount(route(() => usage(1, 2 * 1024 ** 3)));

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    expect(await screen.findByText('Images')).toBeInTheDocument();
    expect(screen.queryByText(/storage/i)).toBeNull();
  });

  it('draws nothing at all when the server cannot be reached', async () => {
    mount((url) => (url.includes('/files/usage') ? new Response('', { status: 500 }) : signedIn()));

    await waitFor(() => expect(screen.getByRole('button', { name: /account/i })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: /account/i }));

    // Absent, not an error line: the user opened this menu to do something
    // else, and a failed background fetch is not their problem to read about.
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no meter at all when signed out', async () => {
    mount(() => new Response('{}', { status: 401 }));

    await userEvent.click(await screen.findByRole('button', { name: /account/i }));

    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
