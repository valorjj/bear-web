# The editor leaves the critical path

**No letter assigned.** The lettering is `docs/superpowers/NEXT.md`'s to
hand out, not this file's; CLAUDE.md is explicit that the lettered rows in
its status table are that document's scheme.

**Date:** 2026-09-17
**Status:** SHIPPED 2026-09-18, merged to `main` as `67f6389`.

**What actually shipped, against what this spec predicted.** Read the
prediction table below as a record of reasoning, not as the result — the
branch beat it, and the reason it beat it is the interesting part.

| | this spec predicted | shipped |
| --- | --- | --- |
| eager gzip | 234,807 | **140,753** |
| first note, Slow 4G | 1,979 ms | **1,473 ms** |
| time-to-typeable | not predicted | 3,286 ms, from 2,556 |

**The spec's own measurement was right about the prize and wrong about the
route.** It found ONE barrel re-export (`src/features/notes/index.ts`). There
were two: `src/features/export/index.ts` re-exported `exportNote` and
`renderNoteHtml` as values through a second door. The spike measured 234,807 B
only because it ablated `html.ts`'s editor imports outright, which masked that
edge completely. Closing both got 223,507 B rather than 129,496.

**`React.lazy` could not be used at all**, which this spec assumed throughout.
See the task-3 addendum below and CLAUDE.md's Toolchain surprises.

**The trade this spec reserved for the user was taken, with numbers.**
Time-to-typeable is 730 ms worse on Slow 4G and unchanged on Fast 4G and
WiFi. It was investigated before being accepted — no waterfall and no late
fetch, both ruled out by direct observation — and decomposes into ~350 ms of
irreducible transfer and ~500 ms of cold-code construction that `main` paid
too, with its modules already warm from boot.

## The problem

A cold first load takes **2,482 ms to show the note list on Slow 4G**. The
browser downloads 364,303 B of gzipped JavaScript before anything appears,
and roughly 70% of that is a rich text editor the note list does not use.

This is a first-visit cost, not a per-launch cost — the browser caches the
JS afterwards — so it is paid once per person, and again after each deploy.
That softens it, but it is still the only moment this app can feel slow:
everything after boot is IndexedDB and instant.

## What the measurement actually says

`npm run measure:load` (added 2026-09-17) times a cold load across CPU and
network. Its finding reframes the problem:

| CPU | Network | First note visible |
| --- | --- | --- |
| 4x | Slow 4G | 2,482 ms |
| 1x | Slow 4G | 2,469 ms |
| 4x | Fast 4G | 905 ms |
| 4x | WiFi | 243 ms |
| 1x | WiFi | 199 ms |

**The network dominates and the CPU barely matters.** Throttling the
processor 4x moves first-note by about 30 ms; changing the connection moves
it by 2.3 seconds. The eager bundle is a TRANSFER cost, not a
parse-and-execute one — the opposite of the usual mobile-web assumption, and
the reason this sub-project is about bytes on the critical path rather than
about making the app do less work.

The caveat, recorded so nobody over-reads the table: CDP's CPU throttling is
a multiplier on this machine's processor, so 4x on an M-series Mac is still
quicker than a real budget Android. The CPU column understates a cheap
handset. It cannot be understating it by two seconds.

## Where the bytes are

Attributed by decoding the chunk's own sourcemap (raw bytes, `themes-*`):

| | raw | share |
| --- | --- | --- |
| our own `src/` | 166,209 | 21.9% |
| prosemirror-view | 97,834 | 12.9% |
| @tiptap/core | 76,194 | 10.0% |
| highlight.js | 70,708 | 9.3% |
| prosemirror-model | 44,733 | 5.9% |
| marked | 40,793 | 5.4% |
| prosemirror-tables | 34,199 | 4.5% |
| prosemirror-transform | 31,172 | 4.1% |
| lowlight | 22,459 | 3.0% |
| @tiptap/extension-list | 20,200 | 2.7% |
| …16 more | | |

**Our own code is a long tail with nothing to trim** — the largest single
file is `RichEditor.tsx` at 9,521 B raw, and the next twenty are between 2
and 9 KB each. There is no application-code win here, which is what six
previous ceiling raises had been implicitly hoping for.

## The finding

**The note list does not need the editor, and loads all of it anyway.**

`src/features/notes/preview.ts` has no imports at all. Only two modules in
the whole of `src/` reach `@/features/editor`: `NoteEditor.tsx`, and
`export/html.ts`.

The split was MEASURED rather than estimated, and the first two attempts are
the instructive part.

**Attempt 1 — `React.lazy` around `NoteEditor`: 86 bytes.** The editor came
straight back through `export/html.ts`, which `NoteRowMenu`, `NoteList`,
`palette/commands.ts` and `AppShell` all import for the export item.

