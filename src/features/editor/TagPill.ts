import { Extension, isMacOS } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { findTagRanges } from '@/data';

import { maskedBlockText } from './blockText';

export interface TagHit {
  /** The normalized tag name, exactly as `parseTags` would report it. */
  tag: string;
  /** Document position of the opening `#`. */
  from: number;
  /** Document position one past the tag's last character. */
  to: number;
}

/**
 * Every tag in a textblock, as document positions.
 *
 * The single place the offset arithmetic lives: `maskedBlockText` emits one
 * character per document position, so the character at index `i` inside a
 * block starting at `blockPos` sits at `blockPos + 1 + i`.
 */
function tagHitsIn(node: Node, blockPos: number): TagHit[] {
  return findTagRanges(maskedBlockText(node)).map((range) => ({
    tag: range.tag,
    from: blockPos + 1 + range.start,
    to: blockPos + 1 + range.end,
  }));
}

/**
 * The tag covering `pos`, or `null`.
 *
 * Deliberately independent of the decoration set: a tag the caret sits inside
 * has no pill (see the suppression rule in `tagDecorations`), and if
 * activation hit-tested the pills instead of the grammar, the same gesture
 * would work or not work with nothing on screen to explain the difference.
 * Behaviour must not depend on invisible state.
 */
export function tagRangeAt(state: EditorState, pos: number): TagHit | null {
  let found: TagHit | null = null;

  state.doc.descendants((node, blockPos) => {
    if (found !== null) return false;
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    for (const hit of tagHitsIn(node, blockPos)) {
      if (pos >= hit.from && pos <= hit.to) {
        found = hit;
        break;
      }
    }
    return false;
  });

  return found;
}

export interface TagPillOptions {
  /**
   * Called with the tag name when the user Mod-clicks a tag. `null` when
   * nobody is listening, which is the state of the schema-only
   * `editorExtensions` constant.
   */
  onActivate: ((tag: string) => void) | null;
  /**
   * Tooltip naming the gesture. Supplied already translated and already
   * platform-correct, because an extension has no access to `useT` and
   * `useT` has no interpolation.
   */
  activateHint: string | null;
}

// Not exported: nothing outside this file needs to target this plugin by
// key. Kept as a `PluginKey` (the `Plugin` constructor takes one) rather than
// an anonymous plugin, for the same debuggability every other plugin in this
// app gets.
//
// Typed on the plugin's own state, which holds nothing but the configured
// `activateHint` — captured once at plugin construction, exactly like
// `onActivate` below, and read back by `tagDecorations` via
// `tagPillKey.getState(state)` so the decorations() prop's call site stays
// unchanged.
const tagPillKey = new PluginKey<string | null>('tagPill');

/**
 * Renders `#tag` as a pill.
 *
 * A decoration, never a mark: the document is untouched, so no schema,
 * serializer or round-trip path is involved, and a pill can never survive
 * into a note's Markdown. Tags are derived from text; the text stays plain.
 *
 * The consequence is that every round-trip test in this project is blind to
 * whether this plugin runs at all — see `tagPill.test.ts`, which asserts on
 * the decoration set itself.
 */
export function tagDecorations(state: EditorState, focused = true): Decoration[] {
  const decorations: Decoration[] = [];
  const { from: selFrom, to: selTo } = state.selection;
  const hint = tagPillKey.getState(state) ?? null;

  state.doc.descendants((node, pos) => {
    // `spec.code` is the property this behaviour actually depends on — set by
    // `codeBlock` today — rather than a hardcoded node name, so a rename or a
    // second code-ish node type stays covered.
    if (node.type.spec.code) return false;
    if (!node.isTextblock) return true;

    for (const hit of tagHitsIn(node, pos)) {
      const { from, to } = hit;
      // A tag the cursor is inside keeps its plain text, so character widths
      // do not jump while it is being typed or edited. Intersection, not
      // containment: a caret sitting at either edge is still "inside" as far
      // as editing comfort goes.
      //
      // Gated on focus: an unfocused editor still has a selection (a fresh
      // note opens with one at position 1), but there is no caret on screen
      // and so nothing for this rule to keep comfortable. Without this gate,
      // a note seeded with a leading tag — exactly what creating a note
      // inside a tag scope does — opened with that tag permanently unpilled,
      // pill or no click. `focused` defaults to `true` so every existing
      // direct call to `tagDecorations(state)` in this file's tests keeps
      // exercising suppression exactly as before; only the mounted extension
      // below ever passes `false`.
      if (focused && selFrom <= to && selTo >= from) continue;
      decorations.push(
        Decoration.inline(
          from,
          to,
          hint === null ? { class: 'bear-tag' } : { class: 'bear-tag', title: hint },
        ),
      );
    }
    return false;
  });

  return decorations;
}

export const TagPill = Extension.create<TagPillOptions>({
  name: 'tagPill',

  addOptions() {
    return {
      onActivate: null,
      activateHint: null,
    };
  },

  addProseMirrorPlugins() {
    // Captured once, not read as `this.editor`/`this.options` inside the
    // props below: both props are invoked by ProseMirror's view machinery
    // with no guarantee of `this` binding to the extension instance.
    //
    // `onActivate` is read once, here, at plugin construction — this is why
    // a caller that needs the callback's *behaviour* to stay current while
    // its *identity* stays stable must thread a ref-backed function rather
    // than the callback itself (see Task 3).
    const { editor } = this;
    const { onActivate, activateHint } = this.options;
    return [
      new Plugin({
        key: tagPillKey,
        state: {
          init: () => activateHint,
          apply: (_tr, prev) => prev,
        },
        props: {
          decorations(state) {
            return DecorationSet.create(state.doc, tagDecorations(state, editor.isFocused));
          },

          handleDOMEvents: {
            // `mousedown`, not `handleClick`. ProseMirror does not place the
            // caret itself on a plain click — the browser moves the DOM
            // selection natively during mousedown and ProseMirror reads it
            // back. By `handleClick` (which runs on mouseup) the caret has
            // already moved, suppression has already lifted the pill, and
            // the thing the user clicked has vanished under the cursor.
            // `preventDefault()` here is the only point that stops it.
            mousedown(view, event) {
              if (onActivate === null) return false;
              if (event.button !== 0) return false;
              // Ctrl-click on macOS is the context-menu gesture, and must
              // not also change scope. Cmd there, Ctrl everywhere else — the
              // same "Mod" every keyboard shortcut in this app uses.
              if (!(isMacOS() ? event.metaKey : event.ctrlKey)) return false;

              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              if (at === null) return false;

              const hit = tagRangeAt(view.state, at.pos);
              if (hit === null) return false;

              event.preventDefault();
              onActivate(hit.tag);
              return true;
            },
          },
        },
      }),
    ];
  },
});
