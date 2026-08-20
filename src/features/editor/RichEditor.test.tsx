import { isMacOS, type Editor } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { headingSections } from './headingSections';
import { RichEditor, type RichEditorHandle, type RichEditorProps } from './RichEditor';
import { tagRangeAt } from './TagPill';

// jsdom has no layout engine, so ProseMirror's caret/scroll math
// (`coordsAtPos`, used by `scrollToSelection`) throws on APIs jsdom never
// implements. The heading-menu tests below drive `.focus()` and
// `.setTextSelection()` through a real, mounted `RichEditor` (not a fake
// view), which is exactly the path that reaches this — see the identical
// stubs and comment in `NoteEditor.test.tsx`'s header and
// `toolbars.test.tsx`'s `scrollToSelection` spy for the same documented gap.
// Without these, an uncaught exception here can make `vitest run` exit 1
// even when every assertion in the file passes — see CLAUDE.md's
// "jsdom drives the editor's surface too" entry.
const emptyRect: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  toJSON: () => ({}),
};
Range.prototype.getBoundingClientRect = () => emptyRect;
Range.prototype.getClientRects = () =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as unknown as DOMRectList;
document.elementFromPoint = () => null;

describe('RichEditor', () => {
  it('renders the initial markdown as rich content', async () => {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    expect(await screen.findByRole('heading', { name: 'Hello' })).toBeInTheDocument();
  });

  // `extensions.ts` registers `HeadingFold` bare (`HeadingFold` with no
  // options) until `RichEditor` threads a translated `foldHint` through
  // `buildEditorExtensions` — see Task 5's decision 1. Nothing else in the
  // suite would notice a regression here: `headingFold.test.ts` only proves
  // the plugin CAN carry an `aria-label` when handed one directly via
  // `HeadingFold.configure({ foldHint: '...' })`, never that the real
  // component actually supplies one.
  it('gives the fold toggle a translated accessible name', async () => {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByRole('heading', { name: 'Hello' });
    const toggle = handleRef.current?.editor?.view.dom.querySelector('[data-fold-toggle]');
    expect(toggle).toHaveAttribute('aria-label', 'Fold or unfold this section');
  });

  // `headingMenu.test.tsx` mounts `HeadingMenu` in isolation with `vi.fn()`
  // props, so nothing there could ever catch a wiring bug at the seam between
  // the badge click and the actual editor command `RichEditor` builds from
  // it. This is that seam: the badge's own `mousedown` calls
  // `preventDefault()` and never moves ProseMirror's selection to the heading
  // that was clicked (see `HeadingFold.ts`), so `onSetLevel` MUST target
  // `menu.pos` explicitly rather than trust whatever the caret already sat
  // at — including a caret sitting in an unrelated PARAGRAPH, which this
  // fixture puts it in on purpose. Getting this wrong doesn't just retitle
  // the wrong heading; it silently converts a paragraph into a heading.
  it("changes only the clicked heading's level, leaving an unrelated paragraph alone", async () => {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown={'# Heading A\n\nbody a\n\n# Heading B\n\nbody b'}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByRole('heading', { name: 'Heading B' });
    const editor = handleRef.current!.editor!;

    // The caret sits inside heading A's BODY PARAGRAPH — not inside any
    // heading at all — precisely so a wiring bug that ignores the clicked
    // heading and acts on the current selection instead has something
    // observably wrong to do: turn this paragraph into a heading.
    const [a] = headingSections(editor.state.doc);
    editor.commands.setTextSelection(a!.contentStart + 1);

    const badges = editor.view.dom.querySelectorAll('[data-fold-badge]');
    expect(badges).toHaveLength(2);
    fireEvent.mouseDown(badges[1]!, { button: 0 });

    const menu = await screen.findByRole('menu');
    await userEvent.click(within(menu).getByRole('menuitemradio', { name: /Heading 4/ }));

    // Heading B — the one actually clicked — took the new level.
    expect(editor.view.dom.querySelector('h4')).toHaveTextContent('Heading B');
    // Heading A is untouched.
    expect(editor.view.dom.querySelector('h1')).toHaveTextContent('Heading A');
    // And the paragraph the caret happened to be sitting in was never
    // touched at all — it must still be a plain paragraph, not a heading.
    const bodyA = screen.getByText('body a');
    expect(bodyA.tagName).toBe('P');
  });

  /**
   * Opens the menu on heading A's badge and returns the editor + the menu
   * element, so each focus-return test starts from the same known state:
   * menu open, its first item focused (by `HeadingMenu`'s own mount effect).
   */
  async function openMenuOnFirstHeading(): Promise<{ editor: Editor; menu: HTMLElement }> {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown="# Heading A"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByRole('heading', { name: 'Heading A' });
    const editor = handleRef.current!.editor!;
    const badge = editor.view.dom.querySelector('[data-fold-badge]')!;
    fireEvent.mouseDown(badge, { button: 0 });

    const menu = await screen.findByRole('menu');
    return { editor, menu };
  }

  // Task 4 measured that Chromium refuses `.focus()` to any descendant of a
  // heading containing a widget, so the badge/toggle that opened the menu is
  // never a valid destination — the editor itself is the only place focus
  // can sensibly land, and `RichEditor`'s `onClose` calls
  // `editor.commands.focus()` for exactly that reason. Without it, focus is
  // left on the menu button React is about to unmount and falls to `<body>`.
  // `editor.commands.focus()` defers the ACTUAL `view.focus()` call to the
  // next animation frame (`@tiptap/core`'s `focus` command wraps it in
  // `requestAnimationFrame`, deliberately — the same delayed-focus pattern
  // every other chained `.focus()` call in this app already relies on), so
  // `document.activeElement` does not update synchronously after `onClose`
  // returns. `waitFor` polls past that frame instead of asserting on a stale
  // snapshot the instant the microtask queue drains.
  it('returns focus to the editor when Escape closes the menu', async () => {
    const { editor } = await openMenuOnFirstHeading();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(editor.view.dom.contains(document.activeElement)).toBe(true));
  });

  // `onSetLevel` already focuses as part of its own chain (needed to target
  // `menu.pos` — see the test above), but `onToggleFold`/`onFoldAll`/
  // `onUnfoldAll` do not call `.focus()` themselves at all; they rely
  // entirely on `RichEditor`'s `onClose` to return focus. "Fold all" is
  // exercised here as the representative of that group.
  it('returns focus to the editor when an action item (Fold all) closes the menu', async () => {
    const { editor, menu } = await openMenuOnFirstHeading();

    await userEvent.click(within(menu).getByRole('menuitem', { name: /Fold all/ }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(editor.view.dom.contains(document.activeElement)).toBe(true));
  });

  it('exposes the current markdown through its handle', async () => {
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown="# Hello"
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByRole('heading', { name: 'Hello' });
    expect(handleRef.current?.getMarkdown()).toBe('# Hello');
  });

  it('preserves an unsupported construct through the handle', async () => {
    // A raw HTML block rather than the table this used to use: tables became a
    // real node in M8b, so they are normalized rather than preserved verbatim
    // and can no longer stand in for an unsupported construct here.
    const source = '<aside>note</aside>';
    const handleRef = createRef<RichEditorHandle>();
    renderWithI18n(
      <RichEditor
        initialMarkdown={source}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        ariaLabel="Note text"
        handleRef={handleRef}
        createdAt={0}
        updatedAt={0}
      />,
    );

    await screen.findByLabelText('Note text');
    expect(handleRef.current?.getMarkdown()).toBe(source);
  });
});

