import { describe, expect, it } from 'vitest';

import { footnoteNumbers } from './footnoteNumbers';
import { parseMarkdownDoc } from './markdown';

describe('footnoteNumbers', () => {
  const numbers = (markdown: string) => footnoteNumbers(parseMarkdownDoc(markdown));

  it('numbers by order of first reference, not by label', () => {
    const result = numbers('Alpha[^why] and beta[^when].\n\n[^when]: b\n\n[^why]: a');

    expect(result.get('why')).toBe(1);
    expect(result.get('when')).toBe(2);
  });

  it('gives a label referenced twice one number', () => {
    const result = numbers('A[^x] B[^x] C[^y].');

    expect(result.get('x')).toBe(1);
    expect(result.get('y')).toBe(2);
    expect(result.size).toBe(2);
  });

  it('gives an unreferenced definition no number', () => {
    const result = numbers('A[^x].\n\n[^x]: one\n\n[^orphan]: two');

    expect(result.has('orphan')).toBe(false);
  });

  it('numbers a marker whose definition is missing', () => {
    // Fail open: a marker written before its definition is the ordinary
    // mid-writing state, not an error.
    expect(numbers('A[^ghost].').get('ghost')).toBe(1);
  });

  it('renumbers when a reference is inserted in the middle', () => {
    const before = numbers('A[^one] C[^three].');
    const after = numbers('A[^one] B[^two] C[^three].');

    expect(before.get('three')).toBe(2);
    expect(after.get('three')).toBe(3);
  });

  it('is empty for a note with no footnotes', () => {
    expect(numbers('Just prose.').size).toBe(0);
  });
});
