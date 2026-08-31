import { API_ORIGIN } from '@/data';

/**
 * Why a diagram render can fail, and only these seven ways.
 *
 * Seven, not one: a user with no connectivity, a user who is signed out, a
 * user who tripped the rate limit, and a user who wrote a syntax error each
 * need a different sentence, and a single "render failed" tells none of them
 * anything they can act on.
 */
export type DiagramFailure =
  | 'offline'
  | 'unauthorized'
  | 'invalidSyntax'
  | 'tooLarge'
  | 'rateLimited'
  | 'unavailable'
  | 'failed';

export class DiagramError extends Error {
  readonly reason: DiagramFailure;
  readonly detail?: string;

  constructor(reason: DiagramFailure, detail?: string) {
    super(
      detail ? `diagram render failed: ${reason}: ${detail}` : `diagram render failed: ${reason}`,
    );
    this.name = 'DiagramError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * The server distinguishes "unreachable or shedding load" (503) from "timed
 * out" (504) for its own operators, but hands the USER the same sentence
 * either way — there is no separate `DiagramFailure` for a timeout, so both
 * collapse to `unavailable`.
 *
 * 502 is deliberately ABSENT from this map, matching `requestPdf.ts`'s
 * `BY_STATUS`: the route reserves 502 for "the renderer answered with
 * something broken" — a genuine unexpected failure, not "try again shortly"
 * — so it falls through to the `failed` default below.
 */
const BY_STATUS: Record<number, DiagramFailure> = {
  401: 'unauthorized',
  413: 'tooLarge',
  429: 'rateLimited',
  503: 'unavailable',
  504: 'unavailable',
};

/**
 * A `<script` anywhere in the returned markup fails the render outright.
 *
 * This is the FOURTH check in the chain: the container sanitizes the SVG
 * with a real DOM walk, the container re-checks its own output with a regex
 * guard, and the API re-checks again at its boundary before this client ever
 * sees a response. This one is the only check an attacker cannot reach —
 * it runs after every server-side defence has already had its turn — and it
 * is what stands between a replaced or mis-deployed renderer and markup
 * inlined directly into the user's notes. Do not delete this as redundant:
 * every other check lives in a different process this client does not
 * control.
 */
const SCRIPT_TAG_PATTERN = /<\s*script\b/i;

/**
 * Sends the diagram source to the API and returns the sanitized SVG.
 *
 * A thrown fetch is mapped to `offline` rather than to a generic failure: a
 * user with no connectivity and a user whose renderer is down need different
 * sentences, and collapsing them tells neither of them anything.
 *
 * A 422 carries the parser's message as `detail`, best-effort: the body is
 * read inside a `try` so a malformed error body still produces a plain
 * `invalidSyntax` failure rather than an unhandled exception. The reason is
 * the contract; the message is a nicety.
 */
export async function requestDiagram(
  source: string,
  deps: { fetch?: typeof globalThis.fetch } = {},
): Promise<string> {
  const doFetch = deps.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(`${API_ORIGIN}/diagram`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
  } catch {
    throw new DiagramError('offline');
  }

  if (response.status === 422) {
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') detail = body.error;
    } catch {
      // Malformed body — the reason is still `invalidSyntax`, just without
      // a message.
    }
    throw new DiagramError('invalidSyntax', detail);
  }

  if (!response.ok) throw new DiagramError(BY_STATUS[response.status] ?? 'failed');

  const svg = await response.text();
  if (SCRIPT_TAG_PATTERN.test(svg)) throw new DiagramError('failed');

  return svg;
}
