import { Editor } from '@tiptap/core';
import type { Plugin } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';

import { parseMarkdown } from './markdown';
import { editorExtensions } from './extensions';
import { CODE_LANGUAGES } from './codeLanguages';
import {
  INHERITS_TEXT,
  KNOWN_FLATTENED_COLLISIONS,
  MAPPED_HLJS_CLASSES,
  roleOf,
  roleOfFlattenedClasses,
} from './highlightClasses';
import { lowlight } from './lowlight';
// Raw text of the real stylesheet, not a copy: a Vite `?raw` import, so a
// change to editor.css is what the enumeration test below reads.
import EDITOR_CSS from '@/styles/editor.css?raw';

/**
 * A snippet per language, chosen to exercise keywords, strings, numbers,
 * comments, function names and type/attribute positions.
 *
 * The five class-supporting languages (java, javascript, typescript, kotlin,
 * python) each also carry an `extends`/inheritance form. highlight.js gives
 * the extended class name its OWN scope distinct from the class being
 * declared (`title.class.inherited`, emitted as the class `inherited__`, in
 * javascript/python/typescript's grammars) — a sample with only a plain
 * `class A { ... }` never exercises that scope, and the empirical sweep
 * cannot report what it never sees.
 */
const SAMPLES: Record<string, string> = {
  bash: '# note\nfoo() { echo "hi" 42; }',
  css: '/* note */\n.a { color: #fff; width: 42px; }',
  java: '// note\nclass A extends B { int f() { return 42; } }',
  javascript: '// note\nfunction f(a) { return "s" + 42; }\nclass A extends B {}',
  json: '{ "a": 42, "b": "s", "c": true }',
  kotlin: '// note\nclass A : B() { fun f(a: Int): String = "s" }',
  markdown: '# Title\n\n**bold** and `code`',
  python: '# note\ndef f(a: int) -> str:\n    return "s"\n\nclass A(B):\n    pass',
  sql: '-- note\nSELECT a FROM t WHERE b = 42;',
  typescript: '// note\nfunction f(a: number): string { return "s"; }\nclass A extends B {}',
  xml: '<!-- note --><a href="x">y</a>',
  yaml: '# note\na: 42\nb: "s"',
};

function classesEmittedBy(language: string, code: string): Set<string> {
  const tree = lowlight.highlight(language, code);
  const found = new Set<string>();
  const walk = (node: {
    type?: string;
    properties?: { className?: string[] };
    children?: unknown[];
  }) => {
    for (const name of node.properties?.className ?? []) found.add(name);
    for (const child of node.children ?? []) walk(child as typeof node);
  };
  walk(tree as unknown as Parameters<typeof walk>[0]);
  return found;
}

describe('the hljs class mapping', () => {
  it('covers every class the twelve grammars actually emit', () => {
    const unaccounted: string[] = [];
    for (const { id } of CODE_LANGUAGES) {
      for (const name of classesEmittedBy(id, SAMPLES[id]!)) {
        if (name === 'hljs') continue;
        if (MAPPED_HLJS_CLASSES.has(name)) continue;
        if (INHERITS_TEXT.has(name)) continue;
        unaccounted.push(`${id}: ${name}`);
      }
    }
    // A class in neither set renders as plain text with NO error, which is
    // indistinguishable from a deliberate choice. Add it to one set or the
    // other — never leave it out.
    expect(unaccounted).toEqual([]);
  });

  it('has a sample for every roster language, so the sweep is not vacuous', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(CODE_LANGUAGES.map((l) => l.id).sort());
  });

  it('never lists a class as both mapped and inheriting', () => {
    const both = [...MAPPED_HLJS_CLASSES].filter((name) => INHERITS_TEXT.has(name));
    expect(both).toEqual([]);
  });
});

/**
 * A second, deliberately nesting-heavy corpus, on top of `SAMPLES` above.
 *
 * `SAMPLES` was built to exercise each of the six roles once; it is not
 * broad enough to surface flattening collisions, which come from a
 * grammar's MODE nesting (a function scope wrapping its own keyword and
 * parameters, a tag scope wrapping its own attribute value, a string scope
 * wrapping an interpolated number) rather than from any single token. Three
 * rounds of this task each found more collisions than the last by widening
 * the corpus by hand — this file exists so the next one is a red test
 * instead of a fourth round of hand discovery.
 */
