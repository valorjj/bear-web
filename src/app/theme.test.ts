import { beforeEach, describe, expect, it } from 'vitest';

import { applyTheme, MIRROR_KEY, readMirror, writeMirror } from './theme';

describe('the paint-time mirror', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('round-trips a choice', () => {
    writeMirror('indigo-dark');
    expect(readMirror()).toBe('indigo-dark');
  });

  it('falls back to system when nothing is stored', () => {
    expect(readMirror()).toBe('system');
  });

  // The mirror is written by a script that predates React and read by one that
  // predates it too. A value that is not a known theme must not reach
  // `data-theme`, or an entry left by an older build paints an unstyled app.
  it('falls back to system when the stored value is not a known theme', () => {
    localStorage.setItem(MIRROR_KEY, 'dracula');
    expect(readMirror()).toBe('system');
  });

  it('accepts every id in the roster', () => {
    for (const id of ['indigo-light', 'indigo-dark', 'paper', 'ink', 'high-contrast']) {
      localStorage.setItem(MIRROR_KEY, id);
      expect(readMirror(), `${id} was rejected`).toBe(id);
    }
  });

  it('stamps the attribute for a named theme', () => {
    applyTheme('paper');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper');
  });

  // System means the ABSENCE of the attribute, so the media query decides.
  // Writing `data-theme="system"` would match no block and leave the `:root`
  // fallback painting a light app for someone whose OS is dark.
  it('removes the attribute for system', () => {
    applyTheme('ink');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
