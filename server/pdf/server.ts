import { createServer, type Server } from 'node:http';

import { QueueFullError, withSlot } from './queue.ts';
import { renderPdf, RenderTimeoutError } from './render.ts';

export const DEFAULT_PORT = 8788;
export const MAX_BYTES = 2 * 1024 * 1024;

/**
 * How many requests may be buffering a body at once.
 *
 * The queue bounds how many renders RUN; this bounds how many bodies are held
 * in memory waiting to. Checked before a single byte is read, because a limit
 * applied after buffering does not bound anything.
 */
export const MAX_INFLIGHT = 16;

export interface RenderServerDeps {
  /** Injected so the HTTP contract can be tested without launching Chromium. */
  render?: (html: string) => Promise<Uint8Array>;
  maxBytes?: number;
  maxInflight?: number;
}

export function createRenderServer(deps: RenderServerDeps = {}): Server {
  const render = deps.render ?? ((html: string) => withSlot(() => renderPdf(html)));
  const maxBytes = deps.maxBytes ?? MAX_BYTES;
  const maxInflight = deps.maxInflight ?? MAX_INFLIGHT;

  let inflight = 0;

  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }

    if (req.method !== 'POST' || req.url !== '/render') {
      res.writeHead(404).end();
      return;
    }

    /*
     * `text/html` is required, and the reason is not tidiness.
     *
     * It is not a CORS-safelisted request content-type, so demanding it means
     * a simple cross-origin `fetch` or a plain HTML form cannot reach this
     * endpoint — the browser must preflight, and the preflight gets no
     * permissive response. That matters because this listens on 127.0.0.1 of a
     * machine somebody browses on: without it, ANY page they visit can POST a
     * 2MB layout bomb straight at the renderer, going around the API's auth
     * and rate limiter completely. The response is unreadable cross-origin, so
     * the prize is resource abuse rather than data — which on a fanless box is
     * the attack that matters.
     */
    const contentType = req.headers['content-type'] ?? '';
    if (!/^text\/html\s*(;|$)/i.test(contentType)) {
      res.writeHead(415).end();
      return;
    }

    // Before reading any of the body. See MAX_INFLIGHT.
    if (inflight >= maxInflight) {
      res.writeHead(503).end();
      return;
    }
    inflight += 1;
    res.on('close', () => {
      inflight -= 1;
    });

    const chunks: Buffer[] = [];
    let total = 0;
    // Writing 413 from the `data` handler and then destroying the socket has
    // a second-headers hazard on paper: ERR_HTTP_HEADERS_SENT thrown out of an
    // event handler is an uncaught exception, which kills the process. The
    // latch closes it. It is UNPROVEN defence — removing it was fault-injected
    // and no test noticed, because Node does not re-fire `data`/`end` on a
    // destroyed request. Kept because the cost is one boolean and the failure
    // mode is a dead renderer.
    let settled = false;

    const fail = (status: number) => {
      if (settled) return;
      settled = true;
      res.writeHead(status).end();
    };

    // Same standing as the latch above: defensible, unproven. Node attaches
    // its own handling to IncomingMessage, so removing this changed no test.
    req.on('error', () => {
      settled = true;
      res.destroy();
    });

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        fail(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;

      void (async () => {
        try {
          const pdf = await render(Buffer.concat(chunks).toString('utf8'));
          res.writeHead(200, { 'content-type': 'application/pdf' }).end(Buffer.from(pdf));
        } catch (error) {
          if (error instanceof RenderTimeoutError) res.writeHead(504).end();
          else if (error instanceof QueueFullError) res.writeHead(503).end();
          else res.writeHead(500).end();
        }
      })();
    });
  });
}

/*
 * `0.0.0.0` is correct INSIDE the container; the loopback restriction is done
 * by the compose port mapping (`127.0.0.1:8788:8788`), exactly as MariaDB's
 * `127.0.0.1:3308:3306` does it. Binding loopback inside the container would
 * make the service unreachable from the host altogether.
 *
 * Listening lives in `main.ts` rather than at this module's top level, behind
 * an entry-point check, because an entry check is a guess about how the
 * process was started and a wrong guess here costs a whole image rebuild to
 * discover. Importing this module binds nothing.
 */
export function startRenderServer(): Server {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  return createRenderServer().listen(port, '0.0.0.0');
}
