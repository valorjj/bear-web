import { describe, expect, it } from 'vitest';

import { mermaidSources } from './sources';

describe('mermaidSources', () => {
  it('finds a mermaid fence', () => {
    expect(mermaidSources('# T\n\n```mermaid\nflowchart TD\n  A --> B\n```\n')).toEqual([
      'flowchart TD\n  A --> B',
    ]);
  });

  it('ignores other languages', () => {
    expect(mermaidSources('```ts\nconst a = 1;\n```')).toEqual([]);
  });

  it('finds several', () => {
    const text = '```mermaid\nA\n```\n\ntext\n\n```mermaid\nB\n```';
    expect(mermaidSources(text)).toEqual(['A', 'B']);
  });

  it('does not treat a mermaid fence INSIDE another fence as a diagram', () => {
    // A note explaining Mermaid contains this. Getting it wrong means the app
    // renders a diagram out of documentation about diagrams.
    const text = '````markdown\n```mermaid\nflowchart TD\n  A --> B\n```\n````';
    expect(mermaidSources(text)).toEqual([]);
  });

  it('accepts a tilde fence', () => {
    expect(mermaidSources('~~~mermaid\nA\n~~~')).toEqual(['A']);
  });

  it('accepts an info string with trailing spaces', () => {
    expect(mermaidSources('```mermaid   \nA\n```')).toEqual(['A']);
  });

  it('ignores a fence with no closing marker', () => {
    // An unclosed fence at end of note is a half-typed block, not a diagram.
    expect(mermaidSources('```mermaid\nflowchart TD')).toEqual([]);
  });

  it('returns the source verbatim, including internal blank lines', () => {
    expect(mermaidSources('```mermaid\nflowchart TD\n\n  A --> B\n```')).toEqual([
      'flowchart TD\n\n  A --> B',
    ]);
  });

  it('deduplicates identical diagrams', () => {
    expect(mermaidSources('```mermaid\nA\n```\n```mermaid\nA\n```')).toEqual(['A']);
  });
});

describe('mermaidSources — CRLF input', () => {
  it('finds a fence whose opener and closer are CRLF-terminated', () => {
    expect(mermaidSources('```mermaid\r\nflowchart TD\r\n  A --> B\r\n```\r\n')).toEqual([
      'flowchart TD\n  A --> B',
    ]);
  });

  it('extracts a source with no stray carriage returns, so the cache key is stable', () => {
    const [source] = mermaidSources('```mermaid\r\nA\r\n```\r\n');
    expect(source).toBe('A');
    expect(source).not.toContain('\r');
  });
});
