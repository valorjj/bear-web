import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { foldKeyOf, headingSections, hiddenRangesFor, serializeFoldKey } from './headingSections';

export interface HeadingFoldOptions {
  /**
   * Called when the user clicks a heading's level badge, with the heading's
   * document position and the badge's screen rectangle. `null` when nobody is
   * listening, which is the state of the schema-only `editorExtensions`
   * constant — and, as with `TagPill.onActivate`, a non-null callback is what
   * makes the plugin consume the click at all.
   */
  onOpenMenu: ((request: HeadingMenuRequest) => void) | null;
  /** Already translated; an extension has no access to `useT`. */
  foldHint: string | null;
}

export interface HeadingMenuRequest {
  /** Document position of the heading node. */
  pos: number;
  level: number;
  folded: boolean;
  /** Viewport rectangle of the badge, for anchoring the menu. */
  rect: DOMRect;
}

interface FoldState {
  keys: string[];
}

const headingFoldKey = new PluginKey<FoldState>('headingFold');

/** Transaction meta carrying the next fold set. */
interface FoldMeta {
  keys: string[];
}

/** The fold keys currently held in plugin state, in the order they were folded. */
export function foldedKeys(state: EditorState): string[] {
  return headingFoldKey.getState(state)?.keys ?? [];
}

function setKeys(tr: Transaction, keys: string[]): Transaction {
  return tr.setMeta(headingFoldKey, { keys } satisfies FoldMeta);
}

// `aria-hidden="true"` on all three widgets below is load-bearing, not
// decorative polish. Each widget is placed at `section.pos + 1` — INSIDE the
// heading element, which `pos + 1` requires (see the comment at the call
// site) — and accessible-name computation for a heading concatenates the
// text/name of every descendant, including a nested `<button>`'s own
// `aria-label` or text content (the "embedded control" rule). Without
// `aria-hidden`, a folded `<h1>` containing the level-1 badge and the fold
// toggle announces as "1 Fold or unfold this section Hello" instead of
// "Hello" — exactly the class of defect `SidebarRow` and `NoteListItem` both
// shipped and had to fix (see CLAUDE.md's Accessibility section). Verified
// live: `RichEditor.test.tsx`'s `findByRole('heading', { name: 'Hello' })`
// fails without this line and passes with it.
//
// This makes the affordance mouse-only, with no keyboard or screen-reader
// path — the same ruling already made for tag pills ("no keyboard
// activation, deliberately"): the sidebar/tree already gives keyboard users a
// route to the same content, and fighting the editor's own focus/selection
// handling for a hover-reveal control is not worth it.
function button(className: string, label: string | null): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.contentEditable = 'false';
  el.setAttribute('aria-hidden', 'true');
  if (label !== null) el.setAttribute('aria-label', label);
  return el;
}

function toggleElement(folded: boolean, hint: string | null): HTMLElement {
  const el = button('bear-fold-toggle', hint);
  el.setAttribute('data-fold-toggle', '');
  el.setAttribute('aria-expanded', folded ? 'false' : 'true');
  return el;
}

function badgeElement(level: number): HTMLElement {
  const el = button('bear-fold-badge', null);
  el.setAttribute('data-fold-badge', '');
  el.setAttribute('data-level', String(level));
  el.textContent = String(level);
  return el;
}

function markerElement(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'bear-fold-marker';
  el.setAttribute('data-fold-marker', '');
  el.setAttribute('contenteditable', 'false');
  // Same reason as the buttons above: this widget also sits inside the
  // heading element (at `section.contentStart - 1`), and its "…" text would
  // otherwise be concatenated into the heading's accessible name.
  el.setAttribute('aria-hidden', 'true');
  el.textContent = '…';
  return el;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingFold: {
      toggleHeadingFold: (pos: number) => ReturnType;
      foldAllHeadings: () => ReturnType;
      unfoldAllHeadings: () => ReturnType;
      setHeadingFolds: (keys: string[]) => ReturnType;
    };
  }
}

/**
 * Folds a heading's section.
 *
 * An `Extension`, never a `Node` or `Mark`: it registers nothing in the schema,
 * so `getSchema(editorExtensions)`, `computeRecognizedHtmlTags()` and every
 * round-trip suite are untouched by it — exactly as `TagPill` is. Folding is
 * decoration only; the document is never mutated, so a fold can never survive
 * into a note's Markdown or reach an export.
 *
 * The consequence is that every round-trip test in this project is blind to
 * whether this plugin runs at all. `headingFold.test.ts` asserts on the
 * decoration set and the plugin state, and is the only thing that can catch a
 * dead plugin.
 */