**Attempt 2 — closing that door as well: still nothing.** The real culprit
was `src/features/notes/index.ts`, which re-exports `NoteEditor`. **A barrel
re-export defeats the split**: importing anything at all from
`@/features/notes` pulls the entire editor stack in statically, and `AppShell`
imports from that barrel. This is the same class of hazard as the runtime
import cycle recorded in CLAUDE.md — a barrel that looks like an organising
convenience and is load-bearing for the module graph.

**With all three doors closed:**

| | eager gzip | Slow 4G first note |
| --- | --- | --- |
| `main` at `765e63b` | 364,303 | 2,482 ms |
| split | 234,807 | 1,979 ms |
| | **−129,496 (−36%)** | **−503 ms (−20%)** |

Fast 4G and WiFi were unchanged, which is expected: they were never
transfer-bound.

## Scope

Three changes, and none of them is the `React.lazy` line everyone expects to
be the whole job.

**1. `NoteEditor` leaves the `@/features/notes` barrel.** Callers import it
by path. Without this, nothing else in this spec has any effect — measured
twice, at 86 B and at 0 B. A test should pin it: a barrel that re-exports the
editor again is a silent regression of the whole sub-project.

**2. The export path becomes dynamic.** Export is always user-initiated —
a menu item, a palette command — so `import()` at the call site is natural
rather than contorted. Four call sites: `NoteRowMenu`, `NoteList`,
`palette/commands.ts`, `AppShell`. The already-lazy `PublishDialogContainer`
is the shape to copy.

**3. `NoteEditor` is wrapped in `React.lazy` with a real fallback.** Not
`null`: on desktop the editor pane is visible immediately, and an empty pane
that fills in reads as a bug. The pane's existing empty state is the obvious
candidate, but see the open question below.

## The decision this sub-project must take first

**Which win are we buying: first PAINT, or first USABLE EDITOR?**

The 503 ms is the note list appearing sooner. The editor chunk then streams
in behind it. For a reader opening the app to find a note, that is the whole
win. For a writer who opens the app to type immediately — and on desktop a
note may already be selected — the editor may now arrive LATER than it does
today, because it starts downloading after the shell rather than alongside it.

**DECIDED by the user on 2026-09-17: buy first paint, and hide the cost with
a preload.** The recommendation below was taken as written.

Issue
the editor chunk's `import()` as soon as the shell has painted, rather than
when the editor first renders. The list is interactive at 1,979 ms and the
editor arrives during the time the reader spends choosing a note — which is
seconds, not milliseconds. This keeps the win without trading it for a
regression on the writer's path.

**The alternative, if measurement disagrees:** keep the editor eager and
accept 2,482 ms. That is a legitimate outcome for an app whose main screen
IS the editor, and this spec should not be read as assuming otherwise.

**This must be verified, not assumed.** `measure:load` currently waits for
the note list. The sub-project needs a second scenario that waits for the
editor to be typeable, measured on both sides, or it will ship a number that
looks good and a writer's experience that got worse.

## What this deliberately does not touch

**highlight.js stays eager.** Its registration in
`src/features/editor/lowlight.ts` is ruled (`5c04dee`, 2026-08-24): lazy
saved 14,614 B but the spike produced a build that compiled, ran, and
highlighted nothing at all, because the registry tree-shook to nothing. That
ruling stands and this sub-project does not reopen it. At ~73 ms on Slow 4G
it is not where the money is; the 129 KB above is.

**No dependency is removed.** `marked` arrives with `@tiptap/markdown` and
`prosemirror-tables` is the table feature. Both move behind the boundary
along with everything else, which is the point — they stop being a
first-paint cost without ceasing to exist.

## Risks

**Rolldown may extract shared primitives and eat some of the saving.** This
is measured behaviour here, not a hypothetical: sub-project W found
`React.lazy` around `ImportSheet` measured 82 B WORSE than eager, because
`Dialog` and `Button` were shared across the new boundary and got pulled into
their own chunks. The saving above (129,496 B) is large enough that
per-chunk overhead cannot plausibly consume it, but the final number must be
measured on the finished branch rather than inherited from this spec.

**`AppShell.test.tsx` mocks `NoteEditor` through the barrel** and will need
rewiring. It was the only typecheck failure the spike hit.

**A `Suspense` boundary changes mount timing**, and this codebase has a
documented history of races around `NoteEditor`'s seed and remount
(`docs/rulings/notes-lifecycle.md`). Expect the e2e suite to find them, and
read a failure there as a real race rather than a flake — the toolbar-focus
bug on 2026-09-17 is the cautionary example.

## What the guard should do afterwards

The eager ceiling is 368,000 with the closure at 364,303. If this lands at
~235,000, **the ceiling should be lowered to match** — around 238,000, on the
same ~3 KB-for-wiring convention every raise has used. A budget left at
368,000 after a 129 KB saving would hand back the entire win to the next six
features without anyone deciding to spend it, which is precisely the ratchet
`scripts/bundleSize.test.ts`'s docblock spent seven entries warning about.

