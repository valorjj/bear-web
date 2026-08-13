# M7.5 Visual Design Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app stop rendering as a wireframe — icons where text is standing in for one, the three panes as cards on a canvas, real density, and the body measure that has sat unused since M5.5.

**Architecture:** One new colour token and one new UI primitive (`Icon`), then a pass over each pane. Nothing touches the data layer, the editor schema, or any document model. Every change is presentation.

**Tech Stack:** React 19, TypeScript 6, Tailwind v4 (`@theme inline`), `lucide-react`, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-m7-5-visual-design-design.md`

## Global Constraints

- **Every colour comes from a CSS custom property.** A literal hex or `rgb()` outside `src/styles/tokens.css` fails `npm test` via `scripts/sourceLint.test.ts`.
- **A new token must be declared in three places:** `:root`, `:root[data-theme='dark']`, and the `prefers-color-scheme: dark` block. `scripts/sourceLint.test.ts` compares the two dark blocks token-for-token.
- **No user-facing string is hardcoded.** Everything goes through `useT`. `src/i18n/en.ts` defines the key type; `src/i18n/ko.ts` is `Record<TranslationKey, string>`, so a missing translation is a compile error. Never weaken that annotation — add the translation.
- **`src/ui/` must import nothing from `src/app/`, `src/data/` or `src/i18n/`.** Enforced by `scripts/sourceLint.test.ts`, which resolves relative specifiers too.
- **Every icon element is `aria-hidden`. Every control whose visible content becomes an icon carries an `aria-label` from `useT`,** and the resulting accessible name is pinned by a test.
- **Headings keep `--bear-text`.** The accent is for links, checkboxes, highlight, selection and focus only. `--bear-accent` and `--bear-danger` hold the same value today, so accent-coloured headings would make one colour mean both "heading" and "delete forever".
- **Destructive controls keep their words.** "New note" becomes an icon button; "Move to trash", "Restore", "Delete forever" and "Empty trash" stay text buttons.
- **Exactly two files may suppress the focus outline** — `src/ui/Resizer.tsx` (marker: `group-focus-visible:`) and `src/features/editor/RichEditor.tsx` (marker: `caret is the focus indicator`), allowlisted in `scripts/sourceLint.test.ts`.
- **Durations are written `duration-[var(--bear-duration-fast)]`.** Tailwind v4 has no `--duration-*` theme namespace.
- **Do not touch `--bear-font-size`, `--bear-line-height`, `--bear-para-spacing` or `--bear-para-indent`.** M8's typography sliders own them; changing values here means M8 redoes the work. `--bear-line-width` IS in scope (Task 7).
- **Do not simplify the `:root:not([data-theme='light'])` selector.** M8 uses it as the seam for its theme picker.
- **All six gates must pass before every commit:** `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`.
- **A test that cannot fail is a defect.** Every behavioural or appearance assertion added here must be verified by fault injection — introduce the defect it guards, watch precisely that test fail, restore, and report the result.
- **Verify visually.** This milestone is entirely about what renders. Take Playwright screenshots and read `getComputedStyle` rather than inferring appearance from a green suite. Three defects shipped through a fully green 700+ test suite in this project because it is blind to appearance by construction.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/ui/Icon.tsx` (create) | The only importer of `lucide-react`. Fixes size, stroke width and `aria-hidden` for every icon in the app. |
| `src/ui/Icon.test.tsx` (create) | Pins the three properties above. |
| `scripts/sourceLint.test.ts` (modify) | New rule: `lucide-react` may be imported only by `src/ui/Icon.tsx`. |
| `src/styles/tokens.css` (modify) | `--bear-canvas` in all three blocks. |
| `src/styles/index.css` (modify) | `--color-canvas` in `@theme`; `body` background becomes the canvas. |
| `src/ui/Pane.tsx` (modify) | Panes become rounded, shadowed cards. |
| `src/ui/Resizer.tsx` (modify) | The gap between cards is the hit target. |
| `src/app/AppShell.tsx` (modify) | Canvas ground, gaps between cards. |
| `src/ui/SidebarRow.tsx` (modify) | Disclosure glyph becomes an icon; density. |
| `src/features/notes/SmartListSidebar.tsx` (modify) | One icon per smart list. |
| `src/features/tags/TagSidebar.tsx` (modify) | `Hash` icon per tag row. |
| `src/features/notes/NoteList.tsx`, `NoteListItem.tsx`, `SearchField.tsx` (modify) | New-note, pin and search icons; row rhythm. |
| `src/features/editor/BottomToolbar.tsx`, `TopControls.tsx` (modify) | Every control becomes an icon. |
| `src/styles/editor.css` (modify) | The body measure; accent on links and checkboxes. |
| `e2e/appearance.spec.ts` (modify) | Five new relative assertions. |
| `e2e/smoke.spec.ts` (modify) | The resizer contract and the body palette, both changing deliberately. |
| `docs/design/DESIGN-bear-web.md` (modify) | Hand-measured contrast against the new canvas. |
| `CLAUDE.md` (modify) | The milestone's rulings. |

---

### Task 1: The `Icon` primitive, and the rule that makes it the only door

**Files:**
- Create: `src/ui/Icon.tsx`, `src/ui/Icon.test.tsx`
- Modify: `scripts/sourceLint.test.ts`, `package.json`

**Interfaces:**
- Produces: `Icon({ glyph, size, className }): ReactElement` where `glyph: LucideIcon`, `size?: 'sm' | 'md'`.

