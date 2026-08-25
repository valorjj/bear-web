import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { HighlightPalette } from './HighlightPalette';

// `I18nProvider` is the real helper — there is no `TestI18nProvider`. Its
// verified signature is `{ children: ReactNode; locale?: Locale }`, exported
// from `@/i18n`. `locale="en"` is passed EXPLICITLY: the default detects from
// `navigator.languages`, and every assertion below matches on an English
// accessible name.
function renderPalette(props: Partial<Parameters<typeof HighlightPalette>[0]> = {}) {
  const onChoose = vi.fn();
  const onDismiss = vi.fn();
  render(
    <I18nProvider locale="en">
      <HighlightPalette current={null} onChoose={onChoose} onDismiss={onDismiss} {...props} />
    </I18nProvider>,
  );
  return { onChoose, onDismiss };
}

describe('HighlightPalette', () => {
  it('marks the current colour as checked', () => {
    renderPalette({ current: 'green' });
    expect(screen.getByRole('menuitemradio', { name: 'Green' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Blue' })).not.toBeChecked();
  });

  it('treats the default tint as a real choice, checked when no colour is set', () => {
    renderPalette({ current: null });
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toBeChecked();
  });

  it('reports a colour choice', async () => {
    const { onChoose } = renderPalette({ current: null });
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pink' }));
    expect(onChoose).toHaveBeenCalledWith('pink');
  });

  it('reports the default tint as null, not as remove', async () => {
    const { onChoose } = renderPalette({ current: 'blue' });
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Default' }));
    expect(onChoose).toHaveBeenCalledWith(null);
  });

  it('reports remove as a distinct outcome from the default tint', async () => {
    const { onChoose } = renderPalette({ current: 'blue' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove highlight' }));
    expect(onChoose).toHaveBeenCalledWith('remove');
  });

  it('dismisses on Escape', async () => {
    const { onDismiss } = renderPalette();
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalled();
  });
});
