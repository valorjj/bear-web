import {
  createContext,
  use,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

export interface ExportProgress {
  /** True while at least one PDF export is in flight. */
  pending: boolean;
  /** Call once when a PDF export starts. Must be paired with exactly one `end()`. */
  begin: () => void;
  /** Call once when that export settles, success or failure. */
  end: () => void;
}

const ExportProgressCtx = createContext<ExportProgress | null>(null);

/**
 * Global "a PDF is rendering" flag, read by the top-of-window progress bar
 * (`AppShell`) and by the PDF menu item's spinner/`aria-busy` (`ExportMenu`)
 * — two places with no ownership relationship over each other, which is why
 * this lives above both rather than as state local to either.
 *
 * A count, not a boolean: `NoteEditor` remounts on every note switch
 * (`key={note.id}`), and `exportNote`'s promise is deliberately NOT tied to
 * that lifetime (`void exportNote(...).catch(...)`, unawaited) — so a user
 * can switch notes while a PDF is still rendering and start a second export
 * from the new instance. A boolean would let the first export's `end()`
 * clear a flag the second export still needs set; the count only reaches
 * zero once every in-flight export has settled.
 *
 * Holds only `useState` — no ref, no effect — for the same reason
 * `SessionContext` does: nothing here can double-fire under StrictMode's
 * phantom double-mount, so this adds no new surface for that class of bug.
 */
export function ExportProgressProvider({ children }: { children: ReactNode }): ReactElement {
  const [count, setCount] = useState(0);
  const begin = useCallback(() => setCount((c) => c + 1), []);
  const end = useCallback(() => setCount((c) => Math.max(0, c - 1)), []);
  const value = useMemo<ExportProgress>(
    () => ({ pending: count > 0, begin, end }),
    [count, begin, end],
  );
  return <ExportProgressCtx value={value}>{children}</ExportProgressCtx>;
}

export function useExportProgress(): ExportProgress {
  const value = use(ExportProgressCtx);
  if (value === null) {
    throw new Error('useExportProgress requires an ExportProgressProvider above it');
  }
  return value;
}
