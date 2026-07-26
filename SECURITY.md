# Security

Status snapshot of the ThinkCocoa platform. Lists controls in place,
known gaps, and the action plan for each. Updated whenever a security
control lands or a new gap is found.

---

## Reporting a vulnerability

Mail to admin with the subject `[ThinkCocoa security]`.
Include reproduction steps, affected endpoints / commits, and the
realistic blast radius. Do not file public issues for unpatched flaws.

---

## Threat model

- **In scope**: web app + REST API + Postgres + better-auth sessions.
  Multi-tenant — every cooperative's data isolated from every other.
- **Trust boundaries**: browser ↔ BE (TLS), BE ↔ DB (private network),
  user ↔ session cookie.
- **Adversaries**: opportunistic web scanners, malicious authed user
  attempting cross-tenant access, brute-force scripts.
- **Out of scope** (for this doc): host OS hardening, AWS / VPS infra,
  physical access, social engineering of internal staff.

---

## Implemented controls

### Network / transport
- **CORS allowlist** — `apps/be/src/app.ts`. Origins limited to FE URL
  + production domain; `credentials: true`.
- **HTTPS enforced** via `Strict-Transport-Security: max-age=31536000;
  includeSubDomains; preload`. Set in `secureHeaders()`.
- **Trusted origins** for better-auth CSRF check —
  `apps/be/src/auth.ts` `trustedOrigins`.

### FE security headers (`apps/fe/rsbuild.config.ts`)
- `Content-Security-Policy` (also as `<meta http-equiv>`) — `default-src
  'self'`, blocks every off-origin asset; `script-src 'self'` blocks
  inline JS; `frame-ancestors 'none'` defeats clickjacking even when
  served by a bare static host.
- `X-Frame-Options: DENY` + `frame-ancestors 'none'` — both shipped
  for legacy browser coverage.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `X-Content-Type-Options: nosniff`.
- HSTS must be set on the production reverse proxy (meta tag can't
  set HSTS — browsers ignore meta variants of that header).

### BE security headers (`apps/be/src/app.ts`, via `hono/secure-headers`)
- `X-Frame-Options: DENY` — blocks every iframe embed (clickjacking).
- `X-Content-Type-Options: nosniff` — browsers respect declared MIME.
- `Referrer-Policy: strict-origin-when-cross-origin` — no full-URL
  leaks (incl. tokens) to third parties via `Referer`.
- `Cross-Origin-Opener-Policy: same-origin` — `window.opener` isolation.
- `X-Permitted-Cross-Domain-Policies: none` — blocks Flash / legacy
  PDF embed surfaces.
- `X-XSS-Protection: 0` — explicit opt-out (deprecated header; modern
  browsers rely on CSP).
- **CSP**: served from the FE bundle via Rsbuild's `index.html` meta
  tag. Not duplicated on the BE — would result in stricter-of-two
  behaviour the FE author can't predict.

### Authentication / session
- **better-auth** — email/password + magic link. bcrypt comparisons
  are constant-time.
- **Session cookies**: `HttpOnly`, `SameSite=Lax`, `Secure` in
  production. Lax permits magic-link top-level navigation while
  blocking cross-site `fetch()` POSTs.
- **Password length cap 128 chars** —
  `packages/shared/src/validators/auth.ts` `passwordSchema`. Prevents
  bcrypt DoS via gigabyte-scale submissions.
- **Rate limit on `/api/auth/*`** — 10 requests / IP / 60s, returns
  `429 + Retry-After`. `apps/be/src/middleware/rate-limit.ts`. Slows
  credential stuffing and magic-link spamming.

### Authorisation
- **`requirePermission(code)`** middleware on every business route —
  `apps/be/src/middleware/require-permission.ts`. Permission codes
  are a typed union from `packages/shared/src/constants/permissions.ts`
  — typos are compile errors.
