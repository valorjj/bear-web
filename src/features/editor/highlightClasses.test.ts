import { describe, expect, it } from 'vitest';

import { CODE_LANGUAGES } from './codeLanguages';
import { INHERITS_TEXT, MAPPED_HLJS_CLASSES } from './highlightClasses';
import { lowlight } from './lowlight';

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
