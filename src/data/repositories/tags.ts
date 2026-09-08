import type { BearDatabase } from '../db';
import { deriveTitle } from '../derive';
import { reindexNote } from '../reindex';
import { markDeleted, markDirty } from '../sync/markDirty';
import { canRenameTo, rewriteTag } from '../tags';
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
  /**
   * What a rename or delete of `tag` would touch. Feeds the confirm dialog.
   *
   * `tagCount` always includes `tag` itself, even when no note text carries
   * it: a synthetic parent row in the tag tree is still a row that goes.
   */
  affected(tag: string): Promise<{ noteCount: number; tagCount: number }>;
  /** Resolves with how many notes were WRITTEN, not how many were selected. */
  rename(from: string, to: string): Promise<{ noteCount: number }>;
  /** Resolves with how many notes were WRITTEN, not how many were selected. */
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

  /**
   * Applies one rewrite across every carrier, atomically.
   *
   * Returns how many notes were actually WRITTEN, never how many were
   * selected. `AppShell.renameTag` keys its self-limiting ref clear on
   * `noteCount === 0` meaning "no `tree.nodes` emission is coming", and a
   * candidate count that included skipped notes would be a lie in exactly
   * that direction.
   */
  async function apply(tag: string, to: string | null): Promise<{ noteCount: number }> {
    const targets = await carriers(tag);
    // Deepest-first. Renaming a tag INTO its own descendant (`a` -> `a/b`)
    // moves both `a` and `a/b`: taking the shallow row first would find `a/b`
    // still occupied, skip the put as if it were a merge, and only then move
    // `a/b` away — leaving the destination with no metadata at all. Deepest
    // first vacates `a/b` before `a` arrives, so "the destination wins" applies
    // only to a destination OUTSIDE the moving subtree, which is the only
    // place that rule means anything.
    const meta = (await db.tags.toArray())
      .filter((row) => covers(tag, row.tag))
      .sort((left, right) => right.tag.split('/').length - left.tag.split('/').length);
    if (targets.length === 0 && meta.length === 0) return { noteCount: 0 };

    let written = 0;
    await db.transaction(
      'rw',
      [db.notes, db.noteTags, db.noteLinks, db.tags, db.syncState],
      async () => {
        for (const target of targets) {
          // Re-read INSIDE the transaction rather than rewriting the snapshot
          // `carriers` took before it opened. Anything landing in that window
          // — an autosave flush, a sync apply — would otherwise be silently
          // reverted by writing the stale text back over it. A note that
          // vanished in the same window is skipped rather than resurrected by
          // `update`, which is a no-op on a missing id.
          const current = await db.notes.get(target.id);
          if (current === undefined) continue;
          const text = rewriteTag(current.text, tag, to);
          if (text === current.text) continue;
          // `updatedAt` is deliberately NOT moved: a tag rename must not
          // reshuffle a note list sorted by Date Modified. `markDirty` is
          // stamped with that same unchanged value, which is what keeps the
          // sync engine's accept guard able to clear the row — and it is the
          // re-read note's value, so a write that landed in the window above
          // is stamped with ITS `updatedAt`, not the stale one.
          await db.notes.update(target.id, { text, title: deriveTitle(text) });
          await reindexNote(db, target.id, text, parseTags, parseLinks, deriveTitle(text));
          await markDirty(db, 'note', target.id, current.updatedAt);
          written += 1;
        }

        for (const row of meta) {
          if (to !== null) {
            const moved = to + row.tag.slice(tag.length);
            // The destination's own metadata wins a merge: it is the tag that
            // was already there. See the deepest-first sort above for why a
            // destination inside the moving subtree is not "already there".
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

    return { noteCount: written };
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
      // Seeded with the queried tag itself, so `tagCount` counts the ROW the
      // user right-clicked plus its descendants, never only the names that
      // literally appear in note text. `buildTagTree` creates a parent node
      // whenever any child exists, so a tag like `project` can be entirely
      // SYNTHETIC — notes carrying only `#project/a` and `#project/b` gave a
      // count of 2, which the confirm copy read as one sub-tag while two were
      // being deleted, and a single child gave 1, i.e. the flat sentence that
      // never mentions a sub-tag at all.
      const names = new Set<string>([tag]);
      for (const target of targets) {
        for (const candidate of parseTags(target.text)) {
          if (covers(tag, candidate)) names.add(candidate);
        }
      }
      return { noteCount: targets.length, tagCount: names.size };
    },

    async rename(from, to) {
      if (from === to) return { noteCount: 0 };
      // `canRenameTo`, not `canWriteTag`. The repository must not rely on the
      // popover to enforce this: it already refuses a name the grammar cannot
      // write at all (`has#hash`), and a name needing the multi-word form's
      // closing `#` belongs beside it — such a token parses only when followed
      // by a boundary, so inserting one before punctuation corrupts the note's
      // prose. Renaming TO a multi-word name is what this refuses; a
      // multi-word tag TYPED into a note is still fully supported.
      if (!canRenameTo(to)) {
        throw new Error(`tag "${to}" cannot be written back into a note's text`);
      }
      return apply(from, to);
    },

    async remove(tag) {
      return apply(tag, null);
    },
  };
}
