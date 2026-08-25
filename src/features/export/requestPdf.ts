import { API_ORIGIN } from '@/data/sync/config';

/**
 * Why an export can fail, and only these six ways.
 *
 * Six, not one: a user with no connectivity and a user whose renderer is down
 * need different sentences, and a single "export failed" tells neither of
 * them anything they can act on.
 */
export type PdfFailure =
  'offline' | 'unauthorized' | 'tooLarge' | 'rateLimited' | 'unavailable' | 'failed';

export class PdfExportError extends Error {
  readonly reason: PdfFailure;

  constructor(reason: PdfFailure) {
    super(`pdf export failed: ${reason}`);
    this.name = 'PdfExportError';
    this.reason = reason;
  }
}

/**
 * The server distinguishes "unreachable or shedding load" (503) from "timed
 * out" (504) for its own operators, but hands the USER the same sentence
 * either way — there is no separate `PdfFailure` for a timeout, so both
 * collapse to `unavailable`.
 *
 * 502 is deliberately ABSENT from this map. The route
 * (`server/src/routes/export.ts`) reserves 502 for "the renderer answered
 * with something broken" — a genuine unexpected failure, not "try again
 * shortly" — so it falls through to the `failed` default below rather than
 * being folded into `unavailable`.
 */
const BY_STATUS: Record<number, PdfFailure> = {
  401: 'unauthorized',
  413: 'tooLarge',
  429: 'rateLimited',
  503: 'unavailable',
  504: 'unavailable',
};

/**
 * Sends the rendered document to the API and returns the PDF.
 *
 * The FILENAME is deliberately absent from this request. The client already
 * computes it with `exportFilename`, so no client-controlled string reaches a
 * `Content-Disposition` header on the server.
 *
 * A thrown fetch is mapped to `offline` rather than to a generic failure: a
 * user with no connectivity and a user whose renderer is down need different
 * sentences, and collapsing them tells neither of them anything.
 *
 * Non-2xx responses carry no body (the route returns `c.body(null, status)`),
 * so there is nothing to read out of a failure response beyond its status.
 */
export async function requestPdf(
  html: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<Blob> {
  const doFetch = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(`${API_ORIGIN}/export/pdf`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'text/html' },
      body: html,
    });
  } catch {
    throw new PdfExportError('offline');
  }

  if (!response.ok) throw new PdfExportError(BY_STATUS[response.status] ?? 'failed');

  return new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
}
