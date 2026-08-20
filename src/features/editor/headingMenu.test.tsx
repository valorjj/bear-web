import { fireEvent, render, screen } from '@testing-library/react';
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

  // Exercises the DOCUMENT-level `keydown` listener `HeadingMenu` installs in
  // its own `useEffect`, not a React `onKeyDown` scoped to the menu subtree —
  // that scoped handler was removed in favour of this listener specifically
  // because it must keep working once focus has already left the menu (see
  // `HeadingMenu.tsx`). `userEvent.keyboard` dispatches on
  // `document.activeElement`, which for this test IS still inside the menu
  // (the mount effect focuses the first item), so this alone would pass
  // whether Escape were wired at the document level or scoped to the
  // subtree — the coverage that actually distinguishes the two is
  // "closes on an outside mousedown" below, which a subtree-scoped handler
  // could never see at all.
  it('closes on Escape', async () => {
    const props = renderMenu();

    await userEvent.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalled();
  });

  // The menu has no other way to dismiss itself: no `onBlur`, no click
  // handler on a backdrop. This is the document-level `mousedown` (capture
  // phase) listener from `HeadingMenu.tsx`'s `useEffect` — `document.body` is
  // an ANCESTOR of the rendered menu (Testing Library mounts into it), never
  // a descendant, so `ref.current.contains(event.target)` is false and the
  // click counts as "outside".
  it('closes when a mousedown lands outside the menu', () => {
    const props = renderMenu();

    fireEvent.mouseDown(document.body);

    expect(props.onClose).toHaveBeenCalled();
  });

  // The inverse of the above: a mousedown ON one of the menu's own items must
  // NOT be treated as "outside" by the same listener — only the item's own
  // `onClick` should decide whether the menu closes.
  it('does not close on a mousedown inside the menu', () => {
    const props = renderMenu();

    fireEvent.mouseDown(screen.getByRole('menuitemradio', { name: /Heading 2/ }));

    expect(props.onClose).not.toHaveBeenCalled();
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
