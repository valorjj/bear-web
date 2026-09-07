# R. The landing page — a first-visit door

Written 2026-09-07. Sub-project letter **R** (O is skipped as confusable with
zero; P is spoken for in `NEXT.md`).

## The problem

A brand-new visitor to https://markflowing.com lands directly in the three-pane
shell with nothing in it: "No notes", "No note selected", "No tags yet". They
are given no idea what the app is, no idea that sync exists, and no idea that
notes here are organised by inline hashtags rather than folders. Sign-in is a
single text button inside a popover in the sidebar footer — reachable only by
someone already looking for it.

Two things are missing, and they are the same size: a door, and something
behind it.

## Goal

A first-visit screen offering two ways in — **Sign in with Google** or
**Continue as guest** — followed by a single seeded welcome note that teaches
hashtag organisation by being itself.

## Non-goals

- **Not a marketing page.** The root URL stays the app. No screenshots, no
  feature grid, no scroll.
- **Not an auth wall.** Guest mode is a first-class choice, and the local-first
  promise is unchanged: nothing behind this screen requires an account that did
  not already require one.
- **Not a router.** The landing is a state, not a location.
- **Not an empty-state redesign.** `EmptyState` is untouched; the welcome note
  simply means a first-run user rarely sees it.

## Decision 1 — the landing is a component, not a route

`App` renders `<Landing />` in place of `<AppShell />` while the gate is open.

```
App
├── I18nProvider            (unchanged)
├── DatabaseStatusProvider  (unchanged)
└── gate open?
    ├── yes → <Landing />
    └── no  → <AppShell />
```

`src/main.tsx` does not change. The landing therefore inherits, for free:

- the theme, stamped on `<html>` pre-paint by `index.html`'s inline script;
- the design tokens and every `--bear-*` utility;
- `I18nProvider`, so `detectLocale()` has already chosen EN or KO;
- the `#boot` indicator's removal timing and the whole database boot sequence.

**Rejected: a real route (`/welcome`).** It means introducing the first client
router this app has ever had for one screen, plus a GitHub Pages 404 fallback,
and buys nothing — there is no second entry point to route to.

## Decision 2 — the gate, and its deliberate asymmetry

One new key, following the established `bear-web:<area>:<name>` convention:

```
bear-web:landing:seen = '1'
```

The gate is open when the key is absent. It is written from **two different
places**, and the difference is the point:

| Branch | Flag written |
| --- | --- |
| **Continue as guest** | immediately, in the click handler |
| **Sign in with Google** | **not** on click — only once `useSession` resolves `signedIn` after the redirect back |

Consequence: an **abandoned or failed OAuth round trip returns the visitor to
the landing screen**, where they can choose guest instead. The alternative —
writing the flag on click — drops a visitor who hit Back at Google into a
signed-out app with no explanation and no way to see this screen again.

**The pending state is required, not cosmetic.** `useSession.signIn()` writes
`SESSION_HINT_KEY` *before* navigating away, so the boot after the redirect
does consult `/me` and starts in `{ status: 'loading' }`. `Landing` must
therefore render a quiet pending state whenever the session is `loading` **and**
the session hint is present; without it, the two buttons flash on screen during
every return from Google.

Reading the key must be wrapped in `try/catch` and treat any failure as absent,
exactly as `useSession`'s markers do — `localStorage` throws outright in some
private-window and blocked-site-data contexts.

### State table

| Flag | Session | Screen |
| --- | --- | --- |
| absent | `signedOut` | landing, buttons |
| absent | `loading` + hint present | landing, pending |
| absent | `loading`, no hint | landing, buttons |
| absent | `signedIn` | write flag → app |
| absent | `unavailable` | landing, buttons |
| present | any | app |

`unavailable` (the Mac Mini asleep) shows the buttons rather than pending: it is
a resolved answer, not a wait, and a guest choice must stay reachable when the
server is down.

## Decision 3 — the welcome note seeds once per device, gated on emptiness

The naive rule breaks on the second device: the landing shows again (new
browser, no flag), "Sign in" seeds a welcome note, sync pushes it, and the
account now holds two. Device three holds three.

**The rule:** seed once per device, after the landing choice, gated on the local
database holding **zero notes** — and when the user is signed in, wait for the
first sync to settle before checking.

"Settled" means `useSync`'s `status` reaching `'idle'` after having been
`'syncing'`. The four cases:

| Situation | Outcome |
| --- | --- |
| Guest | no sync involved; count is zero; seeds immediately |
| Sign-in, existing account | sync settles, notes arrive, count is non-zero; **nothing seeds** |
| Sign-in, brand-new account | sync settles at zero; seeds, and the note syncs up as their first real note |
| Sign-in, server unreachable | `status` never reaches `'idle'`; nothing seeds and the device flag stays unset, so a later boot seeds instead |

The last row is deliberate. Seeding against an unreachable server would inject a
note that duplicates the moment the server answers; deferring costs one empty
first session and is recoverable.