/**
 * Fresh every call, deliberately: a shared module-level object would carry
 * `vi.fn()` call history and a mutable `handleRef.current` across tests,
 * which is exactly the kind of cross-test state leak this project's
 * `afterEach(() => vi.restoreAllMocks())` convention elsewhere exists to
 * avoid.
 */
function makeBaseProps(): Omit<RichEditorProps, 'onActivateTag'> {
  return {
    initialMarkdown: 'a #work b',
    onChange: vi.fn(),
    onBlur: vi.fn(),
    ariaLabel: 'Note text',
    handleRef: { current: null } as RefObject<RichEditorHandle | null>,
    createdAt: 0,
    updatedAt: 0,
  };
}

/**
 * Locates the fixture's tag with `tagRangeAt` (the same grammar the plugin
 * itself uses to decide what a click landed on) and drives the plugin's own
 * `mousedown` handler with a fake view, mirroring `mousedownAt` in
 * `tagPill.test.ts` — no real layout is needed because `posAtCoords` is
 * stubbed rather than exercised.
 *
 * Reports how many times the stub was ASKED, which is the only thing that
 * distinguishes the plugin's two ways of declining: `onActivate === null`
 * short-circuits BEFORE the hit test, while a `false` answer from the app
 * comes after it. Both produce `handled: false` and `defaultPrevented: false`,
 * so an assertion on the outcome alone cannot tell them apart.
 */