Lowering a ceiling is the user's decision on the same terms as raising one,
and **it was taken on 2026-09-17, in advance: the ceiling comes down once
this lands.** The exact number follows the finished measurement rather than
this spec's estimate — ~3 KB of wiring headroom above whatever the branch
actually measures, the same convention every raise used. This is the first
time the guard has moved DOWN.

## Evidence

Every number here came from a throwaway spike on 2026-09-17, reverted in
full. The method, for whoever executes this:

- sourcemap attribution: build with `build.sourcemap: true`, decode the
  chunk's mappings and attribute generated byte spans per source
  (`source-map-explorer` refuses Rolldown's maps — "generated column
  Infinity")
- closure measurement: sum the gzipped entry chunk's transitive STATIC
  `imports` from `dist/.vite/manifest.json`, exactly as
  `scripts/bundleSize.test.ts` does
- timing: `npm run measure:load`

## Addendum, task 3 (2026-09-17): the planned `lazy()`/`Suspense` boundary crashed the editor

This spec's own Step 3 plan (and this sub-project's task-3 brief, which
carried the same snippet forward) called for wrapping `NoteEditor` in
`React.lazy()` + `<Suspense>`. Implemented exactly as planned, it crashed the
app on the very first mount of any note — 100% reproducible in the dev
server, in a production preview build (`npm run build && npm run preview`),
and under Playwright, not a React-dev-mode-only artifact.

**Symptom:** the `EditorLoading` fallback showed briefly, then the whole app
went blank. Console: `TypeError: Cannot read properties of null (reading
'commands')`, thrown from `@tiptap/core`'s `Editor.get commands`, inside a
passive effect with no error boundary above it anywhere in `src/` — React
tears down the whole root on an uncaught error in a passive effect with
nothing to catch it, which is why the entire page went blank rather than
just the editor pane.

**Root cause**, confirmed by reading `@tiptap/react`'s source
(`node_modules/@tiptap/react/dist/index.js`, `EditorInstanceManager`) and by
temporary `onCreate`/`onDestroy`/effect logging in `RichEditor.tsx` (removed
before committing):

`useEditor` survives React StrictMode's synchronous phantom double-mount by
debouncing its real `destroy()` behind a literal `setTimeout(…, 1)` in
`scheduleDestroy()`: on unmount it sets `isComponentMounted = false` and
schedules the destroy; if the component remounts before the 1ms timer fires,
the mount effect clears the timeout and nothing is destroyed. That
assumption — disconnect and reconnect land inside the same synchronous
tick — holds for StrictMode's phantom double-invoke, which really is
synchronous.

It did not hold here. Every mount produced this sequence (captured via the
temporary logging, one real pair even in the production build with no
StrictMode double-invoke):

```
editor onCreate
editor onDestroy        (~1-4ms later)
noteTitles effect { editor: Editor, isDestroyed: true, noteTitles: undefined }
→ TypeError: Cannot read properties of null (reading 'commands')
```

`scheduleDestroy()` calls `currentEditor.destroy()` then `this.setEditor(null)`
once the debounce window has passed without a remount; the crash is the
unique path that produces exactly this error shape once that has happened,
and the reviewer who checked this diagnosis at the dependency level
confirmed that path directly against `@tiptap/react/dist/index.js:486–500`.

What is measured, and what is not: the 1ms window was reliably exceeded on
this machine, with this React and `@tiptap/react` version pair, every time
this specific boundary was mounted. That the mechanism is specifically
Suspense's `reconnectPassiveEffects`/Offscreen connect path (rather than
some other source of delay between `useEditor`'s disconnect and reconnect)
is the least-certain part of this diagnosis — plausible from the stack trace
and from reading React's fiber-commit code, but not independently isolated
from the timing race itself. Treat "a component that owns `useEditor` should
not be mounted behind `lazy()`/`Suspense`" as a measured, version- and
timing-dependent risk to re-check if `@tiptap/react` or React change, not as
a structural law of Suspense — `GraphView`'s own `lazy()`/`<Suspense>`
boundary in `AppShell.tsx` goes through the same boundary machinery
unaffected, because `d3-force` has no comparable debounced-teardown
assumption to race.

**The fix landed instead:** `AppShell.tsx` loads `NoteEditor` through a
manually cached `import()` and a `useState` gate, with no `React.lazy()` and
no `<Suspense>` for this boundary. This produces the identical
`NoteEditor-*.js` entry under `dynamicImports` in
`dist/.vite/manifest.json` — code-splitting is decided by the `import()`
call itself, not by which API consumes its promise — without ever touching
React's Suspense/Offscreen machinery, so there is no reconnect pass for
`useEditor`'s destroy timer to race.
