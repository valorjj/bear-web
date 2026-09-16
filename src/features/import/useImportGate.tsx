import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import { importNote } from '@/data';

import { fetchSharedPage } from './fetchSharedPage';
import { ImportSheet } from './ImportSheet';
import type { SharedPayload } from './parseSharedPage';

/** The query parameter a published page's import link carries. */
const PARAM = 'import';

/**
 * Where the id waits out a full-page navigation away and back.
 *
 * `sessionStorage`, not `localStorage`: it is per-tab and survives exactly
 * the round trip this exists for — clicking "Sign in with Google" on the
 * landing screen is a real `window.location.assign` (`src/features/account/
 * api.ts`), and the server's OAuth callback redirects back to `${appOrigin}/`
 * with no query string at all (`server/src/auth/routes.ts`). Without a
 * stash, `?import=<id>` is simply gone by the time `ImportGate` next mounts,
 * and a first-time visitor who chooses to sign in — the other landing exit,
 * and an entirely reasonable one — loses the note they clicked a link for,
 * silently. `sessionStorage` also expires with the tab, which is the right
 * lifetime: closing the tab abandons the interrupted import, exactly as
 * abandoning the page would if no round trip had happened at all.
 */
export const STASH_KEY = 'bear-web:import:pending';

/**
 * `sessionStorage` throws outright in some private-window and
 * blocked-site-data contexts, the same as `localStorage` —
 * `src/features/landing/gate.ts` reads its markers the same way. An
 * unreadable stash must behave exactly like an absent one: the note is not
 * silently invented, it is simply not recovered, which is the same outcome
 * as never having stashed at all.
 */
function readStash(): string | null {
  try {
    return sessionStorage.getItem(STASH_KEY);
  } catch {
    return null;
  }
}

function writeStash(id: string): void {
  try {
    sessionStorage.setItem(STASH_KEY, id);
  } catch {
    // Best effort. A lost stash costs the OAuth round trip its recovered
    // import, never a wrong state — the same trade `gate.ts`'s markers make.
  }
}

function clearStash(): void {
  try {
    sessionStorage.removeItem(STASH_KEY);
  } catch {
    // Nothing to clear if the write never landed either.
  }
}

/**
 * Reads `?import=<id>` from the URL and stashes it, unconditionally.
 *
 * Exported so `App.tsx` can call it OUTSIDE the landing-gate branch, on
 * every render regardless of whether the gate is open or closed — and that
 * placement is load-bearing, not a convenience. `ImportGate` itself mounts
 * only after the gate closes (see its own doc below), but a first-time
 * visitor sees the LANDING screen first, and "Sign in with Google" is a
 * full navigation away from THAT screen (`startGoogleSignIn`, `src/features/
 * account/api.ts`) that can happen before `ImportGate` ever gets a chance to
 * mount and read the URL. Without something reading and stashing the id
 * from a point that runs regardless of the gate, the sign-in branch drops
 * the import with nothing left to recover on the way back — `ImportGate`'s
 * own stash-on-mount (below) only ever catches the guest path, where no
 * navigation intervenes.
 *
 * Idempotent: called again by `ImportGate`'s own effect once it mounts, on
 * whichever load actually reaches it, which is simply the same value
 * written twice on the guest path and a no-op (the URL is clean by then) on
 * the sign-in path's return trip.
 */
export function stashPendingImportId(): void {
  const id = new URL(window.location.href).searchParams.get(PARAM);
  if (id !== null && id !== '') writeStash(id);
}

/**
 * Removes the parameter without a navigation, and clears the stash with it.
 *
 * Run on every outcome — confirm, cancel, AND a failed write: left in place,
 * a reload re-offers a note the user has already dealt with, and after a
 * failed `importNote` specifically, `notes.create` runs before the image
 * loop, so the note it half-wrote already exists — re-offering it would risk
 * a second, differently-partial copy alongside it.
 */
