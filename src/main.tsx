import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import { openDatabase, persistStorage, runStartupMigrations } from '@/data';
import '@/styles/index.css';

void openDatabase().then((status) => {
  // Deliberately not awaited. The rebuild reads and rewrites the whole tag
  // index; blocking the first paint on it would trade a populated sidebar for
  // a blank screen. The sidebar is a live query, so it fills in when the
  // rebuild lands.
  void runStartupMigrations();

  // Also not awaited, and for a second reason beyond first paint: in Firefox
  // this can raise a permission doorhanger, and blocking render behind a modal
  // the user has not been given any context for is the wrong trade.
  void persistStorage();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App status={status} />
    </StrictMode>,
  );
});