Seeding is a plain `notes.create(text)` through `src/data/index.ts` — the normal
path, so the tag index is written and sync marks it dirty like any other note.
**Nothing in `docs/rulings/sync.md` is touched**: no new note kind, no sync-
exempt flag, no protocol change.

A second key records that this device has seeded, so a user who deletes the
welcome note and reloads does not get it back:

```
bear-web:landing:seeded = '1'
```

**The seed condition in full**, since it spans two keys and cannot live in a
click handler:

> `seen` present **and** `seeded` absent **and** note count is zero **and**
> (signed out, or sync has settled).

`seen` is what ties the seed to the landing flow rather than to every boot.
`seeded` is what makes it once-per-device. Both are needed: the sign-in branch
cannot seed from its click handler at all, because the click navigates to Google
and ends the JS context — the seed necessarily happens on the boot *after* the
redirect, by which time the click handler is long gone.

## Decision 4 — the screen

A centred column, `max-width` ~360px, filling the viewport. Quiet fade-in on
`--bear-duration-*` with `ease-bear`.

```
              markflowing

     Markdown notes that stay
          on your device.

      ┌──────────────────────┐
      │ G  Sign in with Google│
      └──────────────────────┘

         Continue as guest
```

- Wordmark at heading scale; positioning line at body scale in `--bear-muted`.
- Primary button uses `Button`'s existing variant; the guest choice is a `ghost`
  button beneath it, visually secondary but a full 44px target (J2a).
- Because it is a single centred column, phone, tablet and desktop need no
  separate treatment. No new breakpoint.
- Every colour is a token. No new `--bear-*` property is introduced.

### The Google mark is a documented exception to a ruling

`docs/rulings/design-tokens-and-layout.md` holds that a literal hex or `rgb()`
outside `src/styles/tokens.css` is a defect. The Google "G" ships as inline
multi-colour SVG carrying Google's four brand hex values, and that is
**permitted here and nowhere else**, because:

- they are a third party's trademark, not a value in this app's palette, and
  must not shift with the theme;
- a landing page is the one surface where the mark earns its recognition, unlike
  the text-only button in `AccountMenu` today.

It lives inside the landing feature, **not in `src/ui/Icon.tsx`**. That file
holds verbatim lucide `__iconNode` arrays and `Icon.test.tsx` walks them as
single-colour shapes; a multi-colour brand mark does not belong to that
enumeration and would weaken the test that guards it.

### No language toggle on this screen

`detectLocale()` already resolves a Korean browser to Korean before first paint,
and the sidebar toggle is one click away after entry. Adding a second locale
control here would need its own persistence path for a screen seen once.

## Decision 5 — where the welcome note's text lives

`src/features/landing/welcomeNote.ts`, as `Record<Locale, string>` — **not** in
`src/i18n/en.ts` and `ko.ts`.

This is a deliberate deviation from "no user-facing string is hardcoded in a
component; everything goes through `useT`", and the reasoning is recorded rather
than left implicit: a twelve-line Markdown blob is seeded *content*, not UI
chrome, and putting it in the translation bundles would pollute the
`TranslationKey` union that every actual UI string is checked against.
`Record<Locale, string>` provides the identical compile-time completeness
guarantee — a missing locale is a type error, exactly as `ko.ts`'s
`Record<TranslationKey, string>` annotation makes a missing translation one.

Every string on the landing screen *itself* goes through `useT` as normal.

The note's content does three jobs and stops:

1. one inline `#inbox` tag, so the tag sidebar is populated on first sight;
2. one checkbox, so the task-list affordance is discoverable;
3. one sentence saying notes are organised by hashtags, not folders.

It is an ordinary note: editable, taggable, trashable.

## Decision 6 — every existing test must be told to skip the landing

This is the largest mechanical consequence and the one most likely to be
discovered the hard way.

37 e2e specs boot a fresh browser. 24 seed a corpus through
`e2e/fixtures/seed.ts`; **13 do not seed at all**. All 37 would open onto the
landing screen instead of the app, and would fail on assertions about panes that
are not rendered.

**Solve it once, in configuration:**

- `playwright.config.ts` gains `use.storageState` carrying **both**
  `bear-web:landing:seen = '1'` and `bear-web:landing:seeded = '1'` for the
  preview origin. Every existing spec then lands in the app exactly as it does
  today, with no per-spec edit.
- The landing's own spec opts out explicitly:
  `test.use({ storageState: { cookies: [], origins: [] } })`.
- `vitest.setup.ts` makes the parallel move for unit and component tests; the
  landing's own tests clear both keys.

**Both keys, not just `seen`.** Setting only `seen` would close the gate but
leave the seed condition live, and the **13 specs that start with an empty
database** would each have a welcome note injected into the list they are
asserting against — `smoke.spec.ts`, `typography.spec.ts` and `mobile.spec.ts`
among them. The 24 seeding specs would be unaffected, so the failure would look
selective and unrelated to this change.

