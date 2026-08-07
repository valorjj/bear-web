import type { ReactElement } from 'react';

import { useT } from '@/i18n';

import { useDatabaseStatus } from './DatabaseStatusContext';

export function UnavailableBanner(): ReactElement | null {
  const status = useDatabaseStatus();
  const t = useT();

  if (status === 'ready') return null;

  return (
    <div role="alert" className="border-b border-border bg-surface px-4 py-2 text-sm text-text">
      <p className="font-semibold">{t('database.memory.title')}</p>
      <p className="text-muted">{t('database.memory.body')}</p>
    </div>
  );
}