- **`requireActiveCoop`** middleware on farmer endpoints —
  `apps/be/src/middleware/active-coop.ts`. Reads the `active-coop-id`
  cookie, intersects with the user's allowed coop set, returns `404`
  (not `403`) for cross-tenant lookups so existing IDs in other
  tenants are not leaked.
- **FE permission gates** — `usePermission(code)` hook in
  `apps/fe/src/shared/store/useGlobalState.ts`. Components hide
  Create / Edit / Delete buttons the user can't actually use, mirroring
  the BE gates.
- **Org-wide flag** (`users.is_all_cooperative`) auto-derived from
  role membership on every IAM seed run.

### Input validation
- **shared zod validators** — `packages/shared/src/validators/`. Same
  schema enforces on FE form (RHF + zodResolver) AND BE handler.
- **Length caps** on every string field — see `FIELD_LIMITS` in
  `packages/shared/src/validators/common.ts`. Email 254, password 128,
  person name 100, full name 200, short text 200, phone 32, national
  ID 64, address 500, description 2000, URL 2048, code 64.
- **Char patterns** for identifier / contact fields:
  - Person names: letters + diacritics + spaces + hyphens + apostrophes
    (`\p{L}\p{M}` Unicode-aware).
  - Phone: digits + space + `+ - ()` only.
  - National ID: alphanumeric + dash.
  - Cooperative code: `^[A-Z][A-Z0-9_]*$`.
  - Role code: `^[a-z_][a-z0-9_]*$`.
  - Farmer code: `^[A-Za-z0-9_-]+$`.
- **Control-char ban** (`\p{C}`) on person names, descriptions,
  addresses — blocks zero-width / RTL-override invisible chars.
- **Email homoglyph defence** — ASCII-only check on email; non-ASCII
  rejected with `EMAIL_NON_ASCII`. Case-folded via `.toLowerCase()`.
- **Number bounds** — `boundedInt(max)` rejects NaN + caps
  household (100), children (50). DOB 1900–today; registration ≤ today.
- **Mass-assignment safe** — update zod schemas have no top-level `id`
  field; BE never spreads request body into a row.
- **CSV injection** — `escapeCsvCell()` helper in
  `packages/shared/src/validators/common.ts`. Prefix-quotes any cell
  starting with `= + - @ \t \r`. To be applied on every CSV export
  consumer when reporting MVP lands.

### Output / rendering
- **React text rendering** escapes `< > &` automatically. No
  `dangerouslySetInnerHTML` in the codebase today.
- **Audit snapshots** strip password / hash columns —
  `apps/be/src/features/users/projection.ts` `userAuditSnapshot`.

### Payload limits
- **Global body limit 1 MiB** → `413 Payload Too Large`. Set in
  `apps/be/src/app.ts` via `hono/body-limit`. Prevents huge-JSON DoS
  on `JSON.parse` and downstream bcrypt / drizzle.

### Production hardening
- **OpenAPI / Scalar gated by NODE_ENV** — `/doc` + `/reference`
  return 404 in production. Devs/staging keep the interactive viewer;
  attackers don't get a free recon endpoint.

### Engineering controls
- **Migration test on every schema change** —
  `cd apps/be && bun run db:test-migrations`. Runs migrations clean +
  re-runs to verify idempotency on a throwaway container.
- **E2E test harness on a throwaway DB** — `make test`. Crashed tests
  never contaminate dev data.
- **Audit log on every administrative + business mutation** — actor,
  entity, action, cooperative scope. Schema in
  `apps/be/src/db/schema/audit.ts`.
- **Auto-generated FE SDK** — single source of truth from BE OpenAPI
  spec. Type drift fails compile.

---

## Known gaps (open)

