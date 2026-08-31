import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
  type NodeViewConstructor,
} from '@tiptap/pm/view';

import {
  DiagramError,
  ensureDiagram as ensureDiagramDefault,
  type DiagramFailure,
} from '@/features/diagrams';

import { codeBlockPosAt } from './CodeLanguageControls';
import { DIAGRAM_LANGUAGE_ID } from './codeLanguages';

export interface MermaidDiagramOptions {
  /**
   * Already translated; an extension has no access to `useT`.
   *
   * `diagramLabels`, never `labels`: `buildEditorExtensions` spreads every
   * extension's options into ONE object, so a bare name silently collides —
   * which is exactly how `TableHandles`' `onOpenMenu` once lost to
   * `HeadingFold`'s, with no error and no type failure.
   *
   * `null` is the "nobody supplied them" state — the state of the schema-only
   * `editorExtensions` constant — and in that state NO PLUGIN is registered at
   * all, so a mermaid fence renders as an ordinary code block. Absent rather
   * than unlabelled, exactly like `TableHandles.labels` and
   * `CodeLanguageControls.codeLabels`: a diagram whose failure message is a
   * blank space would be worse than no diagram.
   *
   * `diagram` and `failed.invalidSyntax` carry `{name}` and `{detail}`
   * placeholders. `useT()` in this project takes NO parameters — every
   * placeholder is substituted by the caller (see `ScopeMenu.tsx:159`) — so
   * the substitution happens here, against the already-translated template.
   */
  diagramLabels: {
    /** `Diagram: {name}` — the figure's accessible name. */
    diagram: string;
    pending: string;
    retry: string;
    /** One sentence per failure reason; `invalidSyntax` carries `{detail}`. */
    failed: Record<DiagramFailure, string>;
  } | null;

  /**
   * Overridable for tests; defaults to the real cache-first
   * `ensureDiagram`.
   *
   * Narrower than `typeof ensureDiagram` on purpose: the node view never
   * passes deps, and the narrower shape lets a test hand over a plain
   * one-argument fake.
   */
  ensureDiagram: (source: string) => Promise<string>;
}

export const mermaidDiagramKey = new PluginKey('mermaidDiagram');

/**
 * The last check before rendered markup reaches the DOM.
 *
 * `ensureDiagram` already refuses this, and so do the container and the API
 * before it. Do not delete this one as redundant: every other check in the
 * chain runs in a process this module does not control, and this is the only
 * one an attacker cannot reach.
 */
const SCRIPT_TAG_PATTERN = /<\s*script\b/i;

/** Whether a node is a code block whose fence names Mermaid. */
function isMermaidBlock(node: ProseMirrorNode | null | undefined): boolean {
  if (!node || node.type.name !== 'codeBlock') return false;
  const language = node.attrs.language as string | null | undefined;
  return typeof language === 'string' && language.trim().toLowerCase() === DIAGRAM_LANGUAGE_ID;
}

/**
 * The name a screen reader hears for the diagram.
 *
 * Mermaid's own `accTitle:` directive wins when the source declares one —
 * that is precisely what the author wrote the diagram's name to be. Failing
 * that, the first non-empty line, which for every Mermaid grammar is the
 * declaration (`flowchart TD`, `sequenceDiagram`) and so at least names the
 * KIND of picture rather than leaving `role="img"` unnamed.
 */
export function diagramName(source: string): string {
  const lines = source.split('\n');
  for (const line of lines) {
    const declared = /^\s*accTitle\s*:\s*(.*\S)\s*$/.exec(line);
    if (declared) return declared[1]!;
  }
  for (const line of lines) {
    if (line.trim() !== '') return line.trim();
  }
  return '';
}

type Labels = NonNullable<MermaidDiagramOptions['diagramLabels']>;

/** The sentence for a thrown render failure, with its detail folded in. */
function failureMessage(error: unknown, labels: Labels): string {
  const reason: DiagramFailure = error instanceof DiagramError ? error.reason : 'failed';
  const template = labels.failed[reason];
  const detail = error instanceof DiagramError ? error.detail : undefined;
  return detail === undefined ? template : template.replace('{detail}', detail);
}

