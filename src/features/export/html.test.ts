import { Editor } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { editorExtensions, parseMarkdown } from '@/features/editor';
// Raw text of the real stylesheet, not a copy: a Vite `?raw` import, so a
// change to editor.css is what the colour-comparison tests below read.
import EDITOR_CSS from '@/styles/editor.css?raw';

import { EXPORT_TOKEN_NAMES, readExportTokens, renderNoteBody, renderNoteHtml } from './html';

/**
 * The `.hljs-*` (and unprefixed `function_`/`class_`/`inherited__`) classes
 * the EDITOR would apply to the given source, read off the real
 * `CodeBlockLowlight` decoration plugin rather than reimplemented from
 * memory -- so this is the actual editor behaviour, not a guess at it.
 *
 * `PluginKey`'s name is only a prefix: ProseMirror suffixes every 'lowlight'
 * key with an incrementing counter shared across the whole process
 * ('lowlight$', 'lowlight$1', ...), so the plugin can only be found by
 * prefix, never by an exact key a test could construct itself.
 */
function editorHljsClasses(markdownText: string): Set<string> {
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdownText) });
  const classes = new Set<string>();

  try {
    // `Plugin.key` exists at runtime (ProseMirror's own decoration lookup
    // reads it directly) but is not part of the public `.d.ts`, hence the cast.
    const plugin = editor.state.plugins.find((candidate) =>
      (candidate as Plugin & { key: string }).key.startsWith('lowlight$'),
    );
    if (!plugin) return classes;

    const decorations = plugin.getState(editor.state) as {
      find: () => readonly { type: { attrs?: { class?: string } } }[];
    };
    for (const decoration of decorations.find()) {
      for (const name of (decoration.type.attrs?.class ?? '').split(' ').filter(Boolean)) {
        classes.add(name);
      }
    }
  } finally {
    editor.destroy();
  }

  return classes;
}

/** The same classes, read off what `renderNoteBody` actually serialized. */
function exportHljsClasses(markdownText: string): Set<string> {
  const host = document.createElement('div');
  host.innerHTML = renderNoteBody(markdownText);
  const classes = new Set<string>();

  for (const element of host.querySelectorAll('[class]')) {
    for (const name of element.classList) {
      if (name === 'hljs' || name.startsWith('language-')) continue;
      classes.add(name);
    }
  }

  return classes;
}

/**
 * `editorHljsClasses`, but ordered and per-segment rather than flattened
 * into a set -- a set is blind to which classes land TOGETHER on one span,
 * which is exactly what the tag/string and string/number collisions below
 * are about. Each entry is one decoration: its covered text and its full
 * (possibly multi-class) `class` attribute, in document order.
 */
function editorDecorationSegments(markdownText: string): { text: string; classes: string }[] {
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdownText) });

  try {
    const plugin = editor.state.plugins.find((candidate) =>
      (candidate as Plugin & { key: string }).key.startsWith('lowlight$'),
    );
    if (!plugin) return [];

    const decorations = plugin.getState(editor.state) as {
      find: () => readonly { from: number; to: number; type: { attrs?: { class?: string } } }[];
    };
    return [...decorations.find()]
      .sort((a, b) => a.from - b.from)
      .map((decoration) => ({
        text: editor.state.doc.textBetween(decoration.from, decoration.to),
        classes: decoration.type.attrs?.class ?? '',
      }));
  } finally {
    editor.destroy();
  }
}

/**
 * The colour actually painted on each of the export's own leaves, read off
 * the REAL nested markup \`renderNoteBody\` produced -- not a class attribute
 * replayed in isolation. This matters for a leaf like the \`\${\`/\`}\` delimiter
 * text of a template-literal substitution: its own element is
 * \`.hljs-subst\` (no role, no colour rule of its own), and it paints
 * correctly only because it INHERITS \`--bear-code-string\` from the
 * \`.hljs-string\` ancestor wrapping it -- a lookup keyed on its own class
 * alone would miss that inheritance entirely.
 *
 * \`classed\` mirrors the editor's decoration list, which skips any leaf with
 * no classes at all (see \`parseNodes\` in the tiptap extension): a leaf's own
 * element carries at least one class, whether or not that class maps to a
 * colour role.
 */
