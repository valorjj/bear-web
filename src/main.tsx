import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import {
  openDatabase,
  persistStorage,
  runStartupFileSweep,
  runStartupMigrations,
  runStartupSweep,
} from '@/data';
import '@/styles/index.css';

// Captured before React mounts, so the startup sweep can never reclaim a note
// the user creates while it is still pending. See src/data/sweep.ts.
const BOOT_AT = Date.now();

void openDatabase().then((status) => {
  // Deliberately not awaited. The rebuild reads and rewrites the whole tag
  // index; blocking the first paint on it would trade a populated sidebar for
  // a blank screen. The sidebar is a live query, so it fills in when the
  // rebuild lands.
  // Sequenced after the rebuild rather than run alongside it: both write inside
  // transactions touching `notes`, and ordering them removes the question of
  // what a rebuild sees mid-purge. Still unawaited as a pair, so neither
  // blocks first paint.
  void runStartupMigrations()
    .then(() => runStartupSweep(BOOT_AT))
    // Sequenced AFTER the blank-note sweep, not alongside it: that sweep
    // purges notes, and purging already reclaims their files, so running both
    // at once would have the image sweep reading notes the other is deleting.
    .then(() => runStartupFileSweep(BOOT_AT));

  // Also not awaited, and for a second reason beyond first paint: in Firefox
  // this can raise a permission doorhanger, and blocking render behind a modal
  // the user has not been given any context for is the wrong trade.
  void persistStorage();

  // Removed BEFORE `createRoot`, not left for React to clear. React does empty
  // the container on its first render, but that happens after the root is
  // created and after `render` is called — and `index.html`'s indicator is a
  // real element with a running animation until then.
  document.getElementById('boot')?.remove();

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App status={status} />
    </StrictMode>,
  );
});
