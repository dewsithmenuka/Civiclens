-- Links a CivicLens user to an external identity (Google). One external account maps to exactly one user.
CREATE TABLE oauth_identities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider         text NOT NULL CHECK (provider IN ('google')),
  provider_user_id text NOT NULL,          -- Google's stable "sub" claim (never the email, which can change)
  email            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX oauth_identities_user_idx ON oauth_identities (user_id);