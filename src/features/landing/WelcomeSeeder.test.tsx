import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LANDING_SEEN_KEY } from './gate';
import { WelcomeSeeder } from './WelcomeSeeder';

const seed = vi.fn(async (..._args: unknown[]) => true);
vi.mock('./seedWelcomeNote', () => ({ seedWelcomeNote: (...args: unknown[]) => seed(...args) }));

let session = { status: 'signedOut' as string };
let sync = { status: 'idle' as string, lastSyncedAt: null as number | null };

vi.mock('@/features/account', () => ({
  useSessionValue: () => ({ state: session }),
  useSyncValue: () => sync,
}));

// `useLocale` requires an `I18nProvider` ancestor and this component renders
// with none, so the locale value is mocked directly rather than wrapping
// every `render()` call in a provider unrelated to what these tests assert.
vi.mock('@/i18n', () => ({ useLocale: () => ({ locale: 'en', setLocale: vi.fn() }) }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(LANDING_SEEN_KEY, '1');
  seed.mockClear();
  session = { status: 'signedOut' };
  sync = { status: 'idle', lastSyncedAt: null };
});

describe('WelcomeSeeder', () => {
  it('seeds immediately for a signed-out visitor', async () => {
    render(<WelcomeSeeder />);
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
  });

  it('renders nothing', () => {
    const { container } = render(<WelcomeSeeder />);
    expect(container).toBeEmptyDOMElement();
  });

  // A signed-in device must not seed before its account's notes have arrived,
  // or every device after the first receives a duplicate.
  it('does NOT seed while a signed-in device is still syncing', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'syncing', lastSyncedAt: null };
    render(<WelcomeSeeder />);
    await new Promise((r) => setTimeout(r, 10));
    expect(seed).not.toHaveBeenCalled();
  });

  // "Settled" is lastSyncedAt, not an idle/syncing transition. A sync that
  // completes before this component mounts never shows a `syncing` status
  // here, and a transition-based rule would then miss the seed on every boot.
  it('seeds once a signed-in device has completed a sync', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'idle', lastSyncedAt: 1_700_000_000_000 };
    render(<WelcomeSeeder />);
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
  });

  it('does NOT seed for a signed-in device that has never synced', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'idle', lastSyncedAt: null };
    render(<WelcomeSeeder />);
    await new Promise((r) => setTimeout(r, 10));
    expect(seed).not.toHaveBeenCalled();
  });

  it('does NOT seed while the server is unreachable', async () => {
    session = { status: 'signedIn' };
    sync = { status: 'offline', lastSyncedAt: null };
    render(<WelcomeSeeder />);
    await new Promise((r) => setTimeout(r, 10));
    expect(seed).not.toHaveBeenCalled();
  });

  it('seeds at most once across re-renders', async () => {
    const { rerender } = render(<WelcomeSeeder />);
    await waitFor(() => expect(seed).toHaveBeenCalledTimes(1));
    rerender(<WelcomeSeeder />);
    rerender(<WelcomeSeeder />);
    expect(seed).toHaveBeenCalledTimes(1);
  });
});