**Why a primitive rather than importing lucide at each call site.** Mixed icon sizes and stroke weights are the single most legible signal of an unfinished interface, and a missing `aria-hidden` is how an icon leaks into an accessible name. Both are rules, and this project's recurring defect is a rule connected to nothing. A primitive plus an import restriction makes both enforceable instead of documented.

Note that `src/features/editor/markdown.ts` is the only permitted importer of `@tiptap/markdown` by *convention enforced by nothing* — `CLAUDE.md` says so explicitly. This task does the enforceable version of the same idea.

- [ ] **Step 1: Install the dependency**

```bash
npm install lucide-react
```

- [ ] **Step 2: Write the failing tests**

Create `src/ui/Icon.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import { Search } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import { Icon } from './Icon';

describe('Icon', () => {
  // An icon that is not hidden joins the accessible name of whatever control
  // wraps it. This project has shipped two accessible-name regressions.
  it('is hidden from assistive technology', () => {
    const { container } = render(<Icon glyph={Search} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('is not focusable', () => {
    const { container } = render(<Icon glyph={Search} />);
    expect(container.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  });

  it('renders one stroke width for every glyph', () => {
    const { container } = render(<Icon glyph={Search} />);
    expect(container.querySelector('svg')?.getAttribute('stroke-width')).toBe('1.75');
  });

  it('renders the default size, and a smaller one on request', () => {
    const { container: md } = render(<Icon glyph={Search} />);
    const { container: sm } = render(<Icon glyph={Search} size="sm" />);
    expect(md.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(sm.querySelector('svg')?.getAttribute('width')).toBe('14');
  });

  it('takes a className so callers can colour it', () => {
    const { container } = render(<Icon glyph={Search} className="text-accent" />);
    expect(container.querySelector('svg')?.getAttribute('class')).toContain('text-accent');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/ui/Icon.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `src/ui/Icon.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react';
import type { ReactElement } from 'react';

