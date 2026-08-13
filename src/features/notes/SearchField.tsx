import type { ReactElement, RefObject } from 'react';

import { useT } from '@/i18n';
import { Icon, Search, X } from '@/ui/Icon';

export interface SearchFieldProps {
  query: string;
  onQueryChange: (next: string) => void;
  /** So `AppShell` can focus the field from a keyboard shortcut. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchField({ query, onQueryChange, inputRef }: SearchFieldProps): ReactElement {
  const t = useT();

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <span aria-hidden="true" className="pointer-events-none absolute left-2 text-faint">
        <Icon glyph={Search} size="sm" />
      </span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onQueryChange('');
        }}
        className="h-7 w-full min-w-0 rounded-sm border border-border bg-bg py-1 pr-6 pl-7 text-ui text-text placeholder:text-faint"
      />
      {query !== '' && (
        <button
          type="button"
          aria-label={t('search.clear')}
          onClick={() => onQueryChange('')}
          className="absolute right-1 px-1 text-ui text-faint transition-colors duration-[var(--bear-duration-fast)] ease-bear hover:text-text"
        >
          <Icon glyph={X} size="sm" />
        </button>
      )}
    </div>
  );
}
