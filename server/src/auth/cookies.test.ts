import { describe, expect, it } from 'vitest';

import {
  clearedSessionCookie,
  readCookie,
  SESSION_COOKIE,
  sessionCookie,
  txCookie,
} from './cookies.ts';

describe('sessionCookie', () => {
  const cookie = sessionCookie('tok', 2_592_000, true);

  it('is not readable by JavaScript', () => {
    expect(cookie).toContain('HttpOnly');
  });

  it('carries no Domain attribute', () => {
    // Host-only, deliberately. A Domain=.markflowing.com cookie would be sent
    // to lunch-api and docs-api, which belong to unrelated projects.
    expect(cookie).not.toContain('Domain');
  });

  it('is Lax, not Strict', () => {
    // Strict would be dropped on the redirect back from Google, so the user
    // would land on the app still signed out. Lax is sent on top-level
    // navigation, and the app and API are same-site, so it is also sent on the
    // app's fetch calls.
    expect(cookie).toContain('SameSite=Lax');
  });

  it('is Secure and site-wide in path', () => {
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
  });

  it('drops Secure only when explicitly insecure, for http://localhost', () => {
    expect(sessionCookie('tok', 60, false)).not.toContain('Secure');
  });
});

describe('clearedSessionCookie', () => {
  it('expires immediately', () => {
    expect(clearedSessionCookie(true)).toContain('Max-Age=0');
  });
});

describe('txCookie', () => {
  it('is short-lived and Lax so it survives the provider redirect', () => {
    const cookie = txCookie('payload', true);

    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toMatch(/Max-Age=6\d\d/);
  });
});

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=tok; b=2`, SESSION_COOKIE)).toBe('tok');
  });

  it('returns null for a missing header', () => {
    expect(readCookie(undefined, SESSION_COOKIE)).toBeNull();
  });

  it('does not match a cookie whose name merely ends the same way', () => {
    expect(readCookie(`x_${SESSION_COOKIE}=nope`, SESSION_COOKIE)).toBeNull();
  });
});
