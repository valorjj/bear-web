import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EmptyState } from './EmptyState';
import { Pane } from './Pane';
import { Resizer } from './Resizer';

// Local to this file. `src/ui` must not import from `src/app`.
const MIN = 160;
const MAX = 560;

describe('Pane', () => {
  it('exposes an accessible region with its label', () => {
    render(
      <Pane label="Sidebar">
        <p>content</p>
      </Pane>,
    );

    expect(screen.getByRole('region', { name: 'Sidebar' })).toBeInTheDocument();
  });

  it('applies an explicit width as an inline style', () => {
    render(
      <Pane label="Sidebar" width={280}>
        content
      </Pane>,
    );

    expect(screen.getByRole('region', { name: 'Sidebar' })).toHaveStyle({ width: '280px' });
  });

  it('grows to fill when no width is given', () => {
    render(<Pane label="Editor">content</Pane>);

    expect(screen.getByRole('region', { name: 'Editor' })).not.toHaveStyle({ width: '240px' });
  });
});

describe('EmptyState', () => {
  it('renders its title and body', () => {
    render(<EmptyState title="No notes" body="Notes you create appear here." />);

    expect(screen.getByText('No notes')).toBeInTheDocument();
    expect(screen.getByText('Notes you create appear here.')).toBeInTheDocument();
  });
});

describe('Resizer', () => {
  const props = { label: 'Resize the sidebar', min: MIN, max: MAX };

  it('exposes a separator with its label, value, and bounds', () => {
    render(<Resizer {...props} width={240} onResize={vi.fn()} onCommit={vi.fn()} />);

    const separator = screen.getByRole('separator', { name: 'Resize the sidebar' });
    expect(separator).toHaveAttribute('aria-valuenow', '240');
    expect(separator).toHaveAttribute('aria-valuemin', String(MIN));
    expect(separator).toHaveAttribute('aria-valuemax', String(MAX));
    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  });

  it('widens on ArrowRight and narrows on ArrowLeft', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();

    render(<Resizer {...props} width={240} onResize={vi.fn()} onCommit={onCommit} />);

    screen.getByRole('separator').focus();

    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenLastCalledWith(250);

    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(230);
  });

  it('clamps keyboard resizing at both boundaries', async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();

    const { rerender } = render(
      <Resizer {...props} width={MIN} onResize={vi.fn()} onCommit={onCommit} />,
    );

    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowLeft}');
    expect(onCommit).toHaveBeenLastCalledWith(MIN);

    rerender(<Resizer {...props} width={MAX} onResize={vi.fn()} onCommit={onCommit} />);
    screen.getByRole('separator').focus();
    await user.keyboard('{ArrowRight}');
    expect(onCommit).toHaveBeenLastCalledWith(MAX);
  });

  it('is reachable by keyboard', () => {
    render(<Resizer {...props} width={240} onResize={vi.fn()} onCommit={vi.fn()} />);

    expect(screen.getByRole('separator')).toHaveAttribute('tabindex', '0');
  });
});
