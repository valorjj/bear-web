import { notes } from '@/data';
import type { Note, NotesRepository } from '@/data';

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
export type ScopeLister = Pick<NotesRepository, 'listActive' | 'listTrashed' | 'listByTag'>;

/**
 * Ordering comes from the repository and is not re-sorted here.
 *
 * Task 4 replaces the smart-list arm with real predicate filtering. Until then
 * every non-trash builtin behaves as All Notes, which is exactly today's
 * behaviour for the only two builtins that exist.
 */
export function listForScope(scope: NoteScope, repository: ScopeLister = notes): Promise<Note[]> {
  if (scope.kind === 'tag') return repository.listByTag(scope.tag);
  if (scope.list === 'trash') return repository.listTrashed();
  return repository.listActive();
}
