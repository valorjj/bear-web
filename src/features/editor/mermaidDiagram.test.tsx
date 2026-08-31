import { within } from '@testing-library/dom';
import { waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorView } from '@tiptap/pm/view';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DiagramError } from '@/features/diagrams';

import { buildEditorExtensions, editorExtensions } from './extensions';
import { parseMarkdown, serializeMarkdown } from './markdown';
import { DIAGRAM_LANGUAGE_ID } from './codeLanguages';
import { MermaidDiagram, type MermaidDiagramOptions } from './MermaidDiagram';

// jsdom has no layout engine, so ProseMirror's caret and scroll math
// (`coordsAtPos`, `posAtCoords`) reaches DOM APIs jsdom never implements.
// These are the same three stubs `NoteEditor.test.tsx` installs, for the same
// reason: a node view is mounted by ProseMirror, and `insertContent` below
// moves a selection through that math.
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

// `insertContent` scrolls the selection into view, which resolves real
// coordinates jsdom cannot produce. Stubbed exactly as `toolbars.test.tsx`
// does — it only moves the viewport, never the document.
const editorViewPrototype = EditorView.prototype as unknown as { scrollToSelection: () => void };
let scrollToSelectionSpy: ReturnType<typeof vi.spyOn>;
beforeAll(() => {
  scrollToSelectionSpy = vi
    .spyOn(editorViewPrototype, 'scrollToSelection')
    .mockImplementation(() => undefined);
});
afterAll(() => {
  scrollToSelectionSpy.mockRestore();
});

/**
 * Already-translated labels, exactly the shape `RichEditor` passes.
 *
 * The `{name}` and `{detail}` placeholders are substituted BY THE CALLER —
 * `useT()` takes no parameters in this project (see `ScopeMenu.tsx:159`), so
 * the extension does its own `.replace`, and these fixtures carry the same
 * templates `en.ts` does.
 */
const LABELS: NonNullable<MermaidDiagramOptions['diagramLabels']> = {
  diagram: 'Diagram: {name}',
  pending: 'Rendering diagram…',
  retry: 'Render diagram',
  failed: {
    failed: 'This diagram could not be rendered.',
    offline: 'Diagrams need a connection.',
    unauthorized: 'Sign in to render diagrams.',
    invalidSyntax: 'Mermaid could not read this diagram: {detail}',
    tooLarge: 'This diagram is too large to render.',
    rateLimited: 'Too many diagrams at once. Try again shortly.',
    unavailable: 'Diagram rendering is unavailable right now.',
  },
};

const mounted: Array<{ editor: Editor; container: HTMLElement }> = [];

afterEach(() => {
  for (const { editor, container } of mounted.splice(0)) {
    editor.destroy();
    container.remove();
  }
});

function renderEditor(options: {
  text: string;
  ensureDiagram: (source: string) => Promise<string>;
  diagramLabels?: MermaidDiagramOptions['diagramLabels'];
}): { container: HTMLElement; editor: Editor } & ReturnType<typeof within> {
  const container = document.createElement('div');
  document.body.append(container);

  const editor = new Editor({
    element: container,
    extensions: buildEditorExtensions({
      diagramLabels: options.diagramLabels === undefined ? LABELS : options.diagramLabels,
      ensureDiagram: options.ensureDiagram,
    }),
    content: parseMarkdown(options.text),
  });

  mounted.push({ editor, container });
  return { container, editor, ...within(container) };
}

function wrapper(container: HTMLElement): HTMLElement | null {
  return container.querySelector('.bear-mermaid');
}

