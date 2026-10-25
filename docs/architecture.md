# Architecture

## Request path
`Client → [ThrottlerGuard → JwtAuthGuard → RolesGuard] → Controller → Service → Repository → PostgreSQL/PostGIS`

- **Controllers** do transport only (DTO validation, status codes, Swagger metadata).
- **Services** own business rules: lifecycle legality, duplicate signalling, confirmation rules, privacy projection.
- **Domain modules** (`issues/domain/*`) are pure functions with unit tests and no framework imports.
- **Repositories** hold all SQL. PostGIS queries are written explicitly (see [database.md](database.md)).

## Realtime
PostgreSQL is the source of truth; Socket.IO is delivery only.
1. Client connects to `/live` and sends `viewport.subscribe` with its map bounding box.
2. Server maps the bbox to z14 slippy-map tiles (≤ 64) and joins the socket to those rooms.
3. When an issue is created/changed, the service publishes the **public (approximate)** view to the room of the tile containing it.
4. Multi-instance: swap in the Socket.IO Redis adapter (v0.3). Call sites do not change.

## Offline-first (mobile contract)
The device creates a UUID `clientRequestId` when the user taps *Report*, queues the request locally and retries with
exponential backoff. The server treats `(reporter, clientRequestId)` as an idempotency key, so retries are safe.
States: `Pending → Uploading → Submitted | Failed`.

## Shared contracts
`packages/contracts` is the single source for enums, event names and wire types, consumed by the API and (v0.4) the admin app.
The Flutter app mirrors them in Dart; a CI check to diff them is planned.