/**
 * ` ```mermaid ` fences, drawn as diagrams.
 *
 * NO NEW NODE TYPE, and that is the whole design: a mermaid fence stays a
 * `codeBlock`, so the Markdown round-trip is untouched and the file stays
 * portable to GitHub, Obsidian and anything else that reads a fence. What
 * changes is only how the editor DRAWS it.
 *
 * An `Extension`, never a `Node`: it registers nothing in the schema, so
 * `computeRecognizedHtmlTags()` and every round-trip suite are blind to
 * whether it runs at all — `mermaidDiagram.test.tsx` is the only thing that
 * can catch a dead plugin.
 *
 * The editing/rendered switch comes from a ProseMirror node DECORATION adding
 * `is-editing`, not from component state: a node decoration's class lands on
 * the node view's own `dom`, so CSS does the switching with no re-render and
 * no second copy of "which block is the caret in".
 *
 * A plain-DOM node view rather than React, for the same reason
 * `StoredImage`'s is: the SVG is not in the document — it is resolved
 * asynchronously out of the diagram cache — and every other in-editor widget
 * here (`HeadingFold`, `TableHandles`, `StoredImage`) is plain DOM too.
 */
export const MermaidDiagram = Extension.create<MermaidDiagramOptions>({
  name: 'mermaidDiagram',

  addOptions() {
    return { diagramLabels: null, ensureDiagram: ensureDiagramDefault };
  },

  addProseMirrorPlugins() {
    const { diagramLabels, ensureDiagram } = this.options;
    if (diagramLabels === null) return [];
    const labels = diagramLabels;

    return [
      new Plugin({
        key: mermaidDiagramKey,

        props: {
          /**
           * `is-editing` on whichever mermaid block holds the selection.
           *
           * The block is found by the same OUTWARD walk everything else here
           * uses (`codeBlockPosAt`), so a diagram nested in a callout or a
           * list item still resolves to itself. Reused rather than
           * reimplemented: two walks that must agree is the defect that rule
           * exists to prevent.
           */
          decorations(state) {
            const pos = codeBlockPosAt(state);
            if (pos === null) return DecorationSet.empty;

            const node = state.doc.nodeAt(pos);
            if (!isMermaidBlock(node)) return DecorationSet.empty;

            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node!.nodeSize, { class: 'is-editing' }),
            ]);
          },

          nodeViews: {
            /**
             * `undefined` for a non-mermaid block, which prosemirror-view
             * accepts (`let dom = spec && spec.dom` in its `NodeViewDesc`
             * factory) and falls back to the default `DOMSerializer`
             * rendering for. Its PUBLISHED type (`NodeViewConstructor`) does
             * not admit `undefined`, which is the only reason for the cast at
             * the end of this function — the runtime contract behind it was
             * read out of `prosemirror-view`'s own source, not assumed.
             */
            codeBlock: ((
              node: ProseMirrorNode,
              view: EditorView,
              getPos: () => number | undefined,
            ): NodeView | undefined => {
              // Not a diagram: no node view at all, so the default
              // `DOMSerializer` rendering (and `CodeBlockLowlight`'s
              // decorations over it) is completely untouched.
              if (!isMermaidBlock(node)) return undefined;

              const dom = document.createElement('div');
              dom.className = 'bear-mermaid';

              // Exactly the shape `CodeBlockLowlight` renders, because it is
              // what ProseMirror and the highlight decorations both expect:
              // the `<code>` is the `contentDOM`, so editing, selection and
              // highlighting all keep working while the source is on screen.
              const pre = document.createElement('pre');
              const code = document.createElement('code');
              code.className = `language-${DIAGRAM_LANGUAGE_ID}`;
              pre.append(code);

              const figure = document.createElement('div');
              figure.className = 'bear-mermaid__figure';
              // Chrome, not text: without this ProseMirror lets the caret
              // into the rendered SVG.
              figure.contentEditable = 'false';

              dom.append(pre, figure);

              /**
               * A click on the picture puts the caret in the SOURCE.
               *
               * Without this the source is unreachable by mouse: the `<pre>`
               * is `display: none` while the diagram shows, so there is
               * nothing to click, and the figure is `contenteditable=false`
               * chrome ProseMirror will not place a caret inside. Found by
               * running the app — no unit test asked to click a hidden
               * element, and the e2e click failed with "element is not
               * visible", which is what a user experiences as "I cannot edit
               * my diagram".
               *
               * The retry button is excluded: it is a control, not a way in.
               */
              figure.addEventListener('mousedown', (event) => {
                if ((event.target as HTMLElement | null)?.closest('.bear-mermaid__retry')) return;
                event.preventDefault();

                // `getPos` rather than a captured position: the block can
                // move while the diagram is on screen if anything above it
                // is edited.
                const at = getPos();
                if (at === undefined) return;
                view.dispatch(
                  view.state.tr.setSelection(TextSelection.create(view.state.doc, at + 1)),
                );
                view.focus();
              });

              /**
               * The render this view is currently waiting for.
               *
               * Every async result checks this before touching the DOM. A
               * node view can be destroyed or superseded mid-flight — a
               * keystroke inside the block does exactly that — and writing
               * into a stale DOM is the classic bug in this shape of code.
               */
              let generation = 0;
              let destroyed = false;
              let rendered: string | null = null;
              let source = node.textContent;

              const setState = (state: 'empty' | 'pending' | 'ready' | 'failed'): void => {
                // On the WRAPPER, because that is what CSS switches on, and
                // it is also the element ProseMirror's node decoration puts
                // `is-editing` onto — one element, one place to read the
                // state from.
                dom.dataset.state = state;
              };

              const showPending = (): void => {
                figure.removeAttribute('role');
                figure.removeAttribute('aria-label');
                figure.replaceChildren(document.createTextNode(labels.pending));
                setState('pending');
              };

              const showDiagram = (svg: string, name: string): void => {
                figure.setAttribute('role', 'img');
                figure.setAttribute('aria-label', labels.diagram.replace('{name}', name));
                figure.innerHTML = svg;
                setState('ready');
              };

              const showFailure = (message: string): void => {
                // NOT `role="img"`: an `img` role makes its children
                // presentational, so the message and the retry button inside
                // one would be unreachable. A failed diagram is text and a
                // control, not a picture.
                figure.removeAttribute('role');
                figure.removeAttribute('aria-label');

                const text = document.createElement('p');
                text.className = 'bear-mermaid__message';
                text.textContent = message;

                const retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'bear-mermaid__retry';
                retry.contentEditable = 'false';
                retry.textContent = labels.retry;
                retry.addEventListener('click', (event) => {
                  event.preventDefault();
                  render(source, { force: true });
                });
                // Enter and Space by hand, exactly as `CodeCopy` does:
                // ProseMirror handles keydown on `view.dom` and calls
                // `preventDefault`, so a focused button inside the editor
                // never receives the browser's synthesized click. Measured
                // there; the same obstacle applies here.
                retry.addEventListener('keydown', (event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.preventDefault();
                  event.stopPropagation();
                  render(source, { force: true });
                });

                figure.replaceChildren(text, retry);
                // `failed`, and the CSS reveals the source alongside the
                // message: a failed render is never a blank space, and the
                // one thing the user can act on is the text they wrote.
                setState('failed');
              };

              function render(next: string, options: { force?: boolean } = {}): void {
                source = next;

                if (next.trim() === '') {
                  // Nothing to draw, and nothing to ask for. The source
                  // stays on screen (see the CSS) — a half-typed block that
                  // rendered as an empty box would be both invisible and
                  // impossible to click back into.
                  rendered = null;
                  figure.removeAttribute('role');
                  figure.removeAttribute('aria-label');
                  figure.replaceChildren();
                  setState('empty');
                  return;
                }

                if (!options.force && rendered === next) return;

                generation += 1;
                const mine = generation;
                rendered = next;
                showPending();

                void ensureDiagram(next).then(
                  (svg) => {
                    if (destroyed || mine !== generation) return;
                    if (SCRIPT_TAG_PATTERN.test(svg)) {
                      rendered = null;
                      showFailure(labels.failed.failed);
                      return;
                    }
                    showDiagram(svg, diagramName(next));
                  },
                  (error: unknown) => {
                    if (destroyed || mine !== generation) return;
                    // Cleared so the retry button — and any later identical
                    // source — asks again rather than short-circuiting on
                    // "already rendered this".
                    rendered = null;
                    showFailure(failureMessage(error, labels));
                  },
                );
              }

              render(source);

              return {
                dom,
                contentDOM: code,

                update(updated) {
                  // A language change away from Mermaid is not this view's
                  // business: `false` makes ProseMirror rebuild, and the
                  // rebuild takes the `undefined` branch above and gets the
                  // default rendering back.
                  if (!isMermaidBlock(updated)) return false;
                  // Identical text does NOT re-render — `render` itself
                  // short-circuits on it, so the caret moving in and out of
                  // the block costs nothing.
                  render(updated.textContent);
                  return true;
                },

                /**
                 * Everything the figure does is chrome.
                 *
                 * Without this, ProseMirror re-parses the node from the DOM
                 * whenever the async render swaps the SVG in — and the SVG is
                 * not the node's content, so the parse would fight the
                 * document. Mutations inside `contentDOM` (the real text, and
                 * the highlight decorations over it) are left to ProseMirror.
                 */
                ignoreMutation(mutation) {
                  return !code.contains(mutation.target);
                },

                /** A click or key on the retry button is ours, not the editor's. */
                stopEvent(event) {
                  const target = event.target as globalThis.Node | null;
                  return target !== null && figure.contains(target);
                },

                destroy() {
                  destroyed = true;
                },
              };
            }) as NodeViewConstructor,
          },
        },
      }),
    ];
  },
});
