import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { Pane } from './Pane';
import { Resizer } from './Resizer';
import { SidebarRow } from './SidebarRow';
import type { SidebarRowProps } from './SidebarRow';

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

describe('Button', () => {
  it('renders its children and calls onClick', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(<Button onClick={onClick}>New note</Button>);

    await user.click(screen.getByRole('button', { name: 'New note' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('never submits a form', () => {
    // There are no forms in bear-web. A button that defaults to type="submit"
    // would navigate the page if one ever appeared around it.
    render(<Button onClick={vi.fn()}>New note</Button>);

    expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
  });

  it('takes an explicit accessible name when its children are not text', () => {
    render(
      <Button onClick={vi.fn()} label="Delete">
        <span aria-hidden="true">×</span>
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Empty trash
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Empty trash' });
    expect(button).toBeDisabled();

    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  // Pins that `danger` resolves to the danger token and NOT to the accent
  // token. They are the same colour in both shipped themes, so nothing else
  // would notice a call site reaching for `accent` — until an M8 theme with a
  // green accent renders a green delete button.
  it('renders the danger variant from the danger token', () => {
    render(
      <Button onClick={vi.fn()} variant="danger">
        Delete forever
      </Button>,
    );

    expect(screen.getByRole('button', { name: 'Delete forever' }).className).toContain('bg-danger');
  });

  it('gives every variant a distinct appearance', () => {
    const variants = ['default', 'primary', 'danger', 'ghost'] as const;
    const classNames = variants.map((variant) => {
      const { unmount } = render(
        <Button onClick={vi.fn()} variant={variant}>
          {variant}
        </Button>,
      );
      const className = screen.getByRole('button', { name: variant }).className;
      unmount();
      return className;
    });

    expect(new Set(classNames).size).toBe(variants.length);
  });

  it('defaults to the default variant at md size', () => {
    const { unmount } = render(<Button onClick={vi.fn()}>Bare</Button>);
    const bare = screen.getByRole('button', { name: 'Bare' }).className;
    unmount();

    render(
      <Button onClick={vi.fn()} variant="default" size="md">
        Explicit
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Explicit' }).className).toBe(bare);
  });
});

describe('SidebarRow', () => {
  const base = { label: 'Work', selected: false, onSelect: vi.fn() };

  function renderRow(props: Partial<SidebarRowProps> = {}) {
    return render(
      <ul>
        <SidebarRow {...base} {...props} />
      </ul>,
    );
  }

  it('selects on click', async () => {
    const onSelect = vi.fn();
    renderRow({ onSelect });

    await userEvent.click(screen.getByRole('button', { name: /Work/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('marks the selected row with aria-current', () => {
    renderRow({ selected: true });
    expect(screen.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-current', 'page');
  });

  it('leaves an unselected row without aria-current', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /Work/ })).not.toHaveAttribute('aria-current');
  });

  it('honours an explicit aria-current value', () => {
    renderRow({ selected: true, current: 'true' });
    expect(screen.getByRole('button', { name: /Work/ })).toHaveAttribute('aria-current', 'true');
  });

  it('renders a count when given one', () => {
    renderRow({ count: 12 });
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders a zero count rather than hiding it', () => {
    // `count && <span>` would swallow 0 and make an empty smart list look
    // like a list with an unknown size.
    renderRow({ count: 0 });
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders no count element when count is omitted', () => {
    const { container } = renderRow();
    expect(container.querySelectorAll('[data-count]')).toHaveLength(0);
  });

  it('exposes a labelled disclosure that toggles', async () => {
    const onToggle = vi.fn();
    renderRow({ disclosure: { expanded: false, onToggle, label: 'Toggle' } });

    const row = screen.getByRole('button', { name: /Work/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('omits aria-expanded on a leaf row', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /Work/ })).not.toHaveAttribute('aria-expanded');
  });

  it('indents by depth', () => {
    const { container } = renderRow({ depth: 2 });
    const row = screen.getByRole('button', { name: /Work/ });
    expect(row.getAttribute('style')).toContain('padding-left');
    expect(container).toBeTruthy();
  });

  it('renders nested children', () => {
    renderRow({
      children: (
        <ul>
          <SidebarRow label="Urgent" selected={false} onSelect={vi.fn()} />
        </ul>
      ),
    });

    expect(screen.getByRole('button', { name: /Urgent/ })).toBeInTheDocument();
  });
});
