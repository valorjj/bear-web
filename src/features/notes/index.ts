export { NoteEditor } from './NoteEditor';
export type { NoteEditorProps } from './NoteEditor';
export { NoteList } from './NoteList';
export type { NoteListProps } from './NoteList';
export {
  ACTIVE_SCOPE,
  acceptsNewNote,
  allowsTrash,
  isTrash,
  listForScope,
  scopeKey,
  seedTagFor,
  smartScope,
  SMART_LIST_IDS,
  tagScope,
  TRASHED_SCOPE,
} from './scope';
export type { NoteScope, ScopeLister, SmartListId } from './scope';
export { SmartListSidebar } from './SmartListSidebar';
export type { SmartListSidebarProps } from './SmartListSidebar';
export { filterByQuery, hasQuery } from './search';
export type { MatchRange } from './search';
export { useNotes } from './useNotes';
export type { NotesState } from './useNotes';
export { useSmartListCounts } from './useSmartListCounts';
export type { SmartListCounts } from './useSmartListCounts';
