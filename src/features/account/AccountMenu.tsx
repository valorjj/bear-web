import { type ReactElement, useState } from 'react';

import { useT } from '@/i18n';
import { Icon, UserRound } from '@/ui/Icon';
import { Popover } from '@/ui/Popover';

import { useSession } from './useSession';

/**
 * The sidebar footer's account control, beside the theme picker.
 *
 * Deliberately a sibling of `ThemePicker` rather than a new chrome region: both
 * are app-level settings reached rarely, and the footer already exists with the
 * right affordance.
 *
 * No colour is written here. Every value is a token utility, so a palette edit
 * updates this menu for free.
 */
export function AccountMenu(): ReactElement {
  const t = useT();
  const { state, signIn, signOut } = useSession();
  const [open, setOpen] = useState(false);

  function row(label: string, onClick: () => void): ReactElement {
    return (
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onClick();
          setOpen(false);
        }}
        className="text-ui ease-bear text-text hover:bg-hover flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors duration-[var(--bear-duration-fast)]"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    );
  }

  function body(): ReactElement {
    if (state.status === 'loading') {
      return <p className="text-ui text-muted px-2 py-1">{t('account.menu')}</p>;
    }

    if (state.status === 'unavailable') {
      return (
        <div className="px-2 py-1">
          <p className="text-ui text-text">{t('account.unavailable')}</p>
          <p className="text-ui text-muted mt-1">{t('account.unavailable.body')}</p>
        </div>
      );
    }

    if (state.status === 'signedOut') {
      return (
        <>
          <p className="text-ui text-muted px-2 py-1">{t('account.signedOut')}</p>
          {row(t('account.signIn.google'), signIn)}
        </>
      );
    }

    return (
      <>
        <p className="text-ui text-muted truncate px-2 py-1">
          {state.account.email ?? state.account.userId}
        </p>
        {row(t('account.signOut'), () => void signOut())}
        <p className="text-ui text-faint px-2 py-1">{t('account.signOut.note')}</p>
      </>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('account.menu')}
        onClick={() => setOpen((previous) => !previous)}
        className="text-muted hover:bg-hover hover:text-text ease-bear flex size-8 items-center justify-center rounded-md transition-colors duration-[var(--bear-duration-fast)]"
      >
        <Icon glyph={UserRound} size="md" />
      </button>

      {open ? (
        <Popover
          open
          onClose={() => setOpen(false)}
          label={t('account.menu')}
          className="absolute bottom-full left-0 z-10 mb-2 w-64"
        >
          {body()}
        </Popover>
      ) : null}
    </div>
  );
}
