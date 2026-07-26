/**
 * Dump a raw Kobo submission to stdout for terminal debugging.
 *
 * Reads from the DB (`integration.kobo_submissions_raw`) — fast, no
 * Spaces round-trip. For viewing the gzipped daily-snapshot bundle on
 * Spaces, use `make s3 <url>` instead (it covers the whole asset,
 * not a single submission).
 *
 * Usage:
 *   bun apps/be/scripts/inspect-submission.ts <uuid>      # detail by uuid
 *   bun apps/be/scripts/inspect-submission.ts --list      # 20 most-recent
 *   bun apps/be/scripts/inspect-submission.ts --list 50
 *
 * Pipe through `jq` for filtering:
 *
 *   bun ... <uuid> | jq '.["Member/Gps_location"]'
 *   bun ... --list | jq -r '.[] | "\(.submissionUuid)\t\(.payload["Member/producer"])"'
 */

import 'dotenv/config';
import { getRawSubmission, listRawSubmissions } from '../src/features/integrations/service';

const KOBO_FORM_CODE = 'internal_inspection';

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list') || args.length === 0) {
    const idx = args.indexOf('--list');
    const limitArg = idx >= 0 ? args[idx + 1] : args[0];
    const limit = Math.min(100, Math.max(1, Number.parseInt(limitArg ?? '20', 10) || 20));
    const rows = await listRawSubmissions(KOBO_FORM_CODE, limit);
    if (rows.length === 0) {
      console.error('No raw submissions yet. Run a sync first.');
      process.exit(0);
    }
    // Slim summary for terminal scanning — one line per submission.
    // Snapshot upload is now per-asset (gzipped daily file), so the
    // ☁ indicator was dropped — to check whether the asset has been
    // snapshotted, look at `sync_settings.snapshot_uploaded_at`.
    for (const r of rows) {
      const p = (r.payload ?? {}) as Record<string, unknown>;
      const submitted = r.submittedAt?.toISOString().slice(0, 10) ?? '         ';
      const producer = String(p['Member/producer'] ?? '—').padEnd(20);
      const code = String(p['Member/producerId'] ?? '—').padEnd(12);
      const plot = String(p['Member/PlotID'] ?? '—').padEnd(10);
      console.log(`${submitted} ${r.submissionUuid} ${producer} ${code} ${plot}`);
    }
    process.exit(0);
  }

  const uuid = args[0]!;
  const row = await getRawSubmission(uuid);
  if (!row) {
    console.error(`No submission with uuid ${uuid}`);
    process.exit(1);
  }
  console.log(JSON.stringify(row.payload, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
