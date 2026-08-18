/**
 * SSE delivery E2E — verifies that `/api/notifications/stream` only
 * pushes a `notification` frame to subscribers who:
 *
 *   1. share the same active cooperative scope as the audited row,
 *   2. hold the `<resource>:notification` permission, AND
 *   3. have not opted out of that resource in their preferences.
 *
 * Each scenario opens a fresh SSE connection, triggers a farmer PATCH
 * from a different account (so the actor != listener filter never
 * trips us up), and asserts what frames arrived. Reading happens on
 * the same in-process app via `app.fetch()` — no TCP, no FE, no curl.
 *
 * The full pipeline under test:
 *
 *   PATCH /api/farmers/:id
 *     → audit_logs INSERT
 *     → audit.audit_event_notify trigger fires `pg_notify('audit_events', ...)`
 *     → BE LISTEN client (held by streamSSE handler) receives NOTIFY
 *     → eventMatchesSubscriber() decides forward / drop
 *     → stream.writeSSE({ event: 'notification', data: <auditId> })
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { and, eq, like } from 'drizzle-orm';
import { app } from '../app';
import { db } from '../db/client';
import { cooperatives, userNotificationPref } from '../db/schema/iam';
import { type AuthSession, api, signInAs, TEST_USERS, uniqueSuffix } from './helpers';

/**
 * Same shape as `api()` but additionally injects the `active-coop-id`
 * cookie. Farmer / parcel / batch routes resolve their tenant scope
 * from this cookie even for org-wide users — without it the PATCH +
 * DELETE handlers return 404.
 */
