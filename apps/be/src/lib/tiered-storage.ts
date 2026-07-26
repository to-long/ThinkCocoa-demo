/**
 * TieredStorage — disk-first storage with S3 cold archive + auto-thaw.
 *
 * Design:
 *
 *   BE always reads from local disk. S3 is purely cold archive — never
 *   touched on the hot read path. When a request asks for a date that
 *   isn't on disk, we download the day's archive from S3, untar it
 *   into the same day folder under `root`, and the reader sees it on
 *   the next try. Daily cron wipes anything older than `hotDays` —
 *   that catches both archived-and-kept data AND on-demand thaws.
 *
 *   This keeps the BE codebase free of S3 calls in feature logic —
 *   they only do `fs.readFile`-style ops via this library. S3 ops are
 *   isolated to the daily-maintenance cron + the per-day thaw helper.
 *
 * Disk layout (single root):
 *
 *   <root>/
 *   ├── 2026-05-21/                                  ← today — actively written
 *   │   ├── audit/<auditLogId>/<sha-prefix>.json                  (audit diffs)
 *   │   └── kobo/<jobKey>/2026-05-21_15-06-40Z.json               (Kobo snapshots)
 *   ├── 2026-05-20/                                  ← yesterday, hot
 *   ├── 2026-04-22/                                  ← 29 days old, still hot
 *   └── 2025-08-15/                                  ← thawed on demand; cron will delete
 *
 *   "Hot" vs "thawed" is implicit — derived from date age relative to
 *   `hotDays`. A date folder within the hot window is either:
 *     (a) the original write target for that day, OR
 *     (b) untouched after a thaw of the same day.
 *   Either way it's read the same. No separate `thawRoot`.
 *
 * S3 layout:
 *
 *   s3://<bucket>/<s3Prefix>/<YYYY-MM-DD>.tar.zst
 *
 * Concurrency:
 *
 *   Two reads for the same cold date that arrive concurrently must
 *   not both spin up a thaw. We dedupe with an in-process Promise map
 *   keyed by date — the first reader does the download+untar, the
 *   rest await the same Promise.
 *
 * Algorithm: zstd default. Bench on real audit JSON (10 MB, Bun
 * built-in node:zlib):
 *   - zstd default: ~3600 MB/s compress, ~4400 MB/s decompress
 *   - brotli q=6:   ~1100 MB/s compress, ~1500 MB/s decompress
 *   - gzip -9:      ~240 MB/s compress, ~1900 MB/s decompress
 * zstd wins both directions by 2-15× while staying within ~10% of
 * brotli's ratio. Storage cost savings of brotli at ThinkCocoa
 * scale (< $0.01/mo difference) are too small to justify slower
 * codecs. Built into node:zlib (Node 22.15+, Bun): no external dep.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createZstdCompress, createZstdDecompress } from 'node:zlib';
import {
  GetObjectCommand,
  HeadObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import * as tar from 'tar';
import { SPACES_BUCKET, spaces } from './spaces';

export type DateKey = string; // YYYY-MM-DD, always UTC

export interface TieredStorageConfig {
  /** Local directory under which every day's folder lives.
   *  e.g. `/var/lib/think-cocoa/storage`. */
  root: string;
  /** S3 key prefix for archive tarballs. No trailing slash. The
   *  env-aware factory `tieredStorageFromEnv()` prepends the
   *  deployment env (`production`, `staging`, `development`) so prod
   *  and staging Droplets writing to the same bucket can't clobber
   *  each other. */
  s3Prefix: string;
  /** Day folders within this many days of today are kept on disk.
   *  Older folders are deleted by the daily cron. Default 30. */
  hotDays?: number;
}

