/**
 * Notifications HTTP routes — bell badge count + SSE live stream.
 *
 *   GET /api/notifications/unread-count[?since=<auditId>]
 *     Returns `{ count }` (capped at 999). Optional `since` cursor
 *     so the FE can localStorage the highest-seen audit id and only
 *     count rows newer than that. No cursor → falls back to a 24h
 *     window.
 *
 *   GET /api/notifications/stream
 *     Server-Sent Events. Holds a long-lived `pg.Client` LISTEN on
 *     `audit_events` and forwards each qualifying NOTIFY to the
 *     caller as a `notification` event with the audit row id as
 *     `data`. FE bumps the badge on each event; reconnects refetch
 *     `unread-count` to reconcile.
 *
 * Both endpoints gate via the `:notification` suffix — the user
 * passes if any held permission ends in `:notification`. No special
 * `audit:read` requirement.
 */

import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { streamSSE } from 'hono/streaming';
import type pg from 'pg';
import { db, directPool } from '../../db/client';
import { userCooperativeAssignments } from '../../db/schema/iam';
import { notifySubscriptionChanged } from '../../lib/perm-signal';
import { type AuthedContext, requireAuth } from '../../middleware/require-auth';
import {
  type AuditEventPayload,
  effectiveSubscribedResources,
  eventMatchesSubscriber,
  getDisabledResources,
  getReadCursor,
  getUnreadCount,
  grantedNotificationResources,
  setDisabledResources,
  setReadCursor,
} from './service';

const ACTIVE_COOP_COOKIE = 'active-coop-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readActiveCoopCookie(c: { req: { raw: { headers: Headers } } }): string | null {
  const cookieHeader = c.req.raw.headers.get('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === ACTIVE_COOP_COOKIE) {
      const v = rest.join('=');
      return UUID_RE.test(v) ? v : null;
    }
  }
  return null;
}

/** Resolve the active-coop cookie AND verify the caller is allowed
 *  to see that coop's events. Org-wide users get any UUID through;
 *  district-scoped users have the value validated against their
 *  `user_cooperative_assignments`, otherwise it's discarded so a
 *  tampered cookie can't expand visibility. */
// biome-ignore lint/suspicious/noExplicitAny: Context type can vary
async function resolveActiveCoopId(c: any): Promise<string | null> {
  const raw = readActiveCoopCookie(c);
  if (!raw) return null;
  const user = c.get('user');
  if (user.isAllCooperative) return raw;
  const rows = await db
    .select({ id: userCooperativeAssignments.cooperativeId })
    .from(userCooperativeAssignments)
    .where(eq(userCooperativeAssignments.userId, user.id));
  return rows.some((r) => r.id === raw) ? raw : null;
}

function suffixGated(c: { get: (k: 'permissions') => Set<string> }): boolean {
  const perms = c.get('permissions');
  for (const p of perms) {
    if (p.endsWith(':notification')) return true;
  }
  return false;
}

export const notificationsRoutes = new OpenAPIHono<AuthedContext>();

// Hono `*` matches a SUB-path segment, not the same path. Mount
// requireAuth on each concrete path so both endpoints get the
// session + permission set on `c`. Without the explicit
// `/api/notifications/stream` mount the SSE route ran with no
// `permissions` Set on context and crashed inside `suffixGated`.
notificationsRoutes.use('/api/notifications/unread-count', requireAuth);
notificationsRoutes.use('/api/notifications/stream', requireAuth);

// ── Unread count ────────────────────────────────────────────────
notificationsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/notifications/unread-count',
    tags: ['Notifications'],
    request: {
      query: z.object({
        since: z
          .string()
          .optional()
          .openapi({
            description:
              'Audit log id cursor — count only rows with id > since. ' +
              'Omit to fall back to a 24h window.',
          }),
      }),
    },
    responses: {
      200: {
        description: 'Unread notification count for the caller',
        content: {
          'application/json': {
            schema: z
              .object({ count: z.number().int(), latestId: z.number().int().nullable() })
              .openapi('UnreadCount'),
          },
        },
      },
      403: {
        description: 'Caller has no `:notification` permission',
        content: {
          'application/json': {
            schema: z.object({ error: z.string() }),
          },
        },
      },
    },
  }),
  async (c) => {
    if (!suffixGated(c)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const user = c.get('user');
    const perms = c.get('permissions');
    const sinceRaw = c.req.valid('query').since;
    const sinceAuditId = sinceRaw ? Number(sinceRaw) : null;
    const activeCoopId = await resolveActiveCoopId(c);

    const unread = await getUnreadCount({
      userId: user.id,
      isAllCooperative: user.isAllCooperative,
      // Honour the user's per-resource opt-outs so the badge
      // matches the SSE stream — disabling `farmer:notification`
      // in /profile drops both the live event AND the count.
      resources: await effectiveSubscribedResources(user.id, perms),
      activeCoopId,
      // Client cursor wins when supplied (legacy localStorage clients);
      // otherwise fall back to the server-side cursor row.
      sinceAuditId:
        Number.isFinite(sinceAuditId) && (sinceAuditId ?? 0) > 0
          ? sinceAuditId
          : (await getReadCursor(user.id)) || null,
    });
    return c.json(unread, 200);
  },
);

