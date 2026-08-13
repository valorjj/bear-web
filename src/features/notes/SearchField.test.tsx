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
