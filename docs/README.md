# docs/

Demo-support material: things you hand to a prospect, upload during a
call, or use to put the environment back the way it was.

| Path | What it is |
|---|---|
| [`import-samples/`](import-samples/) | Ready-to-upload farmers / parcel-polygon / EUDR files + their column reference |
| `demo-db-dump.sql.gz.enc` | Encrypted snapshot of the whole demo database (see below) |
| `ImpactCocoa_Demo_Assignment_Brian.docx` | Original assignment brief |

## Where the BE config lives

`apps/be/.env` is mirrored into the repo's GitHub Actions config, so a
fresh checkout / CI run doesn't need the file handed over out of band.
Split by sensitivity — **secrets** are write-only and encrypted,
**variables** are readable by anyone with repo access:

| Secret | Variable |
|---|---|
| `DATABASE_URL` (carries credentials) | `NODE_ENV`, `PORT`, `HOST` |
| `BETTER_AUTH_SECRET` | `FE_URL`, `FE_PORT`, `BETTER_AUTH_URL` |
| `DATABASE_ENCODE_PASSWORD` | `SESSION_EXPIRES_SECONDS`, `DATABASE_SSL` |
| | `STORAGE_ROOT`, `EMAIL_FROM` |

Keys that are blank locally (`KOBO_URL`, `KOBO_API_KEY`, `SENTRY_DSN`,
`SENTRY_RELEASE`, `RESEND_API_KEY`) were deliberately NOT created — an
empty secret looks configured while behaving like a missing one. Add them
when there's a real value.

Two caveats:

- The values uploaded are the **local demo** ones (localhost URLs, a
  localhost `DATABASE_URL`, a dev auth secret). They are not production
  config; a real deploy needs its own per-environment values.
- `deploy.yml` does not build the droplet's `.env` from these — it patches
  a handful of keys (`SENTRY_*`, `KOBO_API_KEY`, `BETTER_AUTH_URL`,
  `FE_URL`, …) into an `.env` maintained on the box. So these entries are
  reference/bootstrap material today, not the deploy's source of truth.

## Three ways to get back to a clean demo

| | Scope | Time | Keeps you signed in |
|---|---|---|---|
| **Admin → Data Sync → Reset demo data** | All operational data, rebuilt from the seed | ~3 s | ✅ |
| `bun run db:restore` (this snapshot) | Whole database, including users + sessions | ~10 s | ❌ everyone is logged out |
| `bun run db:reset` | Drops the container and re-migrates from zero | ~40 s | ❌ |

Reach for the **UI reset** during a call — it wipes farmers, parcels,
polygons, EUDR assessments, inspections, corrective actions, coaching,
CLMRS cases, training, purchases, evacuation lots, VSLA and the audit
feed, then re-seeds the baseline. Users, roles, permissions and
cooperatives survive, so the session you're presenting from stays alive.
It requires the `sync:reset` permission (`system_admin` only).

Reach for the **snapshot** when you need a whole environment to match
this one — a fresh box, or a demo DB someone has mangled beyond what the
seed rebuilds (deleted users, edited role grants).

## The encrypted snapshot

`docs/demo-db-dump.sql.gz.enc` = `pg_dump --clean --if-exists` → `gzip -9`
→ `AES-256-CBC` (PBKDF2, 100k iterations). ~870 KB.

The passphrase lives in `apps/be/.env` as `DATABASE_ENCODE_PASSWORD`
(documented in `.env.example`). The dataset is entirely synthetic —
generated names, phone numbers, Ghana Card numbers and polygons — so the
encryption is there to keep a database dump from sitting in git as
plaintext, not as a security boundary.

```bash
cd apps/be && bun run db:dump      # refresh the snapshot from the current DB
cd apps/be && bun run db:restore   # replace the DB with the snapshot (prompts)
```

Both scripts prefer a local `pg_dump`/`psql`; with no client installed
they fall back to `docker exec` against the compose container, but only
after checking that the container actually publishes the port in
`DATABASE_URL` — so pointing `DATABASE_URL` elsewhere can't silently hit
the dev database. Override the container with `DEMO_DB_CONTAINER=<name>`,
and skip the restore prompt with `RESTORE_YES=1`.

Re-run `db:dump` whenever the demo baseline changes in a way the seed
doesn't reproduce (new demo accounts, curated records, edited copy) and
commit the result.
