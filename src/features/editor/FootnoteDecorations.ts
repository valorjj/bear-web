import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { footnoteNumbers } from './footnoteNumbers';
import { revealPositionIn } from './HeadingReveal';

export interface FootnoteDecorationsOptions {
  /** The back-link's accessible name, supplied already translated. */
  footnoteBackLabel: string | null;
  /**
   * The 각주 section's heading, supplied already translated. An extension has
   * no access to `useT`, the same contract `linkActivateHint` and
   * `linkEditLabel` follow — and the string must never enter the document, or
   * a note would carry whichever UI language was selected when it was last
   * saved. `Callout.ts` argues this at its own placeholder.
   */
  footnoteSectionLabel: string | null;
}

interface FootnoteState {
  /**
   * Whether the 각주 section is shut.
   *
   * Session state, NOT persisted, and that is deliberate. Heading folds are
   * persisted (`noteFolds`) because the reader chose them section by section
   * and would lose their place; the footnote section is one run at the end of
   * a note, and a list that stayed shut across a reload would read as
   * footnotes that had gone missing.
   */
  collapsed: boolean;
}

const footnoteKey = new PluginKey<FootnoteState>('footnoteDecorations');

function collapsedNow(view: { state: EditorState }): boolean {
  return footnoteKey.getState(view.state)?.collapsed ?? false;
}

/**
 * The label of the marker a number widget belongs to.
 *
 * The widget is the atom's SIBLING, so the label lives on the element next to
 * it rather than on an ancestor — `closest` cannot find it.
 */
function labelBeside(_view: unknown, number: HTMLElement | null): string | null {
  const sibling = number?.nextElementSibling ?? number?.previousElementSibling ?? null;
  return sibling?.getAttribute('data-footnote-ref') ?? null;
}

/** One decoration per marker and per definition, carrying its number. */
function decorationsFor(
  state: EditorState,
  label: string | null,
  backLabel: string | null,
): Decoration[] {
  const numbers = footnoteNumbers(state.doc);
  const decorations: Decoration[] = [];
  const collapsed = footnoteKey.getState(state)?.collapsed ?? false;
  let firstDefinition = true;

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'footnoteRef') {
      const label = String(node.attrs.label ?? '');
      decorations.push(
        Decoration.widget(pos + 1, () => text('bear-footnote-number', numberFor(numbers, label)), {
          side: -1,
          // Chrome, not content: a selection running over the marker must not
          // be affected by the number drawn inside it.
          ignoreSelection: true,
          key: `footnote-ref-${label}-${numbers.get(label) ?? 'x'}`,
        }),
      );
      return false;
    }

    if (node.type.name === 'footnoteDefinition') {
      const key = String(node.attrs.label ?? '');

      if (firstDefinition && label !== null) {
        firstDefinition = false;
        decorations.push(
          Decoration.widget(pos, () => sectionHeader(label, collapsed), {
            side: -1,
            ignoreSelection: true,
            key: `footnote-section-${collapsed}-${label}`,
          }),
        );
      }

      decorations.push(
        Decoration.widget(
          pos + 1,
          () => text('bear-footnote-def-marker', `${numberFor(numbers, key)}. `),
          {
            side: -1,
            ignoreSelection: true,
            key: `footnote-def-${key}-${numbers.get(key) ?? 'x'}`,
          },
        ),
      );

      // The way back, on definitions somebody actually points at. A widget,
      // never a character: anything in the document reaches the user's
      // Markdown and every export.
      if (numbers.has(key)) {
        decorations.push(
          Decoration.widget(pos + node.nodeSize - 1, () => backLink(key, backLabel), {
            side: 1,
            ignoreSelection: true,
            key: `footnote-back-${key}`,
          }),
        );
      }

      // `display: none`, the same mechanism a folded heading section uses, so
      // the two collapses cannot drift apart visually.
      if (collapsed) {
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'bear-fold-hidden' }));
      }
      return false;
    }

    return true;
  });

  return decorations;
}

/**
 * An unreferenced definition keeps its LABEL rather than taking a number.
 * A number is a reference's property; a footnote nobody points at has no
 * position in the sequence, and the label is what lets the writer find it.
 */
function numberFor(numbers: Map<string, number>, label: string): string {
  return String(numbers.get(label) ?? label);
}

/**
 * The 각주 header. A widget above the FIRST definition, never a node: the word
 * is chrome, and anything in the document reaches the user's Markdown and
 * every export.
 */
function sectionHeader(label: string, collapsed: boolean): HTMLElement {
  const holder = document.createElement('div');
  holder.className = 'bear-footnote-section';
  holder.contentEditable = 'false';

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-footnote-section-toggle', '');
  button.setAttribute('aria-expanded', String(!collapsed));
  button.textContent = label;
  holder.append(button);

  return holder;
}

