import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'kuanadata-theme';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Resolve the OS colour scheme (only meaningful for the `system` pref). */
function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readStored(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'light';
}

// ── Module-level singleton ─────────────────────────────────────────
// A single source of truth shared by every `useAppTheme()` caller. The
// theme is applied to <html> at module load (app start) — NOT inside a
// component effect — so it no longer "flips" the first time a menu that
// happens to read the theme mounts. Independent per-hook useState (the
// old design) desynced once the switchers moved into popovers.
let current: ThemePreference = readStored();
const listeners = new Set<() => void>();

function applyToDom(): void {
  if (typeof document === 'undefined') return;
  const resolved = current === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : current;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
}

function setThemeGlobal(next: ThemePreference): void {
  current = next;
  if (typeof window !== 'undefined') localStorage.setItem(STORAGE_KEY, next);
  applyToDom();
  for (const l of listeners) l();
}

// Apply once on load, and follow the OS while the pref is `system`.
if (typeof window !== 'undefined') {
  applyToDom();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current === 'system') {
      applyToDom();
      for (const l of listeners) l();
    }
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getSnapshot = () => current;
const getServerSnapshot = (): ThemePreference => 'light';

export function useAppTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setTheme = useCallback((next: ThemePreference) => setThemeGlobal(next), []);
  const toggleTheme = useCallback(() => setThemeGlobal(current === 'dark' ? 'light' : 'dark'), []);

  return {
    theme,
    /** Effective dark state (resolves `system` to the OS scheme). */
    isDark: theme === 'system' ? systemPrefersDark() : theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
