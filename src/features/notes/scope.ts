import { notes } from '@/data';
import { DEFAULT_NOTE_ORDER, type Note, type NoteOrder, type NotesRepository } from '@/data';

import { SMART_LIST_PREDICATES } from './smartLists';

/**
 * The builtin lists. Adding one means adding an id here and a row to
 * `SMART_LIST_IDS` — never a new arm on `NoteScope`, and never a new
 * `scope.kind` comparison at a call site.
 */
export type SmartListId = 'all' | 'untagged' | 'todo' | 'today' | 'pinned' | 'locked' | 'trash';

/** Sidebar order. `scope.test.ts` asserts this covers every `SmartListId`. */
export const SMART_LIST_IDS: readonly SmartListId[] = [
  'all',
  'untagged',
  'todo',
  'today',
  'pinned',
  'locked',
  'trash',
];

/**
 * Two arms, permanently.
 *
 * The previous shape grew an arm per scope, and every `===` gate written
 * against it was total until it silently was not. M6 would have taken it to
 * eight arms; instead the builtins became data.
 */
export type NoteScope = { kind: 'smart'; list: SmartListId } | { kind: 'tag'; tag: string };

export function smartScope(list: SmartListId): NoteScope {
  return { kind: 'smart', list };
}

export function tagScope(tag: string): NoteScope {
  return { kind: 'tag', tag };
}

/**
 * Module-level constants, not object literals at each call site. A literal has
 * a fresh identity on every render, and `useNotes` puts the scope through a
 * `useLiveQuery` dependency array.
 */
export const ACTIVE_SCOPE: NoteScope = smartScope('all');
export const TRASHED_SCOPE: NoteScope = smartScope('trash');

/**
 * A stable string identity for a scope, for use as a `useLiveQuery` dependency
 * and as the tag in the tag-and-verify pattern. The `tag:` prefix is what keeps
 * a tag literally named `all` from colliding with the builtin.
 */
export function scopeKey(scope: NoteScope): string {
  return scope.kind === 'tag' ? `tag:${scope.tag}` : `smart:${scope.list}`;
}

/**
 * Whether this scope shows trashed notes. Governs Restore-instead-of-Trash and,
 * from M6, whether Delete Forever and Empty Trash render.
 */
export function isTrash(scope: NoteScope): boolean {
  return scope.kind === 'smart' && scope.list === 'trash';
}

/**
 * Whether a Trash affordance should render. False in Trash (Restore renders
 * instead) and false in Locked, which is permanently empty and must show no
 * destructive control at all.
 */
export function allowsTrash(scope: NoteScope): boolean {
  return !(scope.kind === 'smart' && (scope.list === 'trash' || scope.list === 'locked'));
}

/** The tag a note created in this scope should be seeded with, or `null`. */
export function seedTagFor(scope: NoteScope): string | null {
  return scope.kind === 'tag' ? scope.tag : null;
}

/**
 * Whether a note created here would be visible here.
 *
 * Accepting: `all`; `untagged`, because a new note genuinely has no tags;
 * `today`, because a new note's `updatedAt` is by definition today; and any
 * tag scope, because the note is seeded with that tag. Rejecting: `todo` and
 * `pinned`, where a new note satisfies neither predicate; `locked`, which
 * holds nothing; and `trash`.
 *
 * `untagged` and `today` accept for opposite reasons — one because the note
 * satisfies the predicate now and always, one because it satisfies it now and
 * will stop later. Neither is a special case: the question is only whether the
 * predicate holds at the moment of creation.
 */
export function acceptsNewNote(scope: NoteScope): boolean {
  if (scope.kind === 'tag') return true;
  return scope.list === 'all' || scope.list === 'untagged' || scope.list === 'today';
}

/** Narrowed for injection in tests. */
export type ScopeLister = Pick<
  NotesRepository,
  'listActive' | 'listTrashed' | 'listByTag' | 'allTagRows'
>;

/** Lists whose predicate reads `ctx.tagged`, and so must pay for the index scan. */
const NEEDS_TAG_INDEX: ReadonlySet<string> = new Set(['untagged']);

/**
 * The two view preferences that reach the data layer. Bundled into one object
 * so `listForScope` keeps a stable arity as preferences are added, and so
 * `useNotes` can put a single value in its `useLiveQuery` dependency chain.
 */
export interface ScopeQuery {
  order: NoteOrder;
  /** `false` is the "hide sub-tag notes" preference. Ignored outside tag scopes. */
  includeDescendants: boolean;
}

export const DEFAULT_SCOPE_QUERY: ScopeQuery = {
  order: DEFAULT_NOTE_ORDER,
  includeDescendants: true,
};

/**
 * Ordering comes from the repository and is never re-sorted here: every lister
 * returns its own order, and pinned-first ordering lives in the repository so
 * it applies to the tag scope too.
 *
 * From A, the repository ACCEPTS an order rather than hardcoding one — which
 * does not move ownership. The order is passed through untouched and the
 * result is handed on in the order it arrived; the only transformation applied
 * here is the smart list's predicate filter, which preserves order.
 */
export async function listForScope(
  scope: NoteScope,
  query: ScopeQuery = DEFAULT_SCOPE_QUERY,
  repository: ScopeLister = notes,
  now: () => number = Date.now,
): Promise<Note[]> {
  if (scope.kind === 'tag') {
    return repository.listByTag(scope.tag, {
      order: query.order,
      includeDescendants: query.includeDescendants,
    });
  }
  if (scope.list === 'trash') return repository.listTrashed();

  const list = await repository.listActive(query.order);

  // Only `untagged` reads the index, and `allTagRows` is a full table scan.
  // Paying for it on every scope switch would double the work for six of the
  // seven builtins.
  const tagged = NEEDS_TAG_INDEX.has(scope.list)
    ? new Set((await repository.allTagRows()).map((row) => row.noteId))
    : new Set<string>();

  const predicate = SMART_LIST_PREDICATES[scope.list];
  const ctx = { tagged, now: now() };
  return list.filter((note) => predicate(note, ctx));
}