// ── Mark read ───────────────────────────────────────────────────
// The bell POSTs the highest audit id it displayed when it closes. The
// cursor is stored per user (`iam.user_notification_reads`) so "seen"
// follows the account instead of one browser's localStorage.
notificationsRoutes.use('/api/notifications/mark-read', requireAuth);

notificationsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/notifications/mark-read',
    tags: ['Notifications'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({ upToAuditId: z.number().int().positive() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Cursor after the (monotonic) update',
        content: {
          'application/json': {
            schema: z.object({ lastReadAuditId: z.number().int() }).openapi('NotificationRead'),
          },
        },
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { upToAuditId } = c.req.valid('json');
    const lastReadAuditId = await setReadCursor(user.id, upToAuditId);
    return c.json({ lastReadAuditId }, 200);
  },
);

// ── Per-user notification preferences ───────────────────────────
// Settings UI reads + writes these; SSE filter intersects against
// them on every (re)connect. Disabling a resource silences both
// the bell badge AND the live event stream.

notificationsRoutes.use('/api/notifications/preferences', requireAuth);

notificationsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/notifications/preferences',
    tags: ['Notifications'],
    responses: {
      200: {
        description: 'User notification preferences',
        content: {
          'application/json': {
            schema: z
              .object({
                granted: z.array(z.string()).openapi({
                  description:
                    'Resources granted via :notification perms — what the toggles render.',
                }),
                enabled: z.array(z.string()).openapi({
                  description: 'Granted resources NOT opted out — current bell stream filter.',
                }),
              })
              .openapi('NotificationPreferences'),
          },
        },
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const perms = c.get('permissions');
    const granted = grantedNotificationResources(perms);
    const disabled = await getDisabledResources(user.id);
    const enabled = Array.from(granted)
      .filter((r) => !disabled.has(r))
      .sort();
    return c.json({ granted: Array.from(granted).sort(), enabled }, 200);
  },
);

notificationsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/notifications/preferences',
    tags: ['Notifications'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: z
              .object({
                enabled: z.array(z.string()).openapi({
                  description:
                    'Resources the user wants ON. Anything granted but missing here is treated as opted-out. Resources not in the granted set are ignored silently.',
                }),
              })
              .openapi('NotificationPreferencesUpdate'),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Updated; returns the new effective sets.',
        content: {
          'application/json': {
            schema: z.object({
              granted: z.array(z.string()),
              enabled: z.array(z.string()),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const perms = c.get('permissions');
    const granted = grantedNotificationResources(perms);
    const body = c.req.valid('json');
    // Compute the OFF set: granted resources NOT in the requested
    // enabled list. Anything outside `granted` is ignored — the
    // user can't enable a resource they aren't entitled to.
    const requested = new Set(body.enabled);
    const disabled = Array.from(granted).filter((r) => !requested.has(r));
    await setDisabledResources(user.id, disabled);
    // Drop any open SSE connection so its cached resource set rebuilds
    // from the new prefs on reconnect. Deliberately NOT `notifyPermChanged`
    // — that channel also blacklists the user's access token, and a
    // preference toggle changes nothing the token asserts.
    await notifySubscriptionChanged(user.id);
    return c.json(
      {
        granted: Array.from(granted).sort(),
        enabled: Array.from(granted)
          .filter((r) => !disabled.includes(r))
          .sort(),
      },
      200,
    );
  },
);

// ── SSE stream ─────────────────────────────────────────────────
//
// Per-connection: open a dedicated `pg.Client` (NOT the pool
// connection) so LISTEN survives, register one notification handler,
// drop on client disconnect. Heartbeat every 25s under the typical
// reverse-proxy idle limit (30s on most defaults).
notificationsRoutes.get('/api/notifications/stream', async (c) => {
  // Manually re-run requireAuth's gate: middleware applies to '*'
  // already, but we still need the suffix gate inline here.
  // biome-ignore lint/suspicious/noExplicitAny: bypass middleware gate
  if (!suffixGated(c as any)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const user = c.get('user');
  const perms = c.get('permissions');
  // Effective set = granted (`:notification` perms) MINUS user's
  // per-resource opt-outs from the settings UI. Cached on the
  // connection — perm changes drop the connection via
  // `pg_notify('perm_changed')`; settings changes also bump
  // `perm_changed` so the new set takes effect on reconnect.
  const resources = await effectiveSubscribedResources(user.id, perms);
  const activeCoopId = await resolveActiveCoopId(c);

  // Resolve user's coop assignments once at connect time.
  const assigned = await db
    .select({ cooperativeId: userCooperativeAssignments.cooperativeId })
    .from(userCooperativeAssignments)
    .where(eq(userCooperativeAssignments.userId, user.id));
  const coopIds = new Set(assigned.map((r) => r.cooperativeId));

  return streamSSE(c, async (stream) => {
    // Dedicated long-lived connection — directPool.connect() returns a
    // client we never release back to the pool until cleanup so LISTEN
    // keeps working. Must come from `directPool` (not `pool`) because
    // the main pool routes through PgBouncer transaction-mode in prod,
    // which silently drops session-level state including LISTEN. Single
    // `cleanup()` runs once on abort OR on a write failure, releases the
    // pg.Client back to the pool, and resolves the blocking promise so
    // Hono closes the response cleanly.
    const listener = await directPool.connect();
    let alive = true;
    let resolveDone: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const cleanup = () => {
      if (!alive) return;
      alive = false;
      clearInterval(heartbeat);
      listener.removeListener('notification', onNotification);
      Promise.allSettled([
        listener.query('UNLISTEN audit_events'),
        listener.query('UNLISTEN perm_changed'),
        listener.query('UNLISTEN subscription_changed'),
      ]).finally(() => {
        listener.release();
        resolveDone();
      });
    };

    const safeWrite = async (payload: { event: string; data: string }): Promise<void> => {
      if (!alive) return;
      try {
        await stream.writeSSE(payload);
      } catch {
        // Stream went away — drop the connection deterministically
        // instead of waiting for the abort signal (which Hono may
        // never fire when the underlying socket closes silently).
        cleanup();
      }
    };

    const onNotification = (msg: pg.Notification) => {
      if (!alive) return;
      // Perm change for this user → drop the connection so the
      // client's EventSource auto-reconnects with a fresh perm set
      // (the old `resources` Set captured at connect time is now
      // stale).
      // Both channels mean "your cached scope is stale, reconnect":
      // `perm_changed` for real permission edits (which also revoke the
      // access token), `subscription_changed` for preference toggles.
      if (msg.channel === 'perm_changed' || msg.channel === 'subscription_changed') {
        if (msg.payload === user.id) cleanup();
        return;
      }
      if (msg.channel !== 'audit_events') return;
      let ev: AuditEventPayload;
      try {
        ev = JSON.parse(msg.payload ?? '{}');
      } catch {
        return;
      }
      if (
        !eventMatchesSubscriber(ev, {
          userId: user.id,
          isAllCooperative: user.isAllCooperative,
          resources,
          coopIds,
          activeCoopId,
        })
      ) {
        return;
      }
      void safeWrite({ event: 'notification', data: String(ev.id) });
    };

    // Heartbeat keeps the connection alive past idle proxies.
    const heartbeat = setInterval(() => {
      void safeWrite({ event: 'ping', data: '' });
    }, 25_000);

    listener.on('notification', onNotification);
    await listener.query('LISTEN audit_events');
    // Second channel — fires from `setUserRoles` /
    // `setRolePermissions` / cooperative-assignment edits.
    await listener.query('LISTEN perm_changed');
    // Third channel — notification-preference toggles (token stays valid).
    await listener.query('LISTEN subscription_changed');

    // Race condition: if abort fired before we wired the listener
    // (instant client disconnect), short-circuit immediately.
    if (c.req.raw.signal.aborted) {
      cleanup();
    } else {
      c.req.raw.signal.addEventListener('abort', cleanup, { once: true });
    }

    // Block until cleanup runs — Hono closes the response when
    // this function returns.
    await done;
  });
});
