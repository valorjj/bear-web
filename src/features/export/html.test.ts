import { Editor } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { editorExtensions, parseMarkdown } from '@/features/editor';

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
  ];

  for (const { name, text } of cases) {
    it(`produces the same .hljs-* classes as the editor for ${name}`, () => {
      expect(exportHljsClasses(text)).toEqual(editorHljsClasses(text));
    });
  }
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
