import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { CalloutMenu } from './CalloutMenu';
import { CALLOUT_TYPES } from './callouts';

/**
 * A stand-in for the toolbar button's own box.
 *
 * jsdom has no layout engine, so the MENU's size is always zero here and
 * nothing about the flip can be asserted — but the anchor is a value this
 * test supplies, so the placement derived FROM it is real arithmetic and is
 * checked below against a second, different anchor.
 */
function anchorAt(left: number, bottom: number): { rect: DOMRect; opener: HTMLElement | null } {
  return {
    rect: new DOMRect(left, bottom - 28, 28, 28),
    opener: null,
  };
}

const ANCHOR = anchorAt(300, 700);

describe('CalloutMenu', () => {
  it('marks the active type checked, so the choice is not carried by colour alone', () => {
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current="warning" onChoose={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(
      screen.getByRole('menuitemradio', { name: 'Warning', checked: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitemradio', { name: 'Quote', checked: false }),
    ).toBeInTheDocument();
  });

  it('marks the plain quote checked when there is no callout', () => {
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getByRole('menuitemradio', { name: 'Quote', checked: true })).toBeInTheDocument();
  });

  it('offers exactly the roster plus a plain quote', () => {
    // Derived from CALLOUT_TYPES rather than listed again, so a sixth type
    // cannot exist in the schema and be missing from the menu.
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getAllByRole('menuitemradio')).toHaveLength(CALLOUT_TYPES.length + 1);
  });

  it.each([
    ['info', 'Info'],
    ['tip', 'Tip'],
    ['success', 'Success'],
    ['warning', 'Warning'],
    ['danger', 'Danger'],
  ])('labels %s through i18n rather than by its marker word', (_type, label) => {
    // Every row goes through `useT`. The marker stays English syntax; the menu
    // is UI, and `ko.ts` is annotated `Record<TranslationKey, string>` so a
    // missing translation is a compile error rather than a blank row.
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current={null} onChoose={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getByRole('menuitemradio', { name: label })).toBeInTheDocument();
  });

  it('reports the chosen type', async () => {
    const onChoose = vi.fn();
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current={null} onChoose={onChoose} onDismiss={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Danger' }));

    expect(onChoose).toHaveBeenCalledWith('danger');
  });

  it('reports null for the plain quote, which is how a callout is undone', () => {
    const onChoose = vi.fn();
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current="tip" onChoose={onChoose} onDismiss={vi.fn()} />,
    );

    screen.getByRole('menuitemradio', { name: 'Quote' }).click();

    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('focuses the checked item on open', () => {
    // The control that opens this menu is icon-only, so a keyboard user who
    // cannot get in has no route to a callout at all.
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current="success" onChoose={vi.fn()} onDismiss={vi.fn()} />,
    );

    expect(screen.getByRole('menuitemradio', { name: 'Success' })).toHaveFocus();
  });

  it('dismisses on Escape', async () => {
    const onDismiss = vi.fn();
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current={null} onChoose={vi.fn()} onDismiss={onDismiss} />,
    );

    await userEvent.keyboard('{Escape}');

    expect(onDismiss).toHaveBeenCalled();
  });
  it('places itself against the anchor it was given, not the pane', () => {
    // The defect this replaces: the menu rendered as a centred child of a flex
    // column above the toolbar, so a menu opened from the strip's right-hand
    // end floated over the middle of the pane. Two DIFFERENT anchors must
    // produce two different positions, which a centred layout cannot do —
    // asserting one position alone would pass against the old behaviour too.
    const { unmount } = renderWithI18n(
      <CalloutMenu
        anchor={anchorAt(300, 700)}
        current={null}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const first = screen.getByRole('menu');
    const firstLeft = first.style.left;
    const firstTop = first.style.top;

    // Viewport-fixed, not laid out in the toolbar's flow. No stylesheet is
    // loaded under jsdom, so the class is where this lives — `getComputedStyle`
    // would report nothing either way and could not tell the two apart.
    expect(first.className.split(/\s+/)).toContain('fixed');
    unmount();

    renderWithI18n(
      <CalloutMenu
        anchor={anchorAt(120, 400)}
        current={null}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const second = screen.getByRole('menu').style;

    expect(firstLeft).not.toBe('');
    expect(second.left).not.toBe(firstLeft);
    expect(second.top).not.toBe(firstTop);
  });

  it('dismisses on an outside mousedown', () => {
    const onDismiss = vi.fn();
    renderWithI18n(
      <CalloutMenu anchor={ANCHOR} current={null} onChoose={vi.fn()} onDismiss={onDismiss} />,
    );

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onDismiss).toHaveBeenCalled();
  });

  it('does not treat its own opener as outside', () => {
    // A toggle button must be able to close its own menu. The dismissal
    // listener runs during CAPTURE, so without this exclusion it closes on
    // mousedown and the button's click re-opens a render later — the menu the
    // user clicked to dismiss simply stays.
    const opener = document.createElement('button');
    document.body.append(opener);
    const onDismiss = vi.fn();

    renderWithI18n(
      <CalloutMenu
        anchor={{ rect: new DOMRect(300, 672, 28, 28), opener }}
        current={null}
        onChoose={vi.fn()}
        onDismiss={onDismiss}
      />,
    );

    opener.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onDismiss).not.toHaveBeenCalled();

    // The control: the very same listener still fires for anything else.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    opener.remove();
  });
});
