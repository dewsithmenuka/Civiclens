-- Push delivery targets. A token belongs to exactly one user at a time (a phone that switches accounts moves).
CREATE TABLE device_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        text NOT NULL UNIQUE,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_tokens_user_idx ON device_tokens (user_id);

-- In-app notification inbox. Rows with a dedupe_key are *aggregated* while unread
-- ("5 people confirmed …") instead of creating one row (and one push) per event.
CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issue_id       uuid REFERENCES issues(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('STATUS_CHANGED', 'CONFIRMED')),
  title          text NOT NULL,
  body           text NOT NULL,
  count          integer NOT NULL DEFAULT 1,
  dedupe_key     text,
  read_at        timestamptz,
  last_pushed_at timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, updated_at DESC);
-- At most one *unread* aggregate per (user, key): this is what makes concurrent events collapse safely.
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (user_id, dedupe_key)
  WHERE read_at IS NULL AND dedupe_key IS NOT NULL;