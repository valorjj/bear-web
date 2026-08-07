import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import { openDatabase } from '@/data';
import '@/styles/index.css';

void openDatabase().then((status) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App status={status} />
    </StrictMode>,
  );
});
