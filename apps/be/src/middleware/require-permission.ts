/**
 * Permission check middleware. Requires `requireAuth` to have run first.
 *
 * Usage (per-route):
 *   middleware: [requirePermission('user:update')]
 *   middleware: [requirePermission('role:delete')]
 *
 * Accepts multiple codes — any match passes:
 *   requirePermission('user:read', 'user:update')
 */

import type { PermissionCode } from '@kuanadata/shared';
import type { MiddlewareHandler } from 'hono';
import type { AuthedContext } from './require-auth';

/**
 * Gate a route on one or more permission codes. Passes if the caller has
 * ANY of the listed codes (OR semantics). The argument type is narrowed
 * to `PermissionCode` so typos caught at compile time — the union is
 * derived from the shared `PERMISSION_CATALOG`, which in turn is synced
 * from the DB via `bun run sync:permissions`.
 */
export function requirePermission(
  ...codes: [PermissionCode, ...PermissionCode[]]
): MiddlewareHandler<AuthedContext> {
  return async (c, next) => {
    const perms = c.get('permissions');
    if (!perms) {
      return c.json({ error: 'Missing auth context — call requireAuth first' }, 500);
    }
    const has = codes.some((code) => perms.has(code));
    if (!has) {
      return c.json({ error: `Forbidden — requires one of: ${codes.join(', ')}` }, 403);
    }
    await next();
  };
}

/**
 * Gate a route on a permission-code suffix — passes if the caller
 * holds ANY perm whose code ends in `suffix`. Useful for the
 * notifications page where the user needs *some* `:notification`
 * eligibility but the specific resources they can subscribe to are
 * filtered downstream.
 */
export function requirePermissionSuffix(suffix: string): MiddlewareHandler<AuthedContext> {
  return async (c, next) => {
    const perms = c.get('permissions');
    if (!perms) {
      return c.json({ error: 'Missing auth context — call requireAuth first' }, 500);
    }
    let has = false;
    for (const code of perms) {
      if (code.endsWith(suffix)) {
        has = true;
        break;
      }
    }
    if (!has) {
      return c.json({ error: `Forbidden — requires a permission ending in '${suffix}'` }, 403);
    }
    await next();
  };
}
