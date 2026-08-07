import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import { openDatabase } from '@/data';
import '@/styles/index.css';

// Resolve storage before the first render so components never discover a failed
// database from inside a live query. Task 5 threads the result into the tree.
void openDatabase().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