function activateFirstTag(editor: Editor): {
  handled: boolean;
  defaultPrevented: boolean;
  posAtCoordsCalls: number;
} {
  let hit: ReturnType<typeof tagRangeAt> = null;
  for (let pos = 0; pos <= editor.state.doc.content.size && hit === null; pos++) {
    hit = tagRangeAt(editor.state, pos);
  }
  if (hit === null) throw new Error('activateFirstTag: no tag found in fixture');

  const event = new MouseEvent('mousedown', {
    cancelable: true,
    button: 0,
    ...(isMacOS() ? { metaKey: true } : { ctrlKey: true }),
  });
  const at = hit.from + 1;
  const posAtCoords = vi.fn(() => ({ pos: at, inside: at }));
  const view = { state: editor.state, posAtCoords };
  const handled =
    editor.view.someProp('handleDOMEvents', (handlers) =>
      handlers.mousedown === undefined ? false : handlers.mousedown(view as never, event as never),
    ) === true;
  return {
    handled,
    defaultPrevented: event.defaultPrevented,
    posAtCoordsCalls: posAtCoords.mock.calls.length,
  };
}

describe('RichEditor tag activation', () => {
  it('calls the CURRENT callback, not the one captured at mount', () => {
    // The plugin reads `onActivate` once, at construction. A prop passed
    // straight through would freeze the first render's closure.
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    const handleRef: RefObject<RichEditorHandle | null> = { current: null };
    const baseProps = makeBaseProps();
    const { rerender } = renderWithI18n(
      <RichEditor {...baseProps} handleRef={handleRef} onActivateTag={first} />,
    );
    rerender(<RichEditor {...baseProps} handleRef={handleRef} onActivateTag={second} />);

    // Invoke through the mounted plugin, the same way tagPill.test.ts does.
    activateFirstTag(handleRef.current!.editor!);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('work');
  });

  // The ref-backed wrapper stands between the app's answer and the plugin's
  // `preventDefault()`. A wrapper that forwards the call but not the return
  // value — `(tag) => { activateRef.current?.(tag); }`, the shape an
  // "arrow-body simplification" produces — reports `undefined` for every case
  // and collapses them all to "declined", silently disabling the whole
  // feature while every callback still fires. Both directions are asserted
  // because only the pair can tell propagation from a hardcoded answer.
  it('propagates the handler answer: true swallows the event, false does not', () => {
    const handleRef: RefObject<RichEditorHandle | null> = { current: null };
    const answer = vi.fn(() => true);
    renderWithI18n(
      <RichEditor {...makeBaseProps()} handleRef={handleRef} onActivateTag={answer} />,
    );
    const editor = handleRef.current!.editor!;

    const accepted = activateFirstTag(editor);
    expect(answer).toHaveBeenCalledWith('work');
    expect(accepted.handled).toBe(true);
    expect(accepted.defaultPrevented).toBe(true);

    answer.mockReturnValue(false);
    const declined = activateFirstTag(editor);
    expect(answer).toHaveBeenCalledTimes(2);
    expect(declined.handled).toBe(false);
    expect(declined.defaultPrevented).toBe(false);
    // The contrast that gives the `null`-contract test its meaning: declining
    // by ANSWER happens after the hit test, declining by having no listener at
    // all happens before it. Same outcome, different exit.
    expect(declined.posAtCoordsCalls).toBe(1);
  });

  it('marks the editor while the modifier is held, and clears it on blur', () => {
    renderWithI18n(<RichEditor {...makeBaseProps()} onActivateTag={vi.fn(() => true)} />);
    const surface = screen.getByRole('textbox').closest('[data-mod-held]');
    expect(surface).not.toBeNull();
    expect(surface!.getAttribute('data-mod-held')).toBe('false');

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true, ctrlKey: true });
    expect(surface!.getAttribute('data-mod-held')).toBe('true');

    fireEvent.keyUp(window, { key: 'Meta', metaKey: false, ctrlKey: false });
    expect(surface!.getAttribute('data-mod-held')).toBe('false');
  });

  // Hold Cmd, press Tab to switch windows, and the keyup never arrives. The
  // pills would keep claiming to be clickable while a plain click edits.
  it('clears the modifier state when the window loses focus', () => {
    renderWithI18n(<RichEditor {...makeBaseProps()} onActivateTag={vi.fn(() => true)} />);
    const surface = screen.getByRole('textbox').closest('[data-mod-held]')!;

    fireEvent.keyDown(window, { key: 'Meta', metaKey: true, ctrlKey: true });
    expect(surface.getAttribute('data-mod-held')).toBe('true');

    fireEvent.blur(window);
    expect(surface.getAttribute('data-mod-held')).toBe('false');
  });

  // A `RichEditor` rendered with no `onActivateTag` must behave as though the
  // feature is off: `TagPillOptions.onActivate === null` is what gates the
  // plugin's own `preventDefault()`, so passing a wrapper unconditionally
  // would swallow a Mod-click and suppress the caret placement a plain click
  // would have given, while the tooltip kept promising a filter that never
  // happens.
  //
  // The outcome alone stopped proving this once the boolean contract landed.
  // With an unconditional wrapper and no prop, `activateRef.current` is
  // `undefined`, `undefined === true` is `false`, and the app-declined path
  // produces a byte-identical `handled: false` / `defaultPrevented: false` —
  // so the `null` guard became untestable by its own effects, two guards
  // agreeing everywhere. `posAtCoords` is what separates them: the `null`
  // option short-circuits BEFORE the hit test runs, a `false` answer only
  // after it. Asserting the plugin never even asked where the click landed
  // pins the earlier of the two exits, which is the one this test is about.
  it('does not swallow a Mod-click when no onActivateTag handler is supplied', () => {
    const handleRef: RefObject<RichEditorHandle | null> = { current: null };
    renderWithI18n(<RichEditor {...makeBaseProps()} handleRef={handleRef} />);

    const { handled, defaultPrevented, posAtCoordsCalls } = activateFirstTag(
      handleRef.current!.editor!,
    );

    expect(posAtCoordsCalls).toBe(0);

    // The plugin itself declined: `onActivate === null` short-circuits its
    // mousedown handler before `preventDefault()`, so the browser's own
    // caret-placement mousedown behaviour is left to run, exactly as if the
    // pill were plain text.
    expect(handled).toBe(false);
    expect(defaultPrevented).toBe(false);
  });
});

