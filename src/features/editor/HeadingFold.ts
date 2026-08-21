import { Extension, isMacOS } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { ChevronDown, ChevronRight, renderIconMarkup } from '@/ui/Icon';

import {
  foldKeyOf,
  headingSections,
  hiddenRangesFor,
  serializeFoldKey,
  type HeadingSection,
} from './headingSections';

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

/**
 * The fold set that toggling `section` produces. Shared by the command and
 * the plugin's `mousedown` handler — a raw plugin cannot reach
 * `editor.commands`, so this is the one place the calculation lives rather
 * than being duplicated between the two call sites.
 */
function nextKeysToggling(state: EditorState, section: HeadingSection): string[] {
  const key = serializeFoldKey(foldKeyOf(section));
  const current = foldedKeys(state);
  return current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
}

// Computed ONCE at module init, not per render. `Decoration.widget`'s builder
// function runs on every `decorations(state)` pass that doesn't reuse the old
// DOM (see the `key` spec fields below for why that used to be EVERY pass),
// and `renderIconMarkup` builds a fresh `<svg>` element via
// `document.createElementNS` and serializes it to a string on every call —
// cheap once, not something to pay per keystroke, per heading. Both glyphs
// are always rendered at `Icon`'s `md` size, so there is exactly one of each
// to precompute.
const CHEVRON_DOWN_MARKUP = renderIconMarkup(ChevronDown);
const CHEVRON_RIGHT_MARKUP = renderIconMarkup(ChevronRight);

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
  // implied it was reserved for ("reused for the folded state"). The markup
  // itself is a MODULE-LEVEL constant (see above), not a fresh
  // `renderIconMarkup` call here — this function runs on every
  // `decorations(state)` pass a widget isn't reused across, which used to be
  // every pass at all (see the `key` spec fields at the call site).
  el.innerHTML = folded ? CHEVRON_RIGHT_MARKUP : CHEVRON_DOWN_MARKUP;
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
          if (dispatch) dispatch(setKeys(state.tr, nextKeysToggling(state, section)));
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

  /**
   * `Mod-Alt-f` toggles the fold of the section the cursor is currently in.
   *
   * Added specifically BECAUSE a focusable toggle proved impossible (see the
   * long comment on the `decorations` prop below) — this is the alternative
   * keyboard route that finding closed off. Needs no focusable element at
   * all, unlike the toggle button.
   *
   * NOT `Mod-Alt-0`: that collides with `@tiptap/extension-paragraph`'s own
   * `Mod-Alt-0: () => this.editor.commands.setParagraph()`. StarterKit
   * registers Paragraph, and Tiptap builds its plugins from a REVERSED
   * extension array, so `HeadingFold` — declared after StarterKit in
   * `extensions.ts` — would have WON that collision: with the caret
   * anywhere inside a top-level section, `Mod-Alt-0` folded instead of
   * resetting the block to a paragraph. A unit test could not have caught
   * this by exercising the paragraph command's own return value —
   * `setBlockType` returns `false` on an already-paragraph block, so the
   * collision is invisible in exactly the case a user would never press the
   * key for. The only reliable check is against the editor's OWN claimed
   * bindings, not a browser/OS shortcut list:
   *
   *   grep -rEn "Mod-Alt-[0-9a-zA-Z]|Mod-Alt-\\$\{" node_modules/@tiptap \
   *     --include="*.js" --include="*.ts" --include="*.mjs" --include="*.cjs" \
   *     | grep -v '\.map:'
   *
   * — which is what turned up the collision, `Mod-Alt-c`
   * (`@tiptap/extension-code-block`, `toggleCodeBlock`), and the
   * `` `Mod-Alt-${level}` `` template-literal form
   * (`@tiptap/extension-heading`, levels 1–6) that a plain quoted-string
   * grep would miss. `Mod-Alt-f` — mnemonic for "fold" — does not appear in
   * that search at all.
   *
   * Reuses `headingSections` rather than writing a second search for "the
   * heading that owns this position" — that function is already the single
   * definition of section ownership (`toggleHeadingFold` itself matches on
   * `section.pos`), and a second implementation of "which section is this"
   * is exactly the kind of duplicated grammar this project avoids elsewhere
   * (see `parseTags`/`findTagRanges` in `CLAUDE.md`).
   *
   * Returns `false` — letting the key fall through to whatever else binds it
   * — when the cursor is not inside any top-level section, rather than
   * swallowing the keystroke for nothing.
   */
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-f': () => {
        const { state } = this.editor;
        const pos = state.selection.from;
        const section = headingSections(state.doc).find((s) => s.pos <= pos && pos < s.end);
        if (!section) return false;
        return this.editor.commands.toggleHeadingFold(section.pos);
      },
    };
  },

  addProseMirrorPlugins() {
    const { foldHint, onOpenMenu } = this.options;
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
              // current or future widget inside the heading renders — EXCEPT
              // when `section.text` is empty: per the accname spec an empty
              // `aria-label` is treated as absent and computation falls back
              // to content, so an empty heading gets no protection from this
              // decoration (and none is needed — there is no digit or hint
              // text to pollute it with yet, only the widgets' own content,
              // which the badge/toggle handle by staying `aria-hidden` or
              // unlabelled respectively). `Decoration.node`, not a mark or an
              // attribute write: the document is still never mutated, and
              // this is recomputed on every pass alongside the widgets below,
              // so it tracks edits to the heading's own text.
              if (section.text !== '') {
                decorations.push(
                  Decoration.node(
                    section.pos,
                    section.contentStart,
                    { 'aria-label': section.text },
                    { foldWidget: 'name' },
                  ),
                );
              }

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
                  // `Decoration.widget` passes a FRESH arrow function every
                  // call, and `WidgetType.eq` falls back to comparing that
                  // function's IDENTITY when `spec.key` is absent — which
                  // always fails, so ProseMirror destroyed and rebuilt this
                  // widget's DOM on every single `decorations(state)` pass
                  // (every keystroke anywhere in the document, not just this
                  // heading). A stable `key`, scoped to what actually changes
                  // the rendered output (`folded`), lets `eq` short-circuit on
                  // the key alone and reuse the existing DOM instead.
                  key: `toggle-${folded}`,
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
                  key: `badge-${section.level}`,
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
                    // No variable content (always "…"), but the same
                    // rebuild-on-every-pass cost applies without a key.
                    key: 'marker',
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
          // NOTHING in a real browser — this half is MEASURED, not inferred.
          // Measured with Playwright against real Chromium, across many isolated
          // experiments (seven of them enumerated in this task's fix report):
          // once a heading contains ANY
          // `Decoration.widget` — which ProseMirror itself always renders
          // with `contentEditable = "false"` — `.focus()` silently fails for
          // EVERY descendant of that heading, not just the widget: a
          // manually injected, unrelated `<button tabindex="0">` placed
          // anywhere else in the same heading (before the widgets, after
          // them, cloned from the real toggle with its own attributes
          // stripped) is equally unfocusable, synchronously and permanently,
          // even when called completely outside any keydown handler via a
          // detached `page.evaluate()`. The SAME heading with the widgets
          // removed — or with only the `aria-label` node decoration from
          // above and no widgets — allows normal focus. So this is not a bug
          // in this file's CSS, attributes, or event handling.
          //
          // What actually causes it is a HYPOTHESIS, not something measured
          // directly: the pattern above is consistent with Chromium excluding
          // a whole editing-host subtree from the focusable-area set once it
          // contains a `contenteditable="false"` widget island, but that is
          // an inference from those experiments, not a citation of the
          // spec text or of Chromium's own source. Experiment 1 (a BARE
          // heading with no decorations at all still allows a plain injected
          // button to focus) already rules out the naive "nothing inside a
          // contenteditable is ever focusable" reading of that rule — so
          // whatever the precise trigger is, it is more specific than that.
          // Trust the measured behaviour above; treat this paragraph as an
          // open question, not an established mechanism.
          //
          // Making the toggle genuinely keyboard-reachable via a focusable
          // element would need the control to live OUTSIDE the widget's
          // `contenteditable="false"` DOM entirely (e.g. a React-rendered
          // overlay positioned off the heading's own `getBoundingClientRect()`,
          // the same idea `HeadingMenuRequest.rect` already uses) — a
          // structural change out of scope here. Reachability is instead
          // provided by `addKeyboardShortcuts` above (`Mod-Alt-f`), which
          // needs no focusable element at all.

          // A folded section's blocks are hidden with `display: none` but
          // still occupy document positions, so a caret sitting at the fold
          // boundary can Backspace/Delete content the user cannot see, with
          // no visual feedback that anything happened. This intercepts
          // exactly that: a single keypress unfolds instead of deleting.
          //
          // Deliberately asymmetric with a real selection: select-all then
          // Delete still deletes folded content, because that is the user
          // pointing at a range whose bounds they CAN see (the selection
          // highlight), and it is undoable. Only a collapsed caret is guarded
          // here — `!selection.empty` returns false unconditionally, letting
          // any non-empty selection fall through to normal deletion.
          //
          // Two keys each, not one: `@tiptap/core`'s own built-in `Keymap`
          // extension binds the macOS delete-variant chords — `Ctrl-h` and
          // `Alt-Backspace` alongside plain `Backspace`; `Ctrl-d`, `Alt-d` and
          // `Alt-Delete` alongside plain `Delete` — to the SAME
          // `deleteSelection → … → joinForward/joinBackward` chain plain
          // Backspace/Delete run. `Alt-Backspace`, `Ctrl-Alt-Backspace` and
          // `Alt-Delete` still report `event.key` as `'Backspace'`/`'Delete'`
          // (Alt/Ctrl are modifiers, not a different key), so the plain
          // `event.key` check already catches those — but `Ctrl-h` and
          // `Ctrl-d`/`Alt-d` report `event.key` as the literal letter, so
          // without checking for them explicitly a Mac user pressing the
          // Emacs-style chord would destroy hidden content right past this
          // guard.
          //
          // `isMacOS()`-gated, NOT unconditional: `@tiptap/core`'s own
          // `Keymap` extension only merges `macKeymap` — the object binding
          // `Ctrl-h`/`Ctrl-d`/`Alt-d` at all — inside an `isMacOS() ||
          // isiOS()` branch (see `dist/index.js` around its `pcKeymap` /
          // `macKeymap` split). On Windows or Linux those chords carry no
          // delete meaning in this app; `Ctrl-h` and `Ctrl-d` are real,
          // unrelated OS/browser shortcuts there, and intercepting them would
          // unfold a section the user never asked to touch. The modifier
          // check on top keeps a PLAIN "h" or "d" keystroke (ordinary typing)
          // from ever matching, on any platform.
          handleKeyDown(view, event) {
            // Enter at the end of a folded heading's own line runs
            // `splitBlock`, which inserts the new empty paragraph at that
            // position — INSIDE the section's hidden range (`hiddenRangesFor`
            // hides `[contentStart, end)`, and this caret sits at
            // `contentStart - 1`, i.e. right where the split lands). Nothing is
            // destroyed, unlike the Backspace/Delete hazards below, but the
            // user is left typing into a `display: none` node with no visual
            // feedback that anything happened — the most natural thing to do
            // right after clicking a heading line.
            //
            // Unfold-and-LET-THE-SPLIT-PROCEED, not unfold-and-consume: Enter
            // is not a destructive keystroke the way Backspace/Delete are, so
            // swallowing it (returning `true`, doing nothing but unfold) would
            // make the key silently stop doing its normal job. Dispatching the
            // unfold here updates `view.state` synchronously, and returning
            // `false` lets the keymap-bound `splitBlock` run next against that
            // ALREADY-unfolded state — the same document position is still
            // valid because the unfold transaction carries no steps, only
            // meta. The net effect is: the section reveals itself and THEN the
            // new paragraph is created in it, visibly, exactly what a user
            // pressing Enter there expects.
            if (event.key === 'Enter') {
              const { selection } = view.state;
              if (!selection.empty) return false;

              const keys = new Set(foldedKeys(view.state));
              if (keys.size === 0) return false;

              const at = selection.from;
              const section = headingSections(view.state.doc).find((s) => {
                if (!keys.has(serializeFoldKey(foldKeyOf(s)))) return false;
                if (s.end <= s.contentStart) return false;
                return at === s.contentStart - 1;
              });
              if (!section) return false;

              view.dispatch(setKeys(view.state.tr, nextKeysToggling(view.state, section)));
              return false;
            }

            const macChord = isMacOS();
            const isBackspace =
              event.key === 'Backspace' || (macChord && event.key === 'h' && event.ctrlKey);
            const isDelete =
              event.key === 'Delete' ||
              (macChord && event.key === 'd' && (event.ctrlKey || event.altKey));
            if (!isBackspace && !isDelete) return false;

            const { selection } = view.state;
            if (!selection.empty) return false;

            const keys = new Set(foldedKeys(view.state));
            if (keys.size === 0) return false;

            const at = selection.from;
            const docSize = view.state.doc.content.size;
            const section = headingSections(view.state.doc).find((s) => {
              if (!keys.has(serializeFoldKey(foldKeyOf(s)))) return false;
              if (s.end <= s.contentStart) return false;
              if (isDelete) {
                // Forward from the caret at the end of the heading's own
                // line — the last position that is still VISIBLE, right
                // before the hidden body begins.
                return at === s.contentStart - 1;
              }
              // Backspace's reachable hazard is NOT `contentStart + 1` — that
              // position is one character into the section's hidden body
              // (`hiddenRangesFor` hides `[contentStart, end)`), so it sits
              // inside `display: none` content no caret can ever actually
              // land on. The hazard a user really hits is the caret at the
              // START of the first VISIBLE block after the folded section
              // (measured: the next top-level heading, since `end` is
              // defined as that heading's own `pos` — see `headingSections`).
              // Backspacing there runs `joinBackward`, which merges that
              // visible block into the section's last HIDDEN block — for
              // example merging a following heading into a hidden paragraph,
              // silently deleting the heading. `s.end < docSize` guards the
              // case where the folded section runs to the end of the
              // document and there is no following block to backspace from
              // at all.
              return s.end < docSize && at === s.end + 1;
            });
            if (!section) return false;

            // Unfold instead of deleting. A single keypress must never destroy
            // content the user cannot see. Select-all-then-delete DOES still
            // delete folded content — that is the user asking for the whole
            // document, and it is undoable.
            view.dispatch(setKeys(view.state.tr, nextKeysToggling(view.state, section)));
            return true;
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              const badge = target?.closest('[data-fold-badge]');
              const toggle = target?.closest('[data-fold-toggle]');
              if (!badge && !toggle) return false;
              if (event.button !== 0) return false;

              // Widgets are rendered as CHILDREN of the heading (`section.pos
              // + 1`, not `section.pos` — see the widget decoration above), so
              // the badge/toggle element's own `parentElement` is the heading
              // DOM node itself, and `posAtDOM(el, 0)` resolves to the position
              // right before the heading's first child — which is inside the
              // heading, i.e. `section.pos < pos < section.contentStart`. The
              // section lookup below matches on exactly that range rather than
              // on `pos === section.pos`, which a widget click could never
              // satisfy.
              const pos = view.posAtDOM((badge ?? toggle)!.parentElement as globalThis.Node, 0);
              const section = headingSections(view.state.doc).find(
                (s) => s.pos <= pos && pos < s.contentStart,
              );
              if (!section) return false;

              // `preventDefault` before dispatching, not after asking: unlike a
              // tag pill, this element is chrome the user cannot type into, so
              // there is no "behave like a plain click" fallback worth
              // preserving. What must not happen is the caret jumping to the
              // widget's position.
              event.preventDefault();

              if (toggle) {
                view.dispatch(setKeys(view.state.tr, nextKeysToggling(view.state, section)));
                return true;
              }

              if (onOpenMenu === null) return false;
              onOpenMenu({
                pos: section.pos,
                level: section.level,
                folded: foldedKeys(view.state).includes(serializeFoldKey(foldKeyOf(section))),
                rect: (badge as HTMLElement).getBoundingClientRect(),
              });
              return true;
            },
          },
        },
      }),
    ];
  },
});