const NESTED_SAMPLES: Record<string, readonly string[]> = {
  bash: [
    '# c\nfoo="bar" # trailing\ncmd --flag="value" $VAR ${OTHER:-def} `echo hi` 42',
    'if [[ "$x" == "y" ]]; then echo "$x-$y"; fi',
    'echo "result: $(echo hi) and $((1+2))"',
    'function f() { local x=42; echo "$x"; }',
  ],
  css: [
    '/* c */\n.a[href="x"]::before { content: "hi"; color: var(--c, #fff); width: calc(1px + 2%); }',
    '@media (max-width: 42px) { .b { color: red; } }',
    '.c { background: url("x.png") no-repeat; font: 12px/1.4 "Times New Roman", serif; }',
  ],
  java: [
    '/** doc */\n@Override\npublic class A extends B implements C {\n  private final int x = 42;\n  String s = "hi \\"there\\"";\n}',
    '@Anno("value")\nclass A<T extends Comparable<T>> {\n  void f(int a, String b) throws IOException {}\n}',
  ],
  javascript: [
    'const s = `hi ${name} ${1+2}`;\n/** doc */\nclass A extends B {}\nconst re = /a\\/b/gi;\nconst o = { a: 1, "b": 2 };',
    'async function* f(a = 1, b = "s") { yield await g(`x${1}`); }\nconst { a = 1, ...rest } = obj;',
    'function fn(a, b = 42, c = "d", e = true, f = null) { return a; }',
    'function f(a = NaN, b = Infinity, c = undefined, d = console.log) { return a; }',
  ],
  json: ['{ "a": [1, 2, "s"], "b": { "c": true, "d": null } }'],
  kotlin: [
    'annotation class A\nclass A : B(), C {\n  val x: Int = 42\n  val s = "hi $name ${1+2}"\n}',
    'data class D(val x: Int = 42, val s: String = "d")\nval s2 = "${x.toString()}"',
    'fun f(a: Int = 1): String = "hi"',
    'fun g(a: Int, b: String = "d", c: Double = 1.5, d: Boolean = true, vararg e: Int): Boolean { return true }',
    'fun h(a: List<Int> = listOf(1, 2)): Unit {}',
  ],
  markdown: [
    '# T\n\n**bold *and nested* text** and `code with "quotes"` and [link](http://x "title")\n\n```js\nconst x = 1;\n```\n',
    '> quote with `code` and **bold**\n\n1. item `x` and [link](#a)\n',
  ],
  python: [
    '@decorator\nclass A(B, metaclass=C):\n    """doc"""\n    x: int = 42\n    s = f"hi {name!r:>{width}}"\n    r = r"raw\\d+"\n',
    '@app.route("/x", methods=["GET"])\ndef f(a: int = 42, b: str = "d", c: bool = True, *args, **kwargs) -> dict:\n    return {"a": [1, "s"]}\n',
  ],
  sql: [
    "SELECT a, 'str''s' AS b FROM t /* c */ WHERE x = 42 AND y LIKE '%s%' GROUP BY a HAVING COUNT(*) > 1;",
    "SELECT COUNT(DISTINCT a) AS c, CONCAT(x, '-', 42) FROM t JOIN u ON t.id = u.id;",
  ],
  typescript: [
    'interface I<T extends U> { a: string; }\nclass A<T> extends B<T> implements C {}\nconst s = `hi ${name}`;\nenum E { A, B }',
    '@Component({ selector: "app", template: `<div>${1}</div>` })\nclass A<T extends Base<T>> {}',
    'function f(a: number, b: string = "d", c: boolean = true, d?: number): boolean { return true; }',
    'const arrow = (a: number = 1, b: string = "s"): void => {};',
  ],
  xml: [
    '<a href="x" data-value=\'1\'><!-- c --><b/><c>text &amp; more</c></a>',
    '<svg viewBox="0 0 1 1"><path d="M0 0" fill="red" stroke-width="2"/></svg>',
    '<?xml version="1.0"?>\n<a:b xmlns:a="urn:x"><![CDATA[raw <not> parsed]]></a:b>',
  ],
  yaml: [
    'a: &anchor\n  b: *anchor\n  c: "quoted # not comment"\n  # real comment\n  d: [1, 2, "s"]\n',
    '%YAML 1.2\n---\na: !!str 42\nb: {c: 1, d: "s"}\n',
  ],
};

/**
 * The editor's REAL decorations for a fenced block of `code` in `language`,
 * as `{ text, classes }` segments in document order — `classes` is the full,
 * space-separated, ancestor-first/innermost-last string `CodeBlockLowlight`'s
 * plugin actually attaches, not a reimplementation of what it should be.
 */
function editorDecorationSegments(
  language: string,
  code: string,
): { text: string; classes: string }[] {
  const markdown = '```' + language + '\n' + code + '\n```\n';
  const editor = new Editor({ extensions: editorExtensions, content: parseMarkdown(markdown) });

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
 * The colour a `class` attribute resolves to under `editor.css`'s REAL
 * rules. jsdom does not resolve `var(--x)`, so the result is the literal
 * `var(--bear-code-*)` reference — proof of which role's rule won, which is
 * exactly what this needs.
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

describe('flattened multi-role class combinations', () => {
  /**
   * Every distinct combination the real editor decoration plugin produces
   * across all twelve grammars and the full nesting-heavy corpus, where the
   * accumulated classes span two or more roles. Keyed by the MAPPED classes
   * only, in the order they appear (ancestor-first, innermost-last) — an
   * unmapped class riding along (e.g. `hljs-params`) does not change which
   * role should win and is not part of the identity of the collision.
   */
  const discovered = new Map<string, { classes: string[]; language: string; rawClasses: string }>();

  for (const { id } of CODE_LANGUAGES) {
    for (const sample of NESTED_SAMPLES[id] ?? []) {
      for (const segment of editorDecorationSegments(id, sample)) {
        const allClasses = segment.classes.split(' ').filter(Boolean);
        const mapped = allClasses.filter((cls) => roleOf(cls) !== null);
        const roles = new Set(mapped.map((cls) => roleOf(cls)));
        if (roles.size < 2) continue;

        const key = mapped.join(',');
        if (!discovered.has(key)) {
          discovered.set(key, { classes: mapped, language: id, rawClasses: segment.classes });
        }
      }
    }
  }

  it('found at least one collision, so this sweep is not vacuous', () => {
    expect(discovered.size).toBeGreaterThan(0);
  });

  for (const { classes, language, rawClasses } of discovered.values()) {
    const role = roleOfFlattenedClasses(classes);

    it(`resolves ${classes.join('+')} (found in ${language}) to ${String(role)}, matching the innermost-last rule`, () => {
      // A combination this mechanical rule cannot resolve at all would mean
      // a class in `classes` is not in `ROLE_CLASSES` -- impossible by
      // construction (only mapped classes reach this point), so this is a
      // sanity check on the rule itself, not the corpus.
      expect(role).not.toBeNull();
      expect(editorPaintedColor(rawClasses)).toBe(`var(--bear-code-${role})`);
    });
  }

  it('the discovered set matches the documented list exactly, so neither goes stale', () => {
    // Two ways this can fail: the corpus now produces a combination
    // `KNOWN_FLATTENED_COLLISIONS` does not document (fix the CSS, then add
    // it here), or this file's list documents one the corpus no longer
    // proves exists (widen the corpus, or the entry is dead and should be
    // removed together with its CSS rule).
    const discoveredKeys = [...discovered.values()].map((entry) => entry.classes.join(',')).sort();
    const knownKeys = KNOWN_FLATTENED_COLLISIONS.map((combo) => combo.join(',')).sort();
    expect(discoveredKeys).toEqual(knownKeys);
  });
});
