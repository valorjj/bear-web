import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { applyTypography, BOUNDS, DEFAULTS, snapField, type Typography } from '@/app/typography';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { Button } from '@/ui/Button';
import { Dialog } from '@/ui/Dialog';

export interface TypographyPanelProps {
  value: Typography;
  /** The durable write. Debounced by this component; never called per tick. */
  onCommit: (next: Typography) => void;
  onDismiss: () => void;
}

interface Row {
  field: keyof Typography;
  labelKey: TranslationKey;
  /** `null` for line height, which is unitless. */
  unitKey: TranslationKey | null;
}

/*
 * Module scope, not the render body. A constant defined inside a render is a
 * new identity every render, and this panel re-renders on every slider tick —
 * the trap `NoteRowMenu`'s `Item` cost this project, where remounting threw
 * keyboard focus out of an open menu.
 */
const ROWS: readonly Row[] = [
  { field: 'fontSize', labelKey: 'typography.fontSize', unitKey: 'typography.unit.px' },
  { field: 'lineHeight', labelKey: 'typography.lineHeight', unitKey: null },
  { field: 'lineWidth', labelKey: 'typography.lineWidth', unitKey: 'typography.unit.em' },
  { field: 'paraSpacing', labelKey: 'typography.paraSpacing', unitKey: 'typography.unit.em' },
  { field: 'paraIndent', labelKey: 'typography.paraIndent', unitKey: 'typography.unit.em' },
];

const COMMIT_DELAY_MS = 250;

/**
 * The five reading controls.
 *
 * **This component owns the drag; React state above it does not.** A range
 * input fires a change on every tick, and routing each through the durable
 * write and its `useLiveQuery` would re-render the whole shell thirty times
 * during one gesture. So the in-flight value lives here, the custom property
 * is written to the document IMPERATIVELY on every tick — which is what makes
 * the preview live, since `editor.css` and the export stylesheet both already
 * read these tokens — and `onCommit` fires once on a trailing debounce.
 *
 * The debounce introduces exactly one failure mode, and the cleanup FLUSHES
 * rather than cancels because of it: a user who nudges a slider and closes the
 * panel inside 250 ms must not lose the change.
 */
export function TypographyPanel({
  value,
  onCommit,
  onDismiss,
}: TypographyPanelProps): ReactElement {
  const t = useT();
  const id = useId();
  const [draft, setDraft] = useState<Typography>(value);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Typography | undefined>(undefined);

  // Read through a ref so the flush-on-unmount effect can keep an empty
  // dependency list without closing over a stale callback.
  const commit = useRef(onCommit);
  commit.current = onCommit;

  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current);
      if (pending.current !== undefined) commit.current(pending.current);
    },
    [],
  );

  function change(field: keyof Typography, raw: number): void {
    const next = { ...draft, [field]: snapField(field, raw) };
    setDraft(next);
    applyTypography(next);

    pending.current = next;
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = undefined;
      commit.current(next);
    }, COMMIT_DELAY_MS);
  }

  function reset(): void {
    setDraft(DEFAULTS);
    applyTypography(DEFAULTS);
    if (timer.current !== undefined) clearTimeout(timer.current);
    pending.current = undefined;
    commit.current(DEFAULTS);
  }

  return (
    <Dialog
      open
      onClose={onDismiss}
      label={t('typography.label')}
      className="w-full max-w-sm gap-4 p-4"
    >
      <h2 className="text-ui-lg text-text font-semibold">{t('typography.label')}</h2>

      <div className="flex flex-col gap-3">
        {ROWS.map(({ field, labelKey, unitKey }) => {
          const bound = BOUNDS[field];
          const readout = unitKey === null ? `${draft[field]}` : `${draft[field]} ${t(unitKey)}`;
          const control = `${id}-${field}`;

          return (
            <div key={field} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                {/*
                  The readout is a SIBLING of the label, never inside it. An
                  input labelled by an element that also holds its value
                  announces the value twice — once in the accessible name and
                  again in `aria-valuetext`.
                */}
                <label htmlFor={control} className="text-ui text-text">
                  {t(labelKey)}
                </label>
                <span aria-hidden="true" className="text-ui-sm text-muted tabular-nums">
                  {readout}
                </span>
              </div>
              <input
                id={control}
                type="range"
                min={bound.min}
                max={bound.max}
                step={bound.step}
                value={draft[field]}
                aria-valuetext={readout}
                onChange={(event) => change(field, Number(event.target.value))}
                className="accent-accent w-full"
              />
            </div>
          );
        })}
      </div>

      <div className="flex justify-between gap-2">
        <Button onClick={reset} variant="ghost">
          {t('typography.reset')}
        </Button>
        <Button onClick={onDismiss} variant="primary">
          {t('typography.done')}
        </Button>
      </div>
    </Dialog>
  );
}
