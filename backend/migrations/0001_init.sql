CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────── identity ─────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  display_name  text NOT NULL,
  role          text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER','MODERATOR','ADMIN')),
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  email_verified_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,            -- one login session = one family; reuse of a rotated token revokes the family
  token_hash  text NOT NULL UNIQUE,     -- SHA-256 of the opaque token; the raw token is never stored
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ───────── civic domain ─────────
CREATE TABLE issue_categories (
  code        text PRIMARY KEY,
  label       text NOT NULL,
  description text NOT NULL
);
INSERT INTO issue_categories (code, label, description) VALUES
  ('ROADS',         'Roads',          'Potholes, road damage, obstructions'),
  ('LIGHTING',      'Public lighting','Broken or damaged streetlights'),
  ('WATER',         'Water',          'Leaks and drainage issues'),
  ('WASTE',         'Waste',          'Illegal dumping and overflowing bins'),
  ('TRAFFIC',       'Traffic',        'Signal and sign damage'),
  ('ACCESSIBILITY', 'Accessibility',  'Blocked ramps and accessibility obstacles');

CREATE TABLE issues (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id           uuid NOT NULL REFERENCES users(id),
  category              text NOT NULL REFERENCES issue_categories(code),
  title                 text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 120),
  description           text CHECK (char_length(description) <= 2000),
  status                text NOT NULL DEFAULT 'REPORTED'
                        CHECK (status IN ('REPORTED','UNDER_REVIEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DUPLICATE','REJECTED')),
  location              geography(Point, 4326) NOT NULL,
  client_request_id     uuid,                       -- idempotency key from the offline queue
  possible_duplicate_of uuid REFERENCES issues(id), -- a signal for moderators, never an auto-delete
  confirmation_count    integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  resolved_at           timestamptz,
  UNIQUE (reporter_id, client_request_id)
);
CREATE INDEX issues_location_gix ON issues USING GIST (location);
CREATE INDEX issues_status_idx   ON issues (status);
CREATE INDEX issues_cat_created_idx ON issues (category, created_at DESC);

CREATE TABLE issue_status_history (
  id          bigserial PRIMARY KEY,
  issue_id    uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_id    uuid REFERENCES users(id),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX issue_status_history_issue_idx ON issue_status_history (issue_id, created_at);

CREATE TABLE issue_confirmations (
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);

CREATE TABLE issue_followers (
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issue_id, user_id)
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
