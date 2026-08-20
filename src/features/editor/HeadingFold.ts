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
            if (keys.size === 0) return DecorationSet.empty;

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
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
