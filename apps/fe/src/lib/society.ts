/**
 * Society-name display helpers.
 *
 * Society names arrive from Kobo in inconsistent casing (mostly lower-
 * case, e.g. `kokoase`). We keep the raw value as the canonical key for
 * filtering/query params (so it still matches the BE `society = ?`
 * clause), but ALWAYS render it Title-Cased for a tidy UI.
 */

/**
 * Title-case a society name for display. Empty/nullish → em dash.
 * The stored value carries a redundant " Society" suffix (the "Society"
 * label/icon already conveys the type), so we strip it for display while
 * the raw value stays the canonical filter key.
 */
export function formatSociety(name: string | null | undefined): string {
  if (!name?.trim()) return '—';
  const base = name.trim().replace(/[\s_]*society\s*$/i, '') || name.trim();
  return base.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Case-insensitive alphabetical sort of society keys (raw values). */
export function sortSocieties(list: readonly string[]): string[] {
  return [...list].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
