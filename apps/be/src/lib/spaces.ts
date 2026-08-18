/**
 * DigitalOcean Spaces (S3-compatible) client + read-only helpers.
 *
 * One singleton `spaces` S3Client per process — credentials come from
 * env (`SPACES_KEY`, `SPACES_SECRET`), region + endpoint default to
 * the production bucket at FRA1 but are overridable per-env.
 *
 * ─────────────────────────────────────────────────────────────────
 * ⚠️  ARCHITECTURE RULE — DO NOT WRITE TO S3 FROM FEATURE CODE.
 * ─────────────────────────────────────────────────────────────────
 *
 * The persistence model is **disk-first, cold-archive nightly**:
 *
 *   1. Feature code (runSync, audit logs, inspection ingest, …)
 *      writes JSON to LOCAL DISK via `tiered().write(...)` only.
 *      No S3 PUT happens in any request handler or sync job.
 *
 *   2. A daily PM2 cron (`scripts/storage-maintenance.ts`, 02:05 UTC)
 *      calls `TieredStorage.runDailyMaintenance()`, which tar+zstd's
 *      yesterday's day-folder and uploads ONE archive to S3.
 *
 * This file therefore intentionally EXPORTS ONLY:
 *   - `spaces()`     — the S3Client singleton (for the cron + thaw)
 *   - `getJson<T>()` — read-back used by `TieredStorage.thawFromS3()`
 *   - `objectUrl()`  — log-line URL composition only
 *   - `SPACES_BUCKET` constant
 *
 * Upload helpers (`putJson`, `putBytes`, `deleteObject`) used to
 * exist here but were removed — nobody called them, and keeping
 * them around tempted feature devs to add real-time S3 writes,
 * which would re-introduce the latency we just designed out.
 *
 * If you find yourself needing to upload from a request handler:
 *   STOP and reconsider. The right answer is almost always
 *   `tiered().write(date, relPath, value)` (local) + let the cron
 *   archive it. If that's truly not enough (e.g. need an immediate
 *   public URL), discuss with the team before adding back a writer.
 *
 * NOT used for: FE asset serve (browser fetches the Spaces URL
 * directly via Cloudflare / Spaces CDN — no BE roundtrip needed).
 */

import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Endpoint is always derived from region — DO Spaces hostnames are
// `<region>.digitaloceanspaces.com`. Override only needed if testing
// against a non-DO S3-compatible (MinIO localhost, etc.) — pass via
// `S3_ENDPOINT_OVERRIDE` env then.
const SPACES_REGION = process.env.SPACES_REGION ?? 'fra1';
const SPACES_ENDPOINT =
  process.env.S3_ENDPOINT_OVERRIDE ?? `https://${SPACES_REGION}.digitaloceanspaces.com`;
export const SPACES_BUCKET = process.env.SPACES_BUCKET ?? 'kuana-data-bucket';

/**
 * Lazily construct the client so importing this module in code paths
 * that never actually touch Spaces (tests, migrations) doesn't blow up
 * when env vars are absent. The first real call hits this getter.
 */
let _client: S3Client | null = null;
export function spaces(): S3Client {
  if (_client) return _client;
  const accessKeyId = process.env.SPACES_KEY;
  const secretAccessKey = process.env.SPACES_SECRET;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'SPACES_KEY and SPACES_SECRET env vars are required for DigitalOcean Spaces access.',
    );
  }
  _client = new S3Client({
    endpoint: SPACES_ENDPOINT,
    // S3Client requires SOME region string; DO Spaces don't validate
    // it but the SDK uses it for signature scope.
    region: SPACES_REGION,
    credentials: { accessKeyId, secretAccessKey },
    // DO Spaces uses subdomain-style hostnames
    // (`<bucket>.<region>.digitaloceanspaces.com`) which is the SDK
    // default — leave forcePathStyle off.
    //
    // @aws-sdk v3 (>= 3.729) defaults flexible checksums to
    // `WHEN_SUPPORTED`, which sends `x-amz-content-sha256:
    // STREAMING-UNSIGNED-PAYLOAD-TRAILER` + `Content-Encoding: aws-chunked`
    // on streaming/large PutObject bodies. DigitalOcean Spaces does NOT
    // support the aws-chunked trailer and rejects it with
    // `InvalidArgument: Invalid chunked request body` — this broke the
    // storage-maintenance tar+zstd upload. Force checksums to
    // `WHEN_REQUIRED` so the SDK only adds them when the operation
    // strictly needs one (never for plain PutObject to Spaces).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return _client;
}

/** Compose the canonical Spaces URL of an object. Note: the bucket
 *  is configured with private ACL — anonymous browser fetches return
 *  403. This helper exists only for log lines / debug output ("we
 *  uploaded to <url>"). Reading must go through `getJson()` (auth'd
 *  SDK call) or `make s3 <url>` (CLI that signs the request). */
export function objectUrl(key: string): string {
  return `${SPACES_ENDPOINT.replace('https://', `https://${SPACES_BUCKET}.`)}/${key}`;
}

/** Upload raw bytes to Spaces. **Documented exception to the
 *  no-write-from-features rule**: user-triggered report exports are
 *  generated on demand and must be downloadable from any BE instance,
 *  so they go straight to shared object storage instead of local disk.
 *  Used by `features/reports/service.ts` only. */
export async function putBytes(key: string, body: Buffer, contentType: string): Promise<void> {
  await spaces().send(
    new PutObjectCommand({
      Bucket: SPACES_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** Generate a short-lived presigned GET URL for an object. Used by the
 *  reports download endpoint — bucket is private so anonymous fetches
 *  return 403; the signed URL grants temporary access.
 *
 *  Pass `downloadFileName` to force the upstream response to carry a
 *  `Content-Disposition: attachment; filename=…` header — required so
 *  the browser saves the file (rather than navigating to it) when the
 *  BE redirects cross-origin. Without it, browsers ignore the FE's
 *  `<a download>` attribute on cross-origin redirects and can end up
 *  issuing duplicate download attempts. */
export async function presignGetUrl(
  key: string,
  expiresSeconds = 3600,
  downloadFileName?: string,
): Promise<string> {
  // The presigner and the s3 client pin slightly different `@smithy/types`
  // versions in their declared deps; the resolved instances are 100%
  // interface-compatible at runtime (both speak the same SigV4 layer)
  // but TS sees two structural-mismatched generics. One narrow cast at
  // the boundary is cleaner than dragging a `resolutions` override
  // through `package.json`.
  const cmd = new GetObjectCommand({
    Bucket: SPACES_BUCKET,
    Key: key,
    ResponseContentDisposition: downloadFileName
      ? `attachment; filename="${downloadFileName.replace(/"/g, '')}"`
      : undefined,
  });
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  return getSignedUrl(spaces() as any, cmd as any, { expiresIn: expiresSeconds });
}

/** Fetch a JSON object back. Returns `null` on 404 so callers can
 *  treat absence as a normal flow without try/catch boilerplate.
 *  Read-only — see file header for the no-write-from-features rule. */
export async function getJson<T = unknown>(key: string): Promise<T | null> {
  try {
    const res = await spaces().send(new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }));
    const text = await res.Body?.transformToString();
    return text ? (JSON.parse(text) as T) : null;
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    throw err;
  }
}
