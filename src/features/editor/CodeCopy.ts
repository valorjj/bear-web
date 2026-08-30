import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import { Check, CircleAlert, Copy, renderIconMarkup } from '@/ui/Icon';

export interface CodeCopyOptions {
  /**
   * Already translated; an extension has no access to `useT`.
   *
   * All three are prefixed `codeCopy*` deliberately. `buildEditorExtensions`
   * spreads every extension's options into ONE object, so a bare `label` or
   * `copyLabel` would silently collide with another extension's — which is
   * exactly how `TableHandles`' `onOpenMenu` once lost to `HeadingFold`'s.
   */
  codeCopyLabel: string | null;
  codeCopiedLabel: string | null;
  codeCopyFailedLabel: string | null;
}

/** How long the button holds its outcome before returning to rest. */
export const COPY_FEEDBACK_MS = 1600;

const codeCopyKey = new PluginKey('codeCopy');

// Computed once at module load, not per widget build. `decorations(state)`
// rebuilds any widget it cannot reuse, and `renderIconMarkup` creates a real
// `<svg>` through `document.createElementNS` on every call — cheap once, not
// something to pay per code block per keystroke. Same reason `HeadingFold`
// precomputes its chevrons.
const COPY_MARKUP = renderIconMarkup(Copy, 'sm');
const CHECK_MARKUP = renderIconMarkup(Check, 'sm');
const ALERT_MARKUP = renderIconMarkup(CircleAlert, 'sm');

type CopyState = 'idle' | 'copied' | 'failed';

const GLYPH: Readonly<Record<CopyState, string>> = {
  idle: COPY_MARKUP,
  copied: CHECK_MARKUP,
  failed: ALERT_MARKUP,
};

interface Labels {
  idle: string | null;
  copied: string | null;
  failed: string | null;
}

/**
 * Paints one of the three states onto the button.
 *
 * The accessible NAME carries the outcome, rather than an `aria-live` region
 * announcing it. ProseMirror rebuilds a widget whenever it cannot reuse the
 * old DOM, and a live region that is torn down and recreated mid-announcement
 * is unreliable; the name is read on focus and survives a rebuild.
 */
function paint(button: HTMLElement, state: CopyState, labels: Labels): void {
  button.dataset.state = state;
  button.innerHTML = GLYPH[state];
  const label = labels[state];
  if (label !== null) button.setAttribute('aria-label', label);
}

function buttonElement(labels: Labels): HTMLElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'bear-code-copy';
  el.setAttribute('data-code-copy', '');
  // `contenteditable="false"` is what makes ProseMirror treat this as chrome
  // rather than as text the user can put a caret inside.
  el.contentEditable = 'false';
  paint(el, 'idle', labels);
  return el;
}

/**
 * The widget: a zero-height positioned anchor holding the button, rendered as
 * the `<pre>`'s previous sibling.
 *
 * The button CANNOT live inside the `<pre>`. `.ProseMirror pre` is
 * `overflow-x: auto`, so any child of it scrolls away with a long line and is
 * clipped at the box's edge — there is no CSS that rescues a child of a scroll
 * container from that. Anchoring outside means horizontal code scrolling
 * cannot move the button at all, which is also the behaviour you want.
 *
 * `side: -1` puts the widget before the block's own DOM at the same level, so
 * the `<pre>` follows the anchor — though NOT always immediately; see
 * `codeTextFor`.
 */
function anchorElement(labels: Labels): HTMLElement {
  const anchor = document.createElement('span');
  anchor.className = 'bear-code-copy-anchor';
  anchor.setAttribute('data-code-copy-anchor', '');
  anchor.setAttribute('contenteditable', 'false');
  anchor.appendChild(buttonElement(labels));
  return anchor;
}

/**
 * The code to copy, read from the RENDERED block rather than from a document
 * position closed over at build time.
 *
 * Positions go stale the moment the document changes; the DOM beside the
 * button is always the current render. `textContent` flattens the highlight
 * spans `CodeBlockLowlight` decorates the block with, so what is copied is
 * exactly the characters on screen — with no fence and no language, because
 * neither is part of the node's text.
 *
 * It SCANS FORWARD rather than taking `nextElementSibling`, and that is not
 * defensive programming — it is required. `CodeLanguageControls` puts its own
 * `side: -1` widget at the same position whenever the caret is inside the
 * block, and that chip then sits between this anchor and the `<pre>`. Reading
 * only the immediate sibling made the button silently fail for exactly the
 * block the user was editing, which is the most likely one to copy.
 */
const MAX_WIDGET_HOPS = 4;

function codeTextFor(button: HTMLElement): string | null {
  let el = button.closest('[data-code-copy-anchor]')?.nextElementSibling ?? null;
  for (let hop = 0; el !== null && hop < MAX_WIDGET_HOPS; hop += 1) {
    if (el.tagName === 'PRE') return (el.querySelector('code') ?? el).textContent;
    el = el.nextElementSibling;
  }
  return null;
}

