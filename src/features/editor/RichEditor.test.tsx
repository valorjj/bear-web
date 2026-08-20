import { isMacOS, type Editor } from '@tiptap/core';
import type { DecorationSet } from '@tiptap/pm/view';
import { fireEvent, screen } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithI18n } from '@/i18n/testing';

import { RichEditor, type RichEditorHandle, type RichEditorProps } from './RichEditor';
import { tagRangeAt } from './TagPill';

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
   * Filtering on `title` — only a tag pill's decoration carries one — keeps
   * this about the pill regardless of which plugin's decorations come first.
   */
  function firstPillTitle(editor: Editor): string | undefined {
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
      .find(
        (d) =>
          (d as unknown as { type: { attrs: Record<string, string> } }).type.attrs.title !==
          undefined,
      );
    return (decoration as unknown as { type: { attrs: Record<string, string> } } | undefined)?.type
      .attrs.title;
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
