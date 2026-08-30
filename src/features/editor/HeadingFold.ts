import { Extension, isMacOS } from '@tiptap/core';
import { skipTrailingNodeMeta } from '@tiptap/extensions';
import { isHistoryTransaction } from '@tiptap/pm/history';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';

import {
  ChevronDown,
  ChevronRight,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  renderIconMarkup,
} from '@/ui/Icon';

import {
  foldKeyOf,
  headingSections,
  hiddenRangesFor,
  serializeFoldKey,
  type HeadingSection,
} from './headingSections';
import {
  dropBoundaries,
  planSectionMove,
  planSectionShift,
  type SectionMove,
} from './headingReorder';

export interface HeadingFoldOptions {
  /**
   * Called when the user clicks a heading's level badge, with the heading's
   * document position and the badge's screen rectangle. `null` when nobody is
   * listening, which is the state of the schema-only `editorExtensions`
   * constant — and, as with `TagPill.onActivate`, a non-null callback is what
   * makes the plugin consume the click at all. This gates the WHOLE badge
   * gesture, not just the click: `pointerdown`'s handler returns false before
   * `press` is ever set when `onOpenMenu` is `null` (B2), so a consumer that
   * wires the badge but leaves this `null` silently loses drag-to-reorder
   * along with the menu — there is no separate flag for the drag half.
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

/**
 * A snapshot taken every time an explicit fold-changing transaction rides
 * through: the document as it stood BEFORE that transaction, and the keys as
 * they stood before it too. `past`/`future` exist only so a raw
 * `prosemirror-history` undo/redo — which replays inverted STEPS and carries
 * none of this plugin's meta — can still land the fold set back where it was,
 * rather than leaving it stranded mid-move. See `apply` below.
 *
 * Matching a snapshot by CONTENT equality has one inherent limit, narrow but
 * real: `prosemirror-history` groups transactions made within `newGroupDelay`
 * (500 ms by default), so typing immediately followed by a move can become a
 * single undo event whose resulting document does not `eq` the move's
 * snapshot — the folds are then simply not restored, and in a note with
 * duplicate heading titles the retained keys can name the wrong sections.
 * That is a consequence of identifying documents by content rather than a
 * mistake in the code below; closing it would mean tracking history's own
 * event boundaries, which this plugin deliberately does not do.
 */
interface FoldSnapshot {
  doc: Node;
  keys: string[];
}

interface FoldState {
  keys: string[];
  past: FoldSnapshot[];
  future: FoldSnapshot[];
  /**
   * The boundary a live badge drag is currently over, or `null` when no drag
   * is running. Decoration-only, like everything else in this plugin: it moves
   * a drop indicator and nothing else.
   */
  dropAt: number | null;
  /**
   * The `pos` of the section being carried, for the dimming decoration.
   * `null` whenever `dropAt` is.
   */
  dragFrom: number | null;
}

const headingFoldKey = new PluginKey<FoldState>('headingFold');

/**
 * Matches `prosemirror-history`'s own default `depth` option (100): its undo
 * branch never grows past that many entries, so a snapshot older than that
 * corresponds to a history entry that has already been dropped and can never
 * be replayed back to. Left unbounded, an orphaned snapshot would sit in
 * `past`/`future` forever, since nothing will ever again produce a `tr.doc`
 * matching it.
 */
const MAX_FOLD_HISTORY = 100;

function pushCapped(stack: readonly FoldSnapshot[], entry: FoldSnapshot): FoldSnapshot[] {
  const next = [...stack, entry];
  return next.length > MAX_FOLD_HISTORY ? next.slice(next.length - MAX_FOLD_HISTORY) : next;
}

/** Transaction meta carrying the next fold set. */
interface FoldMeta {
  keys: string[];
}

/**
 * Transaction meta carrying the live drag's decoration state, on the SAME
 * plugin key as `FoldMeta`.
 *
 * A separate shape rather than a widened `FoldMeta`, because a drag
 * transaction must never reach the snapshot branch below: it changes no
 * document and no fold set, and pushing it onto `past`/`future` would corrupt
 * the undo stack those exist to keep straight. `FoldMeta` is left exactly as
 * it was — four fold commands and `applyMove` dispatch through `setKeys`.
 */
interface DragMeta {
  drag: { dragFrom: number | null; dropAt: number | null };
}

function isDragMeta(meta: FoldMeta | DragMeta): meta is DragMeta {
  return 'drag' in meta;
}

/** The fold keys currently held in plugin state, in the order they were folded. */
export function foldedKeys(state: EditorState): string[] {
  return headingFoldKey.getState(state)?.keys ?? [];
}

/**
 * Tags a transaction that carries NO document steps so StarterKit's
 * `TrailingNode` leaves the document alone.
 *
 * `TrailingNode`'s `appendTransaction` is ungated on `docChanged` — verified
 * at `@tiptap/extensions`' own compiled source — so a transaction whose only
 * content is a `setMeta` still makes it append an empty paragraph to a note
 * ending in a list or a table, and autosave then writes that edit back. This
 * needs no typing to reach: `NoteEditor` calls `setHeadingFolds` from a mount
 * effect once persisted folds resolve, so merely OPENING such a note grew it
 * a blank paragraph. See the `TrailingNode` entry in
 * `docs/rulings/markdown-and-schema.md`.
 *
 * Applied only when the transaction changed nothing, because `setKeys` is
 * shared: `applyMove` rides a real section move on the same `tr`, and there
 * `TrailingNode`'s append is the wanted behaviour — identical to what any
 * ordinary edit gets.
 */
function quiet(tr: Transaction): Transaction {
  return tr.docChanged ? tr : tr.setMeta(skipTrailingNodeMeta, true);
}

function setKeys(tr: Transaction, keys: string[]): Transaction {
  return quiet(tr.setMeta(headingFoldKey, { keys } satisfies FoldMeta));
}

function setDrag(tr: Transaction, dragFrom: number | null, dropAt: number | null): Transaction {
  return quiet(tr.setMeta(headingFoldKey, { drag: { dragFrom, dropAt } } satisfies DragMeta));
}

/**
 * Distance in pixels a press must travel before it becomes a drag rather than
 * a click. Small enough that a deliberate drag feels immediate, large enough
 * that the hand tremor in an ordinary click never crosses it.
 */
const DRAG_THRESHOLD = 4;

/** How close to the scroller's edge the pointer must get to auto-scroll. */
const AUTO_SCROLL_EDGE = 40;

/** Pixels scrolled per `requestAnimationFrame` tick while at an edge. */
const AUTO_SCROLL_STEP = 12;

/**
 * The scrolling ancestor of the editor — `EditorContent`'s own
 * `overflow-auto` box in this app (see `RichEditor.tsx`), not the window: in
 * a three-pane shell the window never scrolls.
 */
function scrollerFor(view: EditorView): HTMLElement {
  for (let el = view.dom.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return el;
  }
  return view.dom.parentElement ?? view.dom;
}

/**
 * Every drop boundary's vertical position, in the SCROLLER'S DOCUMENT
 * coordinates — `rect.top + scroller.scrollTop`, not the bare viewport
 * `rect.top`.
 *
 * This is measured once, at drag start, and auto-scroll moves the scroller
 * underneath it. A viewport-relative measurement would be correct until the
 * first auto-scroll tick and then silently drop sections at the wrong
 * boundary, which is a wrong RESULT rather than a visible glitch. Converting
 * the pointer the same way (`clientY + scroller.scrollTop`) keeps both sides
 * of the comparison on one origin, so the scroller's own offset cancels.
 */
function measureBoundaries(view: EditorView, scroller: HTMLElement): DropBoundary[] {
  const scrollTop = scroller.scrollTop;
  return dropBoundaries(view.state.doc).map((pos) => ({
    pos,
    y: view.coordsAtPos(pos).top + scrollTop,
  }));
}

interface DropBoundary {
  pos: number;
  y: number;
}

/**
 * A press on the badge that has not yet been released. Held per EDITOR (the
 * closure inside `addProseMirrorPlugins`), never at module scope: two editors
 * on one page would otherwise share one gesture.
 */
interface BadgePress {
  view: EditorView;
  badge: HTMLElement;
  /**
   * The dragged section's `pos`, resolved once at press time. The section
   * itself is looked up again on release rather than captured here, because
   * an edit during the press can move it.
   */
  pos: number;
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  /** Latest viewport Y, kept so an auto-scroll tick can re-pick without an event. */
  clientY: number;
  dragging: boolean;
  boundaries: DropBoundary[];
  /**
   * The document the `boundaries` were measured against, captured at the same
   * moment they were. The plugin's `apply` abandons a drag when the document
   * changes under it, but it cannot reach this closure — so the handlers below
   * compare this against `view.state.doc` and end the press for good.
   */
  doc: Node;
  scroller: HTMLElement | null;
  frame: number | null;
  /** -1 scrolling up, 1 scrolling down, 0 not at an edge. */
  edge: -1 | 0 | 1;
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

/**
 * One glyph per heading level, indexed 1-6, built ONCE at module load for the
 * same reason the two chevrons above are: `decorations(state)` rebuilds any
 * widget it cannot reuse, and `renderIconMarkup` touches the DOM on every call.
 *
 * Six glyphs rather than one generic `Heading`, because the badge's whole job
 * is to say WHICH level this heading is — that is what the digit it replaced
 * conveyed, and losing it would trade a legibility complaint for an
 * information loss.
 */
const HEADING_MARKUP: Readonly<Record<number, string>> = {
  1: renderIconMarkup(Heading1),
  2: renderIconMarkup(Heading2),
  3: renderIconMarkup(Heading3),
  4: renderIconMarkup(Heading4),
  5: renderIconMarkup(Heading5),
  6: renderIconMarkup(Heading6),
};

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
  // `data-level` is now the only machine-readable record of the level here.
  // It used to be redundant with the badge's text; the text is gone.
  el.setAttribute('data-level', String(level));
  // A `Heading1`-`Heading6` glyph, not the bare digit this shipped with. The
  // digit read as a stray number floating beside the heading rather than as a
  // control — reported from the live app — while its sibling two gutter slots
  // to the left was already an icon. `HEADING_MARKUP` is module-level for the
  // same reason the chevrons are; see above.
  el.innerHTML = HEADING_MARKUP[level] ?? '';
  // Historically this was hidden because its digit was the measured pollution
  // source for the heading's accessible name (see the block comment above).
  // The glyph contributes no text, so that specific hazard is gone — but the
  // badge stays hidden and out of tab order regardless: it is a mouse-only
  // duplicate of the level menu that `Mod-Alt-1`-`6` already reaches, and an
  // unnamed `<button>` announcing as "button" is worse than no button at all.
  // `tabIndex = -1` keeps a real `<button>` from being reachable by Tab while
  // `aria-hidden`, which would otherwise be its own violation.
  el.setAttribute('aria-hidden', 'true');
  el.tabIndex = -1;
  return el;
}

/**
 * The drop indicator drawn during a badge drag. Not a `button` and not
 * focusable: it is pure feedback for a pointer gesture already in progress,
 * and it exists only while the pointer is down.
 */
function dropElement(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bear-section-drop';
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
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
      moveHeadingSection: (fromPos: number, toBoundary: number) => ReturnType;
      moveHeadingSectionUp: () => ReturnType;
      moveHeadingSectionDown: () => ReturnType;
    };
  }
}

