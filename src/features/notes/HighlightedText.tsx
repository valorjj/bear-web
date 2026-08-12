import { Fragment, type ReactElement } from 'react';

import { findMatchRanges } from './search';

export interface HighlightedTextProps {
  text: string;
  query?: string;
}

/**
 * `text` with every occurrence of `query` marked.
 *
 * The accent colour rather than a background: the selected row is already
 * filled with `--bear-selected`, so a background highlight would disappear on
 * exactly the row the user is looking at.
 *
 * Renders `text.normalize('NFC')`, because that is the string
 * `findMatchRanges` indexes into. Slicing the raw text with those indices
 * would cut decomposed Hangul mid-syllable.
 */
export function HighlightedText({ text, query }: HighlightedTextProps): ReactElement {
  const source = text.normalize('NFC');
  const ranges = query === undefined ? [] : findMatchRanges(text, query);

  if (ranges.length === 0) return <>{source}</>;

  const parts: ReactElement[] = [];
  let cursor = 0;

  ranges.forEach((range, index) => {
    if (range.start > cursor) {
      parts.push(<Fragment key={`t${index}`}>{source.slice(cursor, range.start)}</Fragment>);
    }
    parts.push(
      <span key={`m${index}`} data-match="" className="font-semibold text-accent">
        {source.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });

  if (cursor < source.length) {
    parts.push(<Fragment key="tail">{source.slice(cursor)}</Fragment>);
  }

  return <>{parts}</>;
}
