import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { reindexNote } from '../reindex';
import { markDeleted, markDirty } from '../sync/markDirty';
import { canWriteTag, rewriteTag } from '../tags';
import type { TagMeta } from '../types';
import type { LinkParser, TagParser } from './notes';

export interface TagsRepositoryDeps {
  db: BearDatabase;
  parseTags: TagParser;
  parseLinks: LinkParser;
}

export interface TagsRepository {
  getMeta(tag: string): Promise<TagMeta | undefined>;
  setCollapsed(tag: string, collapsed: boolean): Promise<void>;
  setIcon(tag: string, iconKey: string | null): Promise<void>;
  setSortOrder(tag: string, sortOrder: number): Promise<void>;
  allMeta(): Promise<TagMeta[]>;
  removeMeta(tag: string): Promise<void>;
  /** What a rename or delete of `tag` would touch. Feeds the confirm dialog. */
  affected(tag: string): Promise<{ noteCount: number; tagCount: number }>;
  rename(from: string, to: string): Promise<{ noteCount: number }>;
  remove(tag: string): Promise<{ noteCount: number }>;
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
export function createTagsRepository(deps: TagsRepositoryDeps): TagsRepository {
  const { db, parseTags, parseLinks } = deps;

  /**
   * `TagMeta` carries no `updatedAt` of its own, so `markedAt` here is a wall
   * clock rather than a mirror of a stored field, unlike notes' `markDirty`
   * calls. That is fine: the accept path (Task 7) compares `markedAt` against
   * a note's stored `updatedAt`, but clears tag rows on acceptance
   * unconditionally.
   */
  async function patch(tag: string, changes: Partial<TagMeta>): Promise<void> {
    await db.transaction('rw', db.tags, db.syncState, async () => {
      const existing = (await db.tags.get(tag)) ?? defaults(tag);
      await db.tags.put({ ...existing, ...changes, tag });
      await markDirty(db, 'tag', tag, Date.now());
    });
  }

  /** Whether `tag` is `candidate` or an ancestor of it. */
  function covers(tag: string, candidate: string): boolean {
    return candidate === tag || candidate.startsWith(`${tag}/`);
  }

  /**
   * Every note whose TEXT carries `tag` or a descendant of it.
   *
   * A full scan, filtered with `parseTags`, rather than the `noteTags` index —
   * deliberately. `notes.listByTag` reads the index, and `trash` deletes a
   * trashed note's rows while its text keeps the tag, so an index query would
   * miss exactly the notes that `restore` would later resurrect the tag from.
   * `notes.rebuildTagIndex` already establishes a full scan as acceptable for
   * an explicit, infrequent operation, and one code path beats reconciling an
   * indexed source with an unindexed one.
   */
  async function carriers(
    tag: string,
  ): Promise<Array<{ id: string; text: string; updatedAt: number }>> {
    const out: Array<{ id: string; text: string; updatedAt: number }> = [];
    await db.notes.each((note) => {
      if (parseTags(note.text).some((candidate) => covers(tag, candidate))) {
        out.push({ id: note.id, text: note.text, updatedAt: note.updatedAt });
      }
    });
    return out;
  }

  /** Applies one rewrite across every carrier, atomically. */
  async function apply(tag: string, to: string | null): Promise<{ noteCount: number }> {
    const targets = await carriers(tag);
    const meta = (await db.tags.toArray()).filter((row) => covers(tag, row.tag));
    if (targets.length === 0 && meta.length === 0) return { noteCount: 0 };

    await db.transaction(
      'rw',
      [db.notes, db.noteTags, db.noteLinks, db.tags, db.syncState],
      async () => {
        for (const target of targets) {
          const text = rewriteTag(target.text, tag, to);
          if (text === target.text) continue;
          // `updatedAt` is deliberately NOT moved: a tag rename must not
          // reshuffle a note list sorted by Date Modified. `markDirty` is
          // stamped with that same unchanged value, which is what keeps the
          // sync engine's accept guard able to clear the row.
          await db.notes.update(target.id, { text, title: deriveTitle(text) });
          await reindexNote(db, target.id, text, parseTags, parseLinks, deriveTitle(text));
          await markDirty(db, 'note', target.id, target.updatedAt);
        }

        for (const row of meta) {
          if (to !== null) {
            const moved = to + row.tag.slice(tag.length);
            // The destination's own metadata wins a merge: it is the tag that
            // was already there.
            const existing = await db.tags.get(moved);
            if (existing === undefined) {
              await db.tags.put({ ...row, tag: moved });
              await markDirty(db, 'tag', moved, Date.now());
            }
          }
          await db.tags.delete(row.tag);
          await markDeleted(db, 'tag', row.tag, Date.now());
        }
      },
    );

    return { noteCount: targets.length };
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
      await db.transaction('rw', db.tags, db.syncState, async () => {
        await db.tags.delete(tag);
        await markDeleted(db, 'tag', tag, Date.now());
      });
    },
    async affected(tag) {
      const targets = await carriers(tag);
      const names = new Set<string>();
      for (const target of targets) {
        for (const candidate of parseTags(target.text)) {
          if (covers(tag, candidate)) names.add(candidate);
        }
      }
      return { noteCount: targets.length, tagCount: names.size };
    },

    async rename(from, to) {
      if (from === to) return { noteCount: 0 };
      if (!canWriteTag(to)) {
        throw new Error(`tag "${to}" cannot be written back by the tag grammar`);
      }
      return apply(from, to);
    },

    async remove(tag) {
      return apply(tag, null);
    },
  };
}
