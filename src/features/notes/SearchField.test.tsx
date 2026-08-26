import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { SearchField } from './SearchField';

function renderField(query = '', onQueryChange = vi.fn()) {
  renderWithI18n(<SearchField query={query} onQueryChange={onQueryChange} />);
  return { onQueryChange };
}

// `SearchField` is controlled: typing a character re-renders with whatever
// `query` the parent hands back. A bare `vi.fn()` never updates `query`, so
// the DOM value resets to the stale prop after every keystroke and each
// `onQueryChange` call reports only the single character just typed, not the
// accumulated string. This harness mirrors how `AppShell` actually wires the
// field — holding real state — so typing "milk" accumulates as it would for
// a real user.
function ControlledHarness() {
  const [query, setQuery] = useState('');
  return <SearchField query={query} onQueryChange={setQuery} />;
}

describe('SearchField', () => {
  it('reports what the user types', async () => {
    renderWithI18n(<ControlledHarness />);
    const input = screen.getByRole('searchbox', { name: 'Search notes' });
    await userEvent.type(input, 'milk');
    expect(input).toHaveValue('milk');
  });

  it('offers no clear button when the field is empty', () => {
    renderField('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });

  it('clears the query from the clear button', async () => {
    const { onQueryChange } = renderField('milk');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('clears the query on Escape', async () => {
    const { onQueryChange } = renderField('milk');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search notes' }), '{Escape}');
    expect(onQueryChange).toHaveBeenCalledWith('');
  });
});

describe('collapsible', () => {
  it('renders as a button until opened', async () => {
    const user = userEvent.setup();
    renderWithI18n(<SearchField query="" onQueryChange={vi.fn()} collapsible />);

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show search' }));

    // Focused on open, or the tap costs a second one to start typing.
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('names the opener differently from the field it opens', () => {
    // Two controls with the same accessible name are ambiguous to anyone
    // reaching for either — the same reason the scope button is named
    // "List options: {scope}" and not "Notes".
    renderWithI18n(<SearchField query="" onQueryChange={vi.fn()} collapsible />);

    expect(screen.getByRole('button', { name: 'Show search' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Search notes' })).not.toBeInTheDocument();
  });

  it('stays an always-visible field when not collapsible', () => {
    renderWithI18n(<SearchField query="" onQueryChange={vi.fn()} />);

    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show search' })).not.toBeInTheDocument();
  });

  it('stays open while a query is active, so the user can see what is filtering', async () => {
    const user = userEvent.setup();
    renderWithI18n(<SearchField query="milk" onQueryChange={vi.fn()} collapsible />);

    expect(screen.getByRole('searchbox')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
  });

  it('takes a 16px font, which is what stops iOS zooming the page on focus', () => {
    // `--bear-text-ui` is 13px, and Safari zooms the viewport when an input
    // below 16px takes focus, leaving the user zoomed in with no way back but
    // pinching. `--bear-text-ui-lg` is exactly 1rem. This is a class-name
    // check and therefore weak; `e2e/mobile.spec.ts` asserts the COMPUTED
    // font-size, which is what can actually fail if the token changes.
    renderWithI18n(<SearchField query="" onQueryChange={vi.fn()} collapsible open />);

    expect(screen.getByRole('searchbox').className).toContain('text-ui-lg');
  });
});
