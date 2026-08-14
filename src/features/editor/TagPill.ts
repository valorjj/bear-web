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
 *
 * Scans exactly one block — the one containing `pos` — rather than descending
 * from the document root. `resolve` already knows the position's ancestry, so
 * the containing textblock is reachable directly and the gesture's cost is
 * constant instead of proportional to note size. The two are behaviourally
 * identical (document positions are unique, so no other block's tag ranges
 * could ever contain `pos`); the whole-document walk was simply doing the
 * work of ~900 blocks to answer a question about one.
 */
export function tagRangeAt(state: EditorState, pos: number): TagHit | null {
  const $pos = state.doc.resolve(pos);
  // `isTextblock` is load-bearing twice over. It rejects everything that
  // cannot hold a tag, and it is also what keeps `before()` below safe: a
  // position sitting between two top-level blocks resolves to depth 0, where
  // the parent is the document itself and `before()` would throw. An explicit
  // `$pos.depth === 0` clause was written here first and then removed —
  // `doc.isTextblock` is false, so the clause could not be made to fail by any
  // injection, and an unfalsifiable branch is a defect in this project.
  // `spec.code` is the same property `tagDecorations` gates on, so the
  // behaviour depends on code-ness rather than on a node name.
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return null;

  for (const hit of tagHitsIn($pos.parent, $pos.before())) {
    if (pos >= hit.from && pos <= hit.to) return hit;
  }
  return null;
}

export interface TagPillOptions {
  /**
   * Called with the tag name when the user Mod-clicks a tag. `null` when
   * nobody is listening, which is the state of the schema-only
   * `editorExtensions` constant.
   *
   * **Returns whether the app acted on the tag**, and that answer decides
   * whether the event is consumed. The plugin cannot know what the tag index
   * holds — it deliberately learns nothing about scopes — so if it consumed
   * the event before asking, every case the app declines (a lying pill, a
   * trashed note, a tag typed inside the autosave debounce and therefore not
   * yet written to the index) would give the user no filter, no caret, and no
   * feedback at all. The plugin reports a fact; the app decides what it means;
   * and now the app's answer decides what the gesture costs.
   */
  onActivate: ((tag: string) => boolean) | null;
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
const tagPillKey = new PluginKey('tagPill');

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
 *
 * `activateHint`, when non-null, is written onto every decoration's `title`
 * attribute — an explicit parameter, not plugin state, so the function's
 * inputs are visible in its own signature rather than hidden behind
 * `PluginKey.getState`.
 */
export function tagDecorations(
  state: EditorState,
  focused = true,
  activateHint: string | null = null,
): Decoration[] {
  const decorations: Decoration[] = [];
  const { from: selFrom, to: selTo } = state.selection;

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
          activateHint === null
            ? { class: 'bear-tag' }
            : { class: 'bear-tag', title: activateHint },
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
    // `onActivate` (and `activateHint` beside it) is read once, here, at
    // plugin construction, and stays this closure's value for the plugin's
    // whole lifetime even if `this.options` is mutated afterwards — pinned by
    // the "keeps calling the original callback after the extension options
    // are mutated" test in `tagPill.test.ts`. This is why a caller that needs
    // the callback's *behaviour* to stay current while its *identity* stays
    // stable must thread a ref-backed function rather than the callback
    // itself (see Task 3).
    const { editor } = this;
    const { onActivate, activateHint } = this.options;
    return [
      new Plugin({
        key: tagPillKey,
        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              tagDecorations(state, editor.isFocused, activateHint),
            );
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

              // Ask first, consume second. A Mod-click either filters, or
              // behaves exactly like a plain click — never nothing. When the
              // app declines, falling through with no `preventDefault()` and
              // `false` leaves ProseMirror's own mousedown handling to place
              // the caret, which is the honest answer for a pill that cannot
              // do what its tooltip promises.
              if (!onActivate(hit.tag)) return false;

              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
