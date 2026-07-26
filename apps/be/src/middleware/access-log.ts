/**
 * HTTP access logging — one NDJSON row per request appended to a
 * dedicated `access.log` file (path from `ACCESS_LOG_PATH` env, falls
 * back to stdout when unset so the dev shell stays readable).
 *
 * Why a separate file (not `console.log`):
 *   - Boot messages, errors, and access traffic must each rotate
 *     independently; mixing them in `out.log` makes `grep` painful.
 *   - PM2 already manages `out.log` / `error.log`. Routing access there
 *     would double-rotate (PM2's `pm2-logrotate` + system logrotate)
 *     and mix unrelated streams.
 *   - System logrotate's `/etc/logrotate.d/think-cocoa` matches
 *     `/var/log/think-cocoa/*.log` so `access.log` rotates daily with
 *     30-day retention out of the box — no extra config.
 *
 * Trade-offs we made:
 *   - `fs.createWriteStream({flags:'a'})` opened once at module load.
 *     Linux append is atomic for < PIPE_BUF bytes (4 KiB) so concurrent
 *     writes from this process won't interleave. Crash-safe enough.
 *   - `/health` is skipped. Uptime monitors hit it every 1–5 min and
 *     would otherwise flood the log with no signal value.
 *   - User-Agent capped at 120 chars to keep entries bounded.
 *   - `userId` only resolves if an earlier middleware (`requireAuth`)
 *     has populated `c.var.user` — anonymous requests log `null`.
 */

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import type { MiddlewareHandler } from 'hono';

const ACCESS_LOG_PATH = process.env.ACCESS_LOG_PATH;

// Open the file once and reuse the stream. When ACCESS_LOG_PATH is
// unset (dev), we leave the stream null and fall back to a single
// stdout line per request below.
let stream: WriteStream | null = null;
if (ACCESS_LOG_PATH) {
  try {
    mkdirSync(dirname(ACCESS_LOG_PATH), { recursive: true });
    stream = createWriteStream(ACCESS_LOG_PATH, { flags: 'a' });
    stream.on('error', (err) => {
      // Don't crash the app if the log disk fills — keep serving
      // traffic and surface the failure on stderr instead.
      console.error('[access-log] write stream error:', err.message);
    });
  } catch (err) {
    console.error(`[access-log] could not open ${ACCESS_LOG_PATH}:`, (err as Error).message);
  }
}

const SKIP_PATHS = new Set(['/health']);

interface AccessLogVars {
  user?: { id?: string };
}

export const accessLog: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  let errored = false;
  try {
    await next();
  } catch (err) {
    errored = true;
    throw err; // re-throw so onError handles + status code lands
  } finally {
    if (!SKIP_PATHS.has(c.req.path)) {
      const duration = Math.round(performance.now() - start);
      // Cloudflare puts the real client IP in `CF-Connecting-IP`;
      // X-Forwarded-For is the multi-hop chain for non-CF deploys.
      const ip =
        c.req.header('cf-connecting-ip') ??
        c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
        '-';
      const ua = c.req.header('user-agent')?.slice(0, 120) ?? '-';
      const vars = c.var as AccessLogVars;
      const entry = {
        t: new Date().toISOString(),
        m: c.req.method,
        p: c.req.path,
        s: c.res.status,
        d: duration,
        ip,
        u: vars.user?.id ?? null,
        ua,
        ...(errored ? { err: true } : {}),
      };
      const line = `${JSON.stringify(entry)}\n`;
      if (stream) {
        stream.write(line);
      } else {
        // Dev fallback — concise single-line stdout entry.
        process.stdout.write(`[access] ${line}`);
      }
    }
  }
};
