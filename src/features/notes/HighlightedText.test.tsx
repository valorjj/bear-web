import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HighlightedText } from './HighlightedText';

describe('HighlightedText', () => {
  it('renders the plain text when there is no query', () => {
    render(<HighlightedText text="milk and bread" />);
    expect(screen.getByText('milk and bread')).toBeInTheDocument();
  });

  it('renders the plain text when nothing matches', () => {
    render(<HighlightedText text="milk and bread" query="zzz" />);
    expect(screen.getByText('milk and bread')).toBeInTheDocument();
  });

  it('marks the matching run', () => {
    const { container } = render(<HighlightedText text="milk and bread" query="and" />);
    const marks = container.querySelectorAll('[data-match]');
    expect(marks).toHaveLength(1);
    expect(marks[0]?.textContent).toBe('and');
  });

  it('marks every occurrence', () => {
    const { container } = render(<HighlightedText text="milk milk" query="milk" />);
    expect(container.querySelectorAll('[data-match]')).toHaveLength(2);
  });

  // The whole string must survive, in order — a highlighter that drops the
  // unmatched runs would still satisfy the assertions above.
  it('preserves the complete text', () => {
    const { container } = render(<HighlightedText text="milk and bread" query="and" />);
    expect(container.textContent).toBe('milk and bread');
  });

  it('renders composed Hangul, so the marked run lands on the right characters', () => {
    const decomposed = `${'가'.normalize('NFD')} milk`; // NFD '가 milk'
    const { container } = render(<HighlightedText text={decomposed} query="milk" />);
    expect(container.textContent).toBe('가 milk');
    expect(container.querySelector('[data-match]')?.textContent).toBe('milk');
  });
});
