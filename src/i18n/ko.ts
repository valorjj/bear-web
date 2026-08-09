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

  'scope.label': '메모 범위',
  'scope.notes': '메모',
  'scope.trash': '휴지통',

  'note.untitled': '제목 없음',
  'note.noText': '추가 내용 없음',

  'noteList.create': '새 메모',
  'noteList.trash': '삭제',
  'noteList.restore': '복원',

  'trash.empty.title': '휴지통이 비어 있습니다',
  'trash.empty.body': '삭제한 메모는 완전히 지우기 전까지 여기에 있습니다.',

  'editor.textarea': '메모 내용',
  'editor.saveFailed': '메모를 저장하지 못했습니다. 계속 입력하세요. 저장을 다시 시도합니다.',
  'editor.serializeFailed':
    '이 노트를 저장용으로 변환하지 못했습니다. 입력한 내용은 그대로 있으며 덮어쓰지 않았습니다.',

  'resizer.sidebar': '사이드바 크기 조절',
  'resizer.noteList': '메모 목록 크기 조절',

  'database.memory.title': '메모가 저장되지 않습니다',
  'database.memory.body':
    '이 브라우저에서 bear-web이 데이터를 저장할 수 없어, 작성한 내용은 탭을 닫을 때까지만 유지됩니다. 대개 사생활 보호 모드가 원인입니다.',

  'locale.switch': '언어',

  'editor.toolbar.heading': '제목',
  'editor.toolbar.checklist': '체크리스트',
  'editor.toolbar.bulletList': '글머리 기호 목록',
  'editor.toolbar.orderedList': '번호 매기기 목록',
  'editor.toolbar.bold': '굵게',
  'editor.toolbar.italic': '기울임꼴',
  'editor.toolbar.strike': '취소선',
  'editor.toolbar.highlight': '형광펜',
  'editor.toolbar.link': '링크',
  'editor.toolbar.code': '코드 블록',
  'editor.toolbar.quote': '인용',
  'editor.info.show': '노트 정보',
  'editor.info.words': '단어',
  'editor.info.characters': '글자',
  'editor.info.created': '만든 날짜',
  'editor.info.modified': '수정한 날짜',
  'editor.link.prompt': '링크 주소',
};
