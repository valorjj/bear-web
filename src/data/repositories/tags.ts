import type { BearDatabase } from '../db';
import type { TagMeta } from '../types';

export interface TagsRepository {
  getMeta(tag: string): Promise<TagMeta | undefined>;
  setCollapsed(tag: string, collapsed: boolean): Promise<void>;
  setIcon(tag: string, iconKey: string | null): Promise<void>;
  setSortOrder(tag: string, sortOrder: number): Promise<void>;
  allMeta(): Promise<TagMeta[]>;
  removeMeta(tag: string): Promise<void>;
}

const defaults = (tag: string): TagMeta => ({
  tag,
  collapsed: false,
  iconKey: null,
  sortOrder: 0,
});

/**
 * Stores tag *metadata* only. Which notes carry a tag is owned by `noteTags`
 * and derived from note text — never from this table.
 */
export function createTagsRepository(db: BearDatabase): TagsRepository {
  async function patch(tag: string, changes: Partial<TagMeta>): Promise<void> {
    const existing = (await db.tags.get(tag)) ?? defaults(tag);
    await db.tags.put({ ...existing, ...changes, tag });
  }

  return {
    async getMeta(tag) {
      return db.tags.get(tag);
    },
    async setCollapsed(tag, collapsed) {
      await patch(tag, { collapsed });
    },
    async setIcon(tag, iconKey) {
      await patch(tag, { iconKey });
    },
    async setSortOrder(tag, sortOrder) {
      await patch(tag, { sortOrder });
    },
    async allMeta() {
      return db.tags.orderBy('sortOrder').toArray();
    },
    async removeMeta(tag) {
      await db.tags.delete(tag);
    },
  };
}
