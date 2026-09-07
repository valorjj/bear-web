import type { Locale } from '@/i18n';

/**
 * The one note a first-run device is given.
 *
 * Deliberately NOT in `src/i18n/en.ts` and `ko.ts`, and that is a considered
 * deviation from "no user-facing string is hardcoded outside the translation
 * bundles". This is seeded *content*, not UI chrome: a twelve-line Markdown
 * blob in the bundles would pollute the `TranslationKey` union that every
 * actual UI string is checked against. `Record<Locale, string>` gives the
 * identical compile-time completeness guarantee — a missing locale is a type
 * error, exactly as `ko.ts`'s own annotation makes a missing translation one.
 *
 * It does three jobs and stops: one inline tag so the sidebar is populated on
 * first sight, one checkbox so the task affordance is discoverable, and one
 * sentence about hashtags rather than folders — which is the single least
 * guessable thing about this app. It is an ordinary note: editable, taggable,
 * trashable.
 */
export const WELCOME_NOTE: Record<Locale, string> = {
  en: `# Welcome

This is a note. Edit it, or delete it — nothing here is special.

Notes are organised by tags you write inline, not by folders. This one is
tagged #inbox, so it shows up under that tag in the sidebar. Type a new one
anywhere and it appears there too.

- [ ] Try writing your own tag
`,
  ko: `# 시작하기

메모입니다. 자유롭게 수정하거나 삭제하세요. 특별한 메모가 아닙니다.

메모는 폴더가 아니라 본문에 직접 쓴 태그로 정리됩니다. 이 메모에는 #inbox
태그가 붙어 있어서 사이드바의 해당 태그 아래에 나타납니다. 어디에든 새 태그를
쓰면 똑같이 나타납니다.

- [ ] 직접 태그를 하나 써 보세요
`,
};
