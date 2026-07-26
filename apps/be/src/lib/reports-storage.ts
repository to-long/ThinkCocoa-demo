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

const REPORTS_DIR = process.env.REPORTS_DIR ?? path.join(process.cwd(), '.data', 'reports');

/** Resolve a storageKey to an on-disk path, guarding against traversal. */
function resolveKey(key: string): string {
  const safe = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
  return path.join(REPORTS_DIR, safe);
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
