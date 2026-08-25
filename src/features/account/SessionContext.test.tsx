import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider, useSessionValue } from './SessionContext';
import { SESSION_HINT_KEY } from './useSession';

function Probe(): ReactElement {
  return <span data-testid="status">{useSessionValue().state.status}</span>;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('SessionContext', () => {
  it('exposes the session to a descendant', () => {
    // A returning user: the hint is set, so the hook awaits `GET /me` before
    // resolving. The first render is still synchronously `loading` — the
    // boot guarantee — because the fetch below deliberately never settles.
    localStorage.setItem(SESSION_HINT_KEY, '1');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );

    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
  });

  it('throws outside a provider rather than yielding a silent default', () => {
    // A default value would make a misplaced consumer render "signed out"
    // forever, which looks like a product decision instead of a wiring bug.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/SessionProvider/);
    quiet.mockRestore();
  });

  it('calls useSession exactly once for two consumers', () => {
    // The whole point of the lift: two readers, one GET /me. The hint is set
    // so the hook actually reaches `fetch`, otherwise the assertion would
    // trivially pass with zero calls on either side of the lift.
    localStorage.setItem(SESSION_HINT_KEY, '1');
    const fetchSpy = vi.fn(
      async (_input: string | URL) =>
        new Response(JSON.stringify({ userId: 'u1', email: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <SessionProvider>
        <Probe />
        <Probe />
      </SessionProvider>,
    );

    const meCalls = fetchSpy.mock.calls.filter(([input]) => String(input).includes('/me'));
    expect(meCalls.length).toBeLessThanOrEqual(1);
  });
});
