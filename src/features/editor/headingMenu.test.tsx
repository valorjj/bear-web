import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n';

import { HeadingMenu } from './HeadingMenu';

function renderMenu(overrides: Partial<Parameters<typeof HeadingMenu>[0]> = {}) {
  const props = {
    request: { pos: 0, level: 2, folded: false, rect: new DOMRect(10, 10, 16, 16) },
    onSetLevel: vi.fn(),
    onToggleFold: vi.fn(),
    onFoldAll: vi.fn(),
    onUnfoldAll: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <I18nProvider>
      <HeadingMenu {...props} />
    </I18nProvider>,
  );
  return props;
}

describe('the heading menu', () => {
  it('marks the heading’s current level as the selected one', () => {
    renderMenu();

    expect(screen.getByRole('menuitemradio', { name: /Heading 2/ })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Heading 1/ })).not.toBeChecked();
  });

  it('sets a level when one is chosen', async () => {
    const props = renderMenu();

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Heading 4/ }));

    expect(props.onSetLevel).toHaveBeenCalledWith(4);
  });

  it('choosing the level the heading already has closes without setting it again', async () => {
    const props = renderMenu();

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Heading 2/ }));

    expect(props.onSetLevel).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it('offers fold, fold all and unfold all', async () => {
    const props = renderMenu();

    await userEvent.click(screen.getByRole('menuitem', { name: /Fold all/ }));
    expect(props.onFoldAll).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('menuitem', { name: /Unfold all/ }));
    expect(props.onUnfoldAll).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const props = renderMenu();

    await userEvent.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalled();
  });

  it('names the platform-correct shortcut for each level', () => {
    // jsdom's default `navigator.platform` is `''`, so `isMacOS()` (from
    // `@tiptap/core`) is false on every machine, including a real Mac, unless
    // stubbed explicitly — see the CLAUDE.md "Toolchain surprises" entry and
    // `RichEditor.test.tsx`'s two platform tests, which follow this exact
    // pattern. `HeadingMenu` reads `isMacOS()` synchronously during render, so
    // the stub must be in place before `renderMenu()` is called.
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      renderMenu();

      // Mod-Alt-N, already bound by @tiptap/extension-heading. Never Cmd+N:
      // browsers own Cmd+1..9 and a page cannot preventDefault it.
      expect(screen.getByRole('menuitemradio', { name: /Heading 3/ })).toHaveTextContent(/⌥/);
    } finally {
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