export interface IconProps {
  glyph: LucideIcon;
  /** `sm` is for dense trailing positions; `md` is everything else. */
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * The only door to `lucide-react` — enforced by `scripts/sourceLint.test.ts`.
 *
 * It exists to make three rules unbreakable rather than merely written down:
 * one stroke width across every glyph, two sizes and no more, and
 * `aria-hidden` on every icon in the app. An icon that is not hidden joins the
 * accessible name of the control wrapping it, which is how a "Delete forever"
 * button starts announcing as "Delete forever trash".
 *
 * Size and stroke live here as numbers rather than CSS tokens because lucide
 * takes them as props; this component IS the single source of truth for them.
 */
const SIZES = { sm: 14, md: 16 } as const;

export function Icon({ glyph: Glyph, size = 'md', className = '' }: IconProps): ReactElement {
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      size={SIZES[size]}
      strokeWidth={1.75}
      className={`shrink-0 ${className}`}
    />
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/ui/Icon.test.tsx`
Expected: PASS.

- [ ] **Step 6: Add the import restriction**

Read `scripts/sourceLint.test.ts` first — it already has `architecture boundaries` and `focus` describes, and a `resolveImport` helper. Follow the file's existing idiom. Add to the `architecture boundaries` describe:

```ts
  it('imports lucide-react only through src/ui/Icon.tsx', () => {
    // Size, stroke and aria-hidden are decided in one place. A second importer
    // would compile and look fine, which is exactly why this is a test rather
    // than a comment — cf. `@tiptap/markdown`, whose single-importer rule is
    // convention enforced by nothing.
    const offenders = sourceFiles()
      .filter((file) => file !== 'src/ui/Icon.tsx')
      .filter((file) => /from ['"]lucide-react['"]/.test(read(file)));

    expect(offenders).toEqual([]);
  });
```

Use whatever the file actually calls its file-listing and file-reading helpers.

- [ ] **Step 7: Falsify the import restriction**

Add `import { Search } from 'lucide-react';` to `src/ui/Pane.tsx`, run `npx vitest run scripts/sourceLint.test.ts`, confirm the new test fails naming that file, then remove it. Report the result.

- [ ] **Step 8: Falsify the primitive**

Remove `aria-hidden="true"` from `Icon`. Confirm `is hidden from assistive technology` fails. Restore. Report.

- [ ] **Step 9: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add package.json package-lock.json src/ui/Icon.tsx src/ui/Icon.test.tsx scripts/sourceLint.test.ts
git commit -m "feat(ui): one door for icons"
```

---

### Task 2: The canvas, and the three panes as cards

**Files:**
- Modify: `src/styles/tokens.css`, `src/styles/index.css`, `src/ui/Pane.tsx`, `src/app/AppShell.tsx`, `e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `--bear-canvas` / `--color-canvas`; `Pane` renders a rounded, shadowed card.

**The shape.** A browser tab cannot have Bear's rounded macOS window. The equivalent is a darker ground with the three panes floating on it as cards. `--bear-shadow-popover` and `--radius-lg` are already provisioned in `tokens.css` and used by nothing.

**Starting values, to be checked in Task 8:**

```css
/* :root (Paper) */
--bear-canvas: #e8e4de;
/* both dark blocks (Ink) */
--bear-canvas: #121211;
```

**Three declaration sites, not two.** `tokens.css` has `:root`, `:root[data-theme='dark']`, and a `prefers-color-scheme: dark` block. `scripts/sourceLint.test.ts` compares the last two token-for-token; a token in one and not the other is correct for a user who picked dark and wrong for a user whose OS is dark, and no other test can see it.

**`body` takes the canvas.** Today `body` is `var(--color-bg)`, and `e2e/smoke.spec.ts` pins that to `rgb(255, 255, 255)` in light and `rgb(26, 26, 25)` in dark. The ground the user actually sees is changing, so those two assertions change with it. That file pins the palette *deliberately* so a colour change costs a conscious edit — this is that conscious edit. Update the expected values to the canvas values you shipped; do not delete the assertions.

- [ ] **Step 1: Add the token in all three blocks**

In `src/styles/tokens.css`, add to `:root`:

```css
  /*
   * The ground the three panes float on. A browser tab has no window chrome,
   * so depth is what separates the panes from each other and from the page —
   * the role Bear's rounded macOS window plays.
   */
  --bear-canvas: #e8e4de;
```

and `--bear-canvas: #121211;` to **both** `:root[data-theme='dark']` and the `prefers-color-scheme: dark` block.

- [ ] **Step 2: Verify the parity test would have caught a miss**

Delete the `--bear-canvas` line from the `prefers-color-scheme` block only. Run `npx vitest run scripts/sourceLint.test.ts` and confirm the dark-block parity test fails. Restore. Report the result — this is the assertion protecting the whole token layer and you should see it work once.

- [ ] **Step 3: Expose it to Tailwind and paint the body**

In `src/styles/index.css`, inside `@theme inline` add `--color-canvas: var(--bear-canvas);`, and change the `body` rule's `background-color` from `var(--color-bg)` to `var(--color-canvas)`.

- [ ] **Step 4: Make `Pane` a card**

In `src/ui/Pane.tsx`, add `rounded-lg shadow-popover` to the section's class list. Keep `h-full min-w-0 overflow-y-auto` and the existing width behaviour.

- [ ] **Step 5: Give the shell a ground and gaps**

In `src/app/AppShell.tsx`, change the `<main>` class from `flex h-full w-full overflow-hidden bg-bg text-text` to `flex h-full w-full gap-1 overflow-hidden bg-canvas p-1 text-text`.

Tailwind's preflight sets `box-sizing: border-box` globally, so `h-full` plus padding does not overflow — but `e2e/smoke.spec.ts` has a test named `the shell never grows the page past the viewport, ready or degraded` that asserts `scrollHeight === innerHeight`. Run it and confirm it still passes. If it does not, the padding is escaping the box and you must fix the layout, not the test.

- [ ] **Step 6: Update the two palette assertions**

In `e2e/smoke.spec.ts`, update the expected `body` background in `the shell uses the token layer for its colours` and `the system dark preference applies with no JavaScript toggle` to the canvas values. Leave the `color` assertion alone. Add a one-line comment noting the ground moved from `bg` to `canvas` in M7.5.

- [ ] **Step 7: Look at it**

Start the dev server and take a Playwright screenshot at 1440×900 in both `light` and `dark` `colorScheme` emulations. Confirm the three panes read as separate surfaces and the gaps are visible. Save the screenshots under the session scratch directory and say in your report what you saw — not what you expected to see.

- [ ] **Step 8: Falsify**

Remove `bg-canvas` from `<main>`. Confirm the panes stop reading as cards in a screenshot, and note whether any *test* catches it — Task 9 adds the assertion that does. Restore. Report both.

- [ ] **Step 9: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/styles/tokens.css src/styles/index.css src/ui/Pane.tsx src/app/AppShell.tsx e2e/smoke.spec.ts
git commit -m "feat(design): three panes as cards on a canvas"
```

---

### Task 3: The resizer becomes the gap

**Files:**
- Modify: `src/ui/Resizer.tsx`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the canvas and card layout from Task 2.
- Produces: no API change — `ResizerProps` is unchanged.

**Why this task's failing test is legitimate.** `Resizer` currently paints a 1px hairline and widens its hit box to ~8px with `-mx-1 w-2`, a negative margin that cancels out in flex layout so neighbouring panes never shift. With cards there is already a gap between panes, and a hairline drawn inside it competes with the card edges.

`e2e/smoke.spec.ts`'s `the resizer has a mouse hit target wider than its 1px visual line` will fail. **That test is reporting a real contract change, not a stale expectation** — the resizer's specification is what changed. This is the one place in this milestone where editing a failing test is correct. Everywhere else, a failing role-based or geometry test is a behaviour report.

**Two things must survive.**
1. `src/ui/Resizer.tsx` is one of exactly two files allowed to suppress the focus outline, and `scripts/sourceLint.test.ts` requires the marker string `group-focus-visible:` in it as proof it supplies its own indicator. Keep the accent hairline on focus.
2. `dragging a separator with the mouse resizes the pane without snapping back, and persists` must keep passing untouched. jsdom has no `setPointerCapture`, so Playwright is the *only* coverage for the pointer-drag path.

- [ ] **Step 1: Rewrite the hit-target test to the new contract**

In `e2e/smoke.spec.ts`, replace the body of `the resizer has a mouse hit target wider than its 1px visual line` with a test of the new contract, and rename it `the resizer fills the gap between panes and is grabbable across it`:

```ts
test('the resizer fills the gap between panes and is grabbable across it', async ({ page }) => {
  await page.goto('/');

  const separator = page.getByRole('separator').first();
  const box = await separator.boundingBox();
  if (!box) throw new Error('separator has no bounding box');

  // M7.5: the gap between cards IS the resizer, so the hit target is the
  // element's own width rather than an overlap grown with a negative margin.
  // The pre-M7.5 contract was a 1px line with a ±3px overlap; this must be at
  // least as grabbable as that was.
  expect(box.width).toBeGreaterThanOrEqual(6);

  const centerY = box.y + box.height / 2;
  for (const x of [box.x + 1, box.x + box.width - 1]) {
    const role = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('role') ?? null,
      { x, y: centerY },
    );
    expect(role, `x=${x}`).toBe('separator');
  }
});
```

- [ ] **Step 2: Run it against the current component**

Run: `npm run test:e2e -- smoke.spec.ts`
Expected: the new test FAILS or passes only by accident — record which. The current element is 8px wide with a negative margin, so it may already satisfy the width check while failing the edge hit-test once cards add gaps.

- [ ] **Step 3: Rewrite the component's geometry**

In `src/ui/Resizer.tsx`, replace the outer `className` and the inner hairline `span`:

```tsx
      // The gap between cards IS the control. No negative margin: with cards
      // there is real space here, so the element occupies it rather than
      // overlapping its neighbours. `relative z-10` is kept so the cards'
      // shadows never sit above the hit area.
      className="group relative z-10 w-2 shrink-0 cursor-col-resize focus-visible:outline-none"
```

and the indicator, which is now invisible at rest and appears on hover or focus rather than being a permanent hairline:

```tsx
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-transparent transition-colors duration-[var(--bear-duration-fast)] ease-bear group-hover:bg-accent group-focus-visible:bg-accent"
      />
```

The `group-focus-visible:` marker is load-bearing for the lint allowlist — do not drop it.

- [ ] **Step 4: Run the e2e suite**

Run: `npm run test:e2e -- smoke.spec.ts`
Expected: PASS, including the untouched drag-and-persist test.

- [ ] **Step 5: Falsify twice**

1. Change `w-2` to `w-px`. Confirm the new hit-target test fails. Restore.
2. Delete the `group-focus-visible:bg-accent` class. Confirm `scripts/sourceLint.test.ts`'s focus-allowlist marker test fails. Restore.

Report both outcomes.

- [ ] **Step 6: Look at it**

Screenshot the shell, then focus a separator with the keyboard (Tab to it) and screenshot again. Confirm the accent indicator is visible when focused and absent at rest. Say what you saw.

- [ ] **Step 7: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/ui/Resizer.tsx e2e/smoke.spec.ts
git commit -m "feat(design): the gap between cards is the resizer"
```

---

### Task 4: Icons and density in the sidebar

**Files:**
- Modify: `src/ui/SidebarRow.tsx`, `src/features/notes/SmartListSidebar.tsx`, `src/features/tags/TagSidebar.tsx`
- Modify: `src/ui/ui.test.tsx`, `src/features/notes/SmartListSidebar.test.tsx`

**Interfaces:**
- Consumes: `Icon` from `@/ui/Icon`.
- Produces: no prop changes. `SidebarRow` already accepts `icon?: ReactNode`, `depth?: number` and `disclosure?: SidebarRowDisclosure` — all three exist and the `icon` slot is currently unused by every caller.

**Read `src/ui/SidebarRow.tsx` first.** It already indents by `depth`, already renders an icon slot, and already carries an explicit `{' '}` text node before the count. **That space is load-bearing**: accessible-name computation concatenates text content and ignores the CSS gap, and M5.5 shipped and reverted a regression where losing it made a row announce as `"work3"` instead of `"work 3"`. `src/ui/ui.test.tsx` pins the resulting name. Do not remove it, and if a name test fails, fix the component.

Icon assignments:

| Row | Glyph |
| --- | --- |
| `all` | `FileText` |
| `untagged` | `Inbox` |
| `todo` | `ListTodo` |
| `today` | `Calendar` |
| `pinned` | `Pin` |
| `locked` | `Lock` |
| `trash` | `Trash2` |
| tag row | `Hash` |
| disclosure | `ChevronRight`, rotated 90° when expanded |

Verify every name against the installed version — lucide renames exports between releases. If one is missing, pick the nearest and say which in your report.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/SmartListSidebar.test.tsx` (read the file first and reuse its real render helper):

```tsx
describe('icons', () => {
  it('gives every smart list row an icon', () => {
    const { container } = renderSidebar();
    const rows = container.querySelectorAll('li');
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.querySelector('svg')).not.toBeNull();
    }
  });

  // The icon must not join the row's name. This is the regression class M5.5
  // caught in SidebarRow and shipped-then-reverted.
  it('keeps the row name to its label and count', () => {
    renderSidebar({ counts: { all: 3, untagged: 0, todo: 0, today: 0, pinned: 0, locked: 0, trash: 0 } });
    expect(screen.getByRole('button', { name: 'Notes 3' })).toBeInTheDocument();
  });
});
```

Adjust the counts object to the real `SmartListCounts` shape and the label to whatever `smartList.all` resolves to in the test locale.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/notes/SmartListSidebar.test.tsx`
Expected: FAIL — no `svg` in any row.

- [ ] **Step 3: Wire the smart-list icons**

In `src/features/notes/SmartListSidebar.tsx`, add a second lookup beside `LABELS`:

```tsx
const ICONS: Record<SmartListId, LucideIcon> = {
  all: FileText,
  untagged: Inbox,
  todo: ListTodo,
  today: Calendar,
  pinned: Pin,
  locked: Lock,
  trash: Trash2,
};
```

and pass `icon={<Icon glyph={ICONS[id]} />}` to each `SidebarRow`.

`LucideIcon` is a type — import it with `import type`, and note that this file may not import `lucide-react` for *values* under Task 1's rule. Importing the glyph components themselves is a value import, so **this is a genuine conflict you must resolve**: either the rule allows type-only imports and glyph components are re-exported from `src/ui/Icon.tsx`, or every glyph is re-exported. Pick one, implement it, and state which in your report. The simplest resolution is for `src/ui/Icon.tsx` to re-export the glyphs the app uses.

- [ ] **Step 4: Swap the disclosure glyph**

In `src/ui/SidebarRow.tsx`, replace the `▾`/`▸` text with `<Icon glyph={ChevronRight} size="sm" className={disclosure.expanded ? 'rotate-90' : ''} />` plus a `transition-transform duration-[var(--bear-duration-fast)]`. The button keeps its `aria-label={disclosure.label}`.

- [ ] **Step 5: Give tag rows a `Hash` icon**

In `src/features/tags/TagSidebar.tsx`, pass `icon={<Icon glyph={Hash} size="sm" />}` to each row.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/notes/SmartListSidebar.test.tsx src/features/tags/ src/ui/ui.test.tsx`
Expected: PASS, including every pre-existing test. **If a pre-existing accessible-name test fails, fix the component, not the test.**

- [ ] **Step 7: Falsify**

Remove `aria-hidden` from `Icon` (temporarily) and confirm `keeps the row name to its label and count` fails because the glyph's title or content joins the name. If it does *not* fail, say so — it would mean lucide renders nothing nameable and the test is weaker than it looks, which is worth knowing. Restore.

- [ ] **Step 8: Look at it**

Screenshot the sidebar. Confirm icons are aligned, one weight, and that the tag tree's depth indentation is visible. Say what you saw.

- [ ] **Step 9: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/ui/SidebarRow.tsx src/features/notes/SmartListSidebar.tsx src/features/notes/SmartListSidebar.test.tsx src/features/tags/TagSidebar.tsx src/ui/Icon.tsx
git commit -m "feat(design): icons in the sidebar"
```

---

### Task 5: The note list — icons and rhythm

**Files:**
- Modify: `src/features/notes/NoteList.tsx`, `src/features/notes/NoteListItem.tsx`, `src/features/notes/SearchField.tsx`
- Modify: `src/features/notes/NoteList.test.tsx`, `src/features/notes/NoteListItem.test.tsx`

**Interfaces:**
- Consumes: `Icon` and the glyph re-exports from `@/ui/Icon`.

**What changes.** "New note" becomes an icon button (`SquarePen`). The pin toggle's `●` becomes `Pin`/`PinOff`. The search field gains a leading `Search` glyph and its clear button's `×` becomes `X`. Row padding grows.

**What does not.** "Move to trash", "Restore", "Delete forever" and "Empty trash" **stay text buttons** — an icon-only control for an irreversible action against a database with no server copy asks the user to recall a glyph before destroying data.

**The accessible-name risk is concentrated here.** `NoteListItem` carries an explicit `aria-label` composed of title, date and snippet, added in M7 to fix a row that announced as `"Groceries14:32milk"`. The pin button is a *sibling* of the row button, never nested — a `<button>` inside a `<button>` is invalid HTML and unclickable in some browsers. Keep both properties.

- [ ] **Step 1: Write the failing tests**

Append to `src/features/notes/NoteList.test.tsx` (reuse the file's real helpers):

```tsx
describe('icons', () => {
  it('renders New note as an icon button that still has a name', () => {
    renderList({ items: [] });
    const button = screen.getByRole('button', { name: 'New note' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.textContent).toBe('');
  });

  // Destructive actions keep their words: an icon-only delete asks the user to
  // recall a glyph before doing something irreversible.
  it('keeps destructive controls as text', () => {
    renderList({ items: [makeNote('a', 'Alpha')], selectedNoteId: 'a' });
    expect(screen.getByRole('button', { name: 'Delete' }).textContent).not.toBe('');
  });
});
```

Append to `src/features/notes/NoteListItem.test.tsx`:

```tsx
describe('pin icon', () => {
  it('renders the pin as an icon and keeps its name', () => {
    renderItem({ note: makeNote({ pinned: false }) });
    const pin = screen.getByRole('button', { name: 'Pin note' });
    expect(pin.querySelector('svg')).not.toBeNull();
    expect(pin.textContent).toBe('');
  });

  it('keeps the pin button a sibling of the row, never nested inside it', () => {
    const { container } = renderItem({ note: makeNote({ pinned: false }) });
    expect(container.querySelector('button button')).toBeNull();
  });
});
```

Use the file's real fixture names and the real translated labels.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/features/notes/NoteList.test.tsx src/features/notes/NoteListItem.test.tsx`
Expected: FAIL — no `svg` in the New note or pin buttons.

- [ ] **Step 3: Implement**

- `NoteList.tsx`: the create button becomes `<Button onClick={onCreate} label={t('noteList.create')}><Icon glyph={SquarePen} /></Button>`. `Button` already takes a `label` prop for exactly this ("Accessible name, for when `children` is an icon rather than text").
- `NoteListItem.tsx`: replace `●` with `<Icon glyph={note.pinned ? Pin : PinOff} size="sm" />`, keeping the existing `aria-label` and `aria-pressed`.
- `SearchField.tsx`: add a leading `<Icon glyph={Search} size="sm" />` positioned inside the field, shift the input's left padding to clear it, and replace the clear button's `×` with `<Icon glyph={X} size="sm" />`.
- Increase the row's vertical padding in `NoteListItem` from `py-2.5` to `py-3` and the gap between its three lines from `gap-0.5` to `gap-1`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/notes/`
Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Falsify**

Remove the `label` prop from the New note `Button`. Confirm `renders New note as an icon button that still has a name` fails because the button has no accessible name at all. Restore. Report.

- [ ] **Step 6: Look at it**

Create two notes, pin one, type a search query, and screenshot the note list. Confirm the pin icon distinguishes pinned from unpinned, the search glyph does not collide with typed text, and highlighted matches are still legible. Say what you saw.

- [ ] **Step 7: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/notes/
git commit -m "feat(design): icons and rhythm in the note list"
```

---

### Task 6: The editor toolbars

**Files:**
- Modify: `src/features/editor/BottomToolbar.tsx`, `src/features/editor/TopControls.tsx`
- Modify: `src/features/editor/toolbars.test.tsx`

**Interfaces:**
- Consumes: `Icon` and the glyph re-exports from `@/ui/Icon`.

**This is the most visible single change in the milestone.** The bottom toolbar currently renders the literal characters `H`, `☑`, `•`, `1.`, `B`, `I`, `S`, `▮`, `🔗`, `</>`, `❝`. Nothing else in the app says "unfinished" as loudly.

Every one of these buttons **already has an `aria-label`** from `useT` — read `TopControls.tsx` and `BottomToolbar.tsx` and confirm before you start. Swapping the children for icons must not touch those labels, and `toolbars.test.tsx` queries by role and name, so it should keep passing unchanged. If it does not, you have changed a name.

| Control | Glyph |
| --- | --- |
| Heading | `Heading` |
| Checklist | `ListTodo` |
| Bullet list | `List` |
| Numbered list | `ListOrdered` |
| Bold | `Bold` |
| Italic | `Italic` |
| Strikethrough | `Strikethrough` |
| Highlight | `Highlighter` |
| Link | `Link` |
| Code block | `Code` |
| Quote | `Quote` |
| Note information | `Info` |

- [ ] **Step 1: Write the failing test**

Append to `src/features/editor/toolbars.test.tsx` (read its existing setup first — it needs the `EditorView.scrollToSelection` stub documented in `CLAUDE.md`):

```tsx
describe('icons', () => {
  it('renders every formatting control as an icon with no text', () => {
    renderBottomToolbar();
    const toolbar = screen.getByRole('toolbar', { name: 'Formatting toolbar' });
    const buttons = [...toolbar.querySelectorAll('button')];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.querySelector('svg'), button.getAttribute('aria-label') ?? '').not.toBeNull();
      expect(button.textContent, button.getAttribute('aria-label') ?? '').toBe('');
    }
  });

  it('keeps every control findable by its name', () => {
    renderBottomToolbar();
    for (const name of ['Bold', 'Italic', 'Strikethrough', 'Highlight', 'Link', 'Code block', 'Quote']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });
});
```

Use the file's real render helper.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/features/editor/toolbars.test.tsx; echo "exit=$?"`
Expected: FAIL — buttons contain text. **Check the exit code, not just the pass count**: a missing jsdom stub throws an uncaught error that makes vitest exit 1 while every assertion passes.

- [ ] **Step 3: Implement**

Replace each button's text child with an `<Icon glyph={...} />`. Leave every `aria-label`, `aria-pressed`, `onClick`, `disabled` and class name alone except for removing text-specific classes (`font-bold`, `italic`) that no longer do anything.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/editor/; echo "exit=$?"`
Expected: PASS, `exit=0`.

- [ ] **Step 5: Falsify**

Drop the `aria-label` from the Bold button in `BottomToolbar.tsx`. Confirm `keeps every control findable by its name` fails. Restore. Report.

- [ ] **Step 6: Look at it**

Open a note and screenshot the editor with both toolbars visible. Then hover a toolbar button and screenshot again — `hover:bg-hover` on these buttons was dead for two milestones because `--color-hover` did not exist, and `e2e/appearance.spec.ts` now guards it. Confirm the hover state is visible and the pressed state (`aria-pressed`) still reads. Say what you saw.

- [ ] **Step 7: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/features/editor/
git commit -m "feat(design): icons in the editor toolbars"
```

---

### Task 7: The body measure, links and checkboxes

**Files:**
- Modify: `src/styles/editor.css`

**Interfaces:** none produced.

**`--bear-line-width: 56em` has been declared and unused since M5.5.** On a wide window the editor's prose runs the full pane width, which is the strongest "web page, not an app" signal in the product. Wire it: the prose column is centred and capped; the *pane* still fills the window, so the toolbars and the editor background are unaffected.

Also within the accent ruling: links and checkbox accents already use `--bear-accent` in `editor.css`. Verify that is true and leave headings on `--bear-text`. **Do not touch `--bear-font-size`, `--bear-line-height`, `--bear-para-spacing` or `--bear-para-indent`** — M8's sliders own them.

- [ ] **Step 1: Apply the measure**

In `src/styles/editor.css`, add to the `.ProseMirror` rule:

```css
  max-width: var(--bear-line-width);
  margin-inline: auto;
```

- [ ] **Step 2: Verify it in a real browser at two widths**

With the dev server running, use Playwright to open a note at 1600×900 and at 900×900. Measure in both:

```js
const m = await page.evaluate(() => {
  const pm = document.querySelector('.ProseMirror');
  const pane = pm.closest('[role="region"]');
  return { prose: pm.getBoundingClientRect().width, pane: pane.getBoundingClientRect().width };
});
```

At 1600 the prose must be meaningfully narrower than the pane. At 900 it should fill nearly all of it — a measure that also shrinks a narrow window is worse than none. Report both numbers.

- [ ] **Step 3: Screenshot both widths**

Confirm the text is centred rather than left-stranded, and that the toolbars still span the full pane. Say what you saw.

- [ ] **Step 4: Confirm headings did not become accent-coloured**

```js
await page.evaluate(() => getComputedStyle(document.querySelector('.ProseMirror h1')).color);
```

It must equal the computed `--bear-text`, not `--bear-accent`. Report the values.

- [ ] **Step 5: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add src/styles/editor.css
git commit -m "feat(design): give the prose a measure"
```

---

### Task 8: Measure the contrast against the new canvas, by hand

**Files:**
- Modify: `docs/design/DESIGN-bear-web.md`, and `src/styles/tokens.css` only if a ratio fails

**Interfaces:** none produced.

**No test in this project can do this.** Contrast over an alpha-composited overlay needs a real cascade and jsdom has none, so M5.5 measured the ratios by hand and recorded them in `docs/design/DESIGN-bear-web.md`. Task 2 introduced a new background that `--bear-faint` (counts, timestamps) and `--bear-border` now sit against, and nothing has checked them.

**`--bear-faint` was darkened once already to clear WCAG 3.0 and must not be lightened for aesthetics.** Paper `#88857d` measures 3.21:1 on `--bear-sidebar`; the original `#9c988f` measured 2.51:1 and failed.

- [ ] **Step 1: Read the existing record**

Read `docs/design/DESIGN-bear-web.md` and follow its existing table format exactly.

- [ ] **Step 2: Measure in a real browser**

With the dev server running, use Playwright to read the *computed* colours (not the token literals — overlays composite) and compute WCAG 2.1 relative-luminance ratios for both `light` and `dark` `colorScheme`:

- `--bear-text` on each pane background
- `--bear-faint` on each pane background
- `--bear-border` on `--bear-canvas` (the card edge against the ground)
- `--bear-canvas` against each pane background (this one is not a WCAG requirement — it is the number that decides whether the cards read as cards at all; report it and judge it)

- [ ] **Step 3: Judge and, if needed, adjust**

Text must clear 4.5:1. `--bear-faint` must clear 3.0:1 — it carries counts and timestamps, so 3.0 is already the relaxed bar. If the canvas value you chose in Task 2 breaks either, change the **canvas**, not `--bear-faint`.

- [ ] **Step 4: Record the numbers**

Add the measured ratios to `docs/design/DESIGN-bear-web.md` in its existing format, with a line naming the canvas as the new background introduced in M7.5.

- [ ] **Step 5: Commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add docs/design/DESIGN-bear-web.md src/styles/tokens.css
git commit -m "docs(design): contrast against the M7.5 canvas"
```

---

### Task 9: Appearance assertions, and the rulings

**Files:**
- Modify: `e2e/appearance.spec.ts`, `CLAUDE.md`

**Interfaces:** none produced.

**Read the header comment of `e2e/appearance.spec.ts` first.** It explains why every assertion there is *relative* (a heading is larger than a paragraph) rather than pinned to a pixel value: M8's typography sliders move every absolute size by design, and pinning them would turn M8 into a test-editing exercise — the failure mode M5.5 already hit once. `e2e/smoke.spec.ts` pins absolutes for the opposite and equally deliberate reason.

**Every assertion below is adopted only if a fault injection makes precisely it fail.** If one cannot be made to fail, do not add it — say so in your report instead. All five existing tests in that file were adopted under this rule and that is what makes the file worth having.

- [ ] **Step 1: Add the assertions**

Append to `e2e/appearance.spec.ts`:

```ts
test('each pane reads as a card against the canvas behind it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('region')).toHaveCount(3);

  const measured = await page.evaluate(() => {
    const canvas = getComputedStyle(document.body).backgroundColor;
    const panes = [...document.querySelectorAll('[role="region"]')].map((pane) => {
      const style = getComputedStyle(pane);
      return { background: style.backgroundColor, radius: Number.parseFloat(style.borderTopLeftRadius) };
    });
    return { canvas, panes };
  });

  // A pane whose fill equals the ground is not a card. This is what fails if
  // `bg-canvas` is dropped from the shell, or a pane loses its own fill.
  for (const pane of measured.panes) {
    expect(pane.background).not.toBe(measured.canvas);
    expect(pane.radius).toBeGreaterThan(0);
  }
});

