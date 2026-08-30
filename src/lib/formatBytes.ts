/**
 * A byte count, rendered for a person.
 *
 * Base 1024, not 1000. The figure this exists to describe is the server's
 * image quota, which is `2 * 1024 ** 3` — a decimal formatter renders that as
 * "2.1 GB" and the meter then reads as though the account had more room than
 * the server will actually give it.
 *
 * The unit symbols are deliberately not translated. `KB`/`MB`/`GB` are written
 * the same way in both locales this app ships, and routing them through `useT`
 * would put a formatting concern in the translation table for no gain — which
 * is also why this lives in `src/lib/`, which may not import from `src/i18n/`.
 */
const UNITS = [
  { limit: 1024, suffix: 'B', decimals: 0 },
  { limit: 1024 ** 2, suffix: 'KB', decimals: 0 },
  { limit: 1024 ** 3, suffix: 'MB', decimals: 1 },
  { limit: Number.POSITIVE_INFINITY, suffix: 'GB', decimals: 1 },
] as const;

export function formatBytes(bytes: number): string {
  // A negative or non-finite total is a server or arithmetic fault, not
  // something to render as "NaN GB" in the sidebar.
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const index = UNITS.findIndex((unit) => bytes < unit.limit);
  const unit = UNITS[index === -1 ? UNITS.length - 1 : index]!;
  const divisor = index <= 0 ? 1 : UNITS[index - 1]!.limit;
  const value = bytes / divisor;

  // `toFixed` then strip a trailing `.0`: "2 GB" rather than "2.0 GB", without
  // losing the digit where it matters ("1.3 GB").
  const text = value.toFixed(unit.decimals).replace(/\.0$/, '');
  return `${text} ${unit.suffix}`;
}
