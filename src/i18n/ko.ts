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
  'noteList.menu.label': '목록 옵션',
  'noteList.menu.open': '목록 옵션: {scope}',
  'noteList.count.one': '메모 1개',
  'noteList.count.other': '메모 {count}개',

  'noteList.sort.updated': '수정일',
  'noteList.sort.created': '생성일',
  'noteList.sort.title': '제목',
  'noteList.sort.newestFirst': '새로운 항목 맨 위로',
  'noteList.sort.trashNote': '휴지통은 삭제한 시각 순으로 정렬됩니다.',

  'noteList.preview.small': '작음',
  'noteList.preview.medium': '중간',
  'noteList.preview.large': '큼',
  'noteList.preview.hideSubTags': '하위 태그 메모 숨기기',
  'noteList.preview.hideSubTagsNote': '태그 목록에만 하위 태그가 있습니다.',

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
  'editor.toolbar.highlightColor': '형광펜 색상',
  'editor.highlight.menu': '형광펜 색상',
  'editor.highlight.default': '기본',
  'editor.highlight.blue': '파랑',
  'editor.highlight.green': '초록',
  'editor.highlight.pink': '분홍',
  'editor.highlight.purple': '보라',
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

  'editor.table.controls': '표',
  'editor.table.addRow': '행 추가',
  'editor.table.deleteRow': '행 삭제',
  'editor.table.addColumn': '열 추가',
  'editor.table.deleteColumn': '열 삭제',
  'editor.table.deleteTable': '표 삭제',
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
  'theme.solarizedLight': '솔라라이즈드 라이트',
  'theme.roseDawn': '로즈 던',
  'theme.latte': '라떼',
  'theme.gruvboxLight': '그루브박스 라이트',
  'theme.snow': '스노우',
  'theme.sepia': '세피아',

  'appearance.label': '모양',
  'appearance.open': '테마 변경',
  'appearance.system': '시스템',
  'appearance.group.light': '밝은 테마',
  'appearance.group.dark': '어두운 테마',

  'editor.fold.toggle': '이 섹션 접기 또는 펼치기',
  'editor.fold.level': '머리말 수준',
  'editor.fold.foldAll': '모든 머리글 접기',
  'editor.fold.unfoldAll': '모든 머리글 펼치기',
  'editor.fold.headingLevel': '머리말',

  'account.menu': '계정',
  'account.signedIn': '로그인됨',
  'account.signedOut': '로그인하지 않음',
  'account.unavailable': '동기화 서버에 연결할 수 없음',
  'account.signIn.google': 'Google로 로그인',
  'account.signOut': '로그아웃',
  'account.notesLocal': '메모는 이 기기에 그대로 남습니다.',
  'account.signOut.title': '로그아웃할까요?',
  'account.signOut.body':
    '로그아웃해도 메모는 이 기기에 그대로 남습니다. 이 브라우저를 사용하는 다른 사람이 메모를 볼 수 있습니다.',
  'account.signOut.confirm': '로그아웃',
  'account.signOut.cancel': '취소',

  'sync.idle': '메모가 백업되었습니다',
  'sync.pending': '아직 백업되지 않았습니다',
  'sync.syncing': '백업하는 중…',
  'sync.offline': '오프라인 — 메모는 이 기기에 안전하게 있습니다',
  'sync.error': '백업이 중단되었습니다',
  'sync.quota': '계정 저장 공간이 가득 찼습니다. 메모를 삭제한 뒤 다시 백업하세요.',

  'sync.adopt.title': '이 계정에 메모를 추가할까요?',
  // 영어 쪽과 마찬가지로 카운트는 컴포넌트에서 문자열을 이어붙여 만든다
  // (`bodyBefore + count + bodyAfter`). 한국어는 숫자 뒤에 조사/단위가 바로
  // 붙는 것이 자연스러우므로 `bodyAfter`의 앞머리에는 공백을 두지 않았다.
  'sync.adopt.bodyBefore': '이 기기에 메모가 ',
  'sync.adopt.bodyAfter':
    '개 있습니다. 추가하면 계정과 다른 기기에도 사본이 만들어집니다. 삭제하면 이 기기에서 없어집니다.',
  'sync.adopt.confirm': '추가하기',
  'sync.adopt.discard': '삭제하기',

  'sync.adopt.tagsOnly.title': '이 계정에 태그 설정을 추가할까요?',
  'sync.adopt.tagsOnly.body':
    '이 기기에는 계정이 아직 모르는 태그 설정(순서, 아이콘, 접힘 상태)이 있습니다. 추가하면 계정과 다른 기기에도 복사됩니다.',
  'sync.adopt.tagsOnly.discard': '이 기기에만 두기',
};
