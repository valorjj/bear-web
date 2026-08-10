import { describe, expect, it } from 'vitest';

import { parseTags } from './parseTags';

describe('parseTags', () => {
  describe('simple form', () => {
    const cases: ReadonlyArray<[string, string[]]> = [
      ['#work', ['work']],
      ['a #work b', ['work']],
      ['#work\n#home', ['work', 'home']],
      ['#work #work', ['work']],
      ['#work/urgent', ['work/urgent']],
      ['#a/b/c', ['a/b/c']],
      ['#한국어', ['한국어']],
      ['#Work', ['work']],
      ['#WORK and #work', ['work']],
      ['#work1', ['work1']],
      ['#work/1', ['work/1']],
      ['#work-item', ['work-item']],
      ['#work_item', ['work_item']],
      ['', []],
      ['no tags here', []],
      ['#work\r\n#home', ['work', 'home']],
      ['#b #a #b #c', ['b', 'a', 'c']],
    ];

    it.each(cases)('%j -> %j', (input, expected) => {
      expect(parseTags(input)).toEqual(expected);
    });
  });

  describe('the precedence rule: a tag starts only after whitespace or start of line', () => {
    const cases: ReadonlyArray<[string, string[]]> = [
      ['https://example.com/#anchor', []],
      ['[x](#anchor)', []],
      ['<div id="#x">', []],
      ['a#b', []],
      ['see#work', []],
      ['(#work)', []],
      ['  #work', ['work']],
      ['\t#work', ['work']],
      ['line one\n#work', ['work']],
    ];

    it.each(cases)('%j -> %j', (input, expected) => {
      expect(parseTags(input)).toEqual(expected);
    });
  });

  describe('multi-word form', () => {
    const cases: ReadonlyArray<[string, string[]]> = [
      ['#project plan#', ['project plan']],
      ['#project plan# trailing', ['project plan']],
      ['#a #b', ['a', 'b']],
      ['#a b #c d#', ['a', 'c d']],
      ['#big project/phase one#', ['big project/phase one']],
      ['#project  plan#', ['project plan']],
    ];

    it.each(cases)('%j -> %j', (input, expected) => {
      expect(parseTags(input)).toEqual(expected);
    });

    it('does not pair a closing hash across a line break', () => {
      expect(parseTags('#project plan\nmore #')).toEqual(['project']);
    });
  });

  describe('headings never become tags', () => {
    const cases: ReadonlyArray<[string, string[]]> = [
      ['# Heading', []],
      ['## Heading', []],
      ['### Heading', []],
      ['#### Heading', []],
      ['# Heading\ntext #work', ['work']],
    ];

    it.each(cases)('%j -> %j', (input, expected) => {
      expect(parseTags(input)).toEqual(expected);
    });

    it('treats #tag at the start of a line as a tag, because ATX needs a space', () => {
      expect(parseTags('#work\n')).toEqual(['work']);
    });
  });

  describe('rejections', () => {
    const cases: ReadonlyArray<[string, string[]]> = [
      ['#1 priority', []],
      ['#404', []],
      ['#12/34', []],
      ['#', []],
      ['# ', []],
      ['#a//b', []],
      ['#/', []],
      ['#.', []],
      ['#!/bin/sh', []],
      ['#-lead', ['-lead']],
    ];

    it.each(cases)('%j -> %j', (input, expected) => {
      expect(parseTags(input)).toEqual(expected);
    });
  });

  describe('trailing trimming', () => {
    const cases: ReadonlyArray<[string, string[]]> = [
      ['#done.', ['done']],
      ['#done..', ['done']],
      ['#done,', ['done']],
      ['#done!?', ['done']],
      ['#work/', ['work']],
      ['#work//', ['work']],
      ['#done./', ['done']],
      ['#work/urgent.', ['work/urgent']],
    ];

    it.each(cases)('%j -> %j', (input, expected) => {
      expect(parseTags(input)).toEqual(expected);
    });
  });

  describe('code is masked', () => {
    it('ignores an inline code span', () => {
      expect(parseTags('use `#work` here')).toEqual([]);
    });

    it('ignores a double-backtick span', () => {
      expect(parseTags('use ``#work`` here')).toEqual([]);
    });

    it('does not let a masked span create a tag boundary', () => {
      expect(parseTags('`x`#work')).toEqual([]);
    });

    it('terminates a tag at a masked span', () => {
      expect(parseTags('#work`x`')).toEqual(['work']);
    });

    it('ignores a fenced block', () => {
      expect(parseTags('before\n```\n#work\n```\nafter #home')).toEqual(['home']);
    });

    it('ignores a tilde fence', () => {
      expect(parseTags('~~~\n#work\n~~~')).toEqual([]);
    });

    it('ignores a fence with an info string', () => {
      expect(parseTags('```ts\n#work\n```')).toEqual([]);
    });

    it('does not close a backtick fence with a tilde fence', () => {
      expect(parseTags('```\n#work\n~~~\n#home\n```')).toEqual([]);
    });

    it('does not open a fence when a backtick span merely starts the line', () => {
      expect(parseTags('```code``` is inline\n\n#work #home')).toEqual(['work', 'home']);
    });

    it('does not let an info string close a backtick fence', () => {
      expect(parseTags('a\n```\n#incode\n```txt\n#work\n```\n#tail')).toEqual(['tail']);
    });

    it('does not let trailing text close a tilde fence', () => {
      expect(parseTags('~~~\n#incode\n~~~x\n#work')).toEqual([]);
    });

    it('does not let trailing text close a backtick fence', () => {
      expect(parseTags('```\n#work\n``` not-a-closer\n#home')).toEqual([]);
    });

    it('allows trailing whitespace on a closer', () => {
      expect(parseTags('```\n#work\n```   \n#tail')).toEqual(['tail']);
    });

    it('allows a tilde opener to carry an info string', () => {
      expect(parseTags('~~~ruby\n#work\n~~~')).toEqual([]);
    });

    it('discards a whole multi-word candidate that contains a masked span', () => {
      // Asymmetric with the simple form on purpose: see the comment at
      // normalizeTag's `raw.includes(MASK)` check.
      expect(parseTags('#project `x` plan#')).toEqual([]);
    });

    it('leaves an unterminated inline run alone', () => {
      expect(parseTags('a ` b #work')).toEqual(['work']);
    });

    it('does not mask an indented code block, by ruling', () => {
      expect(parseTags('    #define FOO')).toEqual(['define']);
    });
  });

  describe('realistic notes', () => {
    it('finds tags in a note that also contains Markdown structure', () => {
      const note = [
        '# Sprint notes',
        '',
        'Ship the parser #work/urgent by Friday.',
        '',
        '- [ ] write tests #work',
        '- [x] read `#nope` in the docs',
        '',
        '```sh',
        '# not a tag',
        '#alsonot',
        '```',
        '',
        'See https://example.com/#anchor for context. #한국어',
      ].join('\n');

      expect(parseTags(note)).toEqual(['work/urgent', 'work', '한국어']);
    });
  });
});
