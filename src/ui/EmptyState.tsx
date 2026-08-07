import type { ReactElement } from 'react';

export function EmptyState({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <h2 className="text-sm font-semibold text-text">{title}</h2>
      <p className="max-w-xs text-sm text-muted">{body}</p>
    </div>
  );
}