async function apiWithCoop<T = unknown>(
  session: AuthSession,
  activeCoopId: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: T | null; raw: Response }> {
  const cookie = `${session.cookie}; active-coop-id=${activeCoopId}`;
  const headers: Record<string, string> = { Cookie: cookie };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await app.fetch(
    new Request(`http://test.local${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  let data: T | null = null;
  if (res.status !== 204) {
    const text = await res.text();
    data = text ? (JSON.parse(text) as T) : null;
  }
  return { status: res.status, data, raw: res };
}

// ── Test fixtures ─────────────────────────────────────────────────

const SUFFIX = uniqueSuffix();
const FARMER_CODE = `SSE-${SUFFIX.toUpperCase()}`;

let sankofaCoopId: string;
let adwumaCoopId: string;
let sankofaFarmerId: string;

// Three sessions:
//   - actor: system_admin (org-wide, has every permission). Source of
//     PATCH-induced audit events.
//   - listenerSame: ims_manager.sankofa — should RECEIVE.
//   - listenerOther: ims_manager.adwuma — should NOT (different coop).
let actorSession: AuthSession;
let listenerSameSession: AuthSession;
let listenerOtherSession: AuthSession;

beforeAll(async () => {
  actorSession = await signInAs(TEST_USERS.systemAdmin.email, TEST_USERS.systemAdmin.password);
  listenerSameSession = await signInAs(TEST_USERS.imsManager.email, TEST_USERS.imsManager.password);
  listenerOtherSession = await signInAs('ims.manager.adwuma@kuanadata.com', 'KuanaData2026!');

  [sankofaCoopId, adwumaCoopId] = await Promise.all([
    db
      .select({ id: cooperatives.id })
      .from(cooperatives)
      .where(eq(cooperatives.code, 'SANKOFA'))
      .limit(1)
      .then((r) => r[0]?.id ?? ''),
    db
      .select({ id: cooperatives.id })
      .from(cooperatives)
      .where(eq(cooperatives.code, 'ADWUMA'))
      .limit(1)
      .then((r) => r[0]?.id ?? ''),
  ]);
  if (!sankofaCoopId || !adwumaCoopId) {
    throw new Error('cooperatives SANKOFA / ADWUMA missing — run seed first');
  }

  // Create a farmer in SANKOFA. Suffixed code so re-runs don't
  // collide; PATCHed across the four scenarios below to spawn audit
  // events. Created by the actor session so the audit row's
  // actor_user_id != listener (the resource gate is independent of
  // who created the row originally; what matters is the PATCH actor).
  const created = await apiWithCoop<{ id: string }>(
    actorSession,
    sankofaCoopId,
    'POST',
    '/api/farmers',
    {
      cooperativeId: sankofaCoopId,
      farmerCode: FARMER_CODE,
      firstName: 'Sse',
      lastName: 'Test',
    },
  );
  if (created.status !== 201 || !created.data?.id) {
    throw new Error(`farmer create failed: ${created.status} ${JSON.stringify(created.data)}`);
  }
  sankofaFarmerId = created.data.id;
});

afterAll(async () => {
  // Tombstone the test farmer (route soft-deletes — fine, audit rows
  // stay tombstoned but don't pollute the active list).
  if (sankofaFarmerId) {
    await apiWithCoop(actorSession, sankofaCoopId, 'DELETE', `/api/farmers/${sankofaFarmerId}`);
  }
  // Restore preference rows the opt-out scenario cleared.
  await db
    .delete(userNotificationPref)
    .where(eq(userNotificationPref.userId, listenerSameSession.userId));
  void and; // keep the and import alive for future filter additions
  void like;
});

// ── SSE reader ────────────────────────────────────────────────────

interface SseFrame {
  event: string;
  data: string;
}

/**
 * Open `/api/notifications/stream` with the given session (and an
 * optional active-coop cookie injected alongside the better-auth
 * token), accumulate frames for `windowMs` while running `trigger()`
 * mid-window, then abort and return what arrived.
 *
 * The handler doesn't emit a `connected` hello frame, so we can't
 * deterministically know when `LISTEN audit_events` has been issued.
 * A 250 ms warm-up before triggering covers it on dev hardware
 * without making the test sluggish — pump it up if CI is slower.
 */
async function captureSse(
  session: AuthSession,
  opts: {
    activeCoopId: string | null;
    windowMs?: number;
    warmupMs?: number;
    trigger: () => Promise<void>;
  },
): Promise<SseFrame[]> {
  const windowMs = opts.windowMs ?? 1500;
  const warmupMs = opts.warmupMs ?? 250;
  const cookie = opts.activeCoopId
    ? `${session.cookie}; active-coop-id=${opts.activeCoopId}`
    : session.cookie;

  const controller = new AbortController();
  const res = await app.fetch(
    new Request('http://test.local/api/notifications/stream', {
      method: 'GET',
      headers: { Cookie: cookie, Accept: 'text/event-stream' },
      signal: controller.signal,
    }),
  );
  expect(res.status).toBe(200);
  expect(res.body).not.toBeNull();

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buf = '';

  // Background drain — collects frames until abort.
  const drain = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i: number;
        while (true) {
          i = buf.indexOf('\n\n');
          if (i < 0) break;
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let event = '';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (event) frames.push({ event, data });
        }
      }
    } catch {
      // Reader rejects on abort — expected, swallow.
    }
  })();

  await new Promise((r) => setTimeout(r, warmupMs));
  await opts.trigger();
  await new Promise((r) => setTimeout(r, windowMs - warmupMs));

  controller.abort();
  await drain;
  return frames;
}

async function patchFarmer(): Promise<number> {
  // PATCH the test farmer with a unique payload so each call
  // produces a fresh audit row even if the field already had the
  // current value.
  const tag = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const { status } = await apiWithCoop(
    actorSession,
    sankofaCoopId,
    'PATCH',
    `/api/farmers/${sankofaFarmerId}`,
    { otherNames: tag },
  );
  expect(status).toBe(200);
  return Date.now();
}

const isNotification = (f: SseFrame) => f.event === 'notification';

// ── Scenarios ─────────────────────────────────────────────────────

describe('SSE notifications — same coop + permission + enabled', () => {
  test('listener in same coop with farmer:notification receives event', async () => {
    const frames = await captureSse(listenerSameSession, {
      activeCoopId: sankofaCoopId,
      trigger: () => patchFarmer().then(() => undefined),
    });
    const events = frames.filter(isNotification);
    expect(events.length).toBeGreaterThanOrEqual(1);
    // Data is the audit row id — must parse as a positive integer.
    expect(events[0]!.data).toMatch(/^\d+$/);
    expect(Number(events[0]!.data)).toBeGreaterThan(0);
  });
});

describe('SSE notifications — different coop scope', () => {
  test('listener in ADWUMA does NOT receive SANKOFA event', async () => {
    const frames = await captureSse(listenerOtherSession, {
      activeCoopId: adwumaCoopId,
      trigger: () => patchFarmer().then(() => undefined),
    });
    const events = frames.filter(isNotification);
    expect(events.length).toBe(0);
  });
});

describe('SSE notifications — opted-out resource', () => {
  test('listener with farmer disabled in preferences does NOT receive event', async () => {
    // Disable `farmer` notifications via the preferences endpoint —
    // this writes to user_notification_pref AND fires
    // pg_notify('perm_changed') so any open connection re-evaluates.
    // Our SSE connection in this test is opened AFTER the
    // preferences write, so we just observe the post-write filter.
    const grantedExceptFarmer = [
      'parcel',
      'inspection',
      'training',
      'batch',
      'eudr',
      'report',
      'sync',
    ];
    const pref = await api(listenerSameSession, 'PUT', '/api/notifications/preferences', {
      enabled: grantedExceptFarmer,
    });
    expect(pref.status).toBe(200);

    try {
      const frames = await captureSse(listenerSameSession, {
        activeCoopId: sankofaCoopId,
        trigger: () => patchFarmer().then(() => undefined),
      });
      const events = frames.filter(isNotification);
      expect(events.length).toBe(0);
    } finally {
      // Restore — re-enable everything so other tests + dev sessions
      // for this user behave normally on the next run.
      const restore = await api(listenerSameSession, 'PUT', '/api/notifications/preferences', {
        enabled: ['farmer', 'parcel', 'inspection', 'training', 'batch', 'eudr', 'report', 'sync'],
      });
      expect(restore.status).toBe(200);
    }
  });
});

describe('SSE notifications — self-action broadcast', () => {
  test('actor patching their own subscription resource DOES see their own event', async () => {
    // Same listener + actor. As of the self-filter removal in
    // `eventMatchesSubscriber`, the user's own actions broadcast
    // back to their other open tabs — gives live "I just did this"
    // confirmation across the user's open sessions.
    const frames = await captureSse(listenerSameSession, {
      activeCoopId: sankofaCoopId,
      trigger: async () => {
        const tag = `self-${Date.now()}`;
        const { status } = await apiWithCoop(
          listenerSameSession,
          sankofaCoopId,
          'PATCH',
          `/api/farmers/${sankofaFarmerId}`,
          { otherNames: tag },
        );
        expect(status).toBe(200);
      },
    });
    const events = frames.filter(isNotification);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.data).toMatch(/^\d+$/);
  });
});
