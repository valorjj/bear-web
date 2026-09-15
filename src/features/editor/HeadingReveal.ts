import { Extension } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import { normalizeTitle } from '@/data';

import { headingSections } from './headingSections';

/**
 * How long the landing flash stays on the heading, in milliseconds.
 *
 * The CSS animation is the same length. It is a one-shot `forwards` animation,
 * so the class being removed at the end is what makes a SECOND follow of the
 * same link flash again rather than sitting on a finished animation.
 */
export const REVEAL_MS = 1000;

const headingRevealKey = new PluginKey<number | null>('headingReveal');

/**
 * Flashes whatever sits at `pos`, and clears the flash after `REVEAL_MS`.
 *
 * The reusable core, extracted for sub-project V: a footnote marker and its
 * definition point at each other by POSITION, with no text to look up. U's
 * `revealHeading` keeps its own text-to-position step on top of this — that
 * lookup is the part specific to headings, and this part never was.
 *
 * Takes an `EditorView` rather than an `Editor` so a ProseMirror plugin can
 * call it directly. Dispatching from inside a Tiptap command body is what
 * throws `RangeError: Applying a mismatched transaction`; there is no command
 * open here.
 */
export function revealPositionIn(view: EditorView, pos: number): void {
  // `skipTrailingNodeMeta` for the same reason `setKnownNoteTitles` carries
  // it: `TrailingNode`'s `appendTransaction` is NOT gated on `docChanged`, so
  // a meta-only dispatch on a note ending in a list or a table would append an
  // empty paragraph — which autosave then writes back, editing a note the user
  // only looked at.
  view.dispatch(view.state.tr.setMeta(headingRevealKey, pos).setMeta(skipTrailingNodeMeta, true));

  setTimeout(() => {
    if (view.isDestroyed) return;
    view.dispatch(
      view.state.tr.setMeta(headingRevealKey, null).setMeta(skipTrailingNodeMeta, true),
    );
  }, REVEAL_MS);
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingReveal: {
      /**
       * Flashes the first heading whose text normalizes to `text`, or reports
       * `false` when the document has no such heading.
       *
       * `false` is not an error path. A heading renamed or deleted since the
       * link was written is the ordinary case this whole sub-project is
       * designed around: the note is already open, and the reader loses the
       * scroll and nothing else. See the U spec for why no heading index
       * exists to make such a link look broken instead.
       */
      revealHeading: (text: string) => ReturnType;
    };
  }
}

/**
 * The landing flash after a `[[Note/Heading]]` link is followed.
 *
 * A decoration, never a mark or an attribute: the document is untouched, so
 * nothing about this can reach a note's Markdown, an export, or the sync
 * engine. Same discipline as `TagPill` and `LinkPill`.
 *
 * Unfolding is deliberately NOT done here. It rides `setHeadingFolds`, called
 * separately by `RichEditor` — a `view.dispatch` inside a command body
 * conflicts with the transaction the outer command already opened and throws
 * `RangeError: Applying a mismatched transaction` (see CLAUDE.md). The rule
 * for WHICH folds to drop is `keysRevealing`, which is pure and tested without
 * an editor at all.
 */
export const HeadingReveal = Extension.create({
  name: 'headingReveal',

  addCommands() {
    return {
      revealHeading:
        (text: string) =>
        ({ state, dispatch, editor }) => {
          const section = headingSections(state.doc).find(
            (candidate) => normalizeTitle(candidate.text) === text,
          );
          if (section === undefined) return false;
          if (!dispatch) return true;

          revealPositionIn(editor.view, section.pos);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: headingRevealKey,

        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(headingRevealKey) as number | null | undefined;
            if (meta !== undefined) return meta;
            // Mapped through document changes rather than dropped: the reader
            // can start typing while the flash is still on screen, and a
            // stale absolute position would decorate the wrong node.
            return value === null ? null : tr.mapping.map(value);
          },
        },

        props: {
          decorations(state) {
            const pos = headingRevealKey.getState(state) ?? null;
            if (pos === null) return null;

            const node = state.doc.nodeAt(pos);
            // Whatever is there — a heading for U, a footnote or a paragraph
            // for V. The type check this carried until V ("is it a heading?")
            // was a leftover from when headings were the only caller, and it
            // silently painted NOTHING for every other node: the extraction of
            // `revealPositionIn` looked complete and the flash never appeared.
            //
            // The node being gone is still a real case — deleted while the
            // flash was up — and is still nothing to paint and no error.
            if (node === null) return null;

            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, { class: 'bear-heading-revealed' }),
            ]);
          },
        },
      }),
    ];
  },
});