**Rejected: a `dismissLanding(page)` helper called from each spec.** It leaves a
trap — a spec written months from now that forgets the call presents as "my new
test mysteriously sees a login page", with nothing pointing at the cause. This
repo's standing preference is to fail loudly or not at all, and a config-level
default cannot be forgotten.

`e2e/fixtures/seed.ts` is **not** modified; the flag is orthogonal to seeding and
the 13 non-seeding specs need it just as much.

## Testing

**Unit — the gate hook.**

- Flag absent → gate open. Flag present → gate closed.
- `localStorage` throwing on read behaves exactly as absent.
- Guest click writes the flag.
- Sign-in click does **not** write the flag.
- Session resolving `signedIn` with the flag absent writes it.
- `unavailable` does not write it.

**Unit — the seed rule.** Each row of Decision 3's table, with a fake `notes`
repository and a driven `useSync` status:

- guest, zero notes → one `create` call;
- signed in, sync settles with notes present → no `create` call;
- signed in, sync settles at zero → one `create` call;
- signed in, status never reaches `'idle'` → no `create` call **and** the seeded
  flag stays unset;
- seeded flag already present → no `create` call, in every branch.

The "no `create` call" assertions are the ones that matter and must be shown
failing against an implementation with the emptiness gate removed — a seed test
that only asserts a call *happened* is the near-vacuous shape `CLAUDE.md` warns
about.

**Component — `Landing`.**

- Both buttons render with their accessible names in EN and in KO.
- Pending state renders when `loading` **and** the hint is present; buttons
  render when `loading` with no hint.
- The heading is a real heading; tab order reaches the primary button first.

**End-to-end — one new spec, `e2e/landing.spec.ts`**, opting out of the shared
`storageState`:

- fresh browser → landing screen visible, app shell absent;
- "Continue as guest" → three panes, exactly one note in the list, `#inbox`
  visible in the tag sidebar;
- reload → straight into the app, no landing screen;
- delete the welcome note and reload → still no landing, and the note does not
  return.

**Contrast.** `e2e/contrast.spec.ts` covers all sixteen themes; the landing's
text and buttons are added to its surface list. Note that both this and the
shots harness need the **opt-out** to see the landing at all, since the shared
`storageState` dismisses it — the landing case in each must carry its own
`storageState` override, or it will silently photograph and measure the app
shell instead. That failure is invisible in a screenshot count and in a passing
contrast run, so assert the landing heading is present before measuring.

The Google mark is excluded from the contrast sweep — it is a fixed-colour
trademark and is not ours to recolour.

**Visual.** `npm run shots` gains the landing screen, giving 17 shots × 16
themes = **272 files**, up from 256. Count the files; do not trust the exit
code.

**`npm run measure:check`** must pass unchanged. The landing adds a surface but
alters no existing geometry, so a diff there means something else moved.

## The bundle risk, and how it gets decided

`CEILING_BYTES` is **351,000** (`scripts/bundleSize.test.ts:409`). Q shipped at
349,360 B, leaving **1,640 B**. A landing component, a two-language welcome
note and a brand SVG will plausibly consume all of it.

**This spec deliberately does not choose the remedy in advance.** The record in
`NEXT.md` is that confident predictions about this bundle have been wrong —
a fourth `React.lazy` root made the entry closure *worse* by 322 B, and the
~234 KB chunk that reads like the theme roster is actually Tiptap and React.

So: build it, run `scripts/bundleSize.test.ts`, and only then choose between
lazying the landing behind a `React.lazy` boundary, trimming, or raising the
ceiling. The decision is made against a measured number and recorded with it.

Note that lazying *the landing* is the wrong instinct if headroom is the goal —
it is on the critical path for exactly the visitors who have the coldest cache.
Lazying `AppShell` instead would help first-visit paint and hurt every
subsequent one. Measure before arguing either.

## Rulings this creates

To be added to `docs/rulings/` when the work lands:

- **`design-tokens-and-layout.md`** — the Google mark's four brand hex values
  are the sole permitted literal colours outside `tokens.css`, scoped to the
  landing component, for the reasons in Decision 4.
- **`testing-and-tooling.md`** — `playwright.config.ts`'s `use.storageState` and
  `vitest.setup.ts` both pre-dismiss the landing gate. A test that genuinely
  wants the landing must opt out explicitly. Removing either default turns 37
  e2e specs and a large share of the component suite red at once, which is the
  intended failure mode.
- **`notes-lifecycle.md`** — the welcome note is seeded through
  `notes.create()` on the ordinary path, gated on a zero note count and, when
  signed in, on the first sync having settled. It is not sync-exempt and carries
  no special kind.

## Success criteria

1. A first-time visitor sees the landing screen and reaches the app by either
   route.
2. An abandoned sign-in returns to the landing screen, not to a signed-out app.
3. A second device signing into an existing account receives **no** second
   welcome note.
4. A returning visitor never sees the landing screen again.
5. The app still works fully offline, and a guest's experience is unchanged
   after first run.
6. All six gates pass, plus `measure:check`, and the bundle decision is recorded
   with its measurement.
