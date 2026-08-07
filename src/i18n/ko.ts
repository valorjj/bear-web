import type { TranslationKey } from './en';

export const ko: Record<TranslationKey, string> = {
  'app.name': 'bear-web',

  'pane.sidebar': '사이드바',
  'pane.noteList': '메모 목록',
  'pane.editor': '편집기',

  'sidebar.empty.title': '태그 없음',
  'sidebar.empty.body': '메모에 작성한 태그가 여기에 표시됩니다.',

  'noteList.empty.title': '메모 없음',
  'noteList.empty.body': '작성한 메모가 이 목록에 표시됩니다.',

  'editor.empty.title': '선택된 메모 없음',
  'editor.empty.body': '목록에서 메모를 선택하거나 새로 만드세요.',

  'resizer.sidebar': '사이드바 크기 조절',
  'resizer.noteList': '메모 목록 크기 조절',

  'database.memory.title': '메모가 저장되지 않습니다',
  'database.memory.body':
    '이 브라우저에서 bear-web이 데이터를 저장할 수 없어, 작성한 내용은 탭을 닫을 때까지만 유지됩니다. 대개 사생활 보호 모드가 원인입니다.',

  'locale.switch': '언어',
};
