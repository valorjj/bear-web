import { describe, expect, it } from 'vitest';

import { buildTagTree } from './tagTree';

describe('buildTagTree', () => {
  it('returns nothing for no rows', () => {
    expect(buildTagTree([])).toEqual([]);
  });

  it('builds a flat list of top-level tags, sorted', () => {
    const tree = buildTagTree([
      { noteId: 'n1', tag: 'work' },
      { noteId: 'n2', tag: 'home' },
    ]);

    expect(tree.map((n) => n.tag)).toEqual(['home', 'work']);
    expect(tree.map((n) => n.label)).toEqual(['home', 'work']);
  });

  it('nests on slashes and labels each node with its last segment', () => {
    const tree = buildTagTree([{ noteId: 'n1', tag: 'work/urgent/today' }]);

    expect(tree).toHaveLength(1);
    expect(tree[0].tag).toBe('work');
    expect(tree[0].label).toBe('work');
    expect(tree[0].children[0].tag).toBe('work/urgent');
    expect(tree[0].children[0].label).toBe('urgent');
    expect(tree[0].children[0].children[0].tag).toBe('work/urgent/today');
    expect(tree[0].children[0].children[0].label).toBe('today');
    expect(tree[0].children[0].children[0].children).toEqual([]);
  });

  it('materialises a parent that no note carries directly', () => {
    const tree = buildTagTree([{ noteId: 'n1', tag: 'work/urgent' }]);

    expect(tree[0].tag).toBe('work');
    expect(tree[0].count).toBe(1);
  });

  it('counts descendants into the parent', () => {
    const tree = buildTagTree([
      { noteId: 'n1', tag: 'work' },
      { noteId: 'n2', tag: 'work/urgent' },
      { noteId: 'n3', tag: 'work/later' },
    ]);

    expect(tree[0].count).toBe(3);
    expect(tree[0].children.map((c) => c.count)).toEqual([1, 1]);
  });

  it('counts a note once even when it carries both a parent and its child', () => {
    const tree = buildTagTree([
      { noteId: 'n1', tag: 'work' },
      { noteId: 'n1', tag: 'work/urgent' },
    ]);

    expect(tree[0].count).toBe(1);
  });

  it('does not treat a sibling prefix as a child', () => {
    const tree = buildTagTree([
      { noteId: 'n1', tag: 'work' },
      { noteId: 'n2', tag: 'workflow' },
    ]);

    expect(tree.map((n) => n.tag)).toEqual(['work', 'workflow']);
    expect(tree[0].children).toEqual([]);
    expect(tree[0].count).toBe(1);
  });

  it('keeps a multi-word tag whole', () => {
    const tree = buildTagTree([{ noteId: 'n1', tag: 'project plan' }]);

    expect(tree.map((n) => n.tag)).toEqual(['project plan']);
  });

  it('sorts children as well as roots', () => {
    const tree = buildTagTree([
      { noteId: 'n1', tag: 'work/zeta' },
      { noteId: 'n2', tag: 'work/alpha' },
    ]);

    expect(tree[0].children.map((c) => c.label)).toEqual(['alpha', 'zeta']);
  });
});