/** Construct a TieredStorage from process env.
 *
 *  Only ONE env var is read directly:
 *    STORAGE_ROOT — local disk root. Default
 *    `/var/lib/think-cocoa/storage` (the deploy workflow creates it).
 *    Dev overrides to a writable path via `.env`.
 *
 *  Everything else is either inferred or hardcoded:
 *    - Bucket: `SPACES_BUCKET` from `./spaces` (Cold-tier Space).
 *    - S3 prefix: `<NODE_ENV>/storage/`. Prod + staging Droplets
 *      writing to the same bucket can't collide because each
 *      Droplet boots with its own NODE_ENV (`production` /
 *      `staging`), set per-env in ecosystem.config.cjs.
 *    - Hot retention: 30 days (`HOT_DAYS` constant below).
 *
 *  Final S3 key: `<NODE_ENV>/storage/<date>.tar.zst`,
 *  e.g. `production/storage/2026-05-21.tar.zst`. */
const HOT_DAYS = 30;
const BASE_PREFIX = 'storage';

export function tieredStorageFromEnv(): TieredStorage {
  const root = process.env.STORAGE_ROOT ?? '/var/lib/think-cocoa/storage';
  const envLabel = process.env.NODE_ENV ?? 'development';
  return new TieredStorage({
    root,
    s3Prefix: `${envLabel}/${BASE_PREFIX}`,
    hotDays: HOT_DAYS,
  });
}

/** Process-wide singleton. Lazy so importing this module from a
 *  cron/test context that doesn't need storage doesn't construct one. */
let _instance: TieredStorage | null = null;
export function tiered(): TieredStorage {
  if (!_instance) _instance = tieredStorageFromEnv();
  return _instance;
}

export interface MaintenanceSummary {
  /** Dates whose folder was tarballed + uploaded this run. */
  archived: { date: DateKey; rawBytes: number; compressedBytes: number }[];
  /** Dates whose folder was deleted (older than hotDays). Catches
   *  both archived hot days falling off the window AND on-demand
   *  thaws made earlier in the day. */
  purged: DateKey[];
  durationMs: number;
}

