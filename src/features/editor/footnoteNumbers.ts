import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/**
 * Footnote labels mapped to their displayed number, by order of FIRST
 * reference.
 *
 * THE ONLY place the numbering rule exists. The editor paints these as
 * decorations and `renderNoteBody` writes them into exported HTML — two
 * mediums, one rule, nothing to keep in agreement.
 *
 * That split is the whole reason this is a separate function rather than a
 * plugin's private helper. Decorations never serialize: `CodeBlockLowlight`
 * already sprang this trap on the project, producing exports with a correct
 * stylesheet applied to nothing. An export that derived its own numbering
 * would be a second implementation of exactly the kind sub-project U had to
 * collapse — so `renderNoteBody` calls THIS, on the document it already
 * builds.
 *
 * Definitions are not consulted at all. A marker with no definition still
 * takes a number, because a marker written before its footnote is the ordinary
 * mid-writing state; a definition nobody references takes none, because a
 * number is a reference's property, not a footnote's.
 */
export function footnoteNumbers(doc: ProseMirrorNode): Map<string, number> {
  const numbers = new Map<string, number>();

  doc.descendants((node) => {
    if (node.type.name !== 'footnoteRef') return true;
    const label = String(node.attrs.label ?? '');
    if (label !== '' && !numbers.has(label)) numbers.set(label, numbers.size + 1);
    return false;
  });

  return numbers;
}
