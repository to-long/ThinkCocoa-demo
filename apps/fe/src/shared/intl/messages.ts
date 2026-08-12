/**
 * Lazy locale message loader.
 *
 * Instead of bundling all three locales (en/fr/vi × 16 feature
 * dictionaries) into the entry chunk, each locale lives in its own
 * `messages.<locale>.ts` barrel that rspack code-splits. `loadMessages`
 * dynamically imports only the active locale — the other two never
 * download unless the user switches language.
 *
 * Results are cached, and `getCachedMessages` lets a caller render
 * synchronously when a locale has already been fetched (avoids a loader
 * flash on re-mount / language toggle back).
 */

import type { Locale } from '../hooks/use-locale';

type Messages = Record<string, string>;

const loaders: Record<Locale, () => Promise<{ default: Messages }>> = {
  en: () => import('./messages.en'),
  fr: () => import('./messages.fr'),
  es: () => import('./messages.es'),
};

const cache = new Map<Locale, Messages>();

export function getCachedMessages(locale: Locale): Messages | undefined {
  return cache.get(locale);
}

export async function loadMessages(locale: Locale): Promise<Messages> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const mod = await loaders[locale]();
  cache.set(locale, mod.default);
  return mod.default;
}