/** YYYY-MM-DD (UTC). */
export function toDateKey(d: Date | DateKey): DateKey {
  if (typeof d === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Bad date key: ${d}`);
    return d;
  }
  return d.toISOString().slice(0, 10);
}

function archiveKey(prefix: string, date: DateKey): string {
  return `${prefix.replace(/\/+$/, '')}/${date}.tar.zst`;
}

export class TieredStorage {
  private readonly root: string;
  private readonly s3Prefix: string;
  private readonly hotDays: number;
  /** Per-date thaw dedupe: same date already being thawed → reuse promise. */
  private readonly inflightThaws = new Map<DateKey, Promise<void>>();

  constructor(cfg: TieredStorageConfig) {
    this.root = cfg.root;
    this.s3Prefix = cfg.s3Prefix.replace(/\/+$/, '');
    this.hotDays = cfg.hotDays ?? 30;
  }

  // ── Paths ───────────────────────────────────────────────────
  private dayDir(date: DateKey): string {
    return join(this.root, date);
  }
  /** Absolute path for a (date, relPath) tuple. `.json` is appended
   *  if missing — symmetric with `write()`. */
  private filePath(date: DateKey, relPath: string): string {
    const name = relPath.endsWith('.json') ? relPath : `${relPath}.json`;
    return join(this.dayDir(date), name);
  }

  // ── Write — always to local disk ────────────────────────────
  /** Persist `value` for the given date + path under
   *  `<root>/<date>/<relPath>.json`. Creates parent directories as
   *  needed. Overwrites if exists. */
  async write(date: Date | DateKey, relPath: string, value: unknown): Promise<void> {
    const d = toDateKey(date);
    const path = this.filePath(d, relPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value));
  }

  // ── Read — disk only, with auto-thaw fallback ───────────────
  /** Read the value for (date, relPath). Returns null when absent.
   *
   *  Lookup order:
   *    1. `<root>/<date>/<relPath>.json` — fast path (works for both
   *       hot dates and already-thawed cold dates)
   *    2. If missing: trigger thaw of `<s3Prefix>/<date>.tar.zst`,
   *       retry the same disk path
   *
   *  Step 2 dedupes concurrent calls for the same date. */
  async read<T = unknown>(date: Date | DateKey, relPath: string): Promise<T | null> {
    const d = toDateKey(date);
    const path = this.filePath(d, relPath);

    const direct = await tryReadJson<T>(path);
    if (direct !== undefined) return direct;

    await this.thawIfArchived(d);
    return (await tryReadJson<T>(path)) ?? null;
  }

  /** List `*.json` files (recursive) under `<root>/<date>/<relDir>`.
   *  Returns paths relative to the day root, without `.json` suffix —
   *  symmetric with `read()`'s relPath. Auto-thaws cold dates. */
  async list(date: Date | DateKey, relDir = ''): Promise<string[]> {
    const d = toDateKey(date);
    const base = join(this.dayDir(d), relDir);
    if (await pathExists(base)) return listJsonFiles(base, this.dayDir(d));

    await this.thawIfArchived(d);
    if (await pathExists(base)) return listJsonFiles(base, this.dayDir(d));
    return [];
  }

  // ── Thaw — internal, but exposed for explicit warm-up ───────
  /** Force a thaw of `date` from S3 onto `<root>/<date>/`. No-op if
   *  the day folder is already on disk. Returns true when data is now
   *  present on disk, false when S3 doesn't have an archive for it. */
  async thaw(date: Date | DateKey): Promise<boolean> {
    const d = toDateKey(date);
    if (await pathExists(this.dayDir(d))) return true;
    return this.thawIfArchived(d);
  }

  /** Internal: dedupe per-date thaw work. Returns true iff the day
   *  folder exists on disk after the call. */
  private async thawIfArchived(date: DateKey): Promise<boolean> {
    if (await pathExists(this.dayDir(date))) return true;

    const existing = this.inflightThaws.get(date);
    if (existing) {
      await existing;
      return pathExists(this.dayDir(date));
    }

    const p = (async () => {
      try {
        await this.thawFromS3(date);
      } finally {
        this.inflightThaws.delete(date);
      }
    })();
    this.inflightThaws.set(date, p);
    await p;
    return pathExists(this.dayDir(date));
  }

  private async thawFromS3(date: DateKey): Promise<void> {
    const key = archiveKey(this.s3Prefix, date);
    // Probe with HEAD to distinguish "doesn't exist" from real S3 error.
    try {
      await spaces().send(new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    } catch (err) {
      if (isNotFound(err)) return;
      throw err;
    }

    const destDir = this.dayDir(date);
    await mkdir(destDir, { recursive: true });

    const res = await spaces().send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    if (!res.Body) throw new Error(`Empty body for ${key}`);

    // Normalise the body to a Buffer first — runtime-portable
    // (AWS SDK returns Node Readable in Bun/Node, Web ReadableStream
    // in browsers). Tradeoff: holds the whole archive in memory.
    // Typical archives are 1-50 MB; swap to streaming if that ever
    // exceeds ~100 MB.
    const bytes = await res.Body.transformToByteArray();
    await pipeline(
      Readable.from(Buffer.from(bytes)),
      createZstdDecompress(),
      tar.x({ cwd: destDir, strip: 0 }),
    );
  }

  // ── Daily maintenance (cron entry point) ────────────────────
  /** Idempotent. Run from a daily cron (e.g. 02:00 UTC).
   *
   *  Single pass over `<root>/` date folders:
   *    1. Skip today — actively being written.
   *    2. For each other day: if no archive on S3 yet, tar+zstd → upload.
   *    3. Delete every date folder older than `today − hotDays`.
   *       This catches both expired hot days AND any on-demand
   *       thaw folders from earlier in the day.
   *
   *  Returns a summary suitable for logging or feeding to a
   *  sync_jobs-style table. */
  async runDailyMaintenance(): Promise<MaintenanceSummary> {
    const t0 = Date.now();
    const summary: MaintenanceSummary = { archived: [], purged: [], durationMs: 0 };

    await mkdir(this.root, { recursive: true });
    const dayDirs = await listDateDirs(this.root);
    const today = toDateKey(new Date());
    const cutoffKey = toDateKey(new Date(Date.now() - this.hotDays * 86_400_000));

    for (const day of dayDirs) {
      if (day >= today) continue; // never archive today

      // Archive if S3 doesn't have it yet
      if (!(await this.s3Exists(archiveKey(this.s3Prefix, day)))) {
        const { rawBytes, compressedBytes } = await this.archiveDay(day);
        summary.archived.push({ date: day, rawBytes, compressedBytes });
      }

      // Purge if outside retention window. Catches expired hot AND
      // any thaw folders from earlier (a thaw of an old date will
      // have age > hotDays by definition).
      if (day < cutoffKey) {
        await rm(this.dayDir(day), { recursive: true, force: true });
        summary.purged.push(day);
      }
    }

    summary.durationMs = Date.now() - t0;
    return summary;
  }

  /** tar+zstd-stream `<root>/<date>/` → S3 `<s3Prefix>/<date>.tar.zst`.
   *  Streams end-to-end so memory usage is bounded regardless of
   *  archive size. */
  private async archiveDay(date: DateKey): Promise<{ rawBytes: number; compressedBytes: number }> {
    const srcDir = this.dayDir(date);
    // Stage to a temp file outside the day folder (so it doesn't get
    // included in its own tarball if `archiveDay` retries).
    const tmpFile = join(this.root, `.${date}.tar.zst.uploading`);

    const rawBytes = await dirByteSize(srcDir);

    await pipeline(
      tar.c({ cwd: srcDir, gzip: false, portable: true, file: undefined }, ['.']) as never,
      createZstdCompress(),
      createWriteStream(tmpFile),
    );
    const compressedBytes = (await stat(tmpFile)).size;

    await spaces().send(
      new PutObjectCommand({
        Bucket: SPACES_BUCKET,
        Key: archiveKey(this.s3Prefix, date),
        Body: createReadStream(tmpFile) as never,
        ContentType: 'application/zstd',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    await rm(tmpFile, { force: true });
    return { rawBytes, compressedBytes };
  }

  /** HEAD probe — used by `runDailyMaintenance` to decide whether a
   *  date's archive already exists (skip re-tar) vs needs to be
   *  created. */
  private async s3Exists(key: string): Promise<boolean> {
    try {
      await spaces().send(new HeadObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Local helpers (file-scoped — no broader API surface)
// ─────────────────────────────────────────────────────────────

async function tryReadJson<T>(path: string): Promise<T | undefined> {
  try {
    const buf = await readFile(path);
    return JSON.parse(buf.toString('utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    // Treat partial-write JSON as missing — don't break readers on a
    // single corrupt file.
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

async function listDateDirs(root: string): Promise<DateKey[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function listJsonFiles(base: string, root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.json')) {
        out.push(full.slice(root.length + 1).replace(/\.json$/, ''));
      }
    }
  };
  await walk(base);
  return out.sort();
}

async function dirByteSize(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string) => {
    const entries = await readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else total += (await stat(full)).size;
    }
  };
  await walk(dir);
  return total;
}

function isNotFound(err: unknown): boolean {
  if (err instanceof NoSuchKey) return true;
  const status = (err as { $metadata?: { httpStatusCode?: number }; name?: string })?.$metadata
    ?.httpStatusCode;
  if (status === 404) return true;
  // DO Spaces (and AWS S3 without `s3:ListBucket`) returns 403 on
  // HeadObject for a missing key — same semantic as 404 for our
  // "does this archive exist?" probes. Tradeoff: a genuine auth
  // failure looks like "not archived" to runDailyMaintenance which
  // would then try to PUT, surfacing the real error there.
  if (status === 403) return true;
  if ((err as { name?: string }).name === 'NotFound') return true;
  return false;
}
