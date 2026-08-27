/**
 * The canonical demo corpus for design work.
 *
 * Every screenshot in `docs/design/shots/` is taken against this data, so the
 * shots are comparable across sessions and across themes. It is deliberately
 * NOT a minimal fixture: each note earns its place by putting some surface on
 * screen that would otherwise be invisible — a two-line snippet, a truncated
 * CJK title, a nested tag, an empty body, a note long enough to scroll.
 *
 * `title` is a derived cache of `deriveTitle(text)` (see `src/data/derive.ts`).
 * It is written out explicitly here rather than computed, because reimplementing
 * the derivation in the fixture would be a second copy of a rule the data layer
 * already owns. `scripts/corpus.test.ts` asserts every entry against the real
 * `deriveTitle`, so a fixture whose title drifts from its text fails the unit
 * suite instead of quietly producing a lying screenshot.
 *
 * `noteTags` is deliberately absent. The app rebuilds the tag index from
 * `notes.text` on boot whenever the `tagIndexVersion` marker is missing, which
 * the seed never writes — so the sidebar tree in every shot is produced by the
 * real parser rather than by hand-written index rows.
 */

export interface SeedNote {
  id: string;
  title: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  trashedAt: number | null;
  archivedAt: number | null;
}

export interface SeedSetting {
  key: string;
  value: unknown;
}

export interface Corpus {
  notes: SeedNote[];
  settings: SeedSetting[];
}

/**
 * 2026-08-18 14:30 in Asia/Seoul. The shots spec pins both the clock and the
 * timezone to this, because `formatNoteDate` renders a note edited today as a
 * time and anything older as a date — so without a fixed clock half the note
 * list changes shape every day and no two runs are comparable.
 */
export const FIXED_NOW = Date.UTC(2026, 7, 18, 5, 30);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative to `FIXED_NOW`, so the corpus does not age. */
const ago = (ms: number): number => FIXED_NOW - ms;

const RICH_NOTE = `# US market daily — 2026-08-14

Written 13:45 KST. Equities are quoted to the 8/13 close; July retail sales
print at 22:30 KST tonight and are not reflected below.

## One-line summary

Prices are cooling while employment cracks, and the Fed is still leaning toward
a ==hike== rather than a cut. One cause: a Middle East supply shock. #economy/us-market

---

### 1. CPI (July, released 8/12)

| Series        | Result | Prior |
| ------------- | ------ | ----- |
| Headline MoM  | +0.1%  | —     |
| Headline YoY  | 3.4%   | 3.5%  |
| Core MoM      | +0.2%  | —     |
| Core YoY      | 2.5%   | 2.6%  |
| Energy YoY    | +14.7% | —     |

**Why it matters:** headline is what households actually pay. Core strips the
volatile components and is treated as the real trend.

> The 0.9pp gap between headline and core is the whole story this month.

### 2. What to watch

- [x] 8/12 — July CPI
- [ ] 8/18 22:30 KST — July retail sales
- [ ] 8/28 — Jackson Hole
- [ ] 9/16 — FOMC #economy/rates

Rate path in one expression:

\`\`\`python
real_rate = nominal - expected_inflation
\`\`\`
`;

const KOREAN_NOTE = `# 자산화 디자인 과정 기록 — 카탈로그 데모 화면 정리

요약 자산 카탈로그를 데모의 중심에 놓기로 하고, 그 화면이 실제 규모에서
버티는지를 먼저 확인했다. 결론은 버틴다. 다만 목록 높이가 고정이라
행 수가 늘면 스크롤이 두 겹으로 겹친다. #업무/급한

- 카탈로그 좌측 트리는 접힘 상태를 유지해야 한다
- 행 높이는 22px, 선택 표시는 안쪽 여백을 둔 알약 모양
- 날짜는 목록 하단 좌측, 흐린 색
`;

const TODO_NOTE = `Sprint checklist

- [ ] Rewrite the seed helper so shots stop depending on typing
- [ ] Measure Bear's row heights and record them
- [x] Freeze the clock in the shots spec
- [ ] Floating toolbar pill group #work/urgent
- [ ] Density pass across all three panes #work/later
`;

const LONG_TITLE_NOTE = `A deliberately long note title that has to truncate somewhere in the middle of the note list row rather than wrap onto a second line

The row's title is a single truncating line. If a restyle ever lets it wrap,
this note is where that shows up first.
`;

const CODE_NOTE = `Seeding IndexedDB before the app boots

The seed runs in an init script, so Dexie finds the stores already populated
and never has to be told about a write it did not make. #dev

\`\`\`ts
await page.addInitScript(({ notes }) => {
  const request = indexedDB.open('bear-web', 1);
  request.onupgradeneeded = () => {
    /* create stores, then put(notes) */
  };
}, corpus);
\`\`\`

Inline: \`page.addInitScript\` runs before every navigation.
`;

const PLAIN_NOTE = `Groceries

milk, bread, coffee beans, a lemon
`;

/**
 * Three fenced blocks in three languages, one of which the roster does not
 * recognise. This is C's own shot: it exists so every theme's syntax palette
 * — six roles, twelve grammars, and the plain-unhighlighted fallback — has one
 * screen where all of it is visible at once, rather than only the single `ts`
 * fence `n-code` above has carried since before C shipped.
 */
