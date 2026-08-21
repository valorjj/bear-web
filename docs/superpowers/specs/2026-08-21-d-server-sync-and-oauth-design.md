# D — Server sync, accounts, and OAuth2 login

Written 2026-08-21. Sub-project **D** of the four in
`docs/superpowers/NEXT.md`, added there the same day and deliberately placed
last. The letters are `NEXT.md`'s and are not milestone ids.

**This is the largest single change the project has taken on**, and it reverses
two founding premises rather than extending them. Both reversals are recorded
below as reversals, not smoothed over.

## Purpose

`bear-web` is a local-first notes app with no backend and no account. Notes live
in one browser's IndexedDB and reach no further: there is no backup other than
the manual export bundle, no way to read a note on a second machine, and no
identity of any kind.

D adds a sync service and accounts. After D:

- Anyone can use `markflowing.com` with **no account at all** and get the whole
  app on IndexedDB, exactly as today. This is the guest mode and it is not a
  degraded tier.
- A user who signs in with Google (later GitHub) gets their notes stored on a
  server and available in any browser they sign in to.

## What this reverses

Two decisions are overturned. They are named here so a later reader does not
treat the contradiction as an oversight.

**1. "No backend, no account — everything lives in the browser's IndexedDB."**
CLAUDE.md's opening premise. A server now exists. **Local-first is kept**:
IndexedDB remains the source of truth for the running app, the app never awaits
the network to render, and the server is a sync target rather than an authority.

**2. "Single user. OAuth is identity for sync, not multi-tenancy."**
`NEXT.md` recorded this as settled on 2026-08-21. **The user reversed it the
same day, deliberately and after being shown the cost.** D is a real
multi-tenant product with open signup: anyone may create an account, and every
user has their own isolated notes.

The consequence is that a personal Mac Mini becomes the custodian of other
people's private notes. That is why rate limiting, per-user quota, and account
deletion appear in this spec as day-one requirements rather than later
hardening — they are what make open signup survivable on a home machine, and
each is far harder to retrofit than to build.

`NEXT.md`'s "Single user" bullet must be struck when this spec is committed.

## Settled context, not to be re-litigated

Established during the 2026-08-21 brainstorm and in `NEXT.md` before it:

- **Local-first is kept.** IndexedDB stays the source of truth. The app must
  work fully with the Mini asleep or off-network. "Runs every day" is not
  "always"; availability gaps are the normal case, not the error case.
- **A browser cannot speak MySQL's wire protocol.** "Hook up MariaDB"
  necessarily means an HTTP API service in front of it. **The server is the
  project; the database is the small half**, and its shape falls out of the
  conflict-resolution decision rather than driving it.
- **OAuth2 requires a confidential client**, so provider secrets live on the
  server and never in the bundle.
- **Google first, then GitHub. Naver is dropped from D.** `NEXT.md` flagged
  Naver as the one provider that could block the project — registration review,
  and scopes that may require a business entity. It is not in scope and is not
  ruled out later.

## Naming and hostnames

The public surface carries **no `bear` prefix**. CLAUDE.md already states that
Bear is a reference and not a target; `bear-web` is a leftover from when the app
was a clone, and a permanent public hostname is the wrong place to re-commit to
it. Changing a hostname after OAuth clients are registered means re-registering
every redirect URI, so this is settled before any DNS record is created.

| Piece                     | Host                             | Availability      |
| ------------------------- | -------------------------------- | ----------------- |
| The app                   | `markflowing.com` (apex)         | always up (Pages) |
| The sync API              | `api.markflowing.com`            | when the Mini is awake |
| MariaDB                   | container, not publicly routable | with the Mini     |

`markflowing.com` already reads as a Markdown editor — "mark flowing" — so no
subdomain prefix improves on it.

