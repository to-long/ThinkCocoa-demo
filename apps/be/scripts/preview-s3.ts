/**
 * Preview a private Spaces object by URL — authenticates via the
 * BE's `SPACES_KEY/SECRET` from `apps/be/.env`, fetches the object,
 * pretty-prints JSON or echoes text. Useful for ad-hoc debug where
 * you've got a Spaces URL in hand (from DB row, log line, console)
 * and just want to see what's inside without a Cyberduck-style GUI.
 *
 * Accepted URL shapes — both subdomain (Spaces default) and CDN:
 *   https://<bucket>.<region>.digitaloceanspaces.com/<key>
 *   https://<bucket>.<region>.cdn.digitaloceanspaces.com/<key>
 *
 * Usage:
 *   bun apps/be/scripts/preview-s3.ts <url>
 *   bun apps/be/scripts/preview-s3.ts <url> | jq '.foo'
 *
 * Convenience:
 *   make preview-s3 URL=https://...digitaloceanspaces.com/path/to/object.json
 *
 * Exits non-zero on 404 / auth failure so it composes in shell scripts.
 */

import 'dotenv/config';
import { gunzipSync } from 'node:zlib';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { SPACES_BUCKET, spaces } from '../src/lib/spaces';

interface Parsed {
  bucket: string;
  key: string;
}

/** Parse a Spaces / CDN URL into bucket + key. Throws on unknown shape
 *  so the caller gets a clear message instead of a 403 from the SDK. */
function parseSpacesUrl(raw: string): Parsed {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Not a URL: ${raw}`);
  }
  if (!u.hostname.endsWith('digitaloceanspaces.com')) {
    throw new Error(`Not a DO Spaces hostname: ${u.hostname}`);
  }
  // Subdomain style:  <bucket>.<region>(.cdn)?.digitaloceanspaces.com
  // The leading label is always the bucket name; drop optional `.cdn.`
  // segment before extracting region for diagnostic purposes.
  const [bucket] = u.hostname.split('.');
  if (!bucket) throw new Error(`Cannot extract bucket from hostname: ${u.hostname}`);
  const key = u.pathname.replace(/^\/+/, '');
  if (!key) throw new Error('URL has no object key in the path');
  return { bucket, key };
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: bun apps/be/scripts/preview-s3.ts <spaces-url>');
    process.exit(2);
  }

  const { bucket, key } = parseSpacesUrl(url);
  if (bucket !== SPACES_BUCKET) {
    console.error(`Warning: URL bucket "${bucket}" ≠ configured SPACES_BUCKET "${SPACES_BUCKET}"`);
    console.error('Continuing with the URL bucket — set SPACES_BUCKET to match if this is wrong.');
  }

  const res = await spaces().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const raw = await res.Body?.transformToByteArray();
  if (!raw || raw.length === 0) {
    console.error('Empty body');
    process.exit(1);
  }

  // Detect gzip: `.gz` suffix or magic bytes 0x1F 0x8B. Decompress
  // transparently so callers don't have to pipe through `gunzip`.
  const looksGz = key.endsWith('.gz') || (raw[0] === 0x1f && raw[1] === 0x8b);
  const bytes = looksGz ? gunzipSync(Buffer.from(raw)) : Buffer.from(raw);
  const body = bytes.toString('utf8');

  // If it parses as JSON, pretty-print so the terminal output is
  // scannable. Otherwise echo verbatim (e.g. CSV, plain text).
  if (
    (res.ContentType ?? '').includes('json') ||
    body.trimStart().startsWith('{') ||
    body.trimStart().startsWith('[')
  ) {
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
      process.exit(0);
    } catch {
      // Fall through to plain echo
    }
  }
  console.log(body);
}

main().catch((err: unknown) => {
  // S3 SDK errors carry useful metadata on `$metadata` / `name` —
  // surface those for actionable debug output (404 vs 403 vs network).
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    const status = e.$metadata?.httpStatusCode;
    const name = e.name ?? 'Error';
    const msg = e.message ?? '';
    if (status === 404 || name === 'NoSuchKey') {
      console.error(`404 NoSuchKey — object not found at the given URL.`);
    } else if (status === 403) {
      console.error(`403 Forbidden — check SPACES_KEY/SECRET in apps/be/.env.`);
    } else {
      console.error(`${name}${status ? ` (${status})` : ''}: ${msg}`);
    }
    process.exit(1);
  }
  console.error(String(err));
  process.exit(1);
});
