import { createServer, type Server } from 'node:http';

import { MermaidSyntaxError, renderMermaid as renderMermaidPage } from './mermaid.ts';
import { diagramQueue, QueueFullError, withSlot } from './queue.ts';
import { renderPdf, RenderTimeoutError } from './render.ts';

export const DEFAULT_PORT = 8788;
export const MAX_BYTES = 2 * 1024 * 1024;

/** The largest diagram SOURCE this endpoint accepts. A diagram is not a
 * document: `/render`'s 2 MB is a rendered page with inlined images. */
export const MAX_SOURCE_BYTES = 20 * 1024;

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
  /** Injected so the HTTP contract can be tested without launching Chromium. */
  renderMermaid?: (source: string) => Promise<string>;
  maxBytes?: number;
  /** The largest diagram SOURCE this endpoint accepts. A diagram is not a
   * document: `/render`'s 2 MB is a rendered page with inlined images. */
  maxSourceBytes?: number;
  maxInflight?: number;
}

export function createRenderServer(deps: RenderServerDeps = {}): Server {
  const render = deps.render ?? ((html: string) => withSlot(() => renderPdf(html)));
  const renderMermaid =
    deps.renderMermaid ??
    ((source: string) => diagramQueue.withSlot(() => renderMermaidPage(source)));
  const maxBytes = deps.maxBytes ?? MAX_BYTES;
  const maxSourceBytes = deps.maxSourceBytes ?? MAX_SOURCE_BYTES;
  const maxInflight = deps.maxInflight ?? MAX_INFLIGHT;

  let inflight = 0;

  return createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return;
    }

    const isMermaid = req.url === '/render/mermaid';

    if (req.method !== 'POST' || (req.url !== '/render' && !isMermaid)) {
      res.writeHead(404).end();
      return;
    }

    /*
     * `text/html` (for `/render`) or `application/json` (for
     * `/render/mermaid`) is required, and the reason is not tidiness.
     *
     * Neither is a CORS-safelisted request content-type, so demanding one
     * means a simple cross-origin `fetch` or a plain HTML form cannot reach
     * this endpoint — the browser must preflight, and the preflight gets no
     * permissive response. That matters because this listens on 127.0.0.1 of
     * a machine somebody browses on: without it, ANY page they visit could
     * POST straight at the renderer, going around the API's auth and rate
     * limiter completely. `text/plain` in particular IS safelisted, so it
     * must never be accepted here even though it would otherwise look
     * harmless for a JSON body. The response is unreadable cross-origin, so
     * the prize is resource abuse rather than data — which on a fanless box
     * is the attack that matters.
     */
    const contentType = req.headers['content-type'] ?? '';
    const contentTypeOk = isMermaid
      ? /^application\/json\s*(;|$)/i.test(contentType)
      : /^text\/html\s*(;|$)/i.test(contentType);
    if (!contentTypeOk) {
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
    const bodyLimit = isMermaid ? maxSourceBytes : maxBytes;
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
      if (total > bodyLimit) {
        fail(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;

      if (isMermaid) {
        let source: string;
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const candidate = (parsed as { source?: unknown } | null)?.source;
          if (typeof candidate !== 'string' || candidate.length === 0) throw new Error('bad body');
          source = candidate;
        } catch {
          res.writeHead(400).end();
          return;
        }

        void (async () => {
          try {
            const svg = await renderMermaid(source);
            res.writeHead(200, { 'content-type': 'image/svg+xml' }).end(svg);
          } catch (error) {
            if (error instanceof MermaidSyntaxError) {
              res
                .writeHead(422, { 'content-type': 'application/json' })
                .end(JSON.stringify({ error: error.detail }));
            } else if (error instanceof RenderTimeoutError) res.writeHead(504).end();
            else if (error instanceof QueueFullError) res.writeHead(503).end();
            // SanitizerFailedError falls into the final `else`, same as any
            // other unmapped failure: it is our bug or a compromised page,
            // never the user's input, so it gets the same 500.
            else res.writeHead(500).end();
          }
        })();
        return;
      }

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