describe('MermaidDiagram', () => {
  it('adds nothing to the schema, because it is an Extension', () => {
    // The same guard `codeLanguageControls.test.ts` carries: a `Node` would
    // change `computeRecognizedHtmlTags()` and every Markdown round-trip
    // suite; an `Extension` cannot.
    expect(MermaidDiagram.type).toBe('extension');
  });

  it('leaves the Markdown round-trip untouched', () => {
    const text = '```mermaid\nflowchart TD\n  A --> B\n```';
    const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(text) });
    expect(serializeMarkdown(editor.getJSON()).trim()).toBe(text);
    editor.destroy();
  });

  it('renders the cached SVG for a mermaid block', async () => {
    const ensure = vi.fn(async () => '<svg id="drawn"><text>Start</text></svg>');
    const { container } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A[Start] --> B\n```',
      ensureDiagram: ensure,
    });

    await waitFor(() => expect(container.querySelector('svg#drawn')).not.toBeNull());
    expect(ensure).toHaveBeenCalledWith('flowchart TD\n  A[Start] --> B');
  });

  it('gives the diagram an accessible name carrying the diagram type', async () => {
    const { container } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: async () => '<svg/>',
    });

    await waitFor(() => {
      const figure = container.querySelector('[role="img"]');
      expect(figure).not.toBeNull();
      // The VALUE, not the presence. `docs/rulings/accessibility.md`.
      expect(figure!.getAttribute('aria-label')).toBe('Diagram: flowchart TD');
    });
  });

  it('honours accTitle when the source declares one', async () => {
    const { container } = renderEditor({
      text: '```mermaid\nflowchart TD\n  accTitle: Login flow\n  A --> B\n```',
      ensureDiagram: async () => '<svg/>',
    });

    await waitFor(() =>
      expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(
        'Diagram: Login flow',
      ),
    );
  });

  it('shows the source and a named reason when the render fails', async () => {
    const { container, getByText } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: async () => {
        throw new DiagramError('offline');
      },
    });

    await waitFor(() => expect(getByText('Diagrams need a connection.')).toBeInTheDocument());
    // The source must still be there: a failed render is never a blank space.
    // Asserted through the STATE attribute, not through `textContent` — jsdom applies no
    // CSS, so the hidden `<pre>` contributes its text either way and a
    // `toContain('flowchart TD')` would pass against an implementation that
    // never reveals it. `e2e` checks the painted result; this checks the
    // switch that produces it.
    expect(wrapper(container)?.dataset.state).toBe('failed');
    expect(container.textContent).toContain('flowchart TD');
  });

  it('names the parser message on a syntax error', async () => {
    const { getByText } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A -->\n```',
      ensureDiagram: async () => {
        throw new DiagramError('invalidSyntax', 'Parse error on line 2');
      },
    });

    await waitFor(() => expect(getByText(/Parse error on line 2/)).toBeInTheDocument());
  });

  it('offers a retry that asks again, and succeeds the second time', async () => {
    const ensure = vi
      .fn<(source: string) => Promise<string>>()
      .mockRejectedValueOnce(new DiagramError('unavailable'))
      .mockResolvedValueOnce('<svg id="drawn"/>');

    const { container, getByRole } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: ensure,
    });

    await waitFor(() => expect(getByRole('button', { name: 'Render diagram' })).toBeVisible());
    getByRole('button', { name: 'Render diagram' }).click();

    await waitFor(() => expect(container.querySelector('svg#drawn')).not.toBeNull());
    expect(ensure).toHaveBeenCalledTimes(2);
    expect(wrapper(container)?.dataset.state).toBe('ready');
  });

  it('refuses to inline markup carrying a script tag', async () => {
    const { container, getByText } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      // `ensureDiagram` already refuses this; so does the container, and so
      // does the API. This is the last check before the string reaches the
      // DOM, and it is the only one an attacker cannot reach.
      ensureDiagram: async () => '<svg><script>alert(1)</script></svg>',
    });

    await waitFor(() =>
      expect(getByText('This diagram could not be rendered.')).toBeInTheDocument(),
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('leaves a non-mermaid code block alone', async () => {
    const ensure = vi.fn(async () => '<svg/>');
    const { container } = renderEditor({ text: '```ts\nconst a = 1;\n```', ensureDiagram: ensure });

    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    expect(wrapper(container)).toBeNull();
  });

  it('registers no plugin at all when the caller supplied no labels', () => {
    const ensure = vi.fn(async () => '<svg/>');
    const { container } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: ensure,
      diagramLabels: null,
    });

    expect(wrapper(container)).toBeNull();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('shows the source, not the diagram, while the caret is inside the block', async () => {
    const { container, editor } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: async () => '<svg id="drawn"/>',
    });

    await waitFor(() => expect(container.querySelector('svg#drawn')).not.toBeNull());

    // Placed by COMMAND, never by click: a click cannot place a caret in jsdom
    // (`document.elementFromPoint` is stubbed to null and every Range rect is
    // zero), and a test that assumes where the caret landed fails rarely and
    // confusingly.
    editor.commands.setTextSelection(3);

    await waitFor(() => expect(wrapper(container)?.className).toContain('is-editing'));
  });

  it('a click on the diagram puts the caret into the source', async () => {
    // Found by running the app, not by a test: while the diagram shows, the
    // `<pre>` is `display: none`, so there is nothing to click, and the
    // figure is `contenteditable=false` chrome ProseMirror will not place a
    // caret inside. Without the node view's own handler the source is
    // unreachable by mouse — Playwright's click failed with "element is not
    // visible", which a user experiences as "I cannot edit my diagram".
    const { container, editor } = renderEditor({
      text: 'before\n\n```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: async () => '<svg id="drawn"/>',
    });

    await waitFor(() => expect(container.querySelector('svg#drawn')).not.toBeNull());

    // Parked in the paragraph first, so the assertion below cannot pass by
    // accident: a single-block fixture starts with the caret already inside
    // the code block, which would make this test vacuous.
    editor.commands.setTextSelection(1);
    expect(wrapper(container)?.className).not.toContain('is-editing');

    let codePos: number | null = null;
    editor.state.doc.descendants((node: ProseMirrorNode, at: number) => {
      if (codePos === null && node.type.name === 'codeBlock') codePos = at;
      return codePos === null;
    });

    const figure = container.querySelector('.bear-mermaid__figure') as HTMLElement | null;
    figure!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    // The VALUE, not merely "something moved": the first character of the
    // code block's own text.
    expect(editor.state.selection.from).toBe(codePos! + 1);
    await waitFor(() => expect(wrapper(container)?.className).toContain('is-editing'));
  });

  it('leaves the retry button alone rather than treating it as a way in', async () => {
    const ensure = vi
      .fn<(source: string) => Promise<string>>()
      .mockRejectedValueOnce(new DiagramError('unavailable'))
      .mockResolvedValueOnce('<svg id="drawn"/>');

    const { container, getByRole } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: ensure,
    });

    const button = await waitFor(() => getByRole('button', { name: 'Render diagram' }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

    expect(container.querySelector('.bear-mermaid')).not.toBeNull();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('drops the editing class again when the caret leaves the block', async () => {
    const { container, editor } = renderEditor({
      text: 'before\n\n```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: async () => '<svg id="drawn"/>',
    });

    await waitFor(() => expect(container.querySelector('svg#drawn')).not.toBeNull());

    let codePos: number | null = null;
    editor.state.doc.descendants((node: ProseMirrorNode, at: number) => {
      if (codePos === null && node.type.name === 'codeBlock') codePos = at + 1;
      return codePos === null;
    });
    expect(codePos).not.toBeNull();

    editor.commands.setTextSelection(codePos!);
    await waitFor(() => expect(wrapper(container)?.className).toContain('is-editing'));

    editor.commands.setTextSelection(1);
    await waitFor(() => expect(wrapper(container)?.className).not.toContain('is-editing'));
  });

  it('does not re-render when the caret leaves and returns', async () => {
    const ensure = vi.fn(async () => '<svg/>');
    const { editor } = renderEditor({
      text: 'before\n\n```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: ensure,
    });

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    editor.commands.setTextSelection(12);
    editor.commands.setTextSelection(1);

    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('re-renders when the source changes', async () => {
    const ensure = vi.fn(async () => '<svg/>');
    const { editor } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: ensure,
    });

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));

    editor.commands.setTextSelection(3);
    editor.commands.insertContent('C');

    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
  });

  it('ignores a result that lands after the source moved on', async () => {
    // The generation guard, asserted through a VALUE rather than through the
    // absence of a crash: the first (slow) render must never paint over the
    // second (fast) one.
    const resolvers: Array<(svg: string) => void> = [];
    const ensure = vi.fn(
      (_source: string) => new Promise<string>((resolve) => resolvers.push(resolve)),
    );

    const { container, editor } = renderEditor({
      text: '```mermaid\nflowchart TD\n  A --> B\n```',
      ensureDiagram: ensure,
    });

    await waitFor(() => expect(resolvers).toHaveLength(1));

    editor.commands.setTextSelection(3);
    editor.commands.insertContent('C');
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // Second answer first, then the stale first one.
    resolvers[1]!('<svg id="fresh"/>');
    await waitFor(() => expect(container.querySelector('svg#fresh')).not.toBeNull());
    resolvers[0]!('<svg id="stale"/>');

    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('svg#stale')).toBeNull();
    expect(container.querySelector('svg#fresh')).not.toBeNull();
  });

  it('names mermaid as its own picker choice without registering it for highlighting', async () => {
    const { CODE_LANGUAGES } = await import('./codeLanguages');
    expect(DIAGRAM_LANGUAGE_ID).toBe('mermaid');
    // `CODE_LANGUAGES` is the ONE list lowlight's registrations read, and
    // `mermaid` has no highlight.js grammar — asking for one registers
    // nothing and silently renders plain.
    expect(CODE_LANGUAGES.map((language) => language.id)).not.toContain(DIAGRAM_LANGUAGE_ID);
  });
});
