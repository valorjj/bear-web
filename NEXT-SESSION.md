# Start here

Written 2026-09-18, at the end of a session that ran from "check the padding
consistency" to a 61% cut in the app's first-load payload. You have no memory
of it. This file is the handover.

`main` is green, pushed, and deployed at https://markflowing.com/. Working
tree clean. Nothing is half-finished — you are starting from a settled state,
not resuming a task.

## Read these first, in this order

1. **`CLAUDE.md`** — loaded automatically. Its status table, operational
   traps, harness list, toolchain surprises and architecture boundaries are
   all current as of `67f6389`.
2. **`docs/superpowers/NEXT.md`** — the narrative. Its last section covers
   this session and names what was left open on purpose.
3. **`docs/rulings/`** — 600 live constraints across 13 files, NOT loaded
   automatically. CLAUDE.md's rulings index tells you which file to open
   before you touch something. **Read the row before you write the diff.**

## What shipped last session

Thirteen commits. Menu and toolbar consistency, a real focus bug, a new
measurement harness, and the editor code-splitting sub-project.

|                           | before    | now                       |
| ------------------------- | --------- | ------------------------- |
| eager JS (gzip)           | 364,303 B | **140,753 B**             |
| first note, Slow 4G       | 2,489 ms  | **1,473 ms**              |
| time-to-typeable, Slow 4G | 2,556 ms  | 3,286 ms (accepted trade) |
| `CEILING_BYTES`           | 368,000   | **144,000**               |

## Four things you will get wrong without reading this

**1. Do not reopen the `themes-*` bundle audit.** Six ceiling raises named it
as the only lever big enough to matter. It was answered last session and the
answer was NOT the vendor chunk's contents: two barrel re-exports
(`src/features/notes/index.ts`, then `src/features/export/index.ts`) were
making the whole Tiptap/ProseMirror stack a static dependency of the entry
chunk. Removing two lines saved 223,507 B. It is closed.

**2. Do not "simplify" `useNoteEditorComponent` into `React.lazy`.** It looks
like hand-rolled code that should obviously be a framework primitive. It was
`React.lazy` + `<Suspense>` first, exactly as planned, and that combination
DESTROYS this editor deterministically — `@tiptap/react`'s `useEditor`
debounces `destroy()` by a literal `setTimeout(…, 1)` and a Suspense reveal's
gap exceeds it. CLAUDE.md's Toolchain surprises has the full entry.

**3. A raise to `CEILING_BYTES` is the USER's decision, never a step in your
work.** Both sides measured, the reason recorded in the guard's own docblock.
There are 3,247 B of headroom. Also: read the CURRENT number from
`scripts/bundleSize.test.ts` or by gzipping the built file — never a figure
quoted in prose, including in this file, which has been wrong twice before
for exactly that reason.

**4. "Passes alone, fails in the suite" is not evidence of machine
contention.** That reading cost most of a day last session; the failure was a
real bug that duplicated document content. A failure reproducible at ~50% has
a cause worth finding. Three runs a side for a base-vs-branch comparison — two
clean base runs gave a false all-clear.

## Open work, roughly in priority order

Nothing here is urgent and none of it is in flight.

**The on-focus update banner.** GitHub Pages serves `index.html` with a fixed
`max-age=600` and allows no custom headers, so a long-open tab keeps running a
superseded bundle indefinitely. The narrow guard exists —
`src/features/publish/staleBuild.ts`'s `isStaleBuild` refuses to publish a
snapshot rendered by stale code — but the general case is open: a tab runs old
code for everything else, silently. Detection is done and reusable; what is
missing is a surface. `src/app/UnavailableBanner.tsx` is the precedent. If you
build it, `isStaleBuild` probably wants to move to `src/lib/` (it touches only
the DOM and `fetch`, so that is legal). **It has more bite now than when it
was deferred:** a stale tab that 404s the editor chunk after a deploy loses
the ability to edit any note until reloaded — there is a Reload affordance for
exactly that, but a banner would get ahead of it.

**Phone touch targets, still open from the 2026-09-10 audit.** The tag
drawer's four footer buttons (theme, typography, account, language) are 32×32
with no touch-target expansion, and they are the only route to those panels on
a phone. Table row/column handles measure 44×32 and 44×24. Both were design
calls rather than oversights, but they are the last known phone gaps.

**Two cosmetics from the last branch, both deliberately deferred.** The i18n
keys under `editor.loadError.*` still read `retry` though the button now
reloads — an internal identifier only, the user-facing copy is correct in both
locales. And `scripts/sourceLint.test.ts`'s two barrel greps are structurally
incomplete; their comments now say plainly that they are DIAGNOSIS (which line
did it) and that `scripts/bundleSize.test.ts` is what actually detects a
regression. Do not try to make the greps complete — wrong tool.

**An image dropped during an import is silently absent.** `importNote` skips
oversized or failed images and nothing reports it; `ImportSheet`'s count is
parse-time only and the two sets are disjoint. Deferred for lack of a
notification surface — if the update banner lands, this is its second
customer.

**The export renders `[[Note/Heading]]` as one undivided run** where the
editor dims the slash. The only place the two mediums' pill markup differs.

## How this project works

Brainstorm → spec → written plan → subagent-driven execution with a review
after every task and a whole-branch review at the end. Specs in
`docs/superpowers/specs/`, plans in `docs/superpowers/plans/`, per-milestone
ledgers in `.superpowers/sdd/<plan-name>/progress.md` (gitignored).

**Reviews here verify by running code and injecting faults, not by reading.**
Last session that caught: a retry button that could never retry (HTML's module
map caches a null entry for a failed fetch, so re-importing the same specifier
never touches the network), and two tests that could not fail. A review that
only reads the diff would have passed all three.

**Two gates are easy to forget.** `npm run measure:check` before any commit
that touched something visual — it is not in CI and drifts silently. And
`npm run measure:load` if you touch anything that could move first load; it
reports both first-paint and time-to-typeable now, so neither can move unseen.

**The machine is a fanless Mac Mini that also hosts the API service.** Cap
Vitest at `--maxWorkers=4`, never generate synthetic load, and check `uptime`
before concluding a diff broke the suite.

## If you are picking something up

Ask the user first — the list above is not a queue and the ordering is not a
ruling. The update banner is the only item with an obvious trigger (it now
has headroom and a sharper consequence), and it is still their call.