function clearPending(): void {
  clearStash();
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PARAM)) return;
  url.searchParams.delete(PARAM);
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Offers the note behind `?import=<id>`, and writes it only if the user says
 * yes.
 *
 * A component rather than a bare hook so its one caller — `App.tsx` — can
 * place it by where it renders, and so the ordering that matters is visible
 * at the call site: it lives in the branch that renders `AppShell`, i.e.
 * AFTER R's landing gate has closed. A link recipient is by definition a
 * first-time visitor, so mounting this alongside the landing screen would
 * open a modal behind it.
 *
 * `?import=` is the first URL parameter this app reads. It is deliberately
 * not a route: adding a client router for one parameter would also mean a
 * Pages 404 fallback, for the same reason the landing screen is a state
 * rather than a route.
 *
 * The id is stashed to `sessionStorage` the moment it is read from the URL,
 * and read back from there when the parameter is absent: the landing
 * screen's OTHER exit is "Sign in with Google", a real navigation away from
 * and back to this origin, which would otherwise carry the id nowhere and
 * silently drop the import. See `STASH_KEY` above.
 *
 * The fetch is guarded by a ref rather than by an effect dependency. React
 * StrictMode double-mounts in development, and a second fetch of the same
 * capability is harmless but pointless; more to the point, a second SHEET
 * after the user has already answered is not.
 */
export function ImportGate({
  fetch,
}: { fetch?: typeof globalThis.fetch } = {}): ReactElement | null {
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const started = useRef(false);
  const mountedRef = useRef(true);

  // Decoupled from the fetch effect below and merged mount+unmount into one
  // effect, the same fix `useSession` carries for the identical shape of
  // bug: React StrictMode mounts, cleans up, and remounts every effect once
  // in dev. A cleanup tied to the SAME effect that starts the fetch would
  // fire during that phantom cleanup and mark the in-flight request
  // cancelled — and the remounted effect, guarded by `started`, would never
  // start a replacement, so the request's eventual resolution is silently
  // dropped forever and the sheet never appears. A separate `[]`-deps effect
  // that sets the ref true on mount and false only on a REAL unmount survives
  // the phantom remount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (started.current) return;

    // Stashed again here for a component that is mounted or tested in
    // isolation (the guest path, no OAuth round trip involved) — `App.tsx`
    // already calls `stashPendingImportId` unconditionally before this can
    // ever mount in the real app; see that function's doc for why this
    // alone is not enough. Harmless to repeat: writing the same value twice
    // is a no-op, and a StrictMode phantom re-run of this effect writes the
    // same value again rather than anything new.
    stashPendingImportId();

    const urlId = new URL(window.location.href).searchParams.get(PARAM);
    const id = urlId !== null && urlId !== '' ? urlId : readStash();
    if (id === null || id === '') return;

    // Guarded by the ref, not by this effect re-running: `fetch` is read
    // once, at whichever mount first sees the parameter, and StrictMode's
    // phantom remount is a no-op here rather than a second request.
    started.current = true;
    void fetchSharedPage(id, { fetch }).then((result) => {
      if (!mountedRef.current) return;
      if (result === null) setFailed(true);
      else setPayload(result);
    });
    // No cleanup: the in-flight fetch is left to resolve, and `mountedRef`
    // above is what stops a stale resolution from calling `setState` after a
    // real unmount.
  }, [fetch]);

  const close = useCallback(() => {
    clearPending();
    setPayload(null);
    setFailed(false);
    setDone(true);
  }, []);

  const confirm = useCallback(() => {
    if (payload === null) return;
    setBusy(true);
    void importNote(payload)
      .then(close)
      .catch(() => {
        // The parameter (and stash) are cleared here too, not just on
        // cancel: `importNote` creates the note before its image loop runs,
        // so a write that rejects may still have left a partial note
        // behind. Re-offering the same id on reload risks a second,
        // differently-partial copy alongside it.
        clearPending();
        setBusy(false);
        setPayload(null);
        setFailed(true);
      });
  }, [payload, close]);

  if (done && payload === null && !failed) return null;

  return (
    <ImportSheet
      payload={payload}
      failed={failed}
      busy={busy}
      onConfirm={confirm}
      onCancel={close}
    />
  );
}
