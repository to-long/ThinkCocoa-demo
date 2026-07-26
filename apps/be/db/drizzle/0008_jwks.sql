-- JWKS keypair store for the better-auth `jwt` plugin.
--
-- The plugin signs access tokens with an asymmetric key (EdDSA by
-- default) and publishes the public half at `/api/auth/jwks`. Keys must
-- outlive a process restart — an in-memory key would invalidate every
-- issued token on each deploy — so they live here. The private half is
-- encrypted by better-auth using BETTER_AUTH_SECRET before insert.
--
-- Created lazily on the first token mint, so this table is normally
-- empty until the first login after deploy.
CREATE TABLE IF NOT EXISTS iam.jwks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key text NOT NULL,
  private_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