/**
 * Applies a planned move as ONE transaction, so `history` gives one undo step
 * that restores the order and the folds together.
 *
 * The fold set rides the same `tr` through `setKeys` rather than following in
 * a second dispatch — two transactions would mean two `Mod-Z` presses, and the
 * intermediate state (moved, folds not yet remapped) is exactly the wrong one
 * to be able to stop at.
 */
function applyMove(state: EditorState, move: SectionMove): Transaction {
  const slice = state.doc.slice(move.from, move.to);
  const tr = state.tr.delete(move.from, move.to);
  tr.insert(move.insertAt, slice.content);
  return setKeys(tr, move.foldKeys);
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

      moveHeadingSection:
        (fromPos: number, toBoundary: number) =>
        ({ state, dispatch }) => {
          const move = planSectionMove(state.doc, foldedKeys(state), fromPos, toBoundary);
          if (move === null) return false;
          if (dispatch) dispatch(applyMove(state, move));
          return true;
        },

      moveHeadingSectionUp:
        () =>
        ({ state, dispatch }) => {
          const move = planSectionShift(state.doc, foldedKeys(state), state.selection.from, -1);
          if (move === null) return false;
          if (dispatch) dispatch(applyMove(state, move));
          return true;
        },

      moveHeadingSectionDown:
        () =>
        ({ state, dispatch }) => {
          const move = planSectionShift(state.doc, foldedKeys(state), state.selection.from, 1);
          if (move === null) return false;
          if (dispatch) dispatch(applyMove(state, move));
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

      // `Mod-Alt-ArrowUp`/`Down`, symmetric with `StoredImage`'s shipped
      // `Mod-Alt-ArrowLeft`/`Right` (image resize). Verified against
      // `node_modules/@tiptap`. B1's ruling: a new binding is checked against
      // the PACKAGE, not only against browser shortcuts, because Tiptap's
      // reversed extension order lets a later extension silently win.
      //
      // Both return the command's own `false` when the caret is in no
      // section or the section is already at its end, so the keystroke
      // falls through rather than being swallowed for nothing — the rule
      // `Mod-Alt-f` above follows.
      'Mod-Alt-ArrowUp': () => this.editor.commands.moveHeadingSectionUp(),
      'Mod-Alt-ArrowDown': () => this.editor.commands.moveHeadingSectionDown(),
    };
  },

  addProseMirrorPlugins() {
    const { foldHint, onOpenMenu } = this.options;

    // The live badge press, held per EDITOR in this closure rather than at
    // module scope: two editors on one page would otherwise share one
    // gesture. `null` whenever no button is down on a badge.
    let press: BadgePress | null = null;

    function stopAutoScroll(p: BadgePress): void {
      if (p.frame !== null) {
        cancelAnimationFrame(p.frame);
        p.frame = null;
      }
    }

    /**
     * Ends the gesture and returns what it was, so the caller can decide what
     * the release meant. Always clears the decoration BEFORE anything else
     * dispatches, so a move transaction can never carry a stale drop
     * indicator into the reordered document, where its position means
     * something different.
     *
     * `dispatch` is `false` only when the view itself is going away — a
     * dispatch into a destroyed view throws.
     */
    function endPress(dispatch: boolean): BadgePress | null {
      const p = press;
      press = null;
      if (p === null) return null;
      stopAutoScroll(p);
      // `hasPointerCapture`/`releasePointerCapture` are guarded for the same
      // reason `setPointerCapture` is: jsdom implements none of the three, and
      // releasing a capture that was never taken throws in a real browser.
      if (p.badge.hasPointerCapture?.(p.pointerId)) p.badge.releasePointerCapture?.(p.pointerId);
      if (p.dragging && dispatch) p.view.dispatch(setDrag(p.view.state.tr, null, null));
      return p;
    }

    /**
     * Makes the plugin's mid-drag abandon STICKY, and reports whether it
     * fired. `apply` can clear the plugin's `dragFrom`/`dropAt` when the
     * document changes under a live drag, but it cannot reach this closure:
     * `p.dragging` stays `true` and `p.boundaries` keep naming positions in a
     * document that no longer exists. Without this, the ordinary continuation
     * of the same gesture re-arms the stale drag — `updateDrop`'s skip guard
     * compares `current.dragFrom === p.pos`, which now FAILS precisely because
     * the abandon set `dragFrom` to `null`, so the next `pointermove`
     * re-dispatches `setDrag` with a drop measured against the old document
     * and the release commits a move to a boundary the user never pointed at.
     * That is the exact failure the abandon exists to prevent.
     *
     * Compares the DOCUMENT rather than testing the plugin's `dragFrom` for
     * `null`, which would also work. `dragFrom` is plugin state that any
     * future branch of `apply` could clear for a reason of its own, and this
     * closure would then read that as an edit; "the boundaries were measured
     * against a document that is gone" is the invariant the gesture actually
     * depends on, and it is true independently of how `apply` evolves.
     */
    function abandonedByEdit(p: BadgePress, view: EditorView): boolean {
      if (!p.dragging || view.state.doc === p.doc) return false;
      endPress(true);
      return true;
    }

    /** Picks the boundary nearest the pointer and, if it changed, shows it. */
    function updateDrop(p: BadgePress): void {
      // Converted to the same document-scroll origin the boundaries were
      // measured in; see `measureBoundaries`.
      const y = p.clientY + (p.scroller?.scrollTop ?? 0);
      let best: DropBoundary | null = null;
      for (const boundary of p.boundaries) {
        if (best === null || Math.abs(boundary.y - y) < Math.abs(best.y - y)) best = boundary;
      }
      const dropAt = best?.pos ?? null;
      // Dispatch only on a real change. A pointermove fires per pixel, and
      // every dispatch rebuilds the decoration set for the whole document.
      const current = headingFoldKey.getState(p.view.state);
      if (current?.dragFrom === p.pos && current.dropAt === dropAt) return;
      p.view.dispatch(setDrag(p.view.state.tr, p.pos, dropAt));
    }

    /**
     * Runs the scroller while the pointer sits within `AUTO_SCROLL_EDGE` of
     * its top or bottom, so a section can be dragged past the visible page.
     *
     * The `scrollHeight <= clientHeight` guard is load-bearing, not defensive
     * tidying: an unscrollable box (every box in jsdom, whose layout is all
     * zeroes) would otherwise report the pointer as permanently at its bottom
     * edge and spin a `requestAnimationFrame` loop for the rest of the
     * process.
     */
    function updateAutoScroll(p: BadgePress): void {
      const scroller = p.scroller;
      if (scroller === null || scroller.scrollHeight <= scroller.clientHeight) {
        p.edge = 0;
        stopAutoScroll(p);
        return;
      }
      const rect = scroller.getBoundingClientRect();
      p.edge =
        p.clientY - rect.top < AUTO_SCROLL_EDGE
          ? -1
          : rect.bottom - p.clientY < AUTO_SCROLL_EDGE
            ? 1
            : 0;
      if (p.edge === 0) {
        stopAutoScroll(p);
        return;
      }
      if (p.frame !== null) return;
      p.frame = requestAnimationFrame(function tick(): void {
        // `press !== p` covers a release that landed between two frames.
        if (press !== p || !p.dragging || p.edge === 0 || p.scroller === null) {
          p.frame = null;
          return;
        }
        p.scroller.scrollTop += p.edge * AUTO_SCROLL_STEP;
        // Re-picked every tick: the pointer has not moved, but the document
        // has moved under it, so the nearest boundary has changed.
        updateDrop(p);
        p.frame = requestAnimationFrame(tick);
      });
    }

    return [
      new Plugin<FoldState>({
        key: headingFoldKey,

        state: {
          init: () => ({ keys: [], past: [], future: [], dropAt: null, dragFrom: null }),
          apply(tr, value, oldState) {
            const meta = tr.getMeta(headingFoldKey) as FoldMeta | DragMeta | undefined;

            // The drag's own branch, deliberately BEFORE the fold branch and
            // deliberately touching nothing but the two drag fields. A drag
            // transaction has no steps and no new fold set; if it fell through
            // to the snapshot logic below it would push entries onto
            // `past`/`future` for a document that never changed, which is the
            // exact defect the `tr.docChanged` guard there exists to prevent.
            if (meta && isDragMeta(meta)) {
              return { ...value, dragFrom: meta.drag.dragFrom, dropAt: meta.drag.dropAt };
            }

            // A document change under a LIVE DRAG abandons the drag, rather
            // than mapping its positions forward. Reachable: the badge press
            // calls `preventDefault` but does not move focus, so the caret is
            // still live and a keystroke with the button held lands in the
            // document.
            //
            // Clearing beats mapping because `BadgePress.boundaries` was
            // measured ONCE, against a document that no longer exists once
            // `tr.docChanged` is true: `tr.mapping` could carry `dropAt` and
            // `dragFrom` forward, but nothing maps the `boundaries` array
            // itself, so the drop would land somewhere the user never pointed
            // at. A wrong result is exactly what this plugin's document-
            // coordinate conversion exists to prevent, and abandoning the drag
            // is what a user who just typed expects anyway. The release path
            // already handles the cleared state: `dropAt === null` returns
            // without dispatching.
            //
            // Computed HERE, once, and used in place of `value` by EVERY
            // branch below — not as a branch of its own at the bottom. As its
            // own branch it was unreachable for the two transactions that most
            // need it: a fold-meta transaction that also changes the document
            // (`Mod-Alt-ArrowUp` with the badge held) and a history transaction
            // matching a snapshot (`Mod-Z` with the badge held) both `return`
            // above it, and the drag survived into a document it was never
            // measured against.
            //
            // This does NOT guard against a crash. An earlier version of this
            // comment claimed a stale `dropAt` past `doc.content.size` makes
            // `DecorationSet.create` throw an uncaught `RangeError` from
            // inside `decorations` — tested and FALSE (2026-08-29): a
            // throwaway test monkey-patched `coordsAtPos` to force the LAST
            // boundary to be selected, the exact condition the claim needed,
            // then shrank the document. Nothing threw on any run; the widget
            // silently disappeared instead. `prosemirror-view`'s
            // `domFromPos` clamps backward for `side <= 0` rather than
            // throwing (`node_modules/prosemirror-view/dist/index.js:922-960`),
            // and the `RangeError` in that file (`domAfterPos`, ~:1014) is
            // only on the selection-anchoring path, never widget rendering.
            // Do not re-derive the crash claim; the misplaced-drop rationale
            // above is the whole reason this exists.
            const base =
              tr.docChanged && value.dragFrom !== null
                ? { ...value, dragFrom: null, dropAt: null }
                : value;

            if (meta) {
              // A real fold-set change: remember what it was, so an undo of
              // THIS transaction has something to restore. Any pending redo
              // is discarded, same as `prosemirror-history` itself does for
              // a fresh edit.
              //
              // Only pushed when `tr.docChanged`. A plain fold TOGGLE is a
              // zero-step transaction, and `prosemirror-history` itself never
              // records one (`if (tr.steps.length == 0) return history;`,
              // `prosemirror-history`'s `applyTransaction`) — so it can never
              // be the transaction a later undo replays. A snapshot pushed
              // for it anyway would carry `doc: oldState.doc`, which for a
              // zero-step transaction IS the current document; a later,
              // unrelated undo (of an ordinary edit made afterward) can land
              // back on that exact document and wrongly match it, rolling
              // the fold back to before the toggle. Excluding zero-step
              // transactions removes the only way a snapshot's document can
              // equal a live one it wasn't meant to answer for.
              return tr.docChanged
                ? {
                    ...base,
                    keys: meta.keys,
                    past: pushCapped(base.past, { doc: oldState.doc, keys: base.keys }),
                    future: [],
                  }
                : { ...base, keys: meta.keys };
            }

            // No meta of ours: a normal edit (typing, an unrelated command)
            // or a `prosemirror-history` undo/redo replaying INVERTED STEPS,
            // which carries none of the meta above — history stores steps,
            // not plugin state, so the fold set is not naturally part of
            // what it replays. Only a genuine history transaction is checked
            // against the snapshots at all, so a coincidentally-identical
            // document from ordinary typing can't misfire this.
            //
            // A structural-equality match is safe rather than merely
            // convenient: fold identity is itself content-derived
            // (`level:nth:text`), so if a document `eq`s a snapshot's
            // document, that snapshot's keys ARE the correct keys for that
            // content, whatever edit actually produced it. The only way this
            // could go wrong is a snapshot whose document was never actually
            // history-tracked — which is exactly what the `tr.docChanged`
            // guard above rules out.
            if (isHistoryTransaction(tr)) {
              const undone = base.past.at(-1);
              if (undone && undone.doc.eq(tr.doc)) {
                return {
                  ...base,
                  keys: undone.keys,
                  past: base.past.slice(0, -1),
                  future: pushCapped(base.future, { doc: oldState.doc, keys: base.keys }),
                };
              }
              const redone = base.future.at(-1);
              if (redone && redone.doc.eq(tr.doc)) {
                return {
                  ...base,
                  keys: redone.keys,
                  past: pushCapped(base.past, { doc: oldState.doc, keys: base.keys }),
                  future: base.future.slice(0, -1),
                };
              }
            }

            // Keys are content-derived, so an ordinary document change needs
            // no mapping — the identity is re-matched against the new
            // document on every decoration pass. An unmatched key is
            // RETAINED rather than dropped: renaming a heading and renaming
            // it back should restore the fold, and a key that matches
            // nothing hides nothing anyway.
            return base;
          },
        },

        props: {
          decorations(state) {
            const fold = headingFoldKey.getState(state);
            const keys = new Set(fold?.keys ?? []);

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

            // The section currently being carried, dimmed so the drop
            // indicator reads as the answer rather than competing with it.
            // Top-level blocks only, for the same reason `bear-fold-hidden`
            // above decorates only those: decorating a block and its
            // descendants would apply the opacity twice and compound it.
            if (fold?.dragFrom != null) {
              const source = headingSections(state.doc).find((s) => s.pos === fold.dragFrom);
              if (source) {
                state.doc.nodesBetween(source.pos, source.end, (node, pos) => {
                  if (pos < source.pos || pos >= source.end) return false;
                  if (state.doc.resolve(pos).depth !== 0) return false;
                  decorations.push(
                    Decoration.node(
                      pos,
                      pos + node.nodeSize,
                      { class: 'bear-section-dragging' },
                      { sectionDrag: true },
                    ),
                  );
                  return false;
                });
              }
            }

            // The drop indicator: a rule at the target boundary, drawn OUTSIDE
            // any block. B1's `pos + 1` widget rule does NOT apply here, and
            // that is deliberate rather than an oversight — that rule exists so
            // a fold widget becomes a CHILD of its heading element, and this
            // widget sits at a top-level boundary between blocks on purpose.
            // `+ 1` would put the rule inside the following heading's text.
            if (fold?.dropAt != null) {
              const dropAt = fold.dropAt;
              decorations.push(
                Decoration.widget(dropAt, () => dropElement(), {
                  side: -1,
                  ignoreSelection: true,
                  sectionDrop: true,
                  // Required, not tidying: without a `key`, `WidgetType.eq`
                  // compares the fresh arrow function's identity, always fails,
                  // and rebuilds this element's DOM on every single
                  // `decorations(state)` pass — the same cost the module-level
                  // `renderIconMarkup` constants at the top of this file exist
                  // to avoid, paid here on every pointermove of a live drag.
                  key: `drop-${dropAt}`,
                }),
              );
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
            // Escape aborts a live drag: the indicator disappears, the section
            // stays exactly where it was, and NOTHING is dispatched to the
            // document.
            //
            // Handled here rather than on a `window` keydown listener so every
            // keyboard concern of this plugin stays in one place and is
            // torn down with the plugin. `true` — consuming the key — ONLY
            // while a drag is actually live: Escape has other jobs in this
            // editor (closing the heading menu, the code-language list) and
            // must keep them.
            if (event.key === 'Escape') {
              if (press === null || !press.dragging) return false;
              endPress(true);
              return true;
            }

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
            /**
             * The badge is now a PRESS, not a click: it opens its menu on
             * RELEASE, and a press that travels far enough becomes a drag that
             * moves the whole section instead. The toggle is untouched — it
             * still folds on press, which is what a disclosure control should
             * do and what B1 shipped.
             *
             * Pointer events, not mouse events: one code path covers mouse,
             * pen and touch, and `setPointerCapture` is what keeps the move and
             * release events coming to the badge once the pointer has left it.
             */
            pointerdown(view, event) {
              const target = event.target as HTMLElement | null;
              const badge = target?.closest('[data-fold-badge]') as HTMLElement | null;
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

              // The badge's whole gesture — menu and drag alike — is live only
              // when someone is listening, exactly as before B2. This keeps the
              // schema-only `editorExtensions` constant inert, and the shipped
              // app always wires `onOpenMenu` (see `RichEditor.tsx`).
              if (onOpenMenu === null) return false;

              // A second press while one is live: end the first properly
              // rather than overwriting it, which would strand its pointer
              // capture forever. Not reachable through the real UI, but the
              // state machine should not depend on that being true.
              if (press !== null) endPress(true);

              // Guarded: jsdom has a real `PointerEvent` constructor but no
              // `Element.prototype.setPointerCapture` at all (measured
              // 2026-08-29), so an unguarded call makes every unit test that
              // presses this badge throw.
              badge!.setPointerCapture?.(event.pointerId);

              // No menu and no transaction yet. Which of the two this press
              // turns out to be is not known until it moves or releases.
              press = {
                view,
                badge: badge!,
                pos: section.pos,
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                startX: event.clientX,
                startY: event.clientY,
                clientY: event.clientY,
                dragging: false,
                boundaries: [],
                doc: view.state.doc,
                scroller: null,
                frame: null,
                edge: 0,
              };
              return true;
            },

            pointermove(view, event) {
              const p = press;
              if (p === null || event.pointerId !== p.pointerId) return false;
              if (abandonedByEdit(p, view)) return true;
              p.clientY = event.clientY;

              if (!p.dragging) {
                // Mouse and pen only. On touch, a press that slides is the
                // user scrolling the note, and stealing it to drag a section
                // would make the editor unscrollable from its own gutter —
                // which is also why this is checked against the POINTER TYPE
                // rather than against a long-press timer.
                if (p.pointerType !== 'mouse' && p.pointerType !== 'pen') return false;
                const travelled = Math.hypot(event.clientX - p.startX, event.clientY - p.startY);
                if (travelled <= DRAG_THRESHOLD) return false;

                p.dragging = true;
                p.scroller = scrollerFor(view);
                // Measured ONCE, here. See `measureBoundaries` for why the
                // result is in document rather than viewport coordinates.
                p.boundaries = measureBoundaries(view, p.scroller);
                p.doc = view.state.doc;
              }

              updateDrop(p);
              updateAutoScroll(p);
              return true;
            },

            pointerup(view, event) {
              const p = press;
              if (p === null || event.pointerId !== p.pointerId) return false;
              event.preventDefault();
              if (abandonedByEdit(p, view)) return true;

              // Read the chosen boundary BEFORE `endPress` clears it.
              const dropAt = p.dragging
                ? (headingFoldKey.getState(view.state)?.dropAt ?? null)
                : null;
              endPress(true);

              if (!p.dragging) {
                // A press that never travelled is a click, and a click opens
                // the menu — the job the old `mousedown` handler did.
                const section = headingSections(view.state.doc).find((s) => s.pos === p.pos);
                if (!section || onOpenMenu === null) return false;
                onOpenMenu({
                  pos: section.pos,
                  level: section.level,
                  folded: foldedKeys(view.state).includes(serializeFoldKey(foldKeyOf(section))),
                  rect: p.badge.getBoundingClientRect(),
                });
                return true;
              }

              if (dropAt === null) return true;
              // A raw plugin cannot reach `editor.commands`, so the plan and
              // its application are re-run here from the same two functions
              // `moveHeadingSection` uses — not duplicated logic, the same
              // logic reached from the other side. `planSectionMove` returns
              // `null` for both no-op boundaries (the section's own start and
              // its own end), which is exactly the drop that should do nothing.
              const move = planSectionMove(view.state.doc, foldedKeys(view.state), p.pos, dropAt);
              if (move !== null) view.dispatch(applyMove(view.state, move));
              return true;
            },

            // A cancelled pointer (the OS took it, a gesture was interrupted)
            // aborts exactly like Escape: clear, dispatch nothing.
            pointercancel(_view, event) {
              if (press === null || event.pointerId !== press.pointerId) return false;
              endPress(true);
              return true;
            },
          },
        },

        // A press outlives no editor. Without this, an editor destroyed
        // mid-drag leaves a `requestAnimationFrame` loop holding a reference
        // to a torn-down view, which then dispatches into it.
        view() {
          return {
            destroy() {
              endPress(false);
            },
          };
        },
      }),
    ];
  },
});
