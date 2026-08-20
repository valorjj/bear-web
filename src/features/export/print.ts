export interface PrintDeps {
  /** The document to build the print frame in. A parameter so jsdom can be driven. */
  document?: Document;
  /**
   * Invoked once the frame's document and fonts are ready. Injected because
   * jsdom implements no `window.print` at all — it throws "not implemented" —
   * so this is the only seam a test can hold.
   */
  print?: (frame: HTMLIFrameElement) => void;
}

function defaultPrint(frame: HTMLIFrameElement): void {
  const view = frame.contentWindow;
  if (view === null) return;

  // Focus first: Safari prints the parent document if the frame is not focused.
  view.focus();
  view.print();
}

/**
 * Prints a standalone HTML document via a hidden same-origin iframe.
 *
 * The iframe is the point. Printing the app's own window would mean a print
 * stylesheet that hides three panes, two floating toolbars and a dialog, and
 * every future piece of chrome would silently need adding to it. Printing a
 * separate document means the PDF is exactly what `renderNoteHtml` produced, and
 * the app's own CSS cannot leak into it.
 *
 * Awaits fonts before printing: a print started before the document's fonts
 * resolve lays out in the fallback face and then prints that, which is
 * invisible on screen and obvious in the PDF.
 *
 * Resolves once printing has been requested — not once the user has saved a
 * file, which is not observable.
 */
export async function printHtmlDocument(html: string, deps: PrintDeps = {}): Promise<void> {
  const doc = deps.document ?? document;
  const print = deps.print ?? defaultPrint;

  const frame = doc.createElement('iframe');
  // `srcdoc` rather than `document.write`: it keeps the frame same-origin
  // (so `contentDocument` is reachable) without the deprecated API.
  frame.srcdoc = html;
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('title', '');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  // `visibility`, not `display: none`: a display-none frame has no layout in
  // some engines and prints blank.
  frame.style.visibility = 'hidden';

  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });

  doc.body.append(frame);

  try {
    await loaded;
    await frame.contentDocument?.fonts?.ready;
    print(frame);
  } finally {
    // Always, including when printing threw. A frame left behind holds a whole
    // second document alive, and one per export would accumulate silently.
    frame.remove();
  }
}
