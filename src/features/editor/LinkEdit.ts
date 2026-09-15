import { Extension, getMarkRange } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { Pencil, renderIconMarkup } from '@/ui/Icon';

export interface LinkEditOptions {
  /**
   * Called with the link's document range when its edit button is pressed.
   * `null` when nobody is listening — the state of the schema-only
   * `editorExtensions` constant — and in that state no plugin is registered
   * at all, so a bare test editor grows no affordance it cannot serve.
   */
  onEditLink: ((from: number, to: number) => void) | null;
  /**
   * The button's accessible name, supplied already translated. An extension
   * has no access to `useT`, the same contract `linkActivateHint` follows.
   */
  linkEditLabel: string | null;
}

interface LinkEditState {
  /** The link the pointer is over, or `null`. */
  hovered: { from: number; to: number } | null;
}

const linkEditKey = new PluginKey<LinkEditState>('linkEdit');

/** The link mark range covering `pos`, or `null`. */
function linkRangeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  const linkType = state.schema.marks.link;
  if (linkType === undefined) return null;
  const range = getMarkRange(state.doc.resolve(pos), linkType);
  return range === undefined ? null : { from: range.from, to: range.to };
}

/**
 * The pencil that opens the link editor, on the link the pointer is over or
 * the one holding the caret.
 *
 * Rendered ONLY for that one link, never for every link with the button
 * hidden. A hidden-but-present button is either `pointer-events: none` — in
 * which case the pointer can never reach it, because leaving the link text is
 * the only way to get there and that hides it — or it is an invisible click
 * target sitting after every link in the note, which swallows clicks on the
 * word that follows. Rendering on demand avoids both, and is why the hover
 * lives in plugin state rather than in a CSS `:hover` rule.
 *
 * A real `<button>` in a widget decoration, not a CSS `::after`: a
 * pseudo-element cannot take its own click, and deciding "was that click past
 * the end of the text" by geometry is the kind of thing that works until a
 * line wraps. Same shape as `CodeCopy`'s button and `HeadingFold`'s gutter.
 *
 * The widget sits OUTSIDE the `<a>`, at the mark range's end. Inside would be
 * interactive content nested in a link — the browser would fire the link's own
 * click handler as well as ours, and `extension-link` opens the URL on click.
 */
export const LinkEdit = Extension.create<LinkEditOptions>({
  name: 'linkEdit',

  addOptions() {
    return { onEditLink: null, linkEditLabel: null };
  },

  addProseMirrorPlugins() {
    const { onEditLink, linkEditLabel } = this.options;
    if (onEditLink === null) return [];

    return [
      new Plugin<LinkEditState>({
        key: linkEditKey,

        state: {
          init: () => ({ hovered: null }),
          apply(tr, value) {
            const meta = tr.getMeta(linkEditKey) as LinkEditState['hovered'] | undefined;
            if (meta !== undefined) return { hovered: meta };
            // Mapped rather than dropped: the reader can type while the button
            // is up, and a stale absolute position would place it mid-word.
            if (value.hovered === null) return value;
            return {
              hovered: {
                from: tr.mapping.map(value.hovered.from),
                to: tr.mapping.map(value.hovered.to),
              },
            };
          },
        },

        props: {
          decorations(state) {
            const hovered = linkEditKey.getState(state)?.hovered ?? null;
            // The caret's own link, so the affordance is reachable with no
            // pointer at all — a phone has no hover, and neither does a
            // keyboard.
            const caret = linkRangeAt(state, state.selection.from);
            const target = hovered ?? caret;
            if (target === null) return null;

            return DecorationSet.create(state.doc, [
              Decoration.widget(target.to, () => renderButton(target, linkEditLabel), {
                side: 1,
                // The button is chrome, not content: a selection running past
                // the link must not be affected by it.
                ignoreSelection: true,
                key: `link-edit-${target.from}-${target.to}`,
              }),
            ]);
          },

          handleDOMEvents: {
            mouseover(view, event) {
              const target = event.target as HTMLElement | null;

              // Over the button itself: hold the state. Without this the
              // affordance is unreachable — leaving the link text to reach it
              // is what would clear it.
              if (target?.closest('.bear-link-edit') !== null) return false;

              const anchor = target?.closest('a') ?? null;
              const next =
                anchor === null ? null : linkRangeAt(view.state, view.posAtDOM(anchor, 0));
              const current = linkEditKey.getState(view.state)?.hovered ?? null;

              // Only when it actually changes: `mouseover` fires per character
              // crossed, and dispatching an unchanged value on each would be a
              // transaction per pixel of travel.
              if (next?.from === current?.from && next?.to === current?.to) return false;

              view.dispatch(view.state.tr.setMeta(linkEditKey, next));
              return false;
            },

            mousedown(_view, event) {
              const button = (event.target as HTMLElement | null)?.closest(
                '[data-link-edit-button]',
              );
              if (button === null || button === undefined) return false;
              if (event.button !== 0) return false;

              const from = Number(button.getAttribute('data-link-edit-from'));
              const to = Number(button.getAttribute('data-link-edit-to'));
              event.preventDefault();
              onEditLink(from, to);
              return true;
            },
          },
        },
      }),
    ];
  },
});

function renderButton(target: { from: number; to: number }, label: string | null): HTMLElement {
  const holder = document.createElement('span');
  holder.className = 'bear-link-edit';
  holder.contentEditable = 'false';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-link-edit-button', '');
  button.setAttribute('data-link-edit-from', String(target.from));
  button.setAttribute('data-link-edit-to', String(target.to));
  if (label !== null) button.setAttribute('aria-label', label);
  // A ProseMirror widget cannot render React, which is why this goes through
  // `renderIconMarkup` — same constraint `CodeCopy` and the autocomplete rows
  // document at their own glyphs.
  button.innerHTML = renderIconMarkup(Pencil);
  holder.append(button);

  return holder;
}
