-- Durable half of the access-token blacklist.
--
-- Access tokens are verified from their signed claims, so a permission /
-- status change is enforced by remembering "every token issued to this user
-- before <instant> is stale". That memory lived only in an LRU cache, which
-- means a restart or a power cut forgot it while the tokens themselves
-- stayed valid — a revoked user could keep their old scope for the rest of
-- the token lifetime.
--
-- The cache is still the read path (no per-request query); this table is
-- what survives a restart. `expires_at` is `revoked_at + ACCESS_TOKEN_TTL`:
-- past it, no token the row could reject is still valid, so the row is
-- garbage. Rows are deleted when the cache entry leaves the cache
-- (TTL expiry, eviction, explicit clear) and, as a backstop, any expired
-- leftovers are swept on boot.
CREATE TABLE IF NOT EXISTS iam.token_revocations (
  user_id uuid PRIMARY KEY REFERENCES iam.users (id) ON DELETE CASCADE,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

-- Boot hydration reads only the live rows.
CREATE INDEX IF NOT EXISTS token_revocations_expires_at_idx
  ON iam.token_revocations (expires_at);
