import { create } from 'zustand';

export type Theme = 'light' | 'dark';
const KEY = 'vaultlens.theme';

function stored(): Theme {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* storage blocked: fall back to light */
  }
  return 'light';
}

/** Single switch for the whole app: theme-dark.css keys off html[data-theme]. */
function apply(theme: Theme, animate = false) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-anim');
    window.setTimeout(() => root.classList.remove('theme-anim'), 300);
  }
  root.dataset['theme'] = theme;
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const initial = stored();
apply(initial); // before first render, so there is no light flash for dark users

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    apply(theme, true);
    try { window.localStorage.setItem(KEY, theme); } catch { /* not persisted */ }
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
