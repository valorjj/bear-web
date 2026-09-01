# server

The sync API behind `api.markflowing.com`. A Hono service on Node, plain SQL
against its own MariaDB container.

D2 adds the sync protocol: `GET`/`POST /sync` push and pull note and tag rows
under a per-account revision counter, with tombstones and a 90-day sweep.
Note data now does cross the network, encrypted in transit, to an account the
signed-in user controls — see `docs/rulings/sync.md` for the constraints no
test enforces.

Sub-project M adds publishing: `POST /publish` stores a note's already-built
export HTML on disk under a 128-bit capability id, and `GET /p/:id` serves it
back on a **second** hostname, `pub.markflowing.com`. **One process now
answers for two hostnames.** The Cloudflare tunnel routes both `api.` and
`pub.` to the same port, and `server/src/middleware/publishHost.ts`'s
`publishHostOnly` is the only thing splitting them apart at the application
layer — see "The host split" below.

## Run it

    cp .env.example .env        # then fill in the Google credentials
    docker compose up -d
    npm run server:migrate
    npm run server:service:install
    npm run server:service:start

`.env` is gitignored and must stay so. This is the **production** config: it
carries the live origins that the Cloudflare tunnel points at as
`api.markflowing.com`'s (and, since M, `pub.markflowing.com`'s) upstream.

### The host split

Both `api.markflowing.com` and `pub.markflowing.com` resolve to the same
Cloudflare tunnel, the same port, and the same Node process — there is no
second deployment. What keeps them from being the same _surface_ is
`publishHostOnly`, applied before every route: on the publish host, nothing
answers but `GET`/`HEAD /p/*` and `/health` — `/auth`, `/sync`, `/files` and
every other app route 404 there, and a non-GET request to `/p/*` also 404s
rather than reaching `originGuard` (which has no origin policy to answer with
on a host that serves no authenticated surface). On the app host, `/p/*`
itself 404s, so a published page exists on exactly one hostname, never both.

It **fails closed in both directions**: an unrecognised or absent `Host`
header is treated as the app host, which serves no public pages — never the
other way around, which would leak the whole API onto the anonymous surface
that serves author-controlled HTML. This was measured, not assumed: before
the guard existed, `pub.markflowing.com/health`, `/auth` and `/sync` all
answered normally.