function exportPaintedSegments(
  markdownText: string,
): { text: string; classed: boolean; color: string }[] {
  const html = renderNoteHtml(
    { title: 't', text: '' },
    Object.fromEntries(EXPORT_TOKEN_NAMES.map((name) => [name, `VALUE-${name}`])),
  );
  const css = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));

  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  const host = document.createElement('div');
  host.innerHTML = renderNoteBody(markdownText);
  document.body.append(host);

  try {
    const code = host.querySelector('pre > code');
    if (!code) return [];

    const segments: { text: string; classed: boolean; color: string }[] = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? '';
      if (text !== '') {
        const parent = node.parentElement;
        segments.push({
          text,
          classed: parent !== null && parent !== code && parent.className !== '',
          color: getComputedStyle(parent!).color,
        });
      }
      node = walker.nextNode();
    }
    return segments;
  } finally {
    host.remove();
    style.remove();
  }
}

/**
 * The colour a `class` attribute resolves to under `editor.css`'s REAL rules
 * (not a reimplementation of them) -- `.ProseMirror pre` ancestors included,
 * since editor.css's selectors are scoped under them. jsdom does not resolve
 * `var(--x)` to an actual colour, so the result is the literal
 * `var(--bear-code-*)` reference -- which is exactly what is needed here:
 * proof of WHICH role's rule won the cascade, not what that role currently
 * renders as.
 */
function editorPaintedColor(classes: string): string {
  const style = document.createElement('style');
  style.textContent = EDITOR_CSS;
  document.head.append(style);

  const root = document.createElement('div');
  root.className = 'ProseMirror';
  root.innerHTML = `<pre><span class="${classes}">x</span></pre>`;
  document.body.append(root);

  try {
    return getComputedStyle(root.querySelector('span')!).color;
  } finally {
    root.remove();
    style.remove();
  }
}

const note = {
  title: 'US market daily',
  text: '# US market daily\n\nBody **bold** and #economy/us-market\n\n- [ ] one\n- [x] two\n',
  createdAt: Date.UTC(2026, 7, 14, 4, 45),
  updatedAt: Date.UTC(2026, 7, 18, 5, 30),
};

/** A token map with recognisable values, so a missing substitution is obvious. */
const tokens: Record<string, string> = Object.fromEntries(
  EXPORT_TOKEN_NAMES.map((name, index) => [name, `VALUE-${String(index)}`]),
);

