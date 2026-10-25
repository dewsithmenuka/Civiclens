# API v1

Interactive reference: **`GET /docs`** (Swagger UI) · machine-readable: `/docs-json`. Base path: `/api/v1`. Health is unprefixed.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | /auth/register | – | 5/min/IP. Always creates a `USER`. |
| POST | /auth/login | – | 10/min/IP. Constant-time-ish for unknown emails. |
| POST | /auth/refresh | – | Rotates; reuse of a spent token revokes the session family. |
| POST | /auth/logout | – | Revokes the session family. |
| GET | /auth/me | user | |
| GET | /auth/me/export | user | Downloads a no-store JSON export of account data and associated CivicLens records. |
| DELETE | /auth/me | user + re-authentication | Requires the current password or a fresh linked Google ID token; deletes reported issues and their images. |
| GET | /categories | – | |
| POST | /issues | user | 20/min. Send `clientRequestId` for safe retries. |
| GET | /issues | – | Filters: literal substring `q` (≤ 100 chars), `category`, `status`; `limit` ≤ 50, `offset`. |
| GET | /issues/nearby | – | `lat,lng,radius` (10–20000 m), optional `category`. Distance-ordered. |
| GET | /issues/map | – | `minLng,minLat,maxLng,maxLat`; max 2° per side; ≤ 500 results. |
| GET | /issues/:id | – | Includes lifecycle `timeline`. Exact location only for reporter/moderators. |
| GET | /issues/:id/follow | user | Returns whether the current user follows the report. |
| PATCH | /issues/:id/status | moderator/admin | Validated against the lifecycle state machine. |
| POST | /issues/:id/confirm | user | Not your own; once per user; not on closed issues. |
| POST/DELETE | /issues/:id/follow | user | Idempotent. |

## Admin and moderation
All `/admin/*` routes require an active moderator or admin. Account administration and the global audit log require an admin. Staff role and account status are rechecked on every request.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /admin/issues | moderator/admin | Filter by `status`, `category`, `search`, exact `reportId`, inclusive `createdFrom`/`createdTo` dates, and `latitude` + `longitude` + `radiusM` (1–50,000 m). `limit` ≤ 50; `offset` is supported. |
| GET | /admin/issues/:id | moderator/admin | Exact location, images, status timeline, assignment, duplicate context, and the latest 100 issue audit events. |
| GET | /admin/assignees | moderator/admin | Lists active moderators/admins eligible for assignment. |
| PATCH | /admin/issues/:id/assignee | moderator/admin | `{ "assigneeId": "<staff UUID>" }`; send `null` to unassign. Assignment changes are audited. |
| PATCH | /admin/issues/:id/status | moderator/admin | Applies only permitted lifecycle transitions; duplicate merge requires an eligible original report. |
| PATCH | /admin/issues/:id | moderator/admin | Corrects the report category; change is audited. |
| GET | /admin/stats, /admin/heatmap, /admin/insights | moderator/admin | Trends, category counts, resolution metrics, workload insights, and geographic cells. |
| GET | /admin/audit | admin | Filter by `entityType`, `action`, and exact `entityId`; paginated. |
| GET/PATCH | /admin/users, /admin/users/:id | admin | Paginated account search and role/status updates. |

Errors use Nest's standard shape: `{ statusCode, message, error }`. Validation is whitelist-only (unknown fields → 400).

Uploaded JPEG, PNG, and WebP images are decoded and re-encoded before they are attached to a report. This strips EXIF and other source metadata; recorded dimensions are taken from the sanitized image rather than the client payload.

## Lifecycle
```
REPORTED → UNDER_REVIEW → ACKNOWLEDGED → IN_PROGRESS → RESOLVED
REPORTED | UNDER_REVIEW → DUPLICATE | REJECTED   (terminal)
```

## Realtime (`/live`)
Client → server: `viewport.subscribe { bbox: { minLng, minLat, maxLng, maxLat } }` → ack `{ ok, tiles }`.
Server → client: `issue.created`, `issue.updated`, `issue.status_changed`, `issue.confirmed`, `issue.resolved` (payload = public `IssueView`).