`PUBLISH_ORIGIN` is what tells the guard which hostname is which — it names
the publish origin, e.g. `https://pub.markflowing.com`, and the app host is
"whatever isn't that." It is **required at boot with no default**
(`src/env.ts`): a missing or wrong value is not a value that should serve
pages under the wrong hostname or silently 404 every public page — it should
crash the process loudly instead, and it does. This is not hypothetical: the
variable was missing from production `server/.env` on 2026-09-01, during this
sub-project's own rollout, and the service crash-looped until it was added.
Set it in all three of `server/.env`, `server/.env.local` (a `pub.localhost`
value works there — see `.env.local`'s own comment) and `server/.env.example`,
the same pattern `PDF_RENDERER_URL` already established.

### Production runs as a launchd service

`com.markflowing.api`, a LaunchAgent. The plist is tracked at
`server/launchd/com.markflowing.api.plist` and `install` copies it to
`~/Library/LaunchAgents/`. Control it through npm, never launchctl directly:

| command                  | what it does                                         |
| ------------------------ | ---------------------------------------------------- |
| `server:service:install` | copies the plist into `~/Library/LaunchAgents/`      |
| `server:service:start`   | `launchctl bootstrap` — also survives reboot + crash |
| `server:service:stop`    | `launchctl bootout` — the ONLY way to stop it        |
| `server:service:status`  | state, pid, last exit code                           |
| `server:service:log`     | tails `~/Library/Logs/markflowing-api.log`           |

`KeepAlive` is unconditional, so **`kill` no longer stops the server** — launchd
restarts it within ~10s. Verified by killing both the tsx parent and the child
that actually holds the port: either way `/me` answers `401` again within 12s.

`npm run server:dev` (`tsx watch`) is still there for watching production
sources by hand, and `npm run server:start` is the same thing without the
watcher — the command the service itself runs.

### Local development

Local work needs its own config, not edits to `.env`:

    npm run server:service:stop   # frees 8787; see below
    cp .env.example .env.local    # point APP_ORIGIN/API_ORIGIN at localhost
    npm run server:dev:local

`.env.local` is gitignored like `.env`. **The two servers cannot run at the
same time.** Both want port 8787, because
`http://localhost:8787/auth/google/callback` is the one redirect URI
registered in the Google console — there is no dev/prod split there.

**`lsof -ti:8787 | xargs kill -9` no longer works and this README used to tell
you to do it.** Under `KeepAlive` launchd just restarts production, so the kill
appears to succeed and then your local server cannot bind — or worse, races it.
Use `server:service:stop`, and `server:service:start` when you are done. Then
confirm `https://api.markflowing.com/me` answers `401` rather than `502` before
walking away.

### Why the repo is not in `~/Documents`

**A launchd job cannot read `~/Documents`, and it HANGS rather than failing.**
The service was first built with the repo at `~/Documents/bear-web` and the
process sat alive forever with an empty log and nothing bound to 8787.
`sample` put it in `node::Dotenv::ParsePath → uv_fs_open → open()`, blocked.

It is not about `.env` or `--env-file`: a three-line test agent read a file in
`/private/tmp` fine and then hung on `package.json`. `~/Documents` is a
TCC-protected location and a headless LaunchAgent has no way to answer the
consent prompt, so `open()` never returns. Nothing is logged — no TCC denial,
no error — and because the process never _exits_, `KeepAlive` sees a healthy
job. A crash loop would have been louder.

The repo therefore lives at `~/WebstormProjects/bear-web`. Do not move it back
under `~/Documents`, `~/Desktop` or `~/Downloads`. Granting the node binary
Full Disk Access would also work and was rejected: it hands every node process
on the machine full disk access, including five GitHub Actions runners, to buy
one service.

## The PDF renderer

A separate container (`markflowing-pdf`, sub-project G): a Chromium service
that turns exported HTML into a PDF. It is deliberately NOT part of the API
process — it renders client-supplied HTML, which is a code-execution and SSRF
surface.

    npm run pdf:up              # BUILDS, then starts
    npm run pdf:down
    npm run test:pdf            # the unit suite (launches a real Chromium)
    npm run pdf:verify:fonts    # re-run the image's font assertion

Its address is `PDF_RENDERER_URL`, which `src/env.ts` REQUIRES — the API
refuses to boot without it. Set to `http://127.0.0.1:8788` in all three of
`server/.env`, `server/.env.local` and `server/.env.example`. And the usual
trap first: **`npm run server:service:stop` before `npm run server:dev:local`**,
because the launchd job's `KeepAlive` is unconditional and it will hold 8787.

The image is **3.92 GB**, built from a pinned, digest-locked
`mcr.microsoft.com/playwright:v1.62.1-noble` (see
`server/docker/pdf/Dockerfile`). That size is why CI does not build it: the
renderer suite CI runs (`npm run test:pdf`) drives a local Chromium instead,
with no container in the loop.

### Proving it end to end

Neither `npm test` nor `npm run test:e2e` touches the container. The one test
that does is gated, and it is the only place the whole feature is exercised at
once — the app builds the document under a real theme, the real container
renders it, and the PDF bytes are asserted DARK:

    lsof -ti:4173 | xargs -r kill -9      # a stale preview server is reused silently
    npm run pdf:up
    PDF_RENDERER_URL=http://127.0.0.1:8788 npx playwright test e2e/pdfExport.spec.ts
    PDF_RENDERER_URL=http://127.0.0.1:8788 npm run shots:pdf   # 4 reference rasters
    npm run pdf:down

`npm run shots:pdf` writes four PNGs to `docs/design/shots/pdf/` (paper,
sepia, nord, high-contrast) with poppler's `pdftoppm`. **Count the files, do
not trust the exit code** — the same rule `npm run shots` carries.

### What actually contains it

Three layers, and **a route off the host remains** — none of these is a
network jail:

1. **Every subresource request is aborted** (`page.route('**', …)` in
   `render.ts`). No `img`, `link`, `iframe` or `@font-face` URL loads at all.
   This is the control that does the work; the other two exist for the day it
   regresses.
2. **`--host-resolver-rules=MAP * ~NOTFOUND` at browser launch.** Measured
   with layer 1 removed so it was tested alone: it fails **literal IPs as well
   as hostnames**, because Chromium routes literal addresses through its host
   resolver too.
3. **Its own compose network** (`pdf-isolated`), so `mariadb` does not
   resolve — Docker's embedded DNS only answers service names within a shared
   network. It is a normal bridge, so the LAN and the internet are still
   routable from the container; what cannot reach them is the browser.

**`internal: true` was tried and rejected.** It denies egress completely
(`ENETUNREACH`, `EAI_AGAIN` — measured), and it also **breaks the published
port**: `127.0.0.1:8788` answers nothing and the API can never reach the
renderer. The trap is that the container **healthcheck keeps reporting
`healthy`** throughout, because it runs inside the container against its own
loopback — so `docker ps` shows a green service that no client can talk to.
Getting real egress denial needs the API and the renderer on one internal
network, or a unix socket instead of TCP; both are larger than this container.

`POST /render` also requires `content-type: text/html`. That is not
CORS-safelisted, so a page the operator happens to visit cannot POST a layout
bomb at `127.0.0.1:8788` without a preflight this service never answers.

### Fonts, and why the build asserts them

The build FAILS if Pretendard or JetBrains Mono is not embedded in a real
rendered PDF (`server/docker/pdf/verify-fonts.mjs`). Fontconfig-level checks
cannot see this class of defect — `fc-match` answered correctly while every
code block rendered in a fallback face. See the comments in
`server/docker/pdf/fonts.conf`.

**`pdf:up` rebuilds on purpose.** `restart: unless-stopped` plus a healthcheck
means a plain `docker compose up -d pdf` happily serves a stale image, so an
`npm ci` that moves the Pretendard path in `node_modules` would leave the
running renderer silently rendering Korean in the wrong face. Use `pdf:up`,
not `docker compose up -d pdf`. `pdf:build` alone is there for CI-shaped uses
that want the two steps separate.

## Layout

| Path                | What it is                                                                     |
| ------------------- | ------------------------------------------------------------------------------ |
| `src/app.ts`        | Builds the Hono app from injected deps. Does not listen, so tests need no port |
| `src/env.ts`        | Validates the whole environment at boot, naming any missing key                |
| `src/auth/`         | PKCE, the Google provider, cookies, the two OAuth routes                       |
| `src/repositories/` | Users, identities, sessions. Plain SQL                                         |
| `src/db/`           | The pool and the migration runner                                              |
| `migrations/`       | Numbered `.sql`, applied in name order                                         |

## Things that will bite you

- **The redirect URI is on THIS host**, not the app's:
  `https://api.markflowing.com/auth/google/callback`. That is what keeps the
  client secret server-side.
- **The session cookie carries no `Domain`.** Host-only scoping is what keeps
  it off `lunch-api` and `docs-api`, unrelated projects on the same domain.
- **Both cookies are `SameSite=Lax`, never `Strict`.** Strict is dropped on the
  redirect back from Google, and the failure is silent.
- **Both cookies use the `__Host-` name prefix when served over HTTPS.**
  `HttpOnly` does not protect against an attacker who _is_ the client, and
  host-only scoping alone stops egress to sibling subdomains but not ingress
  from them — a compromised `lunch-api.markflowing.com` could otherwise set a
  `Domain=.markflowing.com` cookie this API would read, which is a login-CSRF
  and session-shadowing vector. `__Host-` closes that; it is browser-enforced,
  not decorative. Consequence: the cookie NAME differs between
  `http://localhost` (no prefix, not HTTPS) and production. `API_ORIGIN` must
  match the scheme the browser actually uses to reach the API — get the
  scheme wrong and the browser silently rejects the cookie; login just stops
  working, with no error anywhere to grep for.
- **The OAuth transaction is stateless by design, and therefore replayable
  within its 600-second lifetime.** There is no consumed-transaction store —
  holding one between legs would contradict the design. Single-use protection
  comes entirely from the provider rejecting a reused authorization code, not
  from anything this service does.
- **Rate limiting is in memory, and trusts `cf-connecting-ip` /
  `x-forwarded-for` verbatim.** Both are safe only as long as Cloudflare is
  the guaranteed front door and the process itself is unreachable directly —
  **bind the server to localhost so the tunnel is the only path in.** The
  window `Map` is never pruned, so a long-lived process accumulates entries
  for every IP it has ever seen. A second server instance also makes the
  limit per-instance, so the effective limit multiplies.
- **Identities are never linked by email.** Signing in with a second provider
  creates a second account until you link it from inside a session. This is
  deliberate; see the spec.
- **`DELETE /account` exists as an endpoint and has no UI.** It is the spec's
  day-one requirement and is covered by route tests, but nothing in the app
  calls it: there is no client wrapper and no menu row. Deleting an account
  today means calling the endpoint directly.
- **Several statements must run in one transaction, so repositories take a
  `Tx`, not just `Query`.** `pool.transaction()` checks out a single
  connection and does `BEGIN`/`COMMIT`/`ROLLBACK`. Anything spanning more than
  one statement — creating a user and its identity, and D2's per-user revision
  counter, which the spec requires be incremented in the same transaction as
  every write — must use it, or a pooled call lands on an arbitrary connection
  and the atomicity is imaginary.
- **Integration tests need `TEST_DATABASE_URL`** or they skip. It must point at
  its own database — `markflowing_test`, separate from `DATABASE_URL`'s
  `markflowing` — because the suite truncates the `users` table (and
  `identities`/`sessions` cascade from it) on every run. Point it at the dev
  database and `npm test` deletes your real signed-in account with no
  warning; this has already happened once. `docker-compose.yml` creates
  `markflowing_test` automatically for anyone starting from an empty volume;
  an existing volume needs it created once by hand (see the file's comment).
- **Cloudflare strips the `ETag` header on `/p/*` entirely — not weaken it,
  remove it.** Verified 2026-09-01 through the real tunnel: the origin sets a
  strong `ETag` (confirmed hitting the process directly on `127.0.0.1:8787`),
  and neither a plain request nor one with `Accept-Encoding: identity` shows
  an `ETag` of any kind once it has passed through Cloudflare — not even a
  weakened `W/"…"` form, which is what `publicPage.ts`'s RFC 7232 comparison
  was written to tolerate. The comparison itself is still correct and still
  worth having: a client that already holds a valid value (strong or weak)
  and sends it back as `If-None-Match` gets a real 304 through the tunnel,
  proven the same day. What is unproven is whether a real browser can ever
  acquire that value in the first place, since the response that would teach
  it the ETag never carries one past the edge. No `Cache-Control` is set on
  this route today, which is the most likely reason Cloudflare treats it as
  nothing worth validating — worth revisiting if conditional GETs on
  published pages ever matter enough to chase.
