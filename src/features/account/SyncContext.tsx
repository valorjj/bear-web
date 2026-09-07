import { createContext, use, type ReactElement, type ReactNode } from 'react';

import { useSessionValue } from './SessionContext';
import { useSync, type SyncController } from './useSync';

/**
 * One sync runner, read by several features.
 *
 * The same shape as `SessionProvider`, for a sharper reason. `useSync` holds
 * its concurrency guard in a `useRef` and registers its own Dexie
 * `notes.hook` debounce, so a second CALLER is a second engine with a second
 * guard that cannot see the first — and the guard's own comment names what
 * that costs: "the second push carries stale `baseRev`s for rows the first
 * already advanced — manufacturing conflict copies out of nothing."
 *
 * It had grown to three always-mounted callers (`CommandPaletteHost`,
 * `WelcomeSeeder`, `AccountMenu`), so ONE autosave write scheduled three
 * debounce timers that fired together, three engines collected the same note
 * at the same `baseRev`, the server allocated a rev for the first push and
 * conflicted the other two, and `resolveConflicts` — finding the local text
 * had moved on, because the user was still typing — minted a `(conflict)`
 * copy of the half-typed text and overwrote the note with the server's older
 * copy. On ONE device, with no second actor anywhere. Reported from
 * production on 2026-09-07: a note tagged `#a/b/c/d` left a
 * `TEST3 (conflict)` holding the `#a/b` it had passed through.
 *
 * Two further defects were the same root cause, and are fixed by the same
 * single instance rather than separately. The three instances each held their
 * own `status`/`lastSyncedAt`, so `AccountMenu`'s spinner and the command
 * palette's sync command could disagree about whether a sync was running. And
 * only `AccountMenu` renders `AdoptNotesDialog`: answering it cleared that
 * one instance's `adoptionRef` and left the other two blocked for the rest of
 * the session, so `WelcomeSeeder`'s `lastSyncedAt` never arrived and the
 * welcome note was never seeded after an adoption.
 *
 * `useSync` is deliberately no longer exported from `index.ts`, so the only
 * call site reachable from outside this directory is this provider. That is
 * structural; `scripts/sourceLint.test.ts` also fails on a second call site
 * anywhere under `src/`, because nothing else in the repo can see this class
 * of bug — every gate passed while it was shipping.
 *
 * `null` rather than a default controller, for the reason `SessionContext`
 * gives: a default would make a consumer mounted outside the provider render
 * "idle, never synced" forever, which reads as a product decision rather than
 * the wiring bug it is.
 */
const SyncCtx = createContext<SyncController | null>(null);

export function SyncProvider({ children }: { children: ReactNode }): ReactElement {
  const { state } = useSessionValue();
  return <SyncCtx value={useSync(state)}>{children}</SyncCtx>;
}

export function useSyncValue(): SyncController {
  const value = use(SyncCtx);
  if (value === null) throw new Error('useSyncValue requires a SyncProvider above it');
  return value;
}
