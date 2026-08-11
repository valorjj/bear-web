import { notes } from '@/data';
import type { Note, NotesRepository } from '@/data';

/**
 * Which set of notes the list is showing. M6 folds the smart lists into this
 * union; `ScopeSidebar` is deleted at the same time.
 */
export type NoteScope = { kind: 'active' } | { kind: 'trashed' } | { kind: 'tag'; tag: string };

/**
 * Module-level constants, not object literals at each call site. A literal has
 * a fresh identity on every render, and `useNotes` puts the scope through a
 * `useLiveQuery` dependency array.
 */
export const ACTIVE_SCOPE: NoteScope = { kind: 'active' };
export const TRASHED_SCOPE: NoteScope = { kind: 'trashed' };

export function tagScope(tag: string): NoteScope {
  return { kind: 'tag', tag };
}

/**
 * A stable string identity for a scope, for use as a `useLiveQuery` dependency
 * and as the tag in the tag-and-verify pattern. The `tag:` prefix is what
 * keeps a tag literally named `active` from colliding with the builtin.
 */
export function scopeKey(scope: NoteScope): string {
  return scope.kind === 'tag' ? `tag:${scope.tag}` : scope.kind;
}

/**
 * Whether this scope shows trashed notes. Governs Restore-instead-of-Trash and,
 * from M6, whether Delete Forever and Empty Trash render.
 */
export function isTrash(scope: NoteScope): boolean {
  return scope.kind === 'trashed';
}

/**
 * Whether a Trash affordance should render at all.
 *
 * Call sites ask this rather than comparing `scope.kind`. When the union grew
 * from two arms to three, `NoteList` kept gating on `scope.kind === 'active'`,
 * which had been total and silently became partial — a tag-scoped note had no
 * delete affordance whatsoever. M6 adds five more scopes; the only defence that
 * scales is for the question to live here, next to the union, instead of at
 * each call site.
 */
export function allowsTrash(scope: NoteScope): boolean {
  return !isTrash(scope);
}

/** The tag a note created in this scope should be seeded with, or `null`. */
export function seedTagFor(scope: NoteScope): string | null {
  return scope.kind === 'tag' ? scope.tag : null;
}

/**
 * Whether a note created here would actually be visible here.
 *
 * `false` means the caller should switch to All Notes before creating, rather
 * than making a note that vanishes the instant it exists.
 */
export function acceptsNewNote(scope: NoteScope): boolean {
  return !isTrash(scope);
}

/** Narrowed for injection in tests. */
export type ScopeLister = Pick<NotesRepository, 'listActive' | 'listTrashed' | 'listByTag'>;

/**
 * Ordering comes from the repository and is not re-sorted here: every lister
 * returns its own most-recent-first order.
 */
export function listForScope(scope: NoteScope, repository: ScopeLister = notes): Promise<Note[]> {
  switch (scope.kind) {
    case 'trashed':
      return repository.listTrashed();
    case 'tag':
      return repository.listByTag(scope.tag);
    case 'active':
      return repository.listActive();
  }
}
