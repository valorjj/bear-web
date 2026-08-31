/**
 * Every distinct Mermaid diagram source a note's text contains, in order.
 *
 * A LINE SCAN rather than a regex, and the nesting case is why: a fence of
 * four backticks legitimately contains a three-backtick `mermaid` fence — a
 * note explaining Mermaid looks exactly like that — and a regex that matches
 * an opener to the next closer renders documentation as a diagram. Tracking
 * the open fence's marker and length is the only way to get that right.
 *
 * Deduplicated, because the cache is content-addressed: two identical
 * diagrams in one note are one render.
 */
export function mermaidSources(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  const lines = text.split('\n');
  let open: { marker: string; length: number; isMermaid: boolean; body: string[] } | null = null;

  for (const line of lines) {
    const fence = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*(\S*)[ \t]*$/.exec(line);

    if (open === null) {
      if (fence === null) continue;
      const [, marker, info] = fence;
      open = {
        marker: marker![0]!,
        length: marker!.length,
        isMermaid: info!.toLowerCase() === 'mermaid',
        body: [],
      };
      continue;
    }

    // A closing fence uses the same character and is at least as long, and
    // carries no info string. Anything else is content, including a shorter
    // inner fence — which is the nesting case.
    const closes =
      fence !== null &&
      fence[1]![0] === open.marker &&
      fence[1]!.length >= open.length &&
      fence[2] === '';

    if (closes) {
      if (open.isMermaid) {
        const source = open.body.join('\n');
        if (source.trim() !== '' && !seen.has(source)) {
          seen.add(source);
          found.push(source);
        }
      }
      open = null;
      continue;
    }

    open.body.push(line);
  }

  // An unclosed fence at end of text is a half-typed block. Dropped.
  return found;
}
