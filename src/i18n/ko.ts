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

  'noteList.noResults.title': '일치하는 메모 없음',
  'noteList.noResults.body':
    '이 목록에서 검색어와 일치하는 메모가 없습니다. 검색어를 지우면 전체가 다시 표시됩니다.',

  'search.label': '메모 검색',
  'search.placeholder': '검색',
  'search.clear': '검색어 지우기',

  'editor.empty.title': '선택된 메모 없음',
  'editor.empty.body': '목록에서 메모를 선택하거나 새로 만드세요.',

  'smartList.label': '목록',
  'smartList.all': '메모',
  'smartList.untagged': '태그 없음',
  'smartList.todo': '해야 할 일',
  'smartList.today': '오늘',
  'smartList.pinned': '고정됨',
  'smartList.locked': '잠긴 항목',
  'smartList.trash': '휴지통',

  'locked.empty.title': '잠긴 메모는 아직 사용할 수 없습니다',
  'locked.empty.body':
    '암호화에는 암호와 복구 수단이 필요해서 아직 구현하지 않았습니다. 여기에 숨겨진 메모는 없습니다.',

  'tags.label': '태그',
  'tags.toggle': '펼치기 또는 접기',

  'note.untitled': '제목 없음',
  'note.noText': '추가 내용 없음',
  'note.pin': '메모 고정',
  'note.unpin': '고정 해제',

  'noteList.create': '새 메모',
  'noteList.trash': '삭제',
  'noteList.restore': '복원',
  'noteList.deleteForever': '완전히 삭제',
  'noteList.emptyTrash': '휴지통 비우기',

  'confirm.cancel': '취소',
  'confirm.deleteForever.title': '이 메모를 완전히 삭제할까요?',
  'confirm.deleteForever.body':
    '이 메모는 영구적으로 삭제됩니다. bear-web은 다른 어디에도 사본을 두지 않으므로 되돌릴 수 없습니다.',
  'confirm.emptyTrash.title': '휴지통을 비울까요?',
  'confirm.emptyTrash.body':
    '휴지통의 모든 메모가 영구적으로 삭제됩니다. bear-web은 다른 어디에도 사본을 두지 않으므로 되돌릴 수 없습니다.',

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
  'editor.toolbar.table': '표',
  'editor.toolbar.quote': '인용',
  'export.open': '메모 내보내기',
  'export.label': '내보내기 형식',
  'export.markdown': '마크다운',
  'export.html': 'HTML',
  'export.pdf': 'PDF',
  'export.failed': '이 메모를 내보낼 수 없습니다.',

  'editor.toolbar.top': '상단 컨트롤',
  'editor.toolbar.bottom': '서식 도구 모음',
  'editor.info.show': '노트 정보',
  'editor.info.words': '단어',
  'editor.info.characters': '글자',
  'editor.info.created': '만든 날짜',
  'editor.info.modified': '수정한 날짜',
  'editor.link.prompt': '링크 주소',
  'editor.tagPill.hint.mac': 'Cmd-클릭하면 이 태그로 필터링됩니다',
  'editor.tagPill.hint.other': 'Ctrl-클릭하면 이 태그로 필터링됩니다',

  'theme.indigoLight': '인디고 라이트',
  'theme.indigoDark': '인디고 다크',
  'theme.paper': '페이퍼',
  'theme.ink': '잉크',
  'theme.highContrast': '고대비',

  'appearance.label': '모양',
  'appearance.open': '테마 변경',
  'appearance.system': '시스템',
  'appearance.group.light': '밝은 테마',
  'appearance.group.dark': '어두운 테마',
};
