/**
 * Field-level audit diffs, stored as plain JSON files on disk.
 *
 * Layout under `STORAGE_ROOT` (gitignored):
 *
 *   <STORAGE_ROOT>/audit-changes/<YYYY-MM-DD>/audit/<auditLogId>/<sha16>.json
 *   <STORAGE_ROOT>/reports/<YYYY-MM-DD>/<runId>/<file>        (reports-storage.ts)
 *
 * The key written into `audit.audit_attachment.storage_key` keeps the same
 * `<date>/<relPath>.json` shape the previous storage layer used, so existing
 * rows and the reader's parsing stay valid.
 *
 * Why this replaced `tiered-storage`: diffs used to go through a hot-disk +
 * DigitalOcean Spaces tier, which constructs an S3 client eagerly. With
 * `SPACES_KEY`/`SPACES_SECRET` blank — every local environment, and the demo
 * deployment — that construction threw, the throw was swallowed by the
 * `try/catch` wrapped around `writeAudit` (deliberate: auditing must never
 * break the mutation it records), and the result was silent: no attachment
 * row, and every audit detail page reporting "No field changes recorded".
 *
 * Files, not a table, because a diff is only ever fetched by id for one
 * detail view — there is nothing to query across. The list's inline preview
 * reads the same file per visible row.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** The ONE storage root: audit change diffs under `audit-changes/`,
 *  generated reports under `reports/` (see `reports-storage.ts`). Mirrors
 *  `STORAGE_ROOT` — the deploy sets an absolute path outside the code
 *  directory so a release untar can't wipe it. The dev fallback is
 *  `apps/be/storage`, matching what `.env.example` documents. */
export function storageRoot(): string {
  return process.env.STORAGE_ROOT ?? path.join(process.cwd(), 'storage');
}

function changesRoot(): string {
  return path.join(storageRoot(), 'audit-changes');
}

/** `YYYY-MM-DD` in UTC — the day folder a diff lands in. */
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Reject anything that could climb out of the storage root. Keys are
 *  built internally today, but this is the one place a caller-supplied
 *  string reaches the filesystem. */
function resolveKey(date: string, relPath: string): string | null {
  const target = path.resolve(changesRoot(), date, `${relPath}.json`);
  const root = path.resolve(changesRoot());
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

export async function writeAuditChanges(
  date: string,
  relPath: string,
  diffs: unknown,
): Promise<void> {
  const dest = resolveKey(date, relPath);
  if (!dest) throw new Error(`Refusing to write audit changes outside storage root: ${relPath}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, JSON.stringify(diffs), 'utf8');
}

/** Null when the file is missing — a diff that was never written, or one
 *  wiped by a demo reset. The caller renders the audit row without the
 *  expandable changes rather than failing the request. */
export async function readAuditChanges<T>(date: string, relPath: string): Promise<T | null> {
  const src = resolveKey(date, relPath);
  if (!src) return null;
  try {
    return JSON.parse(await readFile(src, 'utf8')) as T;
  } catch {
    return null;
  }
}

/**
 * Empty the storage root's CONTENTS, keeping the directory itself.
 *
 * Used by the demo reset: the audit rows pointing at these files are
 * truncated in the same operation, so leaving the blobs behind would
 * accumulate orphans no code can ever reach again.
 *
 * The directory is preserved rather than removed and recreated — on the
 * droplet it lives at `/var/lib/think-cocoa/storage` with ownership the app
 * user may not be able to reproduce.
 */
export async function clearStorageContents(): Promise<number> {
  const root = storageRoot();
  const { readdir } = await import('node:fs/promises');
  let removed = 0;
  try {
    for (const entry of await readdir(root)) {
      await rm(path.join(root, entry), { recursive: true, force: true });
      removed++;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return removed;
}