describe('RichEditor tag pill tooltip', () => {
  /**
   * Reads the `title` the mounted plugin actually wrote onto its decorations,
   * through the real `decorations` prop — the same mechanism `tagPill.test.ts`
   * uses for "puts the injected hint on every pill". Reading the extension's
   * OPTIONS back would only prove the value was passed in, not that the
   * plugin used it; this proves the string reached a live decoration.
   *
   * Gathers every plugin's `decorations` prop, the way ProseMirror's own
   * `viewDecorations` does, rather than `someProp`'s short-circuit on the
   * first truthy result: with `HeadingFold` now also registering a
   * `decorations` prop, `someProp` can return that plugin's (empty, but
   * still a truthy object) `DecorationSet` before ever reaching `TagPill`'s.
   *
   * Filtered on the decoration's OWN CLASS (`bear-tag`, the class
   * `tagDecorations` always writes), not on whether `title` happens to be
   * present — a titleless pill must still fail the two tests below rather
   * than being silently treated as "no pill here, keep looking". `attrs` is
   * read with optional chaining throughout: `WidgetType` (a fold's badge
   * widget, once Task 4 adds one) has no `attrs` at all, and this must
   * degrade to `undefined` rather than throw on a decoration type this
   * helper isn't looking for.
   */
  function firstPillTitle(editor: Editor): string | undefined {
    type DecoWithAttrs = { type: { attrs?: Record<string, string> } };

    const decoration = editor.state.plugins
      .flatMap((plugin) => {
        const prop = plugin.props.decorations;
        if (!prop) return [];
        // `decorations`'s declared `this` is the owning `Plugin`, and its
        // declared return type is the general `DecorationSource`, which has
        // no `.find()` — only the concrete `DecorationSet` every plugin in
        // this app actually returns does (see `HeadingFold.ts`, `TagPill.ts`).
        const result = prop.call(plugin, editor.state) as DecorationSet | null | undefined;
        return result?.find() ?? [];
      })
      .find((d) => (d as unknown as DecoWithAttrs).type.attrs?.class === 'bear-tag');
    return (decoration as unknown as DecoWithAttrs | undefined)?.type.attrs?.title;
  }

  // `isMacOS()` runs inside `RichEditor`'s `useState` initializer, which runs
  // during the FIRST render — so the platform stub must be in place before
  // `renderWithI18n` is called, not merely before the assertion. Stubbing
  // afterward would leave `RichEditor` reading whatever `navigator.platform`
  // was at mount, silently passing for the wrong reason.
  it('shows the Mac hint on an Apple platform', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    try {
      const handleRef: RefObject<RichEditorHandle | null> = { current: null };
      renderWithI18n(
        <RichEditor {...makeBaseProps()} handleRef={handleRef} onActivateTag={vi.fn(() => true)} />,
      );
      expect(firstPillTitle(handleRef.current!.editor!)).toBe('Cmd-click to filter by this tag');
    } finally {
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  it('shows the Ctrl hint off an Apple platform', () => {
    const originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    try {
      const handleRef: RefObject<RichEditorHandle | null> = { current: null };
      renderWithI18n(
        <RichEditor {...makeBaseProps()} handleRef={handleRef} onActivateTag={vi.fn(() => true)} />,
      );
      expect(firstPillTitle(handleRef.current!.editor!)).toBe('Ctrl-click to filter by this tag');
    } finally {
      Object.defineProperty(navigator, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
