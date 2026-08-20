import type { Node } from '@tiptap/pm/model';

/**
 * A top-level heading and the extent of the section it owns.
 *
 * Only TOP-LEVEL headings appear here. A heading inside a blockquote or a list
 * item is deliberately not foldable: it keeps the position arithmetic to
 * `doc.forEach`'s offsets, which are absolute for a doc's direct children, and
 * a folded section nested inside another block has no sensible gutter position
 * anyway.
 */
export interface HeadingSection {
  /** Absolute document position of the heading node. */
  pos: number;
  /** Absolute position one past the heading node itself. */
  contentStart: number;
  /** Absolute position one past the last block this section owns. */
  end: number;
  level: number;
  text: string;
  /** Which occurrence this is among headings sharing `level` and `text`. */
  nth: number;
}

/**
 * How a fold names its heading, so it can survive a remount.
 *
 * Content-derived on purpose. Positions do not survive a reparse, and an
 * ordinal index ("the 3rd heading") fails CLOSED — inserting one heading near
 * the top would shift every fold below it and hide sections the user never
 * folded. This scheme fails OPEN instead: a heading that cannot be matched is
 * simply not folded and the user sees their content, which is the only
 * acceptable direction in an app with no server copy.
 */
export interface FoldKey {
  level: number;
  text: string;
  nth: number;
}

/** Stable string form, so fold sets can be a `Set<string>` and persisted as JSON. */
export function serializeFoldKey(key: FoldKey): string {
  // The level and occurrence are numeric and the text is last, so no delimiter
  // ambiguity is possible however the heading is punctuated.
  return `${key.level}:${key.nth}:${key.text}`;
}

export function foldKeyOf(section: HeadingSection): FoldKey {
  return { level: section.level, text: section.text, nth: section.nth };
}

export function headingSections(doc: Node): HeadingSection[] {
  const found: Array<Omit<HeadingSection, 'end' | 'nth'>> = [];
  const seen = new Map<string, number>();

  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading') return;
    found.push({
      pos: offset,
      contentStart: offset + node.nodeSize,
      level: node.attrs.level as number,
      text: node.textContent,
    });
  });

  return found.map((heading, index) => {
    // The section ends at the next heading of the same or HIGHER level (a
    // lower `level` number is higher in the hierarchy), so an h2 swallows the
    // h3s beneath it and stops at the next h2 or h1.
    const next = found.slice(index + 1).find((candidate) => candidate.level <= heading.level);

    const identity = `${heading.level}:${heading.text}`;
    const nth = seen.get(identity) ?? 0;
    seen.set(identity, nth + 1);

    return { ...heading, nth, end: next ? next.pos : doc.content.size };
  });
}

/**
 * The document ranges a fold set hides.
 *
 * A folded section hides its BODY and never its own heading — the heading is
 * what the user clicks to unfold, and hiding it would make the fold
 * unreachable. A key matching no heading contributes nothing: this is the
 * fail-open rule, and it is why an unmatched fold is silently inert rather
 * than an error.
 */
export function hiddenRangesFor(
  doc: Node,
  folded: ReadonlySet<string>,
): Array<{ from: number; to: number }> {
  return headingSections(doc)
    .filter((section) => folded.has(serializeFoldKey(foldKeyOf(section))))
    .filter((section) => section.end > section.contentStart)
    .map((section) => ({ from: section.contentStart, to: section.end }));
}
