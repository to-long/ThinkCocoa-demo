/**
 * Tiny helpers for query-string flags. We accept all the shapes a
 * curl/axios/fetch user might reasonably send (`true`, `1`, `yes`,
 * case-insensitive) instead of strict-matching `'true'` — the
 * server has no business 400ing on a typo'd `?includeDeleted=TRUE`.
 *
 * Default is `false`: when the param is absent or doesn't match a
 * truthy token, behave as if the flag were off.
 */
const TRUTHY = new Set(['true', '1', 'yes', 'on']);

export function parseBoolFlag(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}
