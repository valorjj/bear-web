import type { MouseEvent } from 'react';

/**
 * Stops a chrome control taking the keyboard from the note.
 *
 * Chromium focuses a `<button>` synchronously on mousedown, while Tiptap's
 * `focus()` command defers the real `view.focus()` to a
 * `requestAnimationFrame` (see `@tiptap/core`'s `commands/focus.ts`). Between
 * the click handler returning and the next frame, DOM focus is on the BUTTON
 * — so a `Space` or `Enter` pressed in that window ACTIVATES IT AGAIN rather
 * than reaching the note.
 *
 * That window is normally one frame, which is why this survived from M4: a
 * person's next keystroke after a mouse click is far slower than 16ms. It is
 * not survivable under load, and the consequence is not cosmetic — for an
 * insert command each extra activation inserts again. `footnotes.spec.ts`
 * failed about half of all back-to-back full e2e runs with THREE footnotes
 * where one was expected and the typed text missing entirely; the browser had
 * delivered one `click` with `detail: 1` at real coordinates and two more with
 * `detail: 0` at `0,0`, the signature of a keyboard activation. The text that
 * "went missing" was typed into the button, and its two spaces were the two
 * extra footnotes.
 *
 * `preventDefault` on mousedown is the standard editor-chrome answer and
 * costs nothing a keyboard user needs: it suppresses the browser's
 * focus-on-mouse-press default only. Tab still reaches the control, and Space
 * and Enter still activate it once it is genuinely focused.
 *
 * This is NOT the same concern as `pinAllSelectionStep`, which keeps the
 * editor's SELECTION honest across a click on chrome. The selection already
 * survived; DOM focus did not, and the two are separate. `HighlightPalette`
 * carries a comment reasoning about the selection and concluding
 * `preventDefault` "would be wrong here" — that reasoning is about the caret
 * and remains true; it simply does not address focus.
 */
export function keepEditorFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}
