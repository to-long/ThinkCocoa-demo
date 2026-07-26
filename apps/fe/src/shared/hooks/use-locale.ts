import { useCallback, useState } from 'react';

export type Locale = 'en' | 'fr' | 'vi';

const STORAGE_KEY = 'cocoaimpact-locale';

export const locales: Locale[] = ['en', 'fr', 'vi'];

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
  vi: 'Tiếng Việt',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  fr: '🇫🇷',
  vi: '🇻🇳',
};

export function getInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  return (localStorage.getItem(STORAGE_KEY) as Locale) || 'en';
}

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    localStorage.setItem(STORAGE_KEY, newLocale);
    setLocaleState(newLocale);
  }, []);

  return { locale, setLocale };
}