**The repo directory, the package name, and `DATABASE_NAME = 'bear-web'` are
deliberately NOT renamed.** Renaming an IndexedDB database is a data migration
with a failure mode (every existing user's notes become unreachable) and it buys
nothing a hostname change does not already deliver. Out of scope for D.

### Existing infrastructure on the Mini

Established from the user's Cloudflare and Docker screenshots on 2026-08-21.
This is not greenfield infrastructure:

- A healthy `lunch-select` tunnel already routes `lunch-api.markflowing.com`,
  `docs-api.markflowing.com` and `yjs.markflowing.com` to origin
  `gimjeongjin-ui-Macmini-10.local`. The `*-api` convention is theirs and D
  follows it.
- A second tunnel named `markflowing` is **Down with 1 app**. **Its route must
  be confirmed before the apex DNS record is created** — if it claims the apex,
  D is fighting it for the hostname.
- Containers already present: `lunch-select-mariadb` (mariadb:11.8, 3307:3306),
  `shared-docs-backend` (8090), `shared-doc-yjs-redis`, `lunch-select-backend`.

D adds **its own MariaDB container with its own volume** rather than reusing
`lunch-select-mariadb`, so that notes never share an availability, upgrade, or
wipe fate with an unrelated project.

**The user intends to delete the existing MariaDB containers. That is outside
D's scope and D does not do it.** Recorded because it is a prerequisite the user
runs, and because deleting the *container* is harmless while deleting its
*volume* destroys the `lunch-select` project's data. The distinction must be
made explicitly before anything is removed.

## Prerequisites

These are ordered, and the order is load-bearing.

1. **Confirm what the Down `markflowing` tunnel routes.** If it holds the apex,
   resolve that first.
2. **Serve the app from the apex.** A `public/CNAME` file containing
   `markflowing.com`, GitHub Pages custom-domain settings, and **`base` changed
   from `/bear-web/` to `/`** in `vite.config.ts`.
   - An apex cannot be a plain `CNAME` record, but Cloudflare's CNAME flattening
     makes `markflowing.com → valorjj.github.io` work where another registrar
     would not.
   - **If the record is proxied, SSL mode must be Full, not Flexible.** Proxied
     means GitHub cannot complete its own certificate validation and TLS is
     served by Cloudflare's edge; Flexible produces a redirect loop. This is the
     most common way this exact setup fails.
3. **Register the Google OAuth client** — only after step 2, because the app
   origin is part of the registration.
4. **Add the `api.markflowing.com` tunnel route** to the Mini.

## Architecture

```
markflowing.com                    api.markflowing.com
(GitHub Pages, always up)          (Cloudflare Tunnel → Mac Mini)
        │                                    │
   IndexedDB  ◄── source of truth       Node/TS HTTP service
   (Dexie)                                   │
        │                              markflowing-mariadb
        └──── src/data/sync/ ──── HTTPS ──────┘
              (engine)              cookie session
```

**Boot order is a guarantee, not an implementation detail.** `main.tsx` is
unchanged: `openDatabase()` then `createRoot`. Sync starts *after* the first
paint and is never awaited on the render path. If the sync module throws, hangs,
or cannot resolve DNS, the app has already rendered. This is the mechanical
reason "works with the Mini asleep" is true rather than aspirational.

### Server stack

**Node + TypeScript** (Hono), chosen over Spring Boot and Go for one reason
that outweighs the others: the server imports `Note` and `TagMeta` directly from
`src/data/types.ts`, so client and server **cannot** drift — a schema change
becomes a typecheck failure rather than a runtime surprise. The Mini's existing
services are Spring-shaped, and matching them was the alternative; hand-mirrored
types across a sync boundary is the exact class of bug the project cannot afford
here.

Cost accepted: OAuth is roughly a hundred lines we own rather than
`spring-boot-starter-oauth2-client` configuration.

**No ORM.** Plain SQL with `mysql2`, and schema migrations as numbered `.sql`
files applied by a small runner. The data model is four tables; an ORM would be
more machinery than the thing it manages.

### Repo layout

`server/` lives **in this repo** as a fifth tsconfig project alongside `app`,
`node`, `e2e` and the solution root. One `npm test`, one lint, one CI, and
shared types without a package-publishing step.

`scripts/sourceLint.test.ts` gains rules for the new directory: `server/` must
not import from `src/features/`, `src/ui/`, `src/app/` or `src/i18n/` — it may
reach `src/data/types.ts` and nothing else under `src/`.

## Accounts and authentication

### Schema

```sql
users       (id, created_at)
identities  (provider, provider_subject, email, user_id,
             UNIQUE (provider, provider_subject))
sessions    (id, user_id, created_at, expires_at, last_seen_at)
```

Identity is a separate table from user **from day one**, so Google and GitHub
identities can both point at one account without a later migration.

### Flow

Authorization Code with PKCE. The browser never holds a client secret and never
sees a provider token.

1. App navigates to `api.markflowing.com/auth/google?return=/`
2. Server generates `state` and a PKCE verifier, stores them in a short-lived
   cookie, redirects to Google
3. Google redirects to `api.markflowing.com/auth/google/callback` — **the
   redirect URI is on the API host, not the app host**, which is what keeps the
   code exchange and the secret server-side
4. Server exchanges the code, reads `sub` and email, upserts
   `identities`/`users`, sets the session cookie, redirects back to the app

### Session

An **opaque random id in the `sessions` table, not a JWT** — so logout and
suspicion actually revoke, because a session is a row that can be deleted.

Cookie: `HttpOnly; Secure; SameSite=Lax`, **host-only on
`api.markflowing.com`** — no `Domain=` attribute. 30-day rolling expiry.

The apex and `api.` share the registrable domain `markflowing.com`, so they are
**same-site**: `SameSite=Lax` is sent on the app's `fetch` calls. Host-only
scoping means the cookie is never sent to `lunch-api.markflowing.com` or
`docs-api.markflowing.com`, which belong to unrelated projects.

**This is the reason the app moved to the apex.** From `valorjj.github.io` the
two origins would be cross-*site*, cookies would be blocked by default in Safari
and Chrome, and the session would have to live in JavaScript — readable by any
XSS.

### Account linking is never automatic

**Identities are never linked by matching email address.** If GitHub reports the
same address as an existing Google identity, that is not proof of the same
person, and a provider that admits an unverified email would hand over someone
else's notes. Linking happens only from inside an authenticated session.

Accepted consequence: signing in with GitHub after having used Google creates a
**second, empty** account. This is correct behaviour and will be encountered by
the project owner first.

### CSRF

Cookie authentication requires it. `state` covers the OAuth leg. Every mutating
API request requires an `Origin` header matching an allowlist plus a non-simple
content type.

### Open-signup requirements

Day-one, not later hardening. Each exists because the server is a home machine
holding strangers' data.

- **Rate limits** — per-IP on `/auth/*`, per-user on `/sync`. Without them one
  script fills the Mini's disk.
- **Per-user quota** — a byte cap on total note text, returning `413` with a
  message the client surfaces plainly. This is the bound on disk growth.
- **`DELETE /account`** — removes notes, tombstones, tags, identities and
  sessions for that user. Needed the first time anyone asks, and much harder to
  add later than now.

## The sync protocol

### One revision counter per user

`users.rev_counter`, monotonic, incremented in the **same transaction** as every
write, with the new value stored on the written row. This is the core mechanism:
pull becomes a single indexed range query and **no clock comparison between
devices is ever required**.

```
GET  /sync?since=<rev>   → { notes: [...changed], tags: [...], rev: <latest> }
POST /sync               → { notes: [{ ...note, baseRev }], tags: [...] }
                         → { accepted: [...], conflicts: [...], rev: <latest> }
```

Server-side note rows are per-user and carry `rev` plus a `deleted` flag.

Client state: `lastPulledRev` in settings, and a per-note `syncedRev` and
`dirty` flag.

### Conflict resolution

Established from the user's answer that **one device writes and the others
read**: concurrent edits are an accident, not a workflow. This is what makes
last-write-wins affordable and a CRDT unjustifiable — a CRDT is a large
dependency for an app whose first two adjectives are *lightweight* and *fast*,
and the bundle is already at 847 KB.

The rule: **last-write-wins, with the loser preserved as a visible note.**

On push, if a note's server `rev` is newer than the client's `baseRev`, the
server rejects that note and returns its own copy. The client then:

1. takes the server version as the note, and
2. writes the local text into a **new note** titled `<title> (conflict)`.

No dialog, no merge UI, no silent loss. The losing edit is always a real note
the user can see, compare, and delete. This is LWW's simplicity without LWW's
data loss.

### Deletes require tombstones

`trashedAt` syncs as an ordinary field, so trashing propagates like any edit.

`purge` must leave a `deleted` row carrying a `rev`. Without it the next pull
resurrects the note on every other device, forever — the classic delete-sync
failure. Tombstones are retained **90 days**, then swept.

### What syncs, and what does not

| Table       | Synced | Why                                                                                    |
| ----------- | ------ | -------------------------------------------------------------------------------------- |
| `notes`     | yes    | including `trashedAt`, so deletes propagate                                            |
| `tags`      | yes    | metadata: order, icon, collapsed. Per-row LWW. Small, and a reading device otherwise shows a differently-ordered sidebar |
| `noteTags`  | **no** | derived from note text by `parseTags`; the client rebuilds it after every pull          |
| `noteFolds` | **no** | view state, already excluded from `BackupBundle` — a sync should not move reading position |
| `settings`  | **no** | device-specific: a phone wants different pane widths than a Mac                          |
| `files`     | **no** | the table is empty; image storage has never been scheduled                              |

**`noteTags` is deliberately not synced.** Syncing a derived index would create
a second source of truth for something the data layer already derives, and the
tag index has previously disagreed with its own rebuild — a bug found only by
fault injection. The rebuild path stays the single authority.

### Sync state lives in a new table, not on `Note`

Dexie **version 3** adds `syncState(noteId, syncedRev, dirty)`.

`Note` is deliberately untouched: it is the shape `BackupBundle` serialises, so
sync bookkeeping added to it would leak server state into every exported backup.

Dexie multiplies declared versions by ten, so this is IndexedDB version **30**,
and **`e2e/fixtures/seed.ts` must be moved with it** — a seeding connection open
at the wrong raw version blocks the upgrade forever, `openDatabase()` never
settles, and the page renders as a bare `<div id="root">` with no error at all.

## Client integration

### Module boundaries

- **`src/data/sync/`** — the engine. It owns Dexie access, so it belongs in the
  data layer. `sourceLint` enforces that it imports nothing from
  `src/features/`.
- **`src/features/account/`** — the UI: sign-in entry point, the sync status
  indicator, and the two dialogs described below.

Every user-facing string goes through `useT`, and `ko.ts` must gain each key or
typecheck fails.

### When sync runs

Automatic and quiet — chosen over a manual button because a backup you have to
remember is a backup you will not have.

- on app start (after first paint)
- after edits settle — a debounce layered on the existing autosave flush
- on `visibilitychange` → visible
- on the `online` event

Never on the render path.

### Status indicator

Four states: **synced**, **syncing**, **offline**, **error**.

"Offline" is the *normal* state for a machine that sleeps, and must read as
information rather than as a failure. This is a copy and tone requirement, not
only a state machine.

### Guest → login: the app asks

A guest writing notes in IndexedDB then signs in. On **first** login with local
notes present, a dialog offers to add them to the account or discard them.

Chosen over silent adoption because silent adoption has one genuinely ambiguous
case — an account that already holds notes from another device — and over
server-wins because that silently destroys work done by exactly the person who
was trying the app out.

### Logout: notes stay on the device

Logout does **not** clear IndexedDB. The notes become guest notes again, and
offline access keeps working.

**The user chose this after being shown the cost:** on a shared browser, the
next person opens the app and reads the previous user's notes. The mitigation is
disclosure, not reversal — **the logout dialog states plainly that notes remain
on this device**, so it is an informed choice rather than a surprise. That
sentence is a requirement of this spec, not decoration.

## Decomposition: D1 then D2

**This spec is too large for one implementation plan**, and splitting it is not
a matter of taste — the halves have different risk profiles and the first is a
hard prerequisite for the second.

**D1 — hosting, accounts, Google login.** Prerequisites 1–4, the apex move,
`server/` as a fifth tsconfig project, the four auth tables, the Google flow,
the session cookie, rate limits, quota enforcement, `DELETE /account`, and the
sign-in UI. **No note data crosses the network in D1.** It ends with a user able
to sign in and out, and nothing else — which is exactly the checkpoint worth
having, because every infrastructure failure mode (DNS, TLS mode, tunnel route,
redirect URI, cookie scope) surfaces here where there is no sync logic to blame.

**D2 — the sync protocol.** The revision counter, `GET`/`POST /sync`,
tombstones, Dexie version 3, the conflict copy, the status indicator, and the
guest-adoption and logout dialogs.

**GitHub OAuth is a third, small piece** and can land either side of D2: the
flow is provider-shaped from the start, so it is registration plus env vars plus
a config entry, not new architecture.

Each half gets its own plan. This spec covers both.

## Testing

The project's standing rule applies: reviews verify by running code and
injecting faults, not by reading.

- **Sync engine** — unit tested against a fake transport and `fake-indexeddb`.
  Duck-type rather than `instanceof`; `vitest.setup.ts` swaps the global `Blob`.
- **Server** — integration tests against a **real MariaDB** via a GitHub Actions
  `mariadb` service. SQL tested against a mock proves nothing.
- **Multi-tenancy guard** — a source-level test, in the spirit of
  `sourceLint.test.ts`, that **fails any SQL statement touching a user-scoped
  table without a `user_id` predicate**. In a multi-tenant app one forgotten
  `WHERE` is a cross-user notes leak, and that is not a thing to catch by
  review.
- **Conflict path** — must be tested by forcing a stale `baseRev`, and the
  assertion is that the losing text exists as a note afterwards.
- **Auth** — cannot be end-to-end tested against real Google. A stub provider
  covers the callback, session, and rejection paths.
- **Playwright** — the port-4173 hazard applies unchanged:
  `lsof -ti:4173 | xargs -r kill -9` before trusting any e2e result that follows
  a source change.

All six gates must cover both halves of the repo.

## Out of scope

Each is deliberate, and none is ruled out later:

- **Naver OAuth** — the provider `NEXT.md` flagged as able to block.
- **Image and file sync** — image storage has never been scheduled at all.
- **`settings` and `noteFolds` sync** — device-specific and view state.
- **Note sharing, permissions, per-note ACLs** — accounts are isolation, not
  collaboration.
- **Realtime / WebSocket sync** — the trigger set above is sufficient for
  one-writer use.
- **Renaming the repo, package, or IndexedDB database.**
- **Deleting the existing `lunch-select` MariaDB** — the user's prerequisite,
  not D's work.

## Open questions

None blocking. Two to settle during planning:

1. **Quota size.** A number is needed for the byte cap; nothing depends on which
   number, only that one exists and is enforced.
2. **Tombstone sweep trigger.** A scheduled job on the Mini, or opportunistic
   sweeping during a sync request. The latter needs no scheduler and is the
   likely answer.
