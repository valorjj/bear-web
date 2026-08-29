import type { Node } from '@tiptap/pm/model';

import {
  foldKeyOf,
  headingSections,
  serializeFoldKey,
  type HeadingSection,
} from './headingSections';

export interface SectionMove {
  /** Start of the moved slice, in the PRE-move document. */
  from: number;
  /** End of the moved slice, in the PRE-move document. */
  to: number;
  /** Where the slice is inserted, in the document AFTER the delete. */
  insertAt: number;
  /** The fold set the move must leave behind, already remapped. */
  foldKeys: string[];
}

/**
 * The positions a section may be dropped at: every section's own start, plus
 * the end of the document.
 *
 * Position 0 is deliberately absent. A note's first block renders as its
 * TITLE (see `headingSections`' docblock and `editor.css`'s `:first-child`
 * rule), so a section dropped there would displace the note's name — and
 * `headingSections` already excludes that block, so it is not a section that
 * could be displaced back.
 */
export function dropBoundaries(doc: Node): number[] {
  return [...headingSections(doc).map((section) => section.pos), doc.content.size];
}

/**
 * Old fold keys to new ones, across a reordering.
 *
 * This exists because B1's fold identity is `{ level, text, nth }` and `nth`
 * is an OCCURRENCE INDEX. Reordering renumbers it for every heading sharing a
 * level and text with another, so a stored key silently comes to name a
 * different section — B1's fail-open rule cannot help, because the key still
 * matches something. It fails CLOSED, in the wrong direction.
 *
 * A key matching nothing in `before` is passed through untouched rather than
 * dropped: that IS the fail-open rule, and a key whose heading is temporarily
 * absent must survive to re-match later.
 */
export function remapFoldKeys(
  before: readonly HeadingSection[],
  after: readonly HeadingSection[],
  folded: readonly string[],
): string[] {
  // `after` is the reordered list; its `nth` values are stale by construction,
  // so they are recomputed here rather than trusted.
  const seen = new Map<string, number>();
  const renumbered = after.map((section) => {
    const identity = `${section.level}:${section.text}`;
    const nth = seen.get(identity) ?? 0;
    seen.set(identity, nth + 1);
    return { section, key: serializeFoldKey({ level: section.level, text: section.text, nth }) };
  });

  const mapped = new Map<string, string>();
  for (const section of before) {
    const oldKey = serializeFoldKey(foldKeyOf(section));
    // Identity is by ARRAY MEMBERSHIP, not by key: two sections sharing a
    // level and text are exactly the case this function exists for, so
    // matching them by key would be circular.
    const found = renumbered.find((entry) => entry.section === section);
    if (found) mapped.set(oldKey, found.key);
  }

  return folded.map((key) => mapped.get(key) ?? key);
}

/**
 * The contiguous run of sections a move carries: the source section and every
 * section nested inside it. `end` is the next same-or-higher-level heading, so
 * the run is exactly the sections whose `pos` falls inside `[from, to)`.
 */
function runOf(sections: readonly HeadingSection[], source: HeadingSection): HeadingSection[] {
  return sections.filter((s) => s.pos >= source.pos && s.pos < source.end);
}

function reorder(
  sections: readonly HeadingSection[],
  run: readonly HeadingSection[],
  toBoundary: number,
  docEnd: number,
): HeadingSection[] {
  const rest = sections.filter((s) => !run.includes(s));
  // The boundary names a section that is still in `rest` (or the document
  // end); the run lands immediately before it.
  const at = toBoundary === docEnd ? rest.length : rest.findIndex((s) => s.pos === toBoundary);
  return [...rest.slice(0, at), ...run, ...rest.slice(at)];
}

export function planSectionMove(
  doc: Node,
  folded: readonly string[],
  fromPos: number,
  toBoundary: number,
): SectionMove | null {
  const sections = headingSections(doc);
  const source = sections.find((s) => s.pos === fromPos);
  if (!source) return null;
  if (!dropBoundaries(doc).includes(toBoundary)) return null;

  // The two no-ops, and any boundary inside the slice — a section cannot
  // contain its own destination.
  if (toBoundary === source.pos || toBoundary === source.end) return null;
  if (toBoundary > source.pos && toBoundary < source.end) return null;

  const run = runOf(sections, source);
  const after = reorder(sections, run, toBoundary, doc.content.size);
  const size = source.end - source.pos;

  return {
    from: source.pos,
    to: source.end,
    // Moving downward, the delete happens first and shifts every later
    // position left by the slice's size.
    insertAt: toBoundary > source.pos ? toBoundary - size : toBoundary,
    foldKeys: remapFoldKeys(sections, after, folded),
  };
}

/**
 * The move for "up one place" / "down one place" from a caret.
 *
 * Down is not `next.pos` — that is the section's own `end` and therefore a
 * no-op. It is the NEXT SIBLING'S end, so the section hops over the whole of
 * it rather than landing inside it.
 *
 * This moves one place in DOCUMENT order over ALL sections — not just
 * same-level siblings. A nested subsection can shift past its own parent's
 * neighbour; that is deliberate, not a bug to "fix" by filtering by level.
 */
export function planSectionShift(
  doc: Node,
  folded: readonly string[],
  caretPos: number,
  direction: -1 | 1,
): SectionMove | null {
  const sections = headingSections(doc);
  const source = sections.find((s) => s.pos <= caretPos && caretPos < s.end);
  if (!source) return null;

  const siblings = sections.filter((s) => !(s.pos > source.pos && s.pos < source.end));
  const index = siblings.indexOf(source);

  if (direction === -1) {
    const previous = siblings[index - 1];
    if (!previous) return null;
    return planSectionMove(doc, folded, source.pos, previous.pos);
  }

  const next = siblings[index + 1];
  if (!next) return null;
  const boundary = next.end === doc.content.size ? doc.content.size : next.end;
  return planSectionMove(doc, folded, source.pos, boundary);
}
