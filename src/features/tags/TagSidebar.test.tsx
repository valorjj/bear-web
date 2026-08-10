import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ACTIVE_SCOPE, tagScope } from '@/features/notes';
import { renderWithI18n } from '@/i18n/testing';

import { TagSidebar } from './TagSidebar';
import type { TagNode } from './tagTree';

const tree: TagNode[] = [
  {
    tag: 'work',
    label: 'work',
    count: 3,
    children: [{ tag: 'work/urgent', label: 'urgent', count: 1, children: [] }],
  },
  { tag: 'home', label: 'home', count: 2, children: [] },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof TagSidebar>> = {}) {
  const onScopeChange = vi.fn();
  const onToggle = vi.fn();

  renderWithI18n(
    <TagSidebar
      nodes={tree}
      scope={ACTIVE_SCOPE}
      onScopeChange={onScopeChange}
      isCollapsed={() => false}
      onToggle={onToggle}
      {...overrides}
    />,
  );

  return { onScopeChange, onToggle };
}

describe('TagSidebar', () => {
  it('renders nothing while the tree is loading', () => {
    renderWithI18n(
      <TagSidebar
        nodes={undefined}
        scope={ACTIVE_SCOPE}
        onScopeChange={vi.fn()}
        isCollapsed={() => false}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /work/ })).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no tags', () => {
    renderSidebar({ nodes: [] });
    expect(screen.getByText('No tags yet')).toBeInTheDocument();
  });

  it('renders each node with its label and count', () => {
    renderSidebar();

    const nav = screen.getByRole('navigation', { name: 'Tags' });
    expect(within(nav).getByRole('button', { name: /^work\b/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^urgent\b/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^home\b/ })).toBeInTheDocument();
    expect(within(nav).getByText('3')).toBeInTheDocument();
  });

  it('selects the full tag key, not the label', async () => {
    const { onScopeChange } = renderSidebar();

    await userEvent.click(screen.getByRole('button', { name: /^urgent\b/ }));

    expect(onScopeChange).toHaveBeenCalledWith(tagScope('work/urgent'));
  });

  it('marks the selected tag as current', () => {
    renderSidebar({ scope: tagScope('work/urgent') });

    expect(screen.getByRole('button', { name: /^urgent\b/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('button', { name: /^work\b/ })).not.toHaveAttribute('aria-current');
  });

  it('hides children when a node is collapsed', () => {
    renderSidebar({ isCollapsed: (tag) => tag === 'work' });

    expect(screen.queryByRole('button', { name: /^urgent\b/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^work\b/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('offers a toggle only on a node that has children', () => {
    renderSidebar();

    const workRow = screen.getByRole('button', { name: /^work\b/ }).closest('li')!;
    const homeRow = screen.getByRole('button', { name: /^home\b/ }).closest('li')!;

    expect(within(workRow).getByRole('button', { name: 'Expand or collapse' })).toBeInTheDocument();
    expect(
      within(homeRow).queryByRole('button', { name: 'Expand or collapse' }),
    ).not.toBeInTheDocument();
  });

  it('toggles the node it belongs to', async () => {
    const { onToggle, onScopeChange } = renderSidebar();

    const workRow = screen.getByRole('button', { name: /^work\b/ }).closest('li')!;
    await userEvent.click(within(workRow).getByRole('button', { name: 'Expand or collapse' }));

    expect(onToggle).toHaveBeenCalledWith('work');
    // Toggling must not also change the scope.
    expect(onScopeChange).not.toHaveBeenCalled();
  });
});
