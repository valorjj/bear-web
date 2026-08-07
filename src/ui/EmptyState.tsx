import type { ReactElement } from 'react';

export function EmptyState({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-semibold text-text">{title}</p>
      <p className="max-w-xs text-sm text-muted">{body}</p>
    </div>
  );
}
