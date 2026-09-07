import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Popover } from './Popover';

/**
 * A popover with a real trigger beside it, which is the only shape in which
 * the outside-click rule can be tested honestly.
 *
 * The trigger matters because dismissing on a pointerdown ANYWHERE outside
 * the surface would close the popover a moment before the trigger's own click
 * reopens it — the menu would appear frozen open, and a test that renders no
 * trigger cannot see that at all.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button ref={triggerRef} type="button" onClick={() => setOpen((value) => !value)}>
        Open menu
      </button>
      <p>outside text</p>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        label="Account"
        triggerRef={triggerRef}
      >
        <button type="button">Sign out</button>
      </Popover>
    </div>
  );
}

describe('Popover', () => {
  it('closes on a pointerdown outside the surface', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByText('outside text'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open when the pointerdown is inside the surface', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Account' })).toBeInTheDocument();
  });

  /**
   * The trigger is outside the surface, so a naive rule closes on its
   * pointerdown and the trigger's own click then reopens — leaving the menu
   * open and the user's click apparently ignored. Asserting the DIALOG is
   * gone, not merely that `onClose` fired, is what makes this catch that:
   * the close-then-reopen sequence calls `onClose` exactly once too.
   */
  it('closes exactly once when the trigger is clicked, and does not reopen', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.queryByRole('dialog', { name: 'Account' })).not.toBeInTheDocument();
  });

  it('still closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await userEvent.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not listen while closed', async () => {
    const onClose = vi.fn();
    render(
      <div>
        <p>outside text</p>
        <Popover open={false} onClose={onClose} label="Account">
          <button type="button">Sign out</button>
        </Popover>
      </div>,
    );

    await userEvent.click(screen.getByText('outside text'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
