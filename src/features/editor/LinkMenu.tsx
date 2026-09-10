import { type FormEvent, type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { useT } from '@/i18n';
import { useAnchoredMenu } from '@/lib/useAnchoredMenu';
import { Button } from '@/ui/Button';

export interface LinkMenuProps {
  /**
   * Where to put it: the SELECTION's viewport rectangle, and the toolbar
   * button that opened it (or `null` when the context menu did).
   */
  anchor: { rect: DOMRect; opener: HTMLElement | null };
  /** The href already on the selection, or `''` for a selection with no link. */
  initialHref: string;
  /** Whether a link mark is already there — decides Save vs Add, and whether Remove exists. */
  hasLink: boolean;
  onSubmit: (href: string) => void;
  onRemove: () => void;
  /** Closes without changing the document — Escape, or Cancel. */
  onDismiss: () => void;
}

/**
 * Turns what the user typed into an href, or `null` to mean "nothing usable".
 *
 * A bare `example.com` gets `https://`. Without it the browser resolves the
 * href RELATIVE to the current page, so `example.com` in a note becomes
 * `https://markflowing.com/example.com` — a link that looks right in the
 * editor and 404s when anyone follows it, including in an exported document
 * where there is no app to notice.
 *
 * Four shapes are left exactly as typed, because each is already resolvable
 * and prefixing would break it:
 *
 * - anything carrying its own scheme (`https:`, `mailto:`, `tel:`, and any
 *   other — matched by grammar, not by an allowlist, so a scheme nobody here
 *   anticipated still passes through)
 * - a protocol-relative `//host/path`
 * - a site-root path `/notes/x`
 * - a pure fragment `#heading`
 *
 * `javascript:` is NOT special-cased here. Sanitising is `@tiptap/extension-link`'s
 * job and it already refuses that scheme; a second, weaker check written here
 * would be the one someone later trusts.
 */
export function normalizeHref(raw: string): string | null {
  const href = raw.trim();
  if (href === '') return null;
  if (href.startsWith('//') || href.startsWith('/') || href.startsWith('#')) return href;
  // A scheme per RFC 3986: letter, then letters/digits/`+`/`-`/`.`, then a colon.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href;
  return `https://${href}`;
}

/**
 * The link address, as a popover anchored to the SELECTION.
 *
 * Replaces `window.prompt`, which was the OS dialog rather than the app's —
 * unstyled, unthemeable, and modal to the whole tab. It also carried a real
 * defect this component fixes by construction: `prompt` returns `null` on
 * Cancel, and the old handler read that as "unset the link", so dismissing
 * the dialog DESTROYED an existing link. Here dismissing calls `onDismiss`,
 * which touches nothing.
 *
 * It first shipped in the toolbar's popover column, beside the highlight and
 * callout menus, and moved here on request. The difference is real rather
 * than cosmetic: those two are menus hanging off a specific BUTTON, so the
 * button is the thing to point at, while this one is about the text under the
 * caret and belongs next to it. The cost of the move is that it must render
 * outside the toolbar's positioned wrapper — see `RichEditor`, and
 * `CalloutMenu`'s docblock, which records why: that wrapper takes a
 * `transform` when the virtual keyboard is up, and a transformed ancestor
 * becomes the containing block for `position: fixed`, so anything anchored
 * inside it is measured against the toolbar instead of the viewport.
 *
 * A `form`, so Enter submits without a keydown handler of its own. Escape,
 * the outside-click dismissal and the Tab trap all come from
 * `useAnchoredMenu` rather than being hand-rolled here.
 */
export function LinkMenu({
  anchor,
  initialHref,
  hasLink,
  onSubmit,
  onRemove,
  onDismiss,
}: LinkMenuProps): ReactElement {
  const t = useT();
  const [href, setHref] = useState(initialHref);
  const field = useRef<HTMLInputElement | null>(null);
  const labelId = useId();

  /*
   * The same placement, dismissal and Tab trap every other floating surface
   * here uses — flip above when there is no room below, clamp into the
   * viewport, close on Escape or an outside mousedown.
   *
   * Two of those matter more here than for a menu. The clamp measures against
   * `visibleBottom()` rather than `innerHeight`, so a caret near the bottom of
   * a phone screen puts this ABOVE the virtual keyboard instead of behind it.
   * And `opener` is what lets the toolbar's Link button close its own popover:
   * without it the hook's capture listener closes on mousedown and the
   * button's click immediately reopens.
   *
   * `remeasureOn` carries `hasLink`, because the Remove button appears only
   * for an existing link — the popover is one button wider in that state, and
   * the horizontal clamp has to know.
   */
  const { ref, position, onKeyDown } = useAnchoredMenu<HTMLFormElement>(
    anchor.rect,
    onDismiss,
    [hasLink],
    anchor.opener,
  );

  useEffect(() => {
    // The hook focuses the first focusable, which is this field. Selecting is
    // the part it cannot know to do: the common edit is REPLACING an address,
    // and a caret parked at the end of a long URL makes that a manual clear
    // first.
    field.current?.select();
  }, []);

  function handleSubmit(event?: FormEvent): void {
    event?.preventDefault();
    const normalized = normalizeHref(href);
    // An empty field is a dismissal, never an unlink. Removing is what the
    // Remove button is for, and inferring it from emptiness is how the
    // `window.prompt` version destroyed links by accident.
    if (normalized === null) {
      onDismiss();
      return;
    }
    onSubmit(normalized);
  }

  return (
    <form
      ref={ref}
      aria-labelledby={labelId}
      onSubmit={handleSubmit}
      onKeyDown={onKeyDown}
      style={{ top: position.top, left: position.left }}
      // `w-72` is a fixed width rather than a max, so the hook's horizontal
      // clamp has a real number to work with before the field has any content
      // — an intrinsically-sized popover would jump sideways as the user
      // types. `max-w-[calc(100vw-8px)]` keeps that honest below 296px.
      className="bg-surface shadow-popover fixed z-20 flex w-72 max-w-[calc(100vw-8px)] flex-col gap-2 rounded-lg p-2"
    >
      <label id={labelId} htmlFor={`${labelId}-field`} className="px-1 text-ui-xs text-faint">
        {t('editor.link.address')}
      </label>
      <input
        id={`${labelId}-field`}
        ref={field}
        type="text"
        value={href}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setHref(event.target.value)}
        placeholder={t('editor.link.placeholder')}
        // `text-ui-lg` — exactly 1rem — for the reason `SearchField` gives:
        // iOS Safari zooms the page when an input under 16px takes focus and
        // leaves no way back but pinching. Applied at every width on purpose.
        className="h-11 w-full min-w-0 appearance-none rounded-md border border-border bg-bg px-2 text-ui-lg text-text placeholder:text-faint"
      />
      <div className="flex justify-end gap-1">
        {hasLink && (
          <Button onClick={onRemove} variant="ghost" size="sm">
            {t('editor.link.remove')}
          </Button>
        )}
        <Button onClick={onDismiss} variant="ghost" size="sm">
          {t('editor.link.cancel')}
        </Button>
        {/*
         * Click and Enter run the SAME function rather than the button
         * carrying `type="submit"`. `Button` declares its props explicitly and
         * owns none for form semantics — the accessibility ruling is that a
         * presentation primitive may not take arbitrary attributes — so
         * teaching it `type` to save one line here would widen a shared
         * surface for a local convenience. The form's `onSubmit` covers Enter.
         */}
        <Button onClick={() => handleSubmit()} variant="primary" size="sm">
          {hasLink ? t('editor.link.save') : t('editor.link.add')}
        </Button>
      </div>
    </form>
  );
}