test('every sidebar row carries an icon', async ({ page }) => {
  await page.goto('/');

  const rows = page.getByRole('navigation', { name: 'Lists' }).getByRole('listitem');
  await expect(rows).toHaveCount(7);

  const withIcons = await rows.evaluateAll(
    (items) => items.filter((item) => item.querySelector('svg') !== null).length,
  );
  expect(withIcons).toBe(7);
});

test('the formatting toolbar is icons, not letters', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const toolbar = page.getByRole('toolbar', { name: 'Formatting toolbar' });
  await expect(toolbar).toBeVisible();

  const shape = await toolbar.evaluate((element) => {
    const buttons = [...element.querySelectorAll('button')];
    return {
      total: buttons.length,
      withSvg: buttons.filter((b) => b.querySelector('svg') !== null).length,
      withText: buttons.filter((b) => (b.textContent ?? '').trim() !== '').length,
    };
  });

  expect(shape.total).toBeGreaterThan(0);
  expect(shape.withSvg).toBe(shape.total);
  expect(shape.withText).toBe(0);
});

test('the prose column is measured on a wide window', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note' }).click();

  const editor = page.getByRole('textbox', { name: 'Note text' });
  await editor.click();
  await editor.pressSequentially('A line of prose.');

  const widths = await editor.evaluate((element) => {
    const prose = element.closest('.ProseMirror') ?? element;
    const pane = prose.closest('[role="region"]');
    return {
      prose: prose.getBoundingClientRect().width,
      pane: pane === null ? 0 : pane.getBoundingClientRect().width,
    };
  });

  // Relative, deliberately: M8's sliders move --bear-line-width itself, so the
  // property that must hold is "narrower than the pane", not a pixel count.
  expect(widths.pane).toBeGreaterThan(0);
  expect(widths.prose).toBeLessThan(widths.pane);
});
```

- [ ] **Step 2: Run them**

Run: `npm run test:e2e -- appearance.spec.ts`
Expected: PASS.

- [ ] **Step 3: Falsify each one, individually**

One at a time — apply, run, confirm the named test fails, revert:

1. Remove `bg-canvas` from `<main>` in `AppShell.tsx` → `each pane reads as a card against the canvas behind it` must fail.
2. Remove `rounded-lg` from `Pane.tsx` → the same test must fail on the radius assertion.
3. Remove `icon={...}` from `SmartListSidebar.tsx` → `every sidebar row carries an icon` must fail.
4. Restore one bottom-toolbar button's text child alongside its icon → `the formatting toolbar is icons, not letters` must fail.
5. Remove `max-width: var(--bear-line-width)` from `editor.css` → `the prose column is measured on a wide window` must fail.

Report all five outcomes. **If any injection does not produce the predicted failure, say so plainly and remove that assertion** rather than keeping a test that cannot fail.

- [ ] **Step 4: Update `CLAUDE.md`**

Update the Status table: M7.5 as its own `complete` row, and the test counts to what `npm test` and `npm run test:e2e` actually print — run them and read the numbers.

Add to "Rules that must not be silently reversed":

```markdown
- **`lucide-react` is imported only by `src/ui/Icon.tsx`, and that is enforced
  by `scripts/sourceLint.test.ts`.** The primitive fixes one stroke width, two
  sizes, and `aria-hidden` on every icon in the app. A second importer would
  compile and look fine, which is why this is a test rather than a comment —
  unlike the `@tiptap/markdown` single-importer rule, which is convention
  enforced by nothing.
