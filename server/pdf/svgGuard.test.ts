import { describe, expect, it } from 'vitest';

import { findUnsafeSvgConstructs } from './svgGuard.ts';

const CLEAN = '<svg xmlns="http://www.w3.org/2000/svg"><g><text>hi</text></g></svg>';

describe('findUnsafeSvgConstructs', () => {
  it('passes a clean SVG', () => {
    expect(findUnsafeSvgConstructs(CLEAN)).toEqual([]);
  });

  it.each([
    ['script', '<svg><script>alert(1)</script></svg>'],
    ['script', '<svg><SCRIPT >alert(1)</SCRIPT></svg>'],
    ['eventHandler', '<svg><rect onload="alert(1)"/></svg>'],
    ['eventHandler', "<svg><rect ONCLICK='alert(1)'/></svg>"],
    ['foreignObject', '<svg><foreignObject><b>x</b></foreignObject></svg>'],
    ['externalReference', '<svg><image href="https://example.com/x.png"/></svg>'],
    ['externalReference', '<svg><use xlink:href="//example.com/x#a"/></svg>'],
    ['externalReference', '<svg><a href="javascript:alert(1)">x</a></svg>'],
    ['cssImport', '<svg><style>@import url(https://example.com/x.css);</style></svg>'],
    ['cssUrl', '<svg><rect style="fill:url(https://example.com/x)"/></svg>'],
  ])('reports %s', (expected, markup) => {
    expect(findUnsafeSvgConstructs(markup)).toContain(expected);
  });

  it('allows a same-document fragment reference, which Mermaid uses for markers', () => {
    expect(findUnsafeSvgConstructs('<svg><path marker-end="url(#arrow)"/></svg>')).toEqual([]);
  });

  it('allows an xlink:href to a fragment', () => {
    expect(findUnsafeSvgConstructs('<svg><use xlink:href="#node-1"/></svg>')).toEqual([]);
  });

  it('names every construct it found, not just the first', () => {
    const found = findUnsafeSvgConstructs('<svg><script/><rect onload="x"/></svg>');
    expect(found).toEqual(expect.arrayContaining(['script', 'eventHandler']));
  });

  it('allows quoted fragments in url()', () => {
    expect(findUnsafeSvgConstructs('<svg><rect style="fill:url(\"#arrow\")"/></svg>')).toEqual([]);
  });

  it('allows single-quoted fragments in url()', () => {
    expect(findUnsafeSvgConstructs('<svg><rect style="fill:url(\'#arrow\')"/></svg>')).toEqual([]);
  });

  it('rejects quoted external URLs in url()', () => {
    expect(
      findUnsafeSvgConstructs('<svg><rect style="fill:url(\"https://example.com/x\")"/></svg>'),
    ).toContain('cssUrl');
  });

  it('rejects protocol-relative URLs in quoted url()', () => {
    expect(
      findUnsafeSvgConstructs('<svg><rect style="fill:url(\'//example.com/x\')"/></svg>'),
    ).toContain('cssUrl');
  });

  it('rejects event handlers separated by slash', () => {
    expect(findUnsafeSvgConstructs('<svg><rect/onload="alert(1)"/></svg>')).toContain(
      'eventHandler',
    );
  });

  it('rejects unquoted href attribute values', () => {
    expect(findUnsafeSvgConstructs('<svg><image href=https://example.com/x.png/></svg>')).toContain(
      'externalReference',
    );
  });
});
