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
  'note.menu.label': 'Note actions',
  'note.duplicate': 'Duplicate',
  'note.copyText': 'Copy text',
  'note.copyText.failed': 'This note could not be copied.',

  'sidebar.open': 'Show tags',
  'sidebar.drawer': 'Tags and lists',
  'nav.backToList': 'Back to notes',
  'search.open': 'Show search',
  'search.close': 'Close search',
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

  'editor.image.missing': 'Image not on this device yet',
  'editor.image.tooLarge': 'That image is too large (25 MB maximum).',
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
  'editor.toolbar.highlightColor': 'Highlight colour',
  'editor.highlight.menu': 'Highlight colour',
  'editor.highlight.default': 'Default',
  'editor.highlight.blue': 'Blue',
  'editor.highlight.green': 'Green',
  'editor.highlight.pink': 'Pink',
  'editor.highlight.purple': 'Purple',
  'editor.highlight.palette': 'Highlight colour',
  'editor.highlight.remove': 'Remove highlight',
  'editor.toolbar.link': 'Link',
  'editor.toolbar.code': 'Code block',
  'editor.toolbar.table': 'Table',
  'editor.toolbar.quote': 'Quote',
  'editor.toolbar.calloutType': 'Callout type',
  'editor.callout.menu': 'Callout type',
  'editor.callout.plain': 'Quote',
  'editor.callout.info': 'Info',
  'editor.callout.tip': 'Tip',
  'editor.callout.success': 'Success',
  'editor.callout.warning': 'Warning',
  'editor.callout.danger': 'Danger',
  'export.open': 'Export note',
  'export.label': 'Export as',
  'export.markdown': 'Markdown',
  'export.html': 'HTML',
  'export.pdf': 'PDF',
  'export.pdf.requiresSignIn': 'Sign in to export PDF',
  'export.pdf.pending': 'Exporting PDF…',
  'export.progress.label': 'Exporting PDF',
  'export.failed': 'This note could not be exported.',
  'export.failed.offline': 'PDF export needs a connection.',
  'export.failed.unauthorized': 'Your session expired. Sign in again to export PDF.',
  'export.failed.tooLarge': 'This note is too large to export as PDF.',
  'export.failed.rateLimited': 'Too many exports — try again shortly.',
  'export.failed.unavailable': 'PDF export is unavailable right now.',

  // The two edge handles' accessible names, and the label of the menu each
  // one opens — one string covers both, since the button's whole job is
  // "open this menu". Used to read "Insert row/column here", back when a
  // click inserted directly; a handle that opens a menu instead needs a
  // name that does not promise an action on its own.
  'editor.table.rowHandle': 'Row options',
  'editor.table.columnHandle': 'Column options',
  // Full sentences, because these are context-menu rows now rather than
  // buttons on a bar that already named the table.
  'editor.table.deleteRow': 'Delete row',
  'editor.table.deleteColumn': 'Delete column',
  'editor.table.deleteTable': 'Delete table',

  'editor.context.menu': 'Editing options',
  'editor.context.paragraph': 'Body text',
  'editor.context.table': 'Table',
  'editor.context.format': 'Format',
  'editor.context.blocks': 'Blocks',
  'editor.section.group': 'Section',
  'editor.section.moveUp': 'Move section up',
  'editor.section.moveDown': 'Move section down',
  'editor.table.addRowBefore': 'Insert row above',
  'editor.table.addRowAfter': 'Insert row below',
  'editor.table.addColumnBefore': 'Insert column before',
  'editor.table.addColumnAfter': 'Insert column after',

  'editor.code.language': 'Code language',
  'editor.code.none': 'Plain text',
  'editor.code.filter': 'Filter languages',
  'editor.code.empty': 'No matching language',
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
  'theme.solarizedLight': 'Solarized Light',
  'theme.roseDawn': 'Rosé Dawn',
  'theme.latte': 'Latte',
  'theme.gruvboxLight': 'Gruvbox Light',
  'theme.snow': 'Snow',
  'theme.sepia': 'Sepia',
  'theme.nord': 'Nord',
  'theme.dracula': 'Dracula',
  'theme.solarizedDark': 'Solarized Dark',
  'theme.tokyoNight': 'Tokyo Night',
  'theme.gruvboxDark': 'Gruvbox Dark',

  'appearance.label': 'Appearance',
  'appearance.open': 'Change theme',
  'appearance.system': 'System',
  'appearance.sample': 'The quick brown fox jumps over the lazy dog.',
  'appearance.sampleAccent': 'a link, and a tag',
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
  // in every state. D2 syncs a COPY to the account; the local database stays
  // the source of truth and nothing is ever moved off this device, so the
  // line is as true signed in as signed out. It also
  // carries the disclosure the logout ruling requires — on a shared browser
  // the next person can read these notes — which is why it is stated rather
  // than tucked into a footnote.
  'account.notesLocal': 'Notes stay on this device.',
  // The spec makes this sentence a requirement, not decoration: on a shared
  // browser the next person opens the app and reads these notes. The
  // mitigation is disclosure, so the user's choice is an informed one.
  'account.signOut.title': 'Sign out?',
  'account.signOut.body':
    'Your notes stay on this device after you sign out. Anyone using this browser can read them.',
  'account.signOut.confirm': 'Sign out',
  'account.signOut.cancel': 'Cancel',

  'sync.idle': 'Notes are backed up',
  // The signed-in-but-never-synced state. `sync.idle` is the resting state
  // both BEFORE the first run and after a successful one, and claiming a
  // backup that has not happened yet is the one thing this line must not do.
  // `lastSyncedAt === null` is what separates the two — most visibly while
  // the adoption dialog is open, where sync is deliberately blocked on the
  // user's answer.
  'sync.pending': 'Not backed up yet',
  'sync.syncing': 'Backing up…',
  // "Offline" is the NORMAL state for a machine that sleeps. This reads as
  // information, not as a failure — a copy requirement of the spec, not
  // decoration.
  'sync.offline': 'Offline — your notes are safe on this device',
  'sync.error': 'Backup paused',
  'sync.quota': 'Your account is full. Delete some notes to back up again.',

  'sync.adopt.title': 'Add your notes to this account?',
  // `useT()` takes no arguments — there is no interpolation mechanism in this
  // app (verified against `src/i18n` in Task 8). The count is composed in
  // `AdoptNotesDialog` as `bodyBefore + count + bodyAfter`, plain string
  // concatenation, not a template a translator fills in. Each half carries
  // its OWN surrounding whitespace so the seam reads naturally in its own
  // language; see `ko.ts`, where the count is followed directly by a
  // counter word with no space at all.
  'sync.adopt.bodyBefore': 'You have ',
  'sync.adopt.bodyAfter':
    ' notes on this device. Adding them puts a copy in your account and on your other devices. Discarding removes them from this device.',
  'sync.adopt.confirm': 'Add them',
  'sync.adopt.discard': 'Discard them',

  // The notes-zero case. Adoption gates on notes OR tags, because a guest can
  // hold tag metadata with no notes left behind it and those rows must still
  // reach the account. The note-count sentence above would read "You have 0
  // notes on this device" there, which is false, so this branch gets its own
  // three strings rather than a count of zero. The discard label differs on
  // purpose too: `onDiscard` purges NOTES, so for a tags-only device nothing
  // is deleted — the tags simply stay local and unsynced, and a button
  // reading "Discard them" would promise a deletion that does not happen.
  'sync.adopt.tagsOnly.title': 'Add your tag settings to this account?',
  'sync.adopt.tagsOnly.body':
    'This device has tag settings — their order, icons, and which ones are collapsed — that your account has never seen. Adding them puts a copy in your account and on your other devices.',
  'sync.adopt.tagsOnly.discard': 'Keep them here only',
} as const;

export type TranslationKey = keyof typeof en;
