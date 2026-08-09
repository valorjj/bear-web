import { MarkdownManager } from '@tiptap/markdown';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';

// OBSERVED DEPENDENCY BEHAVIOUR: the brief's original helper built the manager
// like this:
//
//   const instance = new MarkdownManager();
//   for (const extension of StarterKit.configure().extensions ?? []) {
//     instance.registerExtension(extension);
//   }
//
// `StarterKit.configure().extensions` is `undefined` at runtime — `Object.keys()`
// on the configured extension returns only `['type', 'parent', 'child', 'name',
// 'config']`. StarterKit (like every Tiptap "combined" extension) declares its
// children through the `addExtensions()` lifecycle hook, not a public `.extensions`
// array; that hook is only invoked by an extension manager's flatten/sort pass.
// With the brief's helper, `registerExtension` is called zero times, so every
// node type — including built-ins like heading — has no registered
// `renderMarkdown` handler, and `serialize()` returns `''` unconditionally
// regardless of input. `parse()` still produces a heading node because
// `parseFallbackToken` has hardcoded fallback cases for common token types, so
// the illusion of a working round-trip is easy to miss from `parse()` output
// alone.
//
// The correct standalone construction passes the extension list to the
// constructor, which calls the same flatten/sort/registerExtension pipeline
// the real `Markdown` Tiptap extension uses internally
// (`this.editor.extensionManager.baseExtensions`) when there is a live Editor:
function manager(): MarkdownManager {
  return new MarkdownManager({ extensions: [StarterKit.configure()] });
}

describe('characterization: MarkdownManager standalone', () => {
  it('parses and serializes a heading without a DOM', () => {
    const md = manager();
    const doc = md.parse('# Hello');
    expect(md.serialize(doc)).toContain('# Hello');
  });

  it('records what an empty document serializes to', () => {
    const md = manager();
    const doc = md.parse('');
    // The exact value pins EMPTY_DOCUMENT_MARKDOWN in Task 6.
    expect(md.serialize(doc)).toBe('');
  });

  it('records whether a trailing newline is emitted', () => {
    const md = manager();
    // OBSERVED: no trailing newline. `serialize` returns exactly '# Hello'.
    expect(md.serialize(md.parse('# Hello'))).toBe('# Hello');
  });

  it('records what happens to a table token with no table extension', () => {
    const md = manager();
    const source = '| item | qty |\n| ---- | --- |\n| bread | 2 |';
    const doc = md.parse(source);
    const out = md.serialize(doc);
    // OBSERVED DEPENDENCY BEHAVIOUR (load-bearing finding): with no extension
    // registered for the `table` token, `doc.content` is `[]` — the entire
    // table, including 'bread', is dropped during PARSE, not just serialize.
    // `parseFallbackToken`'s default case only recurses into `token.tokens`
    // when present; a marked `table` token has no `.tokens` property (it has
    // `header`/`rows`/`align` instead), so the fallback returns `null` and the
    // whole node vanishes silently. This is exactly the failure mode RawBlock
    // (Task 5) exists to prevent.
    expect(doc.content).toEqual([]);
    expect(out).toBe('');
  });

  it('records whether one extension may claim several markdown token names', () => {
    // `markdownTokenName` is typed `string | undefined` (single value), and at
    // runtime `registerExtension` does:
    //   const tokenName = getExtensionField(extension, 'markdownTokenName') || name;
    //   this.registry.set(tokenName, ...)
    // If an extension supplies an array instead of a string, that array
    // becomes the literal Map key. marked's lexer emits string token types
    // ('table', 'image', ...), so `registry.get('table')` never matches an
    // array key — the registration is accepted with no error, but the
    // extension can never actually handle any token. Demonstrated below with
    // a real extension instance and a real parse call, not a type paraphrase.
    const FakeMulti = Node.create({
      name: 'fakeMulti',
      // @ts-expect-error -- markdownTokenName is declared as a single string;
      // this deliberately passes an array to observe the runtime behaviour.
      markdownTokenName: ['table', 'image'],
      parseMarkdown() {
        return { type: 'paragraph', content: [{ type: 'text', text: 'claimed' }] };
      },
    });
    const md = new MarkdownManager({ extensions: [FakeMulti] });

    // `registry` is a private field of MarkdownManager; reading it here is a
    // deliberate characterization-only inspection of internal state, not
    // something production code should do.
    const registry = (md as unknown as { registry: Map<unknown, unknown> }).registry;
    expect([...registry.keys()]).toEqual([['table', 'image']]);

    const doc = md.parse('| item | qty |\n| ---- | --- |\n| bread | 2 |');
    // OBSERVED: the array-keyed registration never matches the string token
    // type 'table', so the table is still dropped even though an extension
    // was "registered" for it. One extension cannot claim several markdown
    // token names via this field — each token type needs its own extension.
    expect(doc.content).toEqual([]);
  });
});
