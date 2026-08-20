import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { ChevronDown, ChevronRight, renderIconMarkup } from '@/ui/Icon';

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

// The heading's own accessible name is pinned separately, by a
// `Decoration.node` carrying an explicit `aria-label` — see the
// `headingNameDecorations` loop below — so nothing here needs to hide the
// toggle from assistive tech. Only the badge and the marker stay
// `aria-hidden`: measured with `dom-accessibility-api` (the same engine
// `jest-dom`'s `toHaveAccessibleName` uses) over this exact markup, an
// un-hidden `<h2>` containing the badge's digit and the toggle produces the
// name "1 Hello" — the badge's `textContent`, not the toggle's `aria-label`,
// is what pollutes it, because the shipped app registers `HeadingFold` with
// no options (see `extensions.ts`), so `foldHint` is `null` and the toggle
// carries no `aria-label` at all there. A real browser's embedded-control
// rule would fold a non-null hint in too, which is exactly why the toggle
// cannot rely on staying un-labelled — the heading-level `aria-label` decoration
// is what actually closes this, independently of whether the toggle has a name.
//
// The toggle is deliberately NOT `aria-hidden`: a folded section's blocks are
// already `display: none` (see `.bear-fold-hidden` below), so if the one
// control that can reveal them again were also hidden from assistive tech, a
// screen-reader user would hear a heading followed by silence — no cue
// content exists, no way back. That is unlike the tag-pill "no keyboard
// activation, deliberately" ruling, whose safety comes from the tag sidebar
// already being a complete keyboard route to the same filter; there is no
// such alternative route to a folded section's content.
//
// A hidden-but-focusable control is its own violation (`aria-hidden-focus`),
// so anything that stays `aria-hidden` here also gets `tabIndex = -1` — see
// `badgeElement` and `markerElement`.
function button(className: string, label: string | null): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.contentEditable = 'false';
  if (label !== null) el.setAttribute('aria-label', label);
  return el;
}

function toggleElement(folded: boolean, hint: string | null): HTMLElement {
  const el = button('bear-fold-toggle', hint);
  el.setAttribute('data-fold-toggle', '');
  el.setAttribute('aria-expanded', folded ? 'false' : 'true');
  // Explicit `tabindex="0"` ATTRIBUTE, not just the default IDL `.tabIndex`
  // getter a native `<button>` returns on its own. Kept because it is still
  // correct practice for an interactive control and is harmless — but it is
  // NOT sufficient to make this element keyboard-reachable in a real browser.
  // See the long comment on the `decorations` prop's return statement below
  // for the measured reason: once a heading contains this widget at all,
  // Chromium excludes every descendant of that heading — this button
  // included, `tabindex` or not — from the focusable-area set entirely.
  el.setAttribute('tabindex', '0');
  // A visible glyph with real dimensions, not an empty 0x0 box: `ChevronDown`
  // unfolded, `ChevronRight` folded — the same pairing `ChevronRight` already
  // implied it was reserved for ("reused for the folded state"). Rendered
  // through `Icon.tsx`'s `renderIconMarkup`, the one function that lets a
  // plain-DOM widget builder reach a Lucide glyph without becoming a second
  // importer of `lucide-react`.
  el.innerHTML = renderIconMarkup(folded ? ChevronRight : ChevronDown);
  return el;
}

function badgeElement(level: number): HTMLElement {
  const el = button('bear-fold-badge', null);
  el.setAttribute('data-fold-badge', '');
  el.setAttribute('data-level', String(level));
  el.textContent = String(level);
  // The one element whose text actually pollutes the heading's accessible
  // name (see the block comment above) — its digit is redundant with the
  // toggle's own action and is already visible information, so it stays
  // hidden. `tabIndex = -1` keeps a real `<button>` from being reachable by
  // Tab while `aria-hidden`, which would otherwise be its own violation.
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  return el;
}

function markerElement(): HTMLElement {
  const el = document.createElement('span');
  el.className = 'bear-fold-marker';
  el.setAttribute('data-fold-marker', '');
  el.setAttribute('contenteditable', 'false');
  // `aria-expanded="false"` on the toggle already conveys the folded state,
  // so this stays a hidden, decorative "…" rather than a second announcement
  // of the same fact. Not a button, so no `tabIndex` question.
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

              // Pins the heading's own accessible name to its own text,
              // independently of whatever widgets sit inside it. Accessible-name
              // computation for a heading concatenates the name/text of every
              // descendant — including a nested `<button>`'s own text content
              // or `aria-label` (the "embedded control" rule) — so without this,
              // `<h1>1<button aria-label="…"/>Hello</h1>` announces as
              // "1 Hello" (measured with `dom-accessibility-api`) or worse,
              // depending on what `foldHint` is. An explicit `aria-label` on the
              // heading element itself short-circuits that computation entirely
              // (an ancestor's own `aria-label` wins outright, before content is
              // ever considered), so this fix holds regardless of what any
              // current or future widget inside the heading renders. A
              // `Decoration.node`, not a mark or an attribute write: the
              // document is still never mutated, and this is recomputed on
              // every pass alongside the widgets below, so it tracks edits to
              // the heading's own text.
              decorations.push(
                Decoration.node(
                  section.pos,
                  section.contentStart,
                  { 'aria-label': section.text },
                  { foldWidget: 'name' },
                ),
              );

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

          // A Tab-interception `handleKeyDown` was written and then REMOVED
          // here, and the removal is deliberate — record why so it is not
          // silently reintroduced. It moved focus to a `handleKeyDown`-found
          // toggle via `toggle.focus()` and passed a full jsdom unit-test
          // suite (`document.activeElement` became the toggle). It does
          // NOTHING in a real browser. Measured with Playwright against real
          // Chromium, in over a dozen isolated experiments: once a heading
          // contains ANY `Decoration.widget` — which ProseMirror itself always
          // renders with `contentEditable = "false"` — `.focus()` silently
          // fails for EVERY descendant of that heading, not just the widget:
          // a manually injected, unrelated `<button tabindex="0">` placed
          // anywhere else in the same heading (before the widgets, after
          // them, cloned from the real toggle with its own attributes
          // stripped) is equally unfocusable, synchronously and permanently,
          // even when called completely outside any keydown handler via a
          // detached `page.evaluate()`. The SAME heading with the widgets
          // removed — or with only the `aria-label` node decoration from
          // above and no widgets — allows normal focus. So this is not a bug
          // in this file's CSS, attributes, or event handling; it is Chromium
          // excluding a whole editing-host subtree from the focusable set the
          // moment it contains a `contenteditable="false"` widget island,
          // confirmed independent of `tabindex`, `contenteditable`, or DOM
          // position. jsdom does not implement this, which is exactly why
          // the unit tests for this passed while the feature never worked —
          // see CLAUDE.md's Playwright-verification rule. Making the toggle
          // genuinely keyboard-reachable needs the control to live OUTSIDE
          // the widget's `contenteditable="false"` DOM (e.g. a React-rendered
          // overlay positioned off the heading's own `getBoundingClientRect()`,
          // the same idea `HeadingMenuRequest.rect` already uses) — a
          // structural change out of this task's scope, raised as a finding
          // rather than freelanced here.
        },
      }),
    ];
  },
});
