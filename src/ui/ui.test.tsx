import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { Pane } from './Pane';
import { Popover } from './Popover';
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

  it('separates label and count in the accessible name', () => {
    // A CSS gap does not separate text for accessible-name computation. Without
    // an explicit space this row announces as "work12", not "work 12".
    renderRow({ label: 'work', count: 12 });
    expect(screen.getByRole('button', { name: 'work 12' })).toBeInTheDocument();
  });

  it('renders a zero count in the count element rather than hiding it', () => {
    // Not `getByText('0')`: with the `{count && …}` bug React renders a bare
    // `0` text node, which that query happily finds — so it passes for the
    // bug and the fix alike. Asserting the count ELEMENT carries the text is
    // what distinguishes them. An empty smart list must read "0", not blank,
    // which is indistinguishable from "count unknown".
    const { container } = renderRow({ count: 0 });
    expect(container.querySelector('[data-count]')).toHaveTextContent('0');
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

describe('ConfirmDialog', () => {
  const props = {
    open: true,
    title: 'Delete forever?',
    body: 'This cannot be undone.',
    confirmLabel: 'Delete forever',
    cancelLabel: 'Cancel',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders nothing when closed', () => {
    render(<ConfirmDialog {...props} open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('exposes an alertdialog labelled by its title', () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const dialog = screen.getByRole('alertdialog', { name: 'Delete forever?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
  });

  it('focuses cancel on open, not confirm', () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    // An Enter keypress already in flight must not destroy anything.
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('confirms and cancels through their buttons', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    rerender(<ConfirmDialog {...props} onConfirm={onConfirm} onCancel={onCancel} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('cancels on Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not cancel on Escape when closed', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog {...props} open={false} onConfirm={vi.fn()} onCancel={onCancel} />);

    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('traps Tab inside the dialog', async () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'Delete forever' });

    expect(cancel).toHaveFocus();
    await userEvent.tab();
    expect(confirm).toHaveFocus();
    // Wrapping is the trap: focus must not escape to the document body.
    await userEvent.tab();
    expect(cancel).toHaveFocus();
  });

  it('wraps backwards too', async () => {
    render(<ConfirmDialog {...props} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Delete forever' })).toHaveFocus();
  });
});

describe('Popover', () => {
  it('renders nothing when closed', () => {
    render(
      <Popover open={false} onClose={() => {}} label="Appearance">
        <button>x</button>
      </Popover>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names itself for assistive tech', () => {
    render(
      <Popover open onClose={() => {}} label="Appearance">
        <button>x</button>
      </Popover>,
    );
    expect(screen.getByRole('dialog', { name: 'Appearance' })).toBeTruthy();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Popover open onClose={onClose} label="Appearance">
        <button>x</button>
      </Popover>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('moves focus to the first focusable on open', async () => {
    render(
      <Popover open onClose={() => {}} label="Appearance">
        <button>first</button>
        <button>second</button>
      </Popover>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('first')));
  });

  // `ConfirmDialog`'s trap queries 'button' specifically — a documented gap
  // that skips a link or an input rather than holding it at the edge. This
  // surface holds grouped rows and headings and is meant to grow, so it uses a
  // standard selector from the start rather than inheriting that gap.
  it('traps Tab across every focusable kind, not only buttons', async () => {
    render(
      <Popover open onClose={() => {}} label="Appearance">
        <button>first</button>
        <a href="#x">link</a>
        <input aria-label="field" />
      </Popover>,
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('first')));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('link'));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByText('first'));
  });
});
