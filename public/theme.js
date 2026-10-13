// Light/dark switch. Loaded in <head> so the stored choice applies before first paint; without a choice the system setting wins.
const root = document.documentElement;
try {
  const stored = localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') root.dataset.theme = stored;
} catch { /* storage blocked: keep following the system setting */ }

document.addEventListener('DOMContentLoaded', () => {
  const button = document.getElementById('theme-toggle');
  if (!button) return;
  const dark = () => root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const sync = () => {
    button.setAttribute('aria-pressed', String(dark()));
    button.title = dark() ? 'Switch to light mode' : 'Switch to dark mode';
  };
  button.hidden = false;
  sync();
  button.addEventListener('click', () => {
    const next = dark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* not persisted */ }
    sync();
  });
});
