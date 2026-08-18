import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { jwt, magicLink } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { accounts, jwks, sessions, users, verifications } from './db/schema/iam';
import { renderMagicLinkEmail, renderResetPasswordEmail, sendEmail } from './lib/email';
import { resolvePermissionCodes } from './lib/permission-set';
import { accessTokenTtlSeconds, refreshTokenTtlSeconds } from './lib/token-ttl';

/**
 * better-auth configured against our domain `iam.*` schema.
 *
 * Design notes:
 *   - `drizzleAdapter` maps better-auth models to our drizzle tables, which live
 *     in the `iam` schema. We keep one users table for both auth and domain use.
 *   - `usePlural: true` because our tables are `users`, `sessions`, `accounts`,
 *     `verifications` (plural) rather than singular.
 *   - `generateId: false` — IDs come from Postgres via `gen_random_uuid()`.
 *     This keeps UUIDs everywhere and lets all existing FKs to `iam.users.id`
 *     continue to work.
 *   - Domain-only columns on the users table (status, defaultCooperativeId,
 *     lastLoginAt) are declared below as `additionalFields` so better-auth
 *     knows about them and the adapter generates correct SQL.
 */

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema: {
      users,
      sessions,
      accounts,
      verifications,
      // `usePlural: true` pluralises every model name, and the jwt
      // plugin's model is already called `jwks` — so the adapter looks up
      // `jwkss`. Register the table under the key better-auth actually
      // asks for; the exported table stays `iam.jwks`.
      jwkss: jwks,
    },
  }),

  advanced: {
    // Own the cookie namespace instead of better-auth's default
    // `better-auth.*`. Cookies are keyed by HOST, not origin — the port is
    // ignored — so every better-auth app a developer runs on `localhost`
    // writes the SAME `better-auth.session_token` / `.access_token` pair
    // and they silently overwrite each other. That is what kept ending
    // sessions here mid-work: a neighbouring app's token arrives on our
    // request, its `kid` is unknown to our JWKS, verification fails, and
    // the client treats it as a dead login. Our own prefix keeps the two
    // jars apart.
    cookiePrefix: 'kuanadata',
    database: {
      // Let Postgres generate UUIDs via the column default.
      generateId: false,
    },
  },

  // The session IS the refresh credential, so its lifetime is
  // `REFRESH_TOKEN_TTL` — env-driven so the demo can enforce a short idle
  // timeout without forcing devs to re-login all day.
  //   • Local `.env`   REFRESH_TOKEN_TTL=7d
  //   • Demo (GH var)  REFRESH_TOKEN_TTL=7d, ACCESS_TOKEN_TTL=30m
  //
  // updateAge = half of expiresIn (min 60s) → sliding refresh every
  // half-lifetime of activity. In practice: a user actively clicking
  // around never gets kicked out mid-task; walking away for the full
  // lifetime does.
  session: (() => {
    const expiresIn = refreshTokenTtlSeconds();
    const updateAge = Math.max(60, Math.floor(expiresIn / 2));
    return { expiresIn, updateAge };
  })(),

  user: {
    additionalFields: {
      status: {
        type: 'string',
        required: false,
        defaultValue: 'active',
        input: false, // not writable from the API
      },
      defaultCooperativeId: {
        type: 'string',
        required: false,
        input: false,
      },
      lastLoginAt: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      const { subject, html, text } = renderResetPasswordEmail({
        userName: user.name,
        url,
      });
      await sendEmail({ to: user.email, subject, html, text });
    },
  },

  plugins: [
    // ── Access tokens ────────────────────────────────────────────────
    // The session cookie is the REFRESH credential (DB-backed, so it can
    // be revoked); this plugin mints the short-lived ACCESS token that
    // `requireAuth` verifies on every request. Signing keys live in
    // `iam.jwks` (migration 0008) so a deploy doesn't invalidate every
    // token in flight.
    //
    // `definePayload` is what makes stateless verification possible: the
    // permission set travels in the token, so a request costs a signature
    // check instead of a 4-table join. The cost is staleness — a
    // permission or status change only lands on the next mint — which is
    // what `lib/token-revocation.ts` closes by blacklisting the user
    // until their next refresh.
    jwt({
      jwt: {
        // Short enough that a revoked/downgraded user can only keep their
        // old scope for a while, long enough that the refresh round trip is
        // rare. `${n}s` rather than the raw env string so the plugin and the
        // cookie cannot disagree about what `8h` means — both read the same
        // parsed number.
        expirationTime: `${accessTokenTtlSeconds()}s`,
        definePayload: async ({ user }) => {
          const [row] = await db
            .select({
              status: users.status,
              deletedAt: users.deletedAt,
              isAllCooperative: users.isAllCooperative,
              name: users.name,
            })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);
          const codes = await resolvePermissionCodes(user.id);
          return {
            // `sub` is set by the plugin from `getSubject`; everything here
            // is a claim `requireAuth` reads instead of hitting the DB, so
            // it must cover every field a handler pulls off `c.get('user')`
            // — including `isAllCooperative`, which drives coop scoping.
            email: user.email,
            name: row?.name ?? user.name ?? null,
            status: row?.status ?? 'active',
            deleted: row?.deletedAt != null,
            isAllCooperative: row?.isAllCooperative ?? false,
            perms: codes,
          };
        },
      },
    }),
    magicLink({
      // Existing users only. Without this, better-auth's magic-link
      // plugin auto-creates a user row when the email isn't found —
      // meaning anyone typing an arbitrary address into the "Send
      // Magic Link" form silently ends up with a real account they
      // can sign in as. `disableSignUp: true` makes an unknown email
      // return an error to the client (surfaced by
      // `use-magic-link-form`) and skips the email send entirely, so
      // no accidental delivery either.
      //
      // `sendResetPassword` on the email/password provider ABOVE
      // already has this behavior baked in — better-auth only invokes
      // the callback when the user record exists. So the forgot-
      // password flow is naturally protected; only the magic-link
      // path needed this opt-out.
      disableSignUp: true,
      sendMagicLink: async ({ email, url }) => {
        const { subject, html, text } = renderMagicLinkEmail({ url });
        await sendEmail({ to: email, subject, html, text });
      },
    }),
  ],

  // Block sign-in for soft-deleted accounts. `before` runs when a new
  // session is about to be persisted (email + magic-link both create a
  // session), so throwing here stops the login BEFORE a cookie is issued
  // — the client's `signIn` call returns this error instead of a session.
  // require-auth.ts also rejects a deleted user on every request (defence
  // in depth for a session that was live when the account got deleted).
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const [row] = await db
            .select({ deletedAt: users.deletedAt })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
          if (row?.deletedAt) {
            // `code` surfaces on the client error so the FE can show a
            // localized "account deleted" message instead of the raw text.
            throw new APIError('FORBIDDEN', {
              code: 'ACCOUNT_DELETED',
              message: 'This account has been removed from the system.',
            });
          }
        },
      },
    },
  },

  // Trusted origins for better-auth CSRF + redirect checks. Mirrors the
  // CORS allowlist in `app.ts` — pulls from `FE_URL` (comma-separated
  // accepted) so every domain stays in `.env`, not hardcoded.
  // `app.ts` already validates FE_URL at boot, so by the time
  // `auth.ts` evaluates, FE_URL is guaranteed set.
  trustedOrigins: [
    ...(process.env.FE_URL ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Dev: trust any host on the FE dev port so phones / tablets on
    // the same LAN (e.g. `http://192.168.1.6:3130`) can hit the FE
    // proxy without tripping better-auth's CSRF check. `FE_PORT` is
    // env-driven — dev `.env` sets it, staging/prod don't (this
    // branch only triggers when NODE_ENV=development; staging
    // Droplets behave like production for security headers).
    ...(process.env.NODE_ENV === 'development' && process.env.FE_PORT
      ? [`http://*:${process.env.FE_PORT}`]
      : []),
  ],
});
