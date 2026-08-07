export const en = {
  'app.name': 'bear-web',

  'pane.sidebar': 'Sidebar',
  'pane.noteList': 'Note list',
  'pane.editor': 'Editor',

  'sidebar.empty.title': 'No tags yet',
  'sidebar.empty.body': 'Tags you write in a note appear here.',

  'noteList.empty.title': 'No notes',
  'noteList.empty.body': 'Notes you create appear in this list.',

  'editor.empty.title': 'No note selected',
  'editor.empty.body': 'Choose a note from the list, or create one.',

  'resizer.sidebar': 'Resize the sidebar',
  'resizer.noteList': 'Resize the note list',

  'database.memory.title': 'Notes are not being saved',
  'database.memory.body':
    'This browser will not let bear-web store data, so anything you write is kept only until you close this tab. Private browsing is the usual cause.',

  'locale.switch': 'Language',
} as const;

export type TranslationKey = keyof typeof en;
