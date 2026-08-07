import { createContext, type ReactElement, type ReactNode, useContext } from 'react';

import type { DatabaseStatus } from '@/data';

const DatabaseStatusContext = createContext<DatabaseStatus | null>(null);

export function DatabaseStatusProvider({
  status,
  children,
}: {
  status: DatabaseStatus;
  children: ReactNode;
}): ReactElement {
  return <DatabaseStatusContext.Provider value={status}>{children}</DatabaseStatusContext.Provider>;
}

export function useDatabaseStatus(): DatabaseStatus {
  const status = useContext(DatabaseStatusContext);
  if (!status) throw new Error('useDatabaseStatus requires a DatabaseStatusProvider ancestor.');
  return status;
}