export const HeadingFold = Extension.create<HeadingFoldOptions>({
  name: 'headingFold',

  addOptions() {
    return { onOpenMenu: null, foldHint: null };
  },

  addCommands() {
    return {
      toggleHeadingFold:
        (pos: number) =>
        ({ state, dispatch }) => {
          const section = headingSections(state.doc).find((s) => s.pos === pos);
          if (!section) return false;

          const key = serializeFoldKey(foldKeyOf(section));
          const current = foldedKeys(state);
          const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];

          if (dispatch) dispatch(setKeys(state.tr, next));
          return true;
        },

      foldAllHeadings:
        () =>
        ({ state, dispatch }) => {
          const keys = headingSections(state.doc).map((s) => serializeFoldKey(foldKeyOf(s)));
          if (dispatch) dispatch(setKeys(state.tr, keys));
          return true;
        },

      unfoldAllHeadings:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(setKeys(state.tr, []));
          return true;
        },

      setHeadingFolds:
        (keys: string[]) =>
        ({ state, dispatch }) => {
          if (dispatch) dispatch(setKeys(state.tr, [...keys]));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const { foldHint } = this.options;
    return [
      new Plugin<FoldState>({
        key: headingFoldKey,

        state: {
          init: () => ({ keys: [] }),
          apply(tr, value) {
            const meta = tr.getMeta(headingFoldKey) as FoldMeta | undefined;
            // Keys are content-derived, so a document change needs no mapping
            // — the identity is re-matched against the new document on every
            // decoration pass. An unmatched key is RETAINED rather than
            // dropped: renaming a heading and renaming it back should restore
            // the fold, and a key that matches nothing hides nothing anyway.
            return meta ? { keys: meta.keys } : value;
          },
        },

        props: {
          decorations(state) {
            const keys = new Set(headingFoldKey.getState(state)?.keys ?? []);

            const decorations: Decoration[] = [];
            for (const range of hiddenRangesFor(state.doc, keys)) {
              state.doc.nodesBetween(range.from, range.to, (node, pos) => {
                // Top-level blocks only: hiding the outermost block hides its
                // descendants with it, and decorating both would double-count.
                if (pos < range.from || pos >= range.to) return false;
                if (state.doc.resolve(pos).depth !== 0) return false;
                decorations.push(
                  Decoration.node(
                    pos,
                    pos + node.nodeSize,
                    { class: 'bear-fold-hidden' },
                    { foldHidden: true },
                  ),
                );
                return false;
              });
            }

            for (const section of headingSections(state.doc)) {
              const folded = keys.has(serializeFoldKey(foldKeyOf(section)));

              // `section.pos + 1`, NOT `section.pos`. A widget at `section.pos`
              // sits at the document position BEFORE the heading node, so
              // ProseMirror renders it as the heading's SIBLING — every
              // `.ProseMirror h2:hover .bear-fold-toggle` rule below would
              // never match, and `position: absolute` would resolve against
              // the wrong box. `pos + 1` is the start of the heading's inline
              // content, which makes the widget a CHILD of the heading
              // element, which is what the CSS and the hit test both assume.
              decorations.push(
                Decoration.widget(section.pos + 1, () => toggleElement(folded, foldHint), {
                  side: -1,
                  // Widgets are not document content, but say so explicitly:
                  // a widget that ProseMirror thinks is text would be included
                  // in `textBetween` and could reach the serializer.
                  ignoreSelection: true,
                  foldWidget: 'toggle',
                }),
              );

              decorations.push(
                Decoration.widget(section.pos + 1, () => badgeElement(section.level), {
                  side: -1,
                  ignoreSelection: true,
                  foldWidget: 'badge',
                  // Mirrored into the spec so a test can assert the level
                  // without reaching into ProseMirror's widget internals.
                  level: section.level,
                }),
              );

              if (folded) {
                decorations.push(
                  // At the END of the heading's own line, inside the measure.
                  // A persistent GUTTER mark would overlay text at rest on a
                  // narrow pane, which is exactly what the hover-only gutter
                  // rule exists to prevent.
                  Decoration.widget(section.contentStart - 1, () => markerElement(), {
                    side: 1,
                    ignoreSelection: true,
                    foldWidget: 'marker',
                  }),
                );
              }
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
