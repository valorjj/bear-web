import { describe, expect, it } from 'vitest';

import {
  clearedSessionCookie,
  cookieName,
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
    // No Domain attribute is necessary but not sufficient: it stops this
    // cookie being sent outward to a sibling subdomain, but does nothing to
    // stop lunch-api or docs-api setting Domain=.markflowing.com and shadowing
    // or injecting this cookie here. The __Host- prefix (see cookieName)
    // is what actually blocks that, by rejecting any cookie with a Domain
    // attribute at all.
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

describe('cookieName', () => {
  it('adds the __Host- prefix when secure', () => {
    expect(cookieName(SESSION_COOKIE, true)).toBe(`__Host-${SESSION_COOKIE}`);
  });

  it('keeps the bare name when not secure, since __Host- requires Secure', () => {
    expect(cookieName(SESSION_COOKIE, false)).toBe(SESSION_COOKIE);
  });
});

describe('sessionCookie name', () => {
  it('emits the __Host- prefixed name when secure', () => {
    expect(sessionCookie('tok', 60, true)).toMatch(/^__Host-mf_session=/);
  });

  it('emits the bare name when not secure', () => {
    expect(sessionCookie('tok', 60, false)).toMatch(/^mf_session=/);
  });
});

describe('txCookie name', () => {
  it('emits the __Host- prefixed name when secure', () => {
    expect(txCookie('payload', true)).toMatch(/^__Host-mf_oauth_tx=/);
  });

  it('emits the bare name when not secure', () => {
    expect(txCookie('payload', false)).toMatch(/^mf_oauth_tx=/);
  });
});
