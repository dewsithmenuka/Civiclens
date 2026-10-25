CREATE TABLE issue_images (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id     uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  uploader_id  uuid NOT NULL REFERENCES users(id),
  storage_key  text NOT NULL UNIQUE,
  mime_type    text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes   integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  width        integer NOT NULL CHECK (width BETWEEN 1 AND 10000),
  height       integer NOT NULL CHECK (height BETWEEN 1 AND 10000),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX issue_images_issue_idx
ON issue_images (issue_id, created_at);