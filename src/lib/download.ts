/**
 * Hands a blob to the user as a file download.
 *
 * There is no way to do this without touching the DOM: a programmatic download
 * is an anchor with a `download` attribute that gets clicked. Lives in
 * `src/lib/` because it knows nothing about notes, scopes or persistence — it is
 * framework-level behaviour, like `useFlushTriggers`.
 *
 * `doc` is a parameter rather than a global read so the whole thing is testable
 * under jsdom, which implements none of this.
 */
export function downloadBlob(filename: string, blob: Blob, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  // Belt and braces: `download` already prevents navigation, but a browser that
  // ignored it would otherwise get a same-tab navigation with an opener.
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  doc.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Deliberately deferred, not immediate. Revoking in the same task as the
  // click cancels the download outright in some browsers, because the fetch of
  // the blob URL has not started yet. Deferring by one task is the documented
  // workaround; never revoking would leak the blob for the page's lifetime.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
