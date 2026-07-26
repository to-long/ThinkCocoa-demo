/**
 * Tiny in-memory sliding-window rate limiter — keyed by client IP.
 *
 * Use case: throttle auth-style endpoints (sign-in, magic link,
 * forgot-password) to slow credential-stuffing / brute-force without
 * requiring a Redis dependency for the dev / single-instance phase.
 *
 * Limits:
 *   - default 10 requests / 60s window per IP per route prefix.
 *
 * Production notes:
 *   - Resets on process restart (in-memory). Acceptable while we run
 *     a single PM2 instance; switch to a shared store (Redis / KV)
 *     before horizontal scaling — at scale, an attacker can probe
 *     each instance independently and split the limit.
 *   - LRU cap (10k IPs) prevents the map from growing unbounded under
 *     a wide-IP attack; oldest entries are dropped first.
 *   - IP resolution mirrors `lib/audit.ts`: prefer `X-Forwarded-For`
 *     first hop, then `X-Real-IP`, then connInfo socket. If none
 *     resolve (test harness), the request is allowed — fail-open
 *     because a 429 in tests would mask real bugs.
 */

import { getConnInfo } from '@hono/node-server/conninfo';
import type { MiddlewareHandler } from 'hono';
import { LRUCache } from 'lru-cache';

interface RateLimitOpts {
  /** Max hits per IP within `windowMs`. Default 10. */
  limit?: number;
  /** Window length in ms. Default 60_000. */
  windowMs?: number;
  /** Cache key prefix — usually the route group ('auth-signin'). */
  keyPrefix: string;
}

const buckets = new LRUCache<string, number[]>({ max: 10_000, ttl: 5 * 60_000 });

function clientIp(c: Parameters<MiddlewareHandler>[0]): string | null {
  const headers = c.req.raw.headers;
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? headers.get('x-real-ip') ?? null;
  if (ip) return ip;
  try {
    const raw = getConnInfo(c).remote.address ?? null;
    return raw?.startsWith('::ffff:') ? raw.slice(7) : raw;
  } catch {
    return null;
  }
}

export const rateLimit = (opts: RateLimitOpts): MiddlewareHandler => {
  const limit = opts.limit ?? 10;
  const windowMs = opts.windowMs ?? 60_000;
  return async (c, next) => {
    const ip = clientIp(c);
    // Fail-open: no IP (test harness, weird socket) → don't block.
    if (!ip) return next();

    const key = `${opts.keyPrefix}:${ip}`;
    const now = Date.now();
    const cutoff = now - windowMs;
    const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);

    if (hits.length >= limit) {
      const retryAfter = Math.ceil((hits[0] + windowMs - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: 'Too many requests' }, 429);
    }

    hits.push(now);
    buckets.set(key, hits);
    await next();
  };
};
