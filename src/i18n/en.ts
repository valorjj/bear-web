export const en = {
  'app.name': 'bear-web',

  'pane.sidebar': 'Sidebar',
  'pane.noteList': 'Note list',
  'pane.editor': 'Editor',

  'sidebar.empty.title': 'No tags yet',
  'sidebar.empty.body': 'Tags you write in a note appear here.',

  'noteList.empty.title': 'No notes',
  'noteList.empty.body': 'Notes you create appear in this list.',

  'noteList.noResults.title': 'No matching notes',
  'noteList.noResults.body':
    'Nothing in this list matches your search. Clear it to see every note here.',

  'search.label': 'Search notes',
  'search.placeholder': 'Search',
  'search.clear': 'Clear search',

  'editor.empty.title': 'No note selected',
  'editor.empty.body': 'Choose a note from the list, or create one.',

  'smartList.label': 'Lists',
  'smartList.all': 'Notes',
  'smartList.untagged': 'Untagged',
  'smartList.todo': 'Todo',
  'smartList.today': 'Today',
  'smartList.pinned': 'Pinned',
  'smartList.locked': 'Locked',
  'smartList.trash': 'Trash',

  'locked.empty.title': 'Locked notes are not available yet',
  'locked.empty.body':
    'Encryption needs a passphrase and a way to recover it, so it is not built yet. Nothing of yours is hidden here.',

  'tags.label': 'Tags',
  'tags.toggle': 'Expand or collapse',

  'note.untitled': 'Untitled',
  'note.noText': 'No additional text',
  'note.pin': 'Pin note',
  'note.unpin': 'Unpin note',

  'noteList.create': 'New note',
  'noteList.trash': 'Delete',
  'noteList.restore': 'Restore',
  'noteList.deleteForever': 'Delete forever',
  'noteList.emptyTrash': 'Empty trash',
  'noteList.menu.label': 'List options',
  'noteList.menu.open': 'List options: {scope}',
  'noteList.count.one': '1 note',
  'noteList.count.other': '{count} notes',

  'noteList.sort.updated': 'Date modified',
  'noteList.sort.created': 'Date created',
  'noteList.sort.title': 'Title',
  'noteList.sort.newestFirst': 'Newest first',
  'noteList.sort.trashNote': 'Trash is ordered by when notes were deleted.',

  'noteList.preview.small': 'Small',
  'noteList.preview.medium': 'Medium',
  'noteList.preview.large': 'Large',
  'noteList.preview.hideSubTags': 'Hide sub-tag notes',
  'noteList.preview.hideSubTagsNote': 'Only tag lists have sub-tags.',

  'confirm.cancel': 'Cancel',
  'confirm.deleteForever.title': 'Delete this note forever?',
  'confirm.deleteForever.body':
    'This note will be removed permanently. bear-web keeps no copy anywhere else, so this cannot be undone.',
  'confirm.emptyTrash.title': 'Empty the trash?',
  'confirm.emptyTrash.body':
    'Every note in the trash will be removed permanently. bear-web keeps no copy anywhere else, so this cannot be undone.',

  'trash.empty.title': 'Trash is empty',
  'trash.empty.body': 'Notes you delete appear here until you remove them for good.',

  'editor.textarea': 'Note text',
  'editor.saveFailed': 'This note could not be saved. Keep typing — bear-web will keep trying.',
  'editor.serializeFailed':
    'This note could not be converted for saving. Your text is still here — nothing has been overwritten.',

  'resizer.sidebar': 'Resize the sidebar',
  'resizer.noteList': 'Resize the note list',

  'database.memory.title': 'Notes are not being saved',
  'database.memory.body':
    'This browser will not let bear-web store data, so anything you write is kept only until you close this tab. Private browsing is the usual cause.',

  'locale.switch': 'Language',

  'editor.toolbar.heading': 'Heading',
  'editor.toolbar.checklist': 'Checklist',
  'editor.toolbar.bulletList': 'Bullet list',
  'editor.toolbar.orderedList': 'Numbered list',
  'editor.toolbar.bold': 'Bold',
  'editor.toolbar.italic': 'Italic',
  'editor.toolbar.strike': 'Strikethrough',
  'editor.toolbar.highlight': 'Highlight',
  'editor.toolbar.link': 'Link',
  'editor.toolbar.code': 'Code block',
  'editor.toolbar.table': 'Table',
  'editor.toolbar.quote': 'Quote',
  'export.open': 'Export note',
  'export.label': 'Export as',
  'export.markdown': 'Markdown',
  'export.html': 'HTML',
  'export.pdf': 'PDF',
  'export.failed': 'This note could not be exported.',

  'editor.toolbar.top': 'Top controls',
  'editor.toolbar.bottom': 'Formatting toolbar',
  'editor.info.show': 'Note information',
  'editor.info.words': 'Words',
  'editor.info.characters': 'Characters',
  'editor.info.created': 'Created',
  'editor.info.modified': 'Modified',
  'editor.link.prompt': 'Link address',
  'editor.tagPill.hint.mac': 'Cmd-click to filter by this tag',
  'editor.tagPill.hint.other': 'Ctrl-click to filter by this tag',

  'theme.indigoLight': 'Indigo Light',
  'theme.indigoDark': 'Indigo Dark',
  'theme.paper': 'Paper',
  'theme.ink': 'Ink',
  'theme.highContrast': 'High Contrast',

  'appearance.label': 'Appearance',
  'appearance.open': 'Change theme',
  'appearance.system': 'System',
  'appearance.group.light': 'Light',
  'appearance.group.dark': 'Dark',

  'editor.fold.toggle': 'Fold or unfold this section',
  'editor.fold.level': 'Heading level',
  'editor.fold.foldAll': 'Fold all headings',
  'editor.fold.unfoldAll': 'Unfold all headings',
  'editor.fold.headingLevel': 'Heading',

  'account.menu': 'Account',
  // Three states, one grammar: each is a short status the dot annotates, so the
  // menu reads as one sentence about where things stand rather than three
  // unrelated fragments.
  'account.signedIn': 'Signed in',
  'account.signedOut': 'Not signed in',
  'account.unavailable': 'Sync server unreachable',
  'account.signIn.google': 'Sign in with Google',
  'account.signOut': 'Sign out',
  // The largest, highest-contrast line in the menu, and deliberately the same
  // in every state: in D1 signing in does NOT move a single note off this
  // device, so a menu that changed its answer here would be lying. It also
  // carries the disclosure the logout ruling requires — on a shared browser
  // the next person can read these notes — which is why it is stated rather
  // than tucked into a footnote.
  'account.notesLocal': 'Notes stay on this device.',

  'sync.idle': 'Notes are backed up',
  'sync.syncing': 'Backing up…',
  // "Offline" is the NORMAL state for a machine that sleeps. This reads as
  // information, not as a failure — a copy requirement of the spec, not
  // decoration.
  'sync.offline': 'Offline — your notes are safe on this device',
  'sync.error': 'Backup paused',
  'sync.quota': 'Your account is full. Delete some notes to back up again.',
  'sync.never': 'Not backed up yet',
} as const;

export type TranslationKey = keyof typeof en;
