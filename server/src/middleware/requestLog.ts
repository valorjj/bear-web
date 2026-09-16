import type { MiddlewareHandler } from 'hono';

/**
 * Requests worth a line, and nothing else.
 *
 * Every WRITE, because a write that did not happen is the thing you cannot
 * reconstruct afterwards; and every FAILURE, because a 401 or a 429 on a read
 * is the answer to "why did nothing happen". A successful GET is the one case
 * that leaves evidence elsewhere — the response itself — so it is left out,
 * and that keeps `/p/*` and `/share/*` from filling the log with one line per
 * page view.
 */
function worthLogging(method: string, status: number): boolean {
  return method !== 'GET' || status >= 400;
}

/**
 * One line per interesting request: method, path, status, duration.
 *
 * It exists because this service logged NOTHING but startup lines and thrown
 * errors, and that blindness cost a real diagnosis. A published page was not
 * updating; the only instruments available were a file's mtime and a
 * `published_at` column, and neither can distinguish "the request never
 * arrived" from "it arrived and was rejected" — which are opposite bugs with
 * opposite fixes. Three rounds went into narrowing that by elimination.
 *
 * **It logs no identity and no content.** No user id, no session token, no
 * IP, no request or response body, no query string — the path only. A notes
 * app's request log has no business holding any of that, and `/publish`
 * carries an entire note in its body. What is left is exactly enough to
 * answer "did it arrive, and what did it return".
 *
 * The query string is dropped rather than trusted: `/publish` carries the
 * note's TITLE in it, which is user content.
 *
 * Registered first so it times the whole stack, `publishHostOnly` and the
 * rate limiter included — a request refused by either is precisely the kind
 * this exists to make visible.
 */
export function requestLog(): MiddlewareHandler {
  return async (c, next) => {
    const started = Date.now();
    await next();

    const { method } = c.req;
    if (!worthLogging(method, c.res.status)) return;

    // `new URL(...).pathname`, never `c.req.path` plus the raw url: the query
    // string holds the note title on `/publish`.
    const path = new URL(c.req.url).pathname;
    console.log(`${method} ${path} ${c.res.status} ${Date.now() - started}ms`);
  };
}
