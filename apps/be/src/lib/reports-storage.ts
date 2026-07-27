/**
 * Local-disk store for generated report exports.
 *
 * Demo build: replaces the DigitalOcean Spaces (S3) upload/presign flow —
 * no `SPACES_KEY`/`SPACES_SECRET` needed. Report bytes are written under a
 * data dir keyed by the same `storageKey` the run record already holds
 * ("reports/<date>/<runId>/<file>"), and the download endpoint streams them
 * straight back from disk (same-origin, no presigned URL).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storageRoot } from './audit-changes';

/**
 * The ONE storage root, beside the audit diffs — `<root>/reports/…` next to
 * `<root>/audit-changes/…`. It used to be its own `.data/reports` tree,
 * which meant two roots to configure, two to back up, and a "reset demo
 * data" that emptied one of them and left generated reports behind.
 *
 * No `reports/` segment added here: every run record's `storageKey` already
 * starts with one ("reports/<date>/<runId>/<file>"), and appending a second
 * produced `storage/reports/reports/…` — the same doubling the old
 * `.data/reports` layout quietly had. `REPORTS_DIR` still overrides.
 */
function reportsDir(): string {
  return process.env.REPORTS_DIR ?? storageRoot();
}

/** Resolve a storageKey to an on-disk path, guarding against traversal. */
function resolveKey(key: string): string {
  const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(reportsDir(), safe);
}

/** Persist a generated report to local disk. */
export async function saveReportFile(key: string, body: Buffer): Promise<void> {
  const dest = resolveKey(key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, body);
}

/** Read a report back; `null` when the file is absent. */
export async function readReportFile(key: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveKey(key));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}
