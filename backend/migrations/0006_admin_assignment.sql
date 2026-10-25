ALTER TABLE issues
  ADD COLUMN assigned_moderator_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX issues_assignee_status_created_idx
  ON issues (assigned_moderator_id, status, created_at DESC);

CREATE INDEX issues_created_at_idx
  ON issues (created_at DESC);