- **Every icon is `aria-hidden` and every icon-only control carries an
  `aria-label` from `useT`.** Replacing text with icons is the standard way to
  silently destroy a screen-reader experience, and this project has shipped
  that defect class twice — `SidebarRow` losing a space so a row announced as
  `"work3"`, and `NoteListItem` concatenating three spans into
  `"Groceries14:32milk"`.
- **Destructive controls keep their words.** "New note" is an icon button;
  "Move to trash", "Restore", "Delete forever" and "Empty trash" are text. An
  icon-only control for an irreversible action against a database with no
  server copy asks the user to recall a glyph before destroying data. This is a
  deliberate divergence from Bear, which hides destructive actions in menus.
- **`--bear-canvas` is the ground the three panes float on, and it is what
  `body` paints.** A browser tab has no window chrome, so depth is what
  separates the panes — the role Bear's rounded macOS window plays. Panes carry
  `shadow-popover` and no border: hard borders would compete with the 1px
  dividers used inside each pane, and separating panes by depth while
  separating rows by line keeps the two jobs distinct.
- **The gap between cards IS the resizer.** Before M7.5 it was a 1px hairline
  whose hit box was widened with a negative margin that cancelled out in flex
  layout. `e2e/smoke.spec.ts`'s hit-target test was rewritten in M7.5 because
  the contract changed — that is the one licensed instance; a failing
  geometry or role test during a restyle is otherwise a behaviour report, not a
  stale expectation.