describe('renderNoteHtml', () => {
  it('produces a complete standalone document', () => {
    const html = renderNoteHtml(note, tokens);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang=');
    expect(html).toContain('</html>');
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('renders the note body through the editor schema, so export matches the editor', () => {
    const html = renderNoteHtml(note, tokens);

    expect(html).toContain('<h1>US market daily</h1>');
    expect(html).toContain('<strong>bold</strong>');
    // A task list is real markup, not a literal "- [ ]".
    expect(html).toContain('data-type="taskList"');
    expect(html).not.toContain('- [ ] one');
  });

  it('titles the document from the note', () => {
    expect(renderNoteHtml(note, tokens)).toContain('<title>US market daily</title>');
  });

  it('escapes the title rather than letting it close the tag', () => {
    const html = renderNoteHtml({ ...note, title: 'a</title><script>x</script>' }, tokens);

    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;/title&gt;');
  });

  it('inlines every token value, so the file needs no stylesheet from the app', () => {
    const html = renderNoteHtml(note, tokens);

    for (const name of EXPORT_TOKEN_NAMES) {
      expect(html, name).toContain(`${name}: ${tokens[name] ?? ''}`);
    }
  });

  it('defines every custom property it references, so nothing resolves to nothing', () => {
    // The export keeps custom properties rather than substituting values inline,
    // which makes the file readable and editable — but only if the `:root` block
    // covers every `var()` in the sheet. A typo in one token name would
    // otherwise produce an invisible element in a downloaded file, weeks later,
    // with nothing to trace it to.
    const html = renderNoteHtml(note, tokens);

    const referenced = new Set([...html.matchAll(/var\((--bear-[a-z-]+)\)/g)].map((m) => m[1]));
    const defined = new Set([...html.matchAll(/(--bear-[a-z-]+):/g)].map((m) => m[1]));

    expect(referenced.size).toBeGreaterThan(0);
    expect([...referenced].filter((name) => !defined.has(name))).toEqual([]);
  });

  it('carries a page size, so printing to PDF is not letter-by-accident', () => {
    expect(renderNoteHtml(note, tokens)).toContain('@page');
  });

  it('opts into printing backgrounds, so a code block keeps its surface on paper', () => {
    // This declaration does nothing for the server-rendered PDF path, which
    // forces backgrounds via printBackground: true and never applies print
    // media at all. It still governs a reader who downloads the HTML export
    // and prints it from their own browser: Chrome's default is
    // print-color-adjust: economy, which silently drops every painted
    // background and prints the text onto bare paper. Nothing in the unit
    // suite can see a real print, so this asserts the declaration itself -
    // and it must be on the ROOT, because the property is inherited and every
    // painted descendant depends on that inheritance.
    const html = renderNoteHtml(note, tokens);
    const root = html.match(/\n    html \{([^}]*)\}/);

    expect(root).not.toBeNull();
    // Anchored to the start of the declaration. A bare
    // toContain('print-color-adjust: exact') is VACUOUS for the unprefixed
    // form, because the -webkit- line contains that substring - deleting the
    // unprefixed declaration left this test green until it was fault-injected.
    expect(root?.[1]).toMatch(/(?:^|[\s;])print-color-adjust: exact/m);
    // Chrome and Safari still need the prefixed form; unprefixed alone is
    // silently ignored there, which is the exact failure being fixed.
    expect(root?.[1]).toContain('-webkit-print-color-adjust: exact');
  });

  it('lets the theme own the page background even when printed', () => {
    // G's ruling: a PDF matches the app exactly, dark page and all. The old
    // @media print reset cleared html/body and left --bear-text alone, so a
    // Nord export printed near-white text onto white paper - the defect that
    // motivated G, not a feature being removed.
    const html = renderNoteHtml(note, tokens);
    expect(html).not.toMatch(/@media print \{[^}]*html, body \{[^}]*background: none/);
  });

  it('has no reference to any external host', () => {
    // A self-contained export cannot depend on the network; a broken font or
    // stylesheet link would silently change the document weeks later.
    expect(renderNoteHtml(note, tokens)).not.toMatch(/https?:\/\//);
  });

  it('renders a table as a real table', () => {
    // Until M8b a table fell back to `RawBlock` and exported as a `<pre>` of its
    // own pipes. Real table nodes mean the export finally shows a table, which
    // was the single largest visible gap in an exported note.
    const table = '| a | b |\n| - | - |\n| 1 | 2 |\n';
    const html = renderNoteHtml({ ...note, text: table }, tokens);

    expect(html).toContain('<table');
    expect(html).toContain('<td');
    // `data-raw-block="` with the quote, not the bare name: the stylesheet
    // contains the selector `pre[data-raw-block]`, so a looser check matches the
    // CSS on every document and can never fail.
    expect(html).not.toContain('data-raw-block="');
  });

  it('keeps a genuinely unsupported construct verbatim rather than dropping it', () => {
    // A raw HTML block still has no node, and the fallback still has to hold:
    // export must show it rather than silently losing it.
    const html = renderNoteHtml({ ...note, text: '<aside>note</aside>\n' }, tokens);

    expect(html).toContain('data-raw-block="');
    expect(html).toContain('&lt;aside&gt;note&lt;/aside&gt;');
  });

  it('carries the six syntax tokens into the exported stylesheet', () => {
    const html = renderNoteHtml(note, tokens);

    for (const role of ['keyword', 'string', 'number', 'comment', 'function', 'type']) {
      expect(html).toContain(`--bear-code-${role}`);
    }
  });

  it('colours highlighted code in the export, not just in the editor', () => {
    const code = '```ts\nconst x = 1;\n```\n';
    const html = renderNoteHtml({ ...note, text: code }, tokens);

    expect(html).toContain('hljs-keyword');
    expect(html).toMatch(/\.hljs-keyword[^{]*\{[^}]*--bear-code-keyword/);
  });

  it('gives a class name in an extends clause the type colour, not the function colour', () => {
    // `hljs-title` alone is the function role; paired with `class_`/`inherited__`
    // on the same span it means a class name instead — the compound-selector
    // collision `editor.css` resolves and this stylesheet must reproduce.
    const code = '```ts\nclass Foo extends Bar {}\n```\n';
    const html = renderNoteHtml({ ...note, text: code }, tokens);

    expect(html).toContain('class_');
    expect(html).toMatch(/\.hljs-title\.class_[^{]*\{[^}]*--bear-code-type/);
  });

  it('keeps the language- class on the serialized <code>, the export sweep keys on it', () => {
    // If `CodeBlockLowlight`'s own `renderHTML` ever stopped emitting this
    // class, `highlightCodeBlocks` would silently stop finding any code
    // block to highlight -- so its presence is asserted directly rather than
    // assumed.
    const html = renderNoteHtml({ ...note, text: '```ts\nconst x = 1;\n```\n' }, tokens);

    expect(html).toContain('<code class="language-ts">');
  });

  it('leaves an unregistered language unhighlighted rather than guessing, matching the editor', () => {
    // `renderNoteBody`, not `renderNoteHtml` -- the full document's <style>
    // block always contains the literal string `.hljs-` for every export,
    // regardless of this note's content, so only the body proves anything.
    const body = renderNoteBody('```rust\nfn main() {}\n```\n');

    expect(body).not.toContain('hljs-');
    expect(body).toContain('fn main() {}');
  });

  it('leaves a fence with no language unhighlighted rather than guessing', () => {
    const body = renderNoteBody('```\nplain text\n```\n');

    expect(body).not.toContain('hljs-');
    expect(body).toContain('plain text');
  });
});

describe('the export and editor highlighting paths agree', () => {
  // Highlighting happens twice, through two different mechanisms -- real
  // ProseMirror decorations in the editor, a `pre > code` sweep at export --
  // and nothing else ties them together. This is what would catch the two
  // drifting apart.
  const cases: { name: string; text: string }[] = [
    { name: 'a registered language', text: '```ts\nconst x = 1;\n```\n' },
    { name: 'an unregistered language', text: '```rust\nfn main() {}\n```\n' },
    { name: 'no language at all', text: '```\nplain text\n```\n' },
    { name: 'the compound-selector case', text: '```ts\nclass Foo extends Bar {}\n```\n' },
    // The reviewer's own finding: an xml attribute value. The editor
    // flattens `hljs-tag hljs-string` onto one span; export nests a
    // `.hljs-string` element inside a `.hljs-tag` one. A SET comparison of
    // classes cannot see this -- only which one PAINTS does.
    {
      name: 'an xml attribute value (tag/string collision)',
      text: '```xml\n<a href="b">c</a>\n```\n',
    },
    // A number substituted into a template-literal string: editor flattens
    // `hljs-string hljs-number`; export nests `.hljs-number` inside
    // `.hljs-string`.
    {
      name: 'a number in a template string (string/number collision)',
      text: '```ts\nconst s = `${1}`;\n```\n',
    },
  ];

  for (const { name, text } of cases) {
    it(`produces the same .hljs-* classes as the editor for ${name}`, () => {
      expect(exportHljsClasses(text)).toEqual(editorHljsClasses(text));
    });

    it(`paints the same colour, per token, as the editor for ${name}`, () => {
      const editorSegments = editorDecorationSegments(text);
      const exportSegments = exportPaintedSegments(text).filter((segment) => segment.classed);

      expect(exportSegments.map((s) => s.text)).toEqual(editorSegments.map((s) => s.text));

      const editorColors = editorSegments.map((s) => editorPaintedColor(s.classes));
      const exportColors = exportSegments.map((s) => s.color);
      expect(exportColors).toEqual(editorColors);
    });
  }

  it('is not vacuously true: removing the tag/string compound rule breaks the colour comparison (fault injection)', () => {
    // Proves the test above actually exercises the compound rule, rather
    // than passing regardless of whether it exists.
    expect(editorPaintedColor('hljs-tag hljs-string')).toBe('var(--bear-code-string)');

    const withoutRule = EDITOR_CSS.replace(
      '.ProseMirror pre .hljs-tag.hljs-string {\n  color: var(--bear-code-string);\n}',
      '',
    );
    expect(withoutRule).not.toBe(EDITOR_CSS);

    const style = document.createElement('style');
    style.textContent = withoutRule;
    document.head.append(style);
    const root = document.createElement('div');
    root.className = 'ProseMirror';
    root.innerHTML = '<pre><span class="hljs-tag hljs-string">x</span></pre>';
    document.body.append(root);

    try {
      // With the compound rule gone, the two single-class, equal-specificity
      // rules fall back to source order -- `type` (hljs-tag) is declared
      // after `string` (hljs-string) in editor.css, so it wins, and the
      // colour comparison this round exists to enforce would fail.
      expect(getComputedStyle(root.querySelector('span')!).color).toBe('var(--bear-code-type)');
    } finally {
      root.remove();
      style.remove();
    }
  });

  it('the editor emits no .hljs-* class at all for an unregistered or absent language (absolute, not relative)', () => {
    // Round 1 only compared the editor to export; a regression that made
    // BOTH paths guess again would still pass that comparison. This is the
    // direct assertion `editorHljsClasses()` was always able to make.
    expect(editorHljsClasses('```rust\nfn main() {}\n```\n')).toEqual(new Set());
    expect(editorHljsClasses('```\nplain text\n```\n')).toEqual(new Set());
  });
});

describe('readExportTokens', () => {
  it('reads each token from the live cascade, so an export matches the active theme', () => {
    const root = document.createElement('div');
    for (const name of EXPORT_TOKEN_NAMES) root.style.setProperty(name, 'rgb(1, 2, 3)');
    document.body.append(root);

    try {
      const read = readExportTokens(root);
      expect(Object.keys(read).sort()).toEqual([...EXPORT_TOKEN_NAMES].sort());
      for (const name of EXPORT_TOKEN_NAMES) expect(read[name]).toBe('rgb(1, 2, 3)');
    } finally {
      root.remove();
    }
  });

  it('never yields an empty value, so a missing token cannot blank the page', () => {
    // jsdom resolves nothing here: the element declares no custom properties at
    // all, which is exactly the "token was renamed" case.
    const root = document.createElement('div');
    document.body.append(root);

    try {
      const read = readExportTokens(root);
      for (const name of EXPORT_TOKEN_NAMES) expect(read[name], name).not.toBe('');
    } finally {
      root.remove();
    }
  });
});

/**
 * Finds the declaration block for a selector, tolerant of whitespace and
 * formatting differences between editor.css and the export's inline <style>.
 * Throws rather than returning undefined, so a selector that stops existing
 * in either stylesheet fails the test loudly instead of comparing nothing.
 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`rule not found for selector: ${selector}`);
  return match[1] ?? '';
}

/**
 * A table's row height in the PDF export must match the editor's, and it
 * diverged twice at once: DOMSerializer emits a bare empty <p></p> for an
 * empty cell (no trailing <br>, which is what gives the EDITOR's empty
 * paragraph a line box), and the export's cell-paragraph rule dropped the
 * editor's `margin: 0` entirely, falling back to the UA sheet's `margin: 1em
 * 0` for any paragraph that isn't a `body > * + *` sibling.
 *
 * This test cannot see the pixel result -- jsdom has no layout engine, per
 * this repo's own CLAUDE.md -- so it compares the DECLARED rules instead,
 * which is exactly where both divergences live. It is deliberately more
 * specific than "both files mention td": it pins the margin value and
 * requires an explicit height-establishing declaration on the export side,
 * so a future edit that silently drops either one fails here rather than
 * shipping.
 */
describe('table-cell paragraph rules stay parallel between editor and export', () => {
  it('applies the same margin reset the editor applies to cell paragraphs', () => {
    const editorRule = ruleBody(EDITOR_CSS, '.ProseMirror th > p,\n.ProseMirror td > p');
    expect(editorRule).toMatch(/margin\s*:\s*0\b/);

    const html = renderNoteHtml(note, tokens);
    const exportCss = html.slice(
      html.indexOf('<style>') + '<style>'.length,
      html.indexOf('</style>'),
    );
    const exportRule = ruleBody(exportCss, 'th > p,\ntd > p');
    expect(exportRule).toMatch(/margin\s*:\s*0\b/);
  });

  it('gives an empty cell paragraph an explicit line box, since DOMSerializer omits the caret <br>', () => {
    // The editor needs no such declaration: ProseMirror's own DOM always
    // carries the trailing <br>, so an empty <p> is naturally one line tall.
    // The export has no <br> to lean on, so its rule must establish the line
    // box itself -- min-height, 1lh, or an equivalent -- or an empty row
    // collapses to padding alone.
    const html = renderNoteHtml(note, tokens);
    const exportCss = html.slice(
      html.indexOf('<style>') + '<style>'.length,
      html.indexOf('</style>'),
    );
    const exportRule = ruleBody(exportCss, 'th > p,\ntd > p');

    expect(exportRule).toMatch(/min-height\s*:\s*\S/);
    expect(exportRule).not.toMatch(/min-height\s*:\s*(0|auto)\b/);
  });
});
