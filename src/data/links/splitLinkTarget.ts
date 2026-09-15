import { normalizeTitle } from './parseLinks';

export interface LinkTarget {
  /** Normalized note title — `normalizeTitle`'s output, the index key. */
  title: string;
  /** Normalized heading text, or `null` when the link names no heading. */
  heading: string | null;
  /** Raw index of the separating `/` in the input, or -1 when there is none. */
  slash: number;
}

/**
 * Where the note title ends and the heading begins in a `[[…]]` target.
 *
 * THE ONLY place the `/` rule exists. `LinkPill`, `buildGraph`,
 * `notes.linksTo` and the `[[` autocomplete all come through here — a second
 * implementation of this rule is the duplicated-grammar defect this project
 * has already paid for once (see `parseTags`/`findTagRanges` in
 * `docs/rulings/tag-grammar.md`).
 *
 * `isKnownTitle` is a PREDICATE rather than a set so each caller can feed
 * whatever it already holds: a `Set` in the editor plugin, `buildTitleIndex`'s
 * `Map` in the graph, a query in the repository. It is asked about NORMALIZED
 * titles only.
 *
 * The whole string is tried first, and that ordering is load-bearing: a note
 * genuinely titled `A/B testing` must resolve as itself and never as note `A`
 * with heading `B testing`. Titles containing a slash are ordinary
 * (`TCP/IP`, `2026/09/15`).
 *
 * The scan runs over the RAW text, normalizing each candidate as it goes.
 * `normalizeTitle` lowercases and collapses whitespace, so an index found in
 * its output would not address the same character in the raw string — and
 * `slash` exists precisely so the pill can cut the raw text it is decorating.
 *
 * Resolution is therefore CONTEXT-DEPENDENT: the same text can mean a
 * different thing as notes come and go. That is already true of link
 * resolution itself (`data-resolved` flips when its target is created), and
 * the alternative — deciding the split at index time — would make a note's
 * derived rows depend on other notes existing. See the spec.
 */
export interface SplitOptions {
  /**
   * Treat `Title/` — a slash with nothing after it — as naming that note with
   * an EMPTY heading, rather than as an unresolved whole.
   *
   * Exists for the `[[` popover, where `Deploy Checklist/` is the moment the
   * reader has asked for that note's headings and typed no filter yet. The
   * pill deliberately does not pass it: a link written `[[Title/]]` names no
   * heading, and rendering a dangling separator for it would be noise.
   *
   * It is an option on THIS function rather than a second scanner in the
   * popover because the `/` rule may exist in exactly one place — see the
   * docblock above.
   */
  allowEmptyHeading?: boolean;
}

export function splitLinkTarget(
  raw: string,
  isKnownTitle: (title: string) => boolean,
  { allowEmptyHeading = false }: SplitOptions = {},
): LinkTarget {
  const whole = normalizeTitle(raw);
  if (isKnownTitle(whole)) return { title: whole, heading: null, slash: -1 };

  // Collected up front and reversed, rather than walked with a decrementing
  // `lastIndexOf`: `'/a'.lastIndexOf('/', -1)` returns 0, not -1, so the
  // obvious loop spins forever on a leading slash.
  const slashes = [...raw.matchAll(/\//g)].map((match) => match.index).reverse();

  for (const slash of slashes) {
    const title = normalizeTitle(raw.slice(0, slash));
    const heading = normalizeTitle(raw.slice(slash + 1));
    // Neither side may be empty: `[[Title/]]` names no heading, and `[[/x]]`
    // names no note. Both fall through to the unresolved form below.
    if (title === '' || (heading === '' && !allowEmptyHeading)) continue;
    if (isKnownTitle(title)) return { title, heading, slash };
  }

  return { title: whole, heading: null, slash: -1 };
}
