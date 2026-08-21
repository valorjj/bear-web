import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import { editorExtensions } from './extensions';
import { headingSections, hiddenRangesFor, serializeFoldKey } from './headingSections';

function docFor(html: string): Editor {
  return new Editor({ extensions: editorExtensions, content: html });
}

describe('headingSections', () => {
  it('reports each top-level heading with its level and text', () => {
    const editor = docFor('<h1>One</h1><p>a</p><h2>Two</h2><p>b</p>');
    const sections = headingSections(editor.state.doc);

    expect(sections.map((s) => [s.level, s.text])).toEqual([
      [1, 'One'],
      [2, 'Two'],
    ]);
    editor.destroy();
  });

  it('ends a section at the next heading of the same or higher level', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h3>nested</h3><p>y</p><h2>B</h2><p>z</p>');
    const sections = headingSections(editor.state.doc);
    const a = sections.find((s) => s.text === 'A')!;
    const b = sections.find((s) => s.text === 'B')!;

    // A swallows the nested h3 and its paragraph, and stops at B.
    expect(a.end).toBe(b.pos);
    editor.destroy();
  });

  it('runs the last section to the end of the document', () => {
    const editor = docFor('<h1>Only</h1><p>tail</p>');
    const [only] = headingSections(editor.state.doc);

    expect(only!.end).toBe(editor.state.doc.content.size);
    editor.destroy();
  });

  it('numbers repeated headings so identical titles stay distinguishable', () => {
    const editor = docFor('<h2>Same</h2><p>a</p><h2>Same</h2><p>b</p>');
    const sections = headingSections(editor.state.doc);

    expect(sections.map((s) => s.nth)).toEqual([0, 1]);
    editor.destroy();
  });

  it('ignores a heading that is not top level', () => {
    const editor = docFor('<blockquote><h2>Quoted</h2></blockquote><p>a</p>');

    expect(headingSections(editor.state.doc)).toHaveLength(0);
    editor.destroy();
  });
});

describe('hiddenRangesFor', () => {
  it('hides a folded section body but never its own heading', () => {
    const editor = docFor('<h2>A</h2><p>x</p><h2>B</h2>');
    const [a, b] = headingSections(editor.state.doc);
    const ranges = hiddenRangesFor(
      editor.state.doc,
      new Set([serializeFoldKey({ level: a!.level, text: a!.text, nth: a!.nth })]),
    );

    expect(ranges).toHaveLength(1);
    // Starts after the heading node ends, and stops where B begins.
    expect(ranges[0]!.from).toBe(a!.pos + editor.state.doc.child(0).nodeSize);
    expect(ranges[0]!.to).toBe(b!.pos);
    editor.destroy();
  });

  it('hides nothing for a fold whose heading no longer exists — it fails open', () => {
    const editor = docFor('<h2>Renamed</h2><p>x</p>');
    const ranges = hiddenRangesFor(
      editor.state.doc,
      new Set([serializeFoldKey({ level: 2, text: 'Original', nth: 0 })]),
    );

    expect(ranges).toEqual([]);
    editor.destroy();
  });

  it('keeps a fold attached across an edit elsewhere in the document', () => {
    const editor = docFor('<h2>Keep</h2><p>x</p><h2>Other</h2><p>y</p>');
    const key = serializeFoldKey({ level: 2, text: 'Keep', nth: 0 });
    const before = hiddenRangesFor(editor.state.doc, new Set([key]));

    // Type into the OTHER section. The folded section is untouched.
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, 'more');
    const after = hiddenRangesFor(editor.state.doc, new Set([key]));

    expect(after).toHaveLength(1);
    expect(after[0]!.from).toBe(before[0]!.from);
    editor.destroy();
  });
});