const SYNTAX_NOTE = `# Highlighting three languages

Python for keywords, strings and numbers; SQL for a different keyword set and
a comment; and \`rust\`, which this app does not register, so it must render
as plain, unhighlighted text with its fence intact. #dev

\`\`\`python
def greet(name: str, times: int = 1) -> None:
    # Repeat the greeting.
    for i in range(times):
        print(f"Hello, {name}!")
\`\`\`

\`\`\`sql
-- Top five by revenue.
SELECT customer_id, SUM(amount) AS total
FROM orders
WHERE amount > 0
GROUP BY customer_id
ORDER BY total DESC
LIMIT 5;
\`\`\`

\`\`\`rust
fn main() {
    println!("unregistered language, unhighlighted");
}
\`\`\`
`;

const PERSONAL_NOTE = `Bookshelf

Currently reading two at once, which never works. #personal
`;

/** 120 blocks, so the editor pane has something to scroll and measure against. */
const SCROLL_NOTE = [
  '# A note long enough to scroll',
  '',
  ...Array.from({ length: 40 }, (_, i) => [
    `## Section ${String(i + 1)}`,
    '',
    `Paragraph ${String(i + 1)}. The measure is capped by \`--bear-line-width\` and centred in the pane, so this text is where a measure that is too wide becomes obvious.`,
    '',
  ]).flat(),
].join('\n');

/**
 * M9b's own shot: all five callout types in one frame, plus an unrecognised
 * marker and a plain quote beneath them.
 *
 * The last two rows are the point of the fixture rather than filler. A
 * screenshot of five tinted panels proves the palette; only a frame that also
 * carries a quote and a marker outside the roster proves that neither of them
 * invented a colour.
 */
const CALLOUT_NOTE = [
  '# 배포 전 점검',
  '',
  '> [!info] 무엇을 확인하나',
  '>',
  '> 배포 직전에 한 번씩 훑어보는 목록입니다.',
  '',
  '> [!tip] 더 빠르게',
  '>',
  '> 스크립트로 묶어두면 두 번째부터는 한 줄입니다.',
  '',
  '> [!success] 통과',
  '>',
  '> 테스트와 타입 검사가 모두 초록입니다.',
  '',
  '> [!warning] 백업 전에 확인',
  '>',
  '> 이 작업은 되돌릴 수 없습니다.',
  '',
  '> [!danger] 계정 삭제',
  '>',
  '> 서버에 있던 메모도 함께 지워집니다.',
  '',
  '> [!사내공지] 로스터에 없는 표시',
  '>',
  '> 색을 지어내지 않고 그대로 인용문으로 남습니다.',
  '',
  '> 그냥 인용문입니다.',
].join('\n');

export const CORPUS: Corpus = {
  notes: [
    {
      id: 'n-econ',
      title: 'US market daily — 2026-08-14',
      text: RICH_NOTE,
      createdAt: ago(4 * DAY),
      updatedAt: ago(2 * HOUR),
      pinned: true,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-cjk',
      title: '자산화 디자인 과정 기록 — 카탈로그 데모 화면 정리',
      text: KOREAN_NOTE,
      createdAt: ago(9 * DAY),
      updatedAt: ago(5 * HOUR),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-todo',
      title: 'Sprint checklist',
      text: TODO_NOTE,
      createdAt: ago(2 * DAY),
      updatedAt: ago(26 * HOUR),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-long-title',
      title:
        'A deliberately long note title that has to truncate somewhere in the middle of the note list row rather than wrap onto a second line',
      text: LONG_TITLE_NOTE,
      createdAt: ago(3 * DAY),
      updatedAt: ago(2 * DAY),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-nobody',
      title: 'A title and nothing else',
      text: 'A title and nothing else\n',
      createdAt: ago(4 * DAY),
      updatedAt: ago(3 * DAY),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-code',
      title: 'Seeding IndexedDB before the app boots',
      text: CODE_NOTE,
      createdAt: ago(7 * DAY),
      updatedAt: ago(6 * DAY),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-callouts',
      title: '배포 전 점검',
      text: CALLOUT_NOTE,
      createdAt: ago(6 * DAY),
      updatedAt: ago(5 * HOUR),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-syntax',
      title: 'Highlighting three languages',
      text: SYNTAX_NOTE,
      createdAt: ago(6 * DAY),
      updatedAt: ago(4 * HOUR),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-personal',
      title: 'Bookshelf',
      text: PERSONAL_NOTE,
      createdAt: ago(30 * DAY),
      updatedAt: ago(12 * DAY),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-scroll',
      title: 'A note long enough to scroll',
      text: SCROLL_NOTE,
      createdAt: ago(25 * DAY),
      updatedAt: ago(20 * DAY),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-plain',
      title: 'Groceries',
      text: PLAIN_NOTE,
      createdAt: ago(60 * DAY),
      updatedAt: ago(40 * DAY),
      pinned: false,
      trashedAt: null,
      archivedAt: null,
    },
    {
      id: 'n-trash-1',
      title: 'Old meeting notes',
      text: 'Old meeting notes\n\nSuperseded by the sprint checklist.\n',
      createdAt: ago(50 * DAY),
      updatedAt: ago(15 * DAY),
      pinned: false,
      trashedAt: ago(3 * DAY),
      archivedAt: null,
    },
    {
      id: 'n-trash-2',
      title: 'Draft — abandoned',
      text: 'Draft — abandoned\n\nKept only so Trash is never empty in a screenshot.\n',
      createdAt: ago(45 * DAY),
      updatedAt: ago(20 * DAY),
      pinned: false,
      trashedAt: ago(1 * DAY),
      archivedAt: null,
    },
  ],
  // Pinned explicitly rather than left to default, so a future change to the
  // defaults does not silently resize every shot in the archive.
  settings: [
    { key: 'pane.sidebarWidth', value: 240 },
    { key: 'pane.noteListWidth', value: 320 },
  ],
};
