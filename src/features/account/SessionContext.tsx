import { createContext, use, type ReactElement, type ReactNode } from 'react';

import { useSession, type Session } from './useSession';

/**
 * One session, read by several features.
 *
 * `useSession` performs its own `GET /me` on mount and shares nothing, so a
 * second caller means a second boot request. Until G there was exactly one
 * caller (`AccountMenu`) and that was invisible; the export menu is the
 * second, and gating PDF on sign-in through a duplicate hook call would have
 * doubled the request the boot gate exists to avoid.
 *
 * `null` rather than a default session object: a default would make a
 * consumer mounted outside the provider render "signed out" forever, which
 * reads as a product decision rather than the wiring bug it is.
 */
const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }): ReactElement {
  return <SessionCtx value={useSession()}>{children}</SessionCtx>;
}

export function useSessionValue(): Session {
  const value = use(SessionCtx);
  if (value === null) throw new Error('useSessionValue requires a SessionProvider above it');
  return value;
}