/** The `↩` that returns to a footnote's first marker. */
function backLink(label: string, accessibleName: string | null): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'bear-footnote-back';
  button.contentEditable = 'false';
  button.setAttribute('data-footnote-back', label);
  if (accessibleName !== null) button.setAttribute('aria-label', accessibleName);
  button.textContent = '↩';
  return button;
}

/** The position of the definition for `label`, or `null`. */
function definitionPos(state: EditorState, label: string): number | null {
  let found: number | null = null;
  state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'footnoteDefinition') return true;
    if (String(node.attrs.label ?? '') === label) found = pos;
    return false;
  });
  return found;
}

/**
 * The position of the BLOCK holding the first marker for `label`, or `null`.
 *
 * The block, not the marker: a footnote marker is an atom with no text, so
 * flashing it flashes a zero-width superscript. Landing back in the sentence
 * you came from is the point of the gesture.
 */
function firstMarkerPos(state: EditorState, label: string): number | null {
  let found: number | null = null;
  state.doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'footnoteRef') return true;
    if (String(node.attrs.label ?? '') === label) found = state.doc.resolve(pos).before();
    return false;
  });
  return found;
}

/**
 * Reveals `pos` and brings it on screen.
 *
 * The `typeof` guard is not defensive noise: JSDOM implements no
 * `scrollIntoView` AT ALL, so without it every unit test that clicks a marker
 * throws — the same gap `RichEditor`'s reveal effect documents.
 */
function jumpTo(view: Parameters<typeof revealPositionIn>[0], pos: number): void {
  revealPositionIn(view, pos);
  const node = view.nodeDOM(pos);
  if (node instanceof HTMLElement && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ block: 'center' });
  }
}

function text(className: string, content: string): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.contentEditable = 'false';
  element.textContent = content;
  return element;
}

/**
 * Paints footnote numbers in the editor.
 *
 * Recomputed on every `decorations()` call rather than cached in plugin state.
 * The walk is one pass over a document that already fits in memory, and a
 * cache keyed on anything less than the whole document is how a number goes
 * stale after an edit two paragraphs away — which is the entire failure this
 * construct is prone to, since a marker inserted anywhere renumbers everything
 * after it.
 *
 * The same `footnoteNumbers` serves `renderNoteBody`, so what a reader sees
 * here and what an export contains cannot diverge.
 */
export const FootnoteDecorations = Extension.create<FootnoteDecorationsOptions>({
  name: 'footnoteDecorations',

  addOptions() {
    return { footnoteSectionLabel: null, footnoteBackLabel: null };
  },

  addProseMirrorPlugins() {
    const { footnoteSectionLabel, footnoteBackLabel } = this.options;

    return [
      new Plugin<FootnoteState>({
        key: footnoteKey,

        state: {
          init: () => ({ collapsed: false }),
          apply(tr, value) {
            const meta = tr.getMeta(footnoteKey) as boolean | undefined;
            return meta === undefined ? value : { collapsed: meta };
          },
        },

        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              decorationsFor(state, footnoteSectionLabel, footnoteBackLabel),
            );
          },

          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement | null;
              if (target === null || event.button !== 0) return false;

              if (target.closest('[data-footnote-section-toggle]') !== null) {
                event.preventDefault();
                const collapsed = footnoteKey.getState(view.state)?.collapsed ?? false;
                view.dispatch(view.state.tr.setMeta(footnoteKey, !collapsed));
                return true;
              }

              // A marker: go to its footnote. The number is a widget BESIDE
              // the marker atom rather than inside it (a widget cannot be
              // placed in an atom), so both elements have to be accepted here
              // — clicking the visible number is the gesture a reader makes.
              const marker = target.closest('[data-footnote-ref]');
              const number = target.closest('.bear-footnote-number');
              if (marker !== null || number !== null) {
                const label =
                  marker?.getAttribute('data-footnote-ref') ??
                  labelBeside(view, number as HTMLElement);
                const to = label === null ? null : definitionPos(view.state, label);
                // A marker whose footnote is not written yet declines, leaving
                // the click to place a caret — the same fail-open contract an
                // unresolved `[[link]]` follows.
                if (to === null) return false;
                event.preventDefault();
                if (collapsedNow(view)) view.dispatch(view.state.tr.setMeta(footnoteKey, false));
                jumpTo(view, to);
                return true;
              }

              const back = target.closest('[data-footnote-back]');
              if (back !== null) {
                const label = back.getAttribute('data-footnote-back') ?? '';
                const to = firstMarkerPos(view.state, label);
                if (to === null) return false;
                event.preventDefault();
                jumpTo(view, to);
                return true;
              }

              return false;
            },
          },
        },
      }),
    ];
  },
});
