import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SESSION_HINT_KEY } from '@/data';
import { I18nProvider } from '@/i18n';

import { Landing } from './Landing';

function mount(handler: (url: string) => Response, locale?: 'en' | 'ko') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => handler(String(input))),
  );
  const onEnter = vi.fn();
  render(
    <I18nProvider locale={locale}>
      <Landing onEnter={onEnter} />
    </I18nProvider>,
  );
  return onEnter;
}

const signedIn = () =>
  new Response(JSON.stringify({ userId: 'u1', email: 'a@example.com' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const signedOut = () => new Response('{}', { status: 401 });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Landing', () => {
  it('offers both ways in', async () => {
    mount(signedOut);
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue as guest' })).toBeInTheDocument();
  });

  it('names the app in a heading', async () => {
    mount(signedOut);
    expect(await screen.findByRole('heading', { name: 'markflowing' })).toBeInTheDocument();
  });

  it('enters immediately on the guest choice', async () => {
    const onEnter = mount(signedOut);
    await userEvent.click(await screen.findByRole('button', { name: 'Continue as guest' }));
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  // The whole point of the asymmetry: an abandoned OAuth trip must return to
  // this screen, not to a signed-out app with no explanation. Writing the
  // flag on click would make that impossible.
  it('does NOT enter on the sign-in click', async () => {
    const originalLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    });

    try {
      const onEnter = mount(signedOut);
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' }));
      expect(assign).toHaveBeenCalledTimes(1);
      expect(onEnter).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });

  it('enters once the session resolves signed in', async () => {
    // No hint set: useSession resolves signedOut without a fetch, so seed the
    // hint to reach the real /me path that produces signedIn.
    localStorage.setItem(SESSION_HINT_KEY, '1');
    const onEnter = mount(signedIn);
    await waitFor(() => expect(onEnter).toHaveBeenCalledTimes(1));
  });

  it('does not enter when the server is unavailable', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    const onEnter = mount(() => {
      throw new TypeError('Failed to fetch');
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue as guest' })).toBeInTheDocument(),
    );
    expect(onEnter).not.toHaveBeenCalled();
  });

  // signIn() writes SESSION_HINT_KEY before navigating away, so the boot after
  // the redirect starts in `loading` WITH the hint. Rendering the buttons then
  // flashes them on every return from Google.
  it('shows a pending state while resolving a returning sign-in', async () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    // Never resolve, so the session stays in `loading` for the assertion.
    mount(() => new Promise<Response>(() => {}) as unknown as Response);
    expect(await screen.findByText('Signing you in…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument();
  });

  it('shows the buttons while loading with no prior session', async () => {
    // No hint in storage: useSession resolves signedOut synchronously with no
    // fetch at all, so the buttons are the very first thing rendered.
    mount(signedOut);
    expect(await screen.findByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('renders in Korean', async () => {
    mount(signedOut, 'ko');
    expect(await screen.findByRole('heading', { name: 'markflowing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Google로 로그인' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '게스트로 계속하기' })).toBeInTheDocument();
  });
});
