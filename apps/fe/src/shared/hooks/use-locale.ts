import { useCallback, useState } from 'react';

export type Locale = 'en' | 'fr' | 'es';

const STORAGE_KEY = 'kuanadata-locale';

export const locales: Locale[] = ['en', 'fr', 'es'];

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  es: '🇪🇸',
};

// A previously-persisted 'vi' choice is no longer a valid locale — fall back
// to English so an old localStorage value doesn't select a missing bundle.
export function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored && (locales as string[]).includes(stored) ? (stored as Locale) : 'en';
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem(STORAGE_KEY, newLocale);
    setLocaleState(newLocale);
  }, []);

  return { locale, setLocale };
}