- **Headings keep `--bear-text`.** `--bear-accent` and `--bear-danger` hold the
  same value in both shipped themes, so accent-coloured headings would make one
  colour mean both "heading" and "delete forever", and a page of red headings
  reads as a warning notice. The accent is for links, checkboxes, highlight,
  selection and focus.
- **`--bear-line-width` caps the prose column, not the pane.** The editor pane
  still fills the window so the toolbars span it; only `.ProseMirror` is capped
  and centred. It sat declared-and-unused from M5.5 to M7.5, which is why the
  editor read as a web page rather than an app.
```

Remove the now-stale carried item about editor typography being "declared but not wired" **only for `--bear-line-width`** — the `--bear-font-size` family is still M8's and that entry stays, amended.

- [ ] **Step 5: Run all six gates and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run format && npm run build && npm run test:e2e
git add e2e/appearance.spec.ts CLAUDE.md
git commit -m "test(e2e): the shell has a shape now, and M7.5 docs"
```

---

## Self-Review Notes

Checked against `docs/superpowers/specs/2026-08-13-m7-5-visual-design-design.md`:

- **One conflict is surfaced rather than resolved, deliberately.** Task 1 forbids importing `lucide-react` outside `src/ui/Icon.tsx`, and Task 4 needs glyph *components* (value imports) in feature files. Task 4 states the conflict explicitly and asks the implementer to resolve it — re-exporting the app's glyphs from `Icon.tsx` is the suggested resolution. This is a real design decision, not an oversight; leaving it to the implementer with the constraint stated is better than guessing the ergonomics from here.
- Every spec ruling maps to a task: accent-out-of-headings (7, 9), canvas in three blocks (2), cards by depth not border (2), resizer-as-gap (3), lucide single door (1), aria-hidden + labels (1, 4, 5, 6), destructive controls keep words (5), body measure (7), hand-measured contrast (8), relative-only appearance assertions with fault injection (9).
- Out-of-scope items from the spec appear in no task: tag pills, theme switching, typography sliders, note-list thumbnails and date grouping.
- No task modifies the data layer, the editor schema, `useNotes`, or `NoteScope`.
