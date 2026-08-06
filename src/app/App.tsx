import { useState } from 'react';

export default function App() {
  const [dark, setDark] = useState(false);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  };

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-bg text-text">
      <h1 className="text-2xl font-semibold">bear-web</h1>
      <button
        type="button"
        onClick={toggle}
        className="rounded border border-border px-3 py-1 text-muted"
      >
        {dark ? 'Light' : 'Dark'}
      </button>
    </div>
  );
}
