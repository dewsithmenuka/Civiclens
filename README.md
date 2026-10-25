# CivicLens

**Real-time community infrastructure intelligence.**
*See what's happening. Make it visible.*

Report, verify and track local problems — potholes, broken streetlights, water leaks, illegal dumping, damaged signals and **blocked accessibility ramps** — on a live map, with a moderation dashboard behind it.

Built as a systems-engineering project: PostGIS spatial queries, viewport-scoped realtime that scales across servers, offline-safe idempotent reporting, a state-machine lifecycle, privacy-preserving public locations, and a security-first admin dashboard.

## What makes it different

| Decision | Why it matters |
|---|---|
| **Viewport-scoped realtime over Redis** | Phones subscribe to the map tiles they can see. A report filed on server B appears live on a phone connected to server A. |
| **Idempotent offline queue** | Reports are saved on the device and retried with exponential backoff and jitter. A device-generated ID means retries can never create duplicates. |
| **Privacy by design** | Public pins are snapped to ~55 m; reporter identity never appears in public payloads. |
| **Lifecycle as a state machine** | One shared table decides legal moves (`REPORTED → … → RESOLVED`); the API enforces it and the dashboard only offers legal buttons. |
| **Real duplicate merging** | Nearby same-category reports are *flagged*, never auto-deleted. A moderator merges them: followers and confirmations move to the original. |
| **Tokens never reach browser JavaScript** | The dashboard keeps tokens in httpOnly cookies behind a backend-for-frontend, with CSRF checks, a per-request CSP nonce, and refresh-token reuse detection. |
| **Immediate lockout** | Suspending or demoting staff takes effect on their next request, not when a token expires. |
| **Accessibility measured, not assumed** | WCAG contrast is unit-tested; the heatmap has a table equivalent; the app labels every pin with its status. |

## Architecture

```mermaid
flowchart LR
  M[Flutter app<br/>offline queue · live map] -->|REST + Socket.IO| API
  D[Next.js dashboard<br/>BFF · httpOnly cookies] -->|REST| API
  subgraph API[NestJS API]
    G[Guards: throttle → JWT → roles] --> C[Controllers] --> S[Services / domain] --> R[Repositories]
    S --> GW[Realtime gateway<br/>tile rooms]
  end
  R --> PG[(PostgreSQL + PostGIS)]
  GW <--> RD[(Redis pub/sub)]
  API --> OS[(S3-compatible storage)]
  API -. push .-> FCM[Firebase]
```

## Monorepo

```
backend/            NestJS API
admin/              Next.js moderation dashboard
mobile/             Flutter app
packages/contracts/ Shared enums, lifecycle table, wire types
infrastructure/     Dockerfiles
docs/               Architecture, API, DB, security, deployment, ADRs
```

## Features

**Citizens (mobile):** live map with status-coded pins · report with photos at your GPS position, a searched place, or any map point · offline queue with retry, progress and an offline banner · confirm, follow, notification inbox · email verification, password reset, Google sign-in · place search · screen-reader labels and large-text support.

**Moderators and admins (dashboard):** filterable queue · report detail with exact location, timeline, photos and a duplicate-comparison map · lifecycle actions · duplicate merging · category correction · statistics · analytics (heatmap, hotspots, backlog age, time-to-fix) · user management and an append-only audit log (admins).

## Quick start

```bash
cp .env.example .env && cp admin/.env.example admin/.env.local
npm install
npm run infra:up                       # PostGIS + Redis
export DATABASE_URL=postgres://civiclens:civiclens@localhost:5433/civiclens
npm run db:migrate
npm run dev:api                        # http://localhost:3000  (Swagger: /docs)
npm run dev:admin                      # http://localhost:3001
```

Make the first admin (there is deliberately no default account):

```bash
docker exec -it civiclens-postgres psql -U civiclens -d civiclens \
  -c "UPDATE users SET role='ADMIN' WHERE lower(email)=lower('you@example.com');"
```

Mobile: `cd mobile && flutter run --dart-define=API_BASE=http://localhost:3000 --dart-define=GEOCODER_CONTACT=you@example.com`

The API process reads its own environment; when running it directly, set
`REDIS_URL=redis://localhost:6379` if you need shared Redis rate limiting. The
root `.env.example` configures Docker Compose service addresses, while
`admin/.env.example` documents dashboard process settings.

## Testing

`npm test` (backend + admin unit suites) · `npm run test:e2e` (API against PostgreSQL/PostGIS) · `npm run test:e2e -w @civiclens/admin` (dashboard over real HTTP) · `cd mobile && flutter analyze && flutter test`.
`npm run db:migrate` applies ordered migrations; CI checks a clean migration and a second idempotent run.
The suites cover auth and token security, lifecycle rules, PostGIS queries, uploads, notifications, Redis scaling, Google sign-in account-linking defences, the admin API, heatmap SQL, rate limiting behind a proxy, and the dashboard's CSRF / cookie / redirect / session behaviour.

## Status — what is and isn't proven

| Area | State |
|---|---|
| API, database, realtime, admin API | Covered by automated tests against real PostgreSQL/PostGIS and Redis |
| Dashboard server behaviour | Covered by unit tests and an end-to-end suite over real HTTP |
| Flutter app | Analyze, widget/unit tests, and web production build run in CI |
| Not yet exercised | Real S3/R2 uploads, real email delivery, real push delivery (needs Firebase + a device), Android, the Docker images in CI |

## Roadmap

| Release | Scope |
|---|---|
| v0.1 – v0.5 ✅ | API, mobile app, accounts, notifications, Redis scaling, Google sign-in, admin dashboard, analytics, offline queue, accessibility |
| **v1.0** | Hardening (rate limits behind proxies ✅), Sign in with Apple, account deletion/export, deployment guide, demo |

## Docs
[Architecture](docs/architecture.md) · [API](docs/api.md) · [Database](docs/database.md) · [Security](docs/security.md) · [Deployment](docs/deployment.md) · [Decisions](docs/decisions/)

MIT licensed. Security issues: see [SECURITY.md](SECURITY.md).