/**
 * Canonical society key.
 *
 * Kobo enumerators type the society name freehand, so the same society
 * arrives in mixed casing / spacing (`Akokofe`, `AKOKOFE`, ` akokofe `).
 * We store a single canonical form — lowercased, trimmed, single-spaced —
 * so grouping / filtering treats them as one. The FE title-cases it for
 * display (`apps/fe/src/lib/society.ts`). Null/empty → null.
 */
export function normalizeSociety(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return s.length > 0 ? s : null;
}
