import { describe, expect, it } from 'vitest';

import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('uses whole bytes below a kilobyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('drops the decimal for kilobytes, which nobody reads at that scale', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(12_800)).toBe('13 KB');
  });

  it('keeps one decimal from megabytes up, where the digit carries meaning', () => {
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2 GB');
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1.3 GB');
  });

  it('drops a trailing .0 rather than printing "2.0 GB"', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });

  it('uses 1024, matching the quota it is asked to describe', () => {
    // `IMAGE_QUOTA_BYTES` is `2 * 1024 ** 3`. A formatter dividing by 1000
    // would render that as "2.1 GB" and the meter would read as though the
    // user had been given more room than the server will actually allow.
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
  });

  it('never renders a negative or non-finite figure as a unit', () => {
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});
