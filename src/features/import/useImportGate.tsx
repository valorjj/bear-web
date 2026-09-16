import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';

import { importNote } from '@/data';

import { fetchSharedPage } from './fetchSharedPage';
import { ImportSheet } from './ImportSheet';
import type { SharedPayload } from './parseSharedPage';

/** The query parameter a published page's import link carries. */
const PARAM = 'import';

/**
 * Removes the parameter without a navigation.
 *
 * Run on BOTH outcomes, confirm and cancel alike: left in place, a reload
 * re-offers a note the user has already dealt with — and on confirm it would
 * offer a second copy of one they already hold.
 */
function clearParam(): void {
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
    const id = new URL(window.location.href).searchParams.get(PARAM);
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
    clearParam();
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