/**
 * Adds a copy button to every code block.
 *
 * An `Extension`, never a `Node`: it registers nothing in the schema, so every
 * Markdown round-trip suite is untouched by it and a copy button can never
 * reach a note's text or an export. The consequence, as with `HeadingFold`, is
 * that the round-trip tests are blind to whether this plugin runs at all —
 * `codeCopy.test.ts` is the only thing that can catch a dead plugin.
 *
 * One widget PER BLOCK, unlike `CodeLanguageControls`, which anchors a single
 * widget to the block under the caret. Copying a block you are not editing is
 * the whole reason this control exists, so a caret-anchored control would miss
 * the common case.
 */
export const CodeCopy = Extension.create<CodeCopyOptions>({
  name: 'codeCopy',

  addOptions() {
    return { codeCopyLabel: null, codeCopiedLabel: null, codeCopyFailedLabel: null };
  },

  addProseMirrorPlugins() {
    const labels: Labels = {
      idle: this.options.codeCopyLabel,
      copied: this.options.codeCopiedLabel,
      failed: this.options.codeCopyFailedLabel,
    };

    return [
      new Plugin({
        key: codeCopyKey,

        props: {
          decorations(state) {
            const widgets: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'codeBlock') return true;
              widgets.push(
                Decoration.widget(pos, () => anchorElement(labels), {
                  side: -1,
                  // Keyed so an unrelated keystroke reuses the existing DOM
                  // instead of rebuilding it — which would also throw away a
                  // button mid-feedback, resetting a just-copied tick.
                  key: `code-copy-${String(pos)}`,
                }),
              );
              // A code block has no block children worth walking into, and its
              // text nodes cannot contain another one.
              return false;
            });
            return widgets.length === 0
              ? DecorationSet.empty
              : DecorationSet.create(state.doc, widgets);
          },

          handleDOMEvents: {
            // `click`, not `mousedown`: this is a real focusable `<button>`,
            // and Enter or Space on a focused button dispatches a click with
            // no mousedown at all. Binding mousedown would make the control
            // mouse-only for no reason — unlike the fold gutter, which is
            // mouse-only because Chromium refuses focus to anything inside a
            // heading holding a widget. A code block is not a heading, so
            // that exclusion does not apply here.
            click(_view, event) {
              const button = buttonFor(event.target);
              if (!button) return false;
              event.preventDefault();
              copyFrom(button, labels);
              return true;
            },

            /**
             * Enter and Space, because a focused `<button>` inside the editor
             * never receives a synthesized click: ProseMirror handles Enter on
             * `view.dom` first and calls `preventDefault`, so the browser's own
             * activation behaviour never runs. Measured — the control took
             * focus and lit up correctly, and Enter still copied nothing.
             *
             * This is a different obstacle from the fold gutter's. There,
             * Chromium refuses FOCUS to anything inside a heading holding a
             * widget, so no keyboard route through the control exists at all.
             * Here focus works and only activation was missing, which a
             * handler can supply.
             */
            keydown(_view, event) {
              if (event.key !== 'Enter' && event.key !== ' ') return false;
              const button = buttonFor(event.target);
              if (!button) return false;
              event.preventDefault();
              copyFrom(button, labels);
              return true;
            },
          },
        },
      }),
    ];
  },
});

function buttonFor(target: EventTarget | null): HTMLElement | null {
  return (target as HTMLElement | null)?.closest('[data-code-copy]') ?? null;
}

/**
 * Reads the block and writes it to the clipboard, then paints the outcome.
 *
 * Shared by the pointer and keyboard paths so the two cannot drift — the same
 * reason `HeadingFold` keeps its fold arithmetic in one place rather than in
 * both the command and the plugin.
 */
function copyFrom(button: HTMLElement, labels: Labels): void {
  const existing = button.dataset.timer;
  if (existing !== undefined) window.clearTimeout(Number(existing));

  const text = codeTextFor(button);

  // `navigator.clipboard` is absent in jsdom, absent over plain
  // HTTP on a non-localhost origin, and `writeText` REJECTS when
  // the document is not focused. Each of those is silent without
  // this branch, so the button would appear to work and paste
  // something stale. Same shape as `NoteList`'s copy-text row.
  void (
    text === null
      ? Promise.reject(new Error('no code block'))
      : (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard')))
  )
    .then(() => paint(button, 'copied', labels))
    .catch(() => paint(button, 'failed', labels))
    .finally(() => {
      button.dataset.timer = String(
        window.setTimeout(() => {
          paint(button, 'idle', labels);
          delete button.dataset.timer;
        }, COPY_FEEDBACK_MS),
      );
    });
}
