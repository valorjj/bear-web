import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadBlob } from './download';

describe('downloadBlob', () => {
  let created: string[];
  let revoked: string[];

  beforeEach(() => {
    created = [];
    revoked = [];
    vi.useFakeTimers();

    // jsdom implements neither of these.
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (): string => {
        const url = `blob:test/${String(created.length)}`;
        created.push(url);
        return url;
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: (url: string): void => void revoked.push(url),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clicks an anchor carrying the filename, then removes it', () => {
    const clicks: string[] = [];
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement): void {
      clicks.push(this.download);
    };

    try {
      downloadBlob('Groceries.md', new Blob(['milk'], { type: 'text/markdown' }));
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }

    expect(clicks).toEqual(['Groceries.md']);
    // No stray anchor may survive: this runs once per export, and a leaked
    // element per call would accumulate for the page's lifetime.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('revokes the object URL, but only after the current task', () => {
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = (): void => {};

    try {
      downloadBlob('note.md', new Blob(['x']));
    } finally {
      HTMLAnchorElement.prototype.click = original;
    }

    expect(created).toHaveLength(1);
    // Revoking in the same task as the click cancels the download in some
    // browsers, because the blob fetch has not started yet. If this ever
    // becomes synchronous, downloads break in a way no assertion on the
    // anchor could see.
    expect(revoked).toEqual([]);

    vi.runAllTimers();
    expect(revoked).toEqual(created);
  });
});
