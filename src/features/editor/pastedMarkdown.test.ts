import { describe, expect, it } from 'vitest';

// The user's real clipboard, plain flavour, committed verbatim. Vite `?raw`
// rather than `readFileSync`: the `app` tsconfig project carries no Node types
// on purpose, so a `process.env` — or an `fs` import — under `src/` must fail
// typecheck.
import GEMINI_PLAIN from './fixtures/geminiAnswer.plain.txt?raw';

import {
  containsFence,
  decodeEntities,
  htmlCarriesStructure,
  unwrapMarkdownFence,
} from './pastedMarkdown';

describe('htmlCarriesStructure', () => {
  // The question is never "which flavour looks more like Markdown" but "did
  // the source declare structure". If it did, ProseMirror's HTML path is the
  // faithful reading and this must answer true.
  it.each([
    ['a heading', '<h1>Title</h1>'],
    ['a list', '<ul><li>one</li></ul>'],
    ['a table', '<table><tr><td>a</td></tr></table>'],
    ['a code block', '<pre><code>const a = 1;</code></pre>'],
    ['an image', '<img src="x.png">'],
    ['a blockquote', '<blockquote>quoted</blockquote>'],
    // THE REASON `a` IS ON THE LIST. A paragraph copied off a web page has
    // its link in the HTML flavour and NOTHING in its plain text, so calling
    // this payload trivial would silently drop the link.
    ['a link', '<a href="x">y</a>'],
  ])('trusts the HTML flavour of %s', (_label, html) => {
    expect(htmlCarriesStructure(html)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['wrapper divs and spans', '<div><span>plain text</span></div>'],
    ['a bare paragraph', '<p>just a paragraph</p>'],
    [
      'the scaffolding a clipboard payload comes wrapped in',
      "<meta charset='utf-8'><html><head></head><body><div>text</div></body></html>",
    ],
  ])('treats %s as a plain-text document dressed in HTML', (_label, html) => {
    expect(htmlCarriesStructure(html)).toBe(false);
  });

  // The `[\s/>]` lookahead, tested rather than trusted. Without it every
  // page's own wrapper markup reads as structure — `<article>` matches `a`,
  // `<header>` matches `h1`-ish prefixes — and the Markdown path becomes
  // unreachable.
  it.each([
    ['article', '<article>text</article>'],
    ['header', '<header>text</header>'],
    ['aside', '<aside>text</aside>'],
    ['section', '<section>text</section>'],
    ['hr-prefixed nonsense', '<hrefish>text</hrefish>'],
    ['imgur-like', '<imgur>text</imgur>'],
    ['tablet', '<tablet>text</tablet>'],
  ])('does not read <%s> as a structural tag it merely prefixes', (_label, html) => {
    expect(htmlCarriesStructure(html)).toBe(false);
  });
});

describe('unwrapMarkdownFence', () => {
  it('unwraps the reported Gemini payload, whose nested fence breaks CommonMark', () => {
    // THE MEASURED CASE. The wrapper opens on line 5 and means to close on
    // line 93, but the ASCII diagram's own fence sits at lines 63 and 69 — and
    // a CommonMark closing fence need only match the opening's LENGTH, so line
    // 63 closes the wrapper and the diagram is stranded between two code
    // blocks. Dropping the two wrapper lines and parsing the rest yields the
    // whole 25-node document with the diagram as one code block.
    const unwrapped = unwrapMarkdownFence(GEMINI_PLAIN);

    expect(unwrapped).not.toBeNull();
    // Exactly two lines lighter — the wrapper, and nothing else.
    expect(unwrapped!.split('\n')).toHaveLength(GEMINI_PLAIN.split('\n').length - 2);
    // The preamble is prose and MUST survive: the fence does not wrap the
    // whole payload, so an implementation that returned only the fence's
    // interior would silently drop four lines of the answer.
    expect(unwrapped!.startsWith('```')).toBe(false);
    expect(unwrapped!.startsWith(GEMINI_PLAIN.split('\n')[0])).toBe(true);
    // The nested fences are handed to the parser untouched. Removing them too
    // is the obvious over-reach and it would flatten the ASCII diagram into
    // prose.
    expect(unwrapped).toContain('\n```\n');
    expect(unwrapped).toContain('# SYSTEM PROMPT FOR CLAUDE CODE');
  });

  it.each([
    ['the empty string', ''],
    ['plain prose with no fence at all', 'Just a sentence.\n\nAnd another.'],
    // The narrowing condition doing its job: only the source's own `markdown`
    // info string licenses overriding CommonMark.
    ['a fence tagged ts rather than markdown', '```ts\nconst a = 1;\n```'],
    ['a fence tagged nothing at all', '```\nplain\n```'],
    ['an opening with no closing fence at the end', '```markdown\n## Hi\n\nmore prose'],
    [
      'a payload whose last non-blank line is prose',
      'intro\n\n```markdown\n## Hi\n```\n\ntrailing commentary',
    ],
    ['nothing but a bare closing fence', '```'],
    ['a markdown fence with no line between its ends', '```markdown\n```'],
    // Character mismatch. CommonMark would not close these either; the
    // override keeps that rule rather than loosening it.
    ['a backtick opening closed by tildes', '```markdown\n## Hi\n~~~'],
    ['a tilde opening closed by backticks', '~~~markdown\n## Hi\n```'],
    // Length. A closing fence must be at least as long as its opening.
    ['a four-backtick opening closed by three', '````markdown\n## Hi\n```'],
    // Four spaces of indent is an indented code block, not a fence.
    ['an indented would-be fence', '    ```markdown\n    ## Hi\n    ```'],
  ])('returns null for %s', (_label, text) => {
    expect(unwrapMarkdownFence(text)).toBeNull();
  });

  it.each([
    ['markdown', '```markdown\n## Hi\n```'],
    ['md', '```md\n## Hi\n```'],
    ['MD, case-insensitively', '```MD\n## Hi\n```'],
    ['Markdown, case-insensitively', '```Markdown\n## Hi\n```'],
    ['a tilde fence closed by tildes', '~~~markdown\n## Hi\n~~~'],
    ['a three-backtick opening closed by four', '```markdown\n## Hi\n````'],
    ['an info string padded with spaces', '``` markdown \n## Hi\n``` '],
    ['a fence indented three spaces', '   ```markdown\n## Hi\n   ```'],
  ])('accepts %s', (_label, text) => {
    expect(unwrapMarkdownFence(text)).toBe('## Hi');
  });

  it('tolerates blank lines after the closing fence', () => {
    // A clipboard commonly carries a trailing newline or two, and the close is
    // still the last NON-BLANK line.
    expect(unwrapMarkdownFence('```markdown\n## Hi\n```\n\n')).toBe('## Hi\n\n');
  });

  it('keeps the preamble before the fence, and the line endings it found', () => {
    // Both halves of the shape this exists for: the fence need not wrap the
    // whole payload, and CRLF must survive rather than being normalised into
    // a diff nobody asked for.
    expect(unwrapMarkdownFence('intro\n\n```markdown\n## Hi\n\n- a\n```')).toBe(
      'intro\n\n## Hi\n\n- a',
    );
    expect(unwrapMarkdownFence('intro\r\n```markdown\r\n## Hi\r\n```')).toBe('intro\r\n## Hi');
  });
});

describe('containsFence', () => {
  // THE MEASUREMENT THE PRECEDENCE RULE RESTS ON, pinned so it cannot drift.
  // An interior fence is what makes CommonMark's greedy close destructive AND
  // what left Gemini's own HTML mangled in the same place; its absence means
  // the wrapper was harmless and structural HTML is the better reading.
  it('separates the two real payloads', () => {
    // The reported clipboard: two interior fences, so our unwrap outranks the
    // HTML.
    expect(containsFence(unwrapMarkdownFence(GEMINI_PLAIN)!)).toBe(true);
    // The clipboard `e2e/pasteMarkdown.spec.ts` pastes: none, so its real
    // `h2` and real `table` win.
    expect(
      containsFence(
        unwrapMarkdownFence(
          '```markdown\n## Weekly report\n\n+---+---+\n| a | b |\n+---+---+\n```',
        )!,
      ),
    ).toBe(false);
  });

  it.each([
    ['a backtick fence', '## Hi\n\n```\nx\n```'],
    ['a tagged fence', 'text\n```text\ndiagram\n```'],
    ['a tilde fence', 'text\n~~~\nx\n~~~'],
    ['a fence indented three spaces', 'text\n   ```\nx\n   ```'],
    ['a fence on the very first line', '```\nx'],
  ])('finds %s', (_label, text) => {
    expect(containsFence(text)).toBe(true);
  });

  it.each([
    ['the empty string', ''],
    ['plain prose', 'Just a sentence.\n\nAnd another.'],
    ['an ASCII table', '## Weekly report\n\n+---+---+\n| a | b |\n+---+---+'],
    // Four spaces of indent is an indented code block, not a fence — the same
    // rule `FENCE_LINE` follows, so the two agree about what a fence is.
    ['an indented would-be fence', 'text\n    ```\n    x'],
    // Backticks that are not a fence: inline code, and a fence needs three.
    ['inline code', 'use `npm test` to run it'],
    ['two backticks at line start', '``not a fence'],
  ])('does not find a fence in %s', (_label, text) => {
    expect(containsFence(text)).toBe(false);
  });
});

describe('decodeEntities', () => {
  it.each([
    ['a non-breaking space', 'a&nbsp;b', 'a\u00A0b'],
    ['an em dash', 'a&mdash;b', 'a—b'],
    ['a right single quote', 'don&rsquo;t', 'don’t'],
    ['an ellipsis', 'wait&hellip;', 'wait…'],
    ['a copyright sign', '&copy; 2026', '© 2026'],
    ['an apostrophe', 'don&apos;t', "don't"],
    ['a decimal reference', 'a&#160;b', 'a\u00A0b'],
    ['a hex reference', 'a&#x2014;b', 'a—b'],
    ['an uppercase hex reference', 'a&#X2014;b', 'a—b'],
    ['several in one string', '&copy;&nbsp;&mdash;', '\u00A9\u00A0\u2014'],
    ['a legacy entity spelled with its semicolon', '&not;', '¬'],
  ])('decodes %s', (_label, input, expected) => {
    expect(decodeEntities(input)).toBe(expected);
  });

  // The four the Markdown parser decodes ITSELF. Decoding them here too is a
  // double-decode: `&amp;amp;` must reach the parser intact so it becomes the
  // text `&amp;`, not `&`. And `&lt;div&gt;` must keep reaching the parser as
  // an entity pair, because the parser decodes it and then claims `<div>` as a
  // raw-HTML node — changing that would be a silent schema surprise.
  it.each([
    ['ampersand', 'AT&amp;T'],
    ['less-than', '&lt;div&gt;'],
    ['greater-than', '&gt; quoted'],
    ['double quote', '&quot;quoted&quot;'],
    ['a doubly-escaped ampersand', '&amp;amp;'],
    ['a doubly-escaped nbsp', '&amp;nbsp;'],
  ])('leaves %s untouched for the parser', (_label, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it.each([
    ['text with no ampersand at all', 'plain text'],
    ['a bare ampersand', 'Tom & Jerry'],
    ['an unterminated reference', 'a &nbsp b'],
    ['an unknown named reference', 'a &notareal; b'],
    ['an empty reference', 'a &; b'],
    ['the empty string', ''],
  ])('returns %s unchanged', (_label, input) => {
    expect(decodeEntities(input)).toBe(input);
  });

  it('decodes an uppercase alias the parser does not handle', () => {
    // `&AMP;` is a legacy HTML alias the Markdown parser does NOT decode, so
    // skipping it here would leave it literal and let it gain an `&amp;` on
    // the way out. The exclusion list is therefore matched case-SENSITIVELY,
    // against exactly the four spellings the parser handles.
    expect(decodeEntities('a &AMP; b')).toBe('a & b');
  });
});