### High — multi-tenant data leak surface
Three endpoints still leak across tenants. Documented in
[earlier audit](#); fix proposed but not landed.

| # | Endpoint | What leaks | Severity | Fix |
|---|---|---|---|---|
| 1 | `GET /api/cooperatives` | Coop list returns all coops to any holder of `cooperative:read` (today only `system_admin` has it, but role-grant change could expose) | Medium | Scope by allowed coop set when not `is_all_cooperative` |
| 2 | `GET /api/cooperatives/:id` | Detail (chair email, contact, area) of any coop by UUID | Medium | Same |
| 3 | `GET /api/users` | Users of all tenants | Low (only system_admin grant) | Add `requireActiveCoop` + scope by assignment |
| 4 | `GET /api/audit-logs` | Audit log of all tenants | Low (only org-wide grants) | Filter `WHERE cooperative_id = activeCoopId` for non-org-wide |

Pattern problem: scoping is **opt-in** today (endpoint must remember
`requireActiveCoop`). Switching to **default-scoped** with explicit
opt-out would be more defensive — deferred until module count grows.

### Medium
- **No CI dependency scan**. Plan: enable GitHub Dependabot (free,
  built-in) + Semgrep step in CI workflow.
- **No automated DAST**. Plan: weekly OWASP ZAP scan against staging.
- **No external pentest**. Plan: 1–2 day engagement before beta release.
- **Email provider not wired** — `sendResetPassword` + `sendMagicLink`
  print to `console.log` (see `apps/be/src/auth.ts`). Acceptable in
  dev; must be replaced with Resend / Postmark before any non-dev
  rollout that exposes the auth flows publicly.
- **Rate limiter is in-memory** — resets on process restart and lets
  an attacker probe each PM2 instance independently. Switch to a
  Redis-backed store before horizontal scale.

### Low
- **Lost-update protection**. Two admins editing the same farmer
  silently overwrite. Needs ETag / `If-Match` layer; deferred.
- **Phone number false positives**. `+0000000000` matches the regex
  but isn't a real number. libphonenumber-js validation deferred until
  SMS integration ships.
- **Empty-array clear semantics**. `cooperativeIds: []` clears every
  assignment in one PATCH. Per-dialog confirm required (UX, not
  validator).

### Out of scope until needed
- **File upload attacks** — no upload endpoints today.
- **WebSockets / realtime** — no surface today.
- **Mobile app** — not in repo; auth contract documented in README.

---

## Action plan (rolling)

| When | Action |
|---|---|
| **This sprint** | Fix multi-tenant gaps #1–#4 |
| **Pre-beta** | Wire production email provider; enable Dependabot + Semgrep CI |
| **Beta** | Run weekly ZAP DAST on staging; book external pentest |
| **Pre-go-live** | Switch rate limiter + sessions to a shared Redis store if scaling horizontally |
| **Continuous** | Code review every PR touching auth / permission / sensitive data against OWASP ASVS L1 |

---

## Quick reference — where things live

| Topic | File |
|---|---|
| HTTP security headers, body limit, CORS | `apps/be/src/app.ts` |
| Rate limiter | `apps/be/src/middleware/rate-limit.ts` |
| Auth config (better-auth, trusted origins) | `apps/be/src/auth.ts` |
| Permission middleware | `apps/be/src/middleware/require-permission.ts` |
| Active-coop tenant middleware | `apps/be/src/middleware/active-coop.ts` |
| Permission catalog (typed union) | `packages/shared/src/constants/permissions.ts` |
| Org-wide role list + helper | `packages/shared/src/validators/common.ts` |
| Validator codes + max lengths + char patterns | `packages/shared/src/validators/common.ts` |
| Per-domain validators | `packages/shared/src/validators/{auth,user,role,permission,cooperative,farmer}.ts` |
| Audit logger (PII-safe snapshot) | `apps/be/src/lib/audit.ts` + `apps/be/src/features/users/projection.ts` |
| FE permission hook | `apps/fe/src/shared/store/useGlobalState.ts` (`usePermission`) |
| FE active-coop store + cookie sync | `apps/fe/src/shared/store/useActiveCoop.ts` |
