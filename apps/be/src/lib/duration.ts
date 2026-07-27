/**
 * `30m` / `8h` / `7d` / `1800` → seconds.
 *
 * One parser for both token lifetimes so `ACCESS_TOKEN_TTL` and
 * `REFRESH_TOKEN_TTL` accept the same spellings — the pair used to be
 * written two different ways (a duration string vs. a bare
 * `SESSION_EXPIRES_SECONDS` count), which is an easy way to set one of
 * them to a value you did not mean.
 *
 * A malformed value falls back to the caller's default rather than
 * throwing: an unparsable TTL should not stop the server from booting,
 * and every call site has a sane default.
 */

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function parseDurationSeconds(raw: string | undefined, fallbackSeconds: number): number {
  if (!raw) return fallbackSeconds;
  const m = /^(\d+)\s*([smhd])?$/.exec(raw.trim());
  if (!m) return fallbackSeconds;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallbackSeconds;
  // No unit = seconds, so a legacy numeric value still means what it did.
  return n * (UNIT_SECONDS[m[2] ?? 's'] ?? 1);
}
