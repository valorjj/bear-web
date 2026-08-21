# server

The sync API behind `api.markflowing.com`. A Hono service on Node, plain SQL
against its own MariaDB container.

D1 ships accounts only: **no note data crosses the network yet.**

## Run it

    cp .env.example .env        # then fill in the Google credentials
    docker compose up -d
    npm run server:migrate
    npm run server:dev

`.env` is gitignored and must stay so.

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
