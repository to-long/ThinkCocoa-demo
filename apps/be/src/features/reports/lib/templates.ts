/**
 * Resolve XLSX template files at runtime.
 *
 * `bun build --bytecode` bakes `import.meta.dir` at build time, so a
 * bytecode compiled on CI (`/home/runner/work/...`) points at the CI
 * checkout when it runs on the droplet — ENOENT. We instead resolve
 * relative to `process.cwd()`, trying both the deploy layout
 * (droplet cwd = `/opt/impactcocoa`, templates in `apps/be/reports/`)
 * and the dev layout (`bun run dev` from `apps/be/`, templates in
 * `reports/`). `REPORTS_DIR` env var overrides everything for the
 * unusual deploy targets.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function readReportTemplate(filename: string): Promise<Buffer> {
  const cwd = process.cwd();
  const candidates = [
    process.env.REPORTS_DIR && path.resolve(process.env.REPORTS_DIR, filename),
    path.resolve(cwd, 'apps/be/reports', filename), // deploy droplet
    path.resolve(cwd, 'reports', filename), // apps/be dev
  ].filter((p): p is string => Boolean(p));

  const errors: string[] = [];
  for (const p of candidates) {
    try {
      return (await readFile(p)) as Buffer;
    } catch (err) {
      errors.push(`${p}: ${(err as Error).message}`);
    }
  }
  throw new Error(`Report template not found: ${filename}. Tried:\n  ${errors.join('\n  ')}`);
}
