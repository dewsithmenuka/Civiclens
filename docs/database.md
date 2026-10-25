# Database

PostgreSQL 16 + PostGIS 3.4. Schema lives in `backend/migrations/*.sql`, applied once each, in order, inside a transaction
(`npm run db:migrate`). `schema_migrations` tracks what has run. CI builds a clean database from zero on every PR, then
runs the migration command a second time to verify idempotence. PostgreSQL advisory locking prevents concurrent API
replicas from applying the same migration at once.

Never edit an applied migration. For a schema change:

1. Add the next zero-padded SQL file and keep the change transactional and safe to retry.
2. Test from an empty PostGIS database with `npm run db:migrate`, then rerun it.
3. Test upgrade from the previous released schema using a disposable restored copy.
4. Deploy the migration before code that requires it. Prefer expand/contract changes so old and new app versions can
   coexist during a rolling deploy.
5. API containers run `node dist/database/migrate.js` before starting; monitor startup and readiness before routing traffic.

Use a dedicated migration database role for schema changes. Where practical, grant the runtime API role only the DML
permissions it needs.

## Key spatial decisions
- `issues.location` is `geography(Point, 4326)` — distances are in metres, no projection maths in application code.
- GiST index `issues_location_gix` serves `ST_DWithin` (nearby, duplicate detection), `&&` (viewport) and `<->` (nearest-first).
- **Viewport:** `location && ST_MakeEnvelope(minLng,minLat,maxLng,maxLat,4326)::geography`, hard `LIMIT 500`, bbox ≤ 2° per side.
- **Nearby:** `ST_DWithin(location, point, radius)` ordered by `<->`.
- **Public coordinates:** `ST_SnapToGrid(location::geometry, 0.0005)` at query time; exact coordinates never leave the DB for public callers.

## Tables (v0.1)
`users`, `refresh_tokens` (hashed, family-based rotation), `auth_tokens`, `oauth_identities`,
`issue_categories` (seeded), `issues`, `issue_status_history`, `issue_confirmations`,
`issue_followers`, `issue_images`, `device_tokens`, `notifications`, `audit_logs`.

Account export (`GET /api/v1/auth/me/export`) returns a consistent JSON snapshot of the user's
account, exact coordinates and history for their reports, image metadata and URLs, confirmations,
follows, device tokens, notifications, linked identities, and audit activity. Account deletion
(`DELETE /api/v1/auth/me`)
requires the current password or a fresh ID token for a linked Google identity. It removes the
account, its reported issues and all associated images, and images uploaded to other reports. Civic
history on other users' reports is retained with the deleted user's actor reference cleared;
duplicate links to deleted reports are cleared. Object-storage deletion must succeed before the
database erasure is committed.

## Integrity rules enforced in the database
CHECK constraints on role/status/title length; composite PKs prevent double confirmations/follows;
`UNIQUE (reporter_id, client_request_id)` is the idempotency guarantee.

## Topology and rate limiting
Put one reverse proxy (Caddy, nginx, Cloudflare) in front of the API and the dashboard. It must **overwrite** `X-Forwarded-For`
with the real client IP. Keep the API reachable only through that proxy (or the dashboard) and set `TRUST_PROXY=1`;
the API then rate-limits each visitor separately. If the API is directly reachable, leave `TRUST_PROXY` empty —
otherwise anyone can forge the header to dodge the limits.