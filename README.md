# CivicLens

<p align="center">
  <strong>Real-time community infrastructure intelligence.</strong><br />
  See what's happening. Make it visible.
</p>

<p align="center">
  <a href="https://github.com/dewsithmenuka/Civiclens/actions/workflows/ci.yml">
    <img src="https://github.com/dewsithmenuka/Civiclens/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" />
  </a>
  <img src="https://img.shields.io/badge/Flutter-Mobile-blue?logo=flutter" alt="Flutter" />
  <img src="https://img.shields.io/badge/NestJS-Backend-e0234e?logo=nestjs" alt="NestJS" />
  <img src="https://img.shields.io/badge/PostgreSQL-PostGIS-336791?logo=postgresql" alt="PostgreSQL and PostGIS" />
  <img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License" />
</p>

CivicLens is a community issue reporting and infrastructure monitoring platform that helps people report, verify, and track local problems through a map-based mobile application. It supports issues such as potholes, damaged streetlights, water leaks, illegal dumping, damaged traffic signals, and blocked accessibility ramps.

The platform combines a Flutter mobile application, a NestJS REST API, a geospatial PostgreSQL database, Redis-powered real-time communication, and a Next.js moderation dashboard.

CivicLens is designed around reliable reporting, location privacy, transparent issue lifecycles, and secure administration.

## Table of Contents

- [Key Features](#key-features)
- [Engineering Highlights](#engineering-highlights)
- [System Architecture](#system-architecture)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Configuration](#configuration)
- [Running the Applications](#running-the-applications)
- [Database and Migrations](#database-and-migrations)
- [Testing and Quality Assurance](#testing-and-quality-assurance)
- [Security and Privacy](#security-and-privacy)
- [Project Status](#project-status)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Key Features

### Mobile Application

- **Interactive issue map** — discover community reports using status-coded map markers.
- **Issue reporting** — submit reports with descriptions, categories, photographs, and locations selected using GPS, place search, or the map.
- **Offline-aware reporting** — queue reports locally and retry failed submissions with exponential backoff and jitter.
- **Issue engagement** — follow reports, confirm existing issues, and receive notifications.
- **Account authentication** — email verification, password reset, and Google sign-in.
- **Accessible interface** — screen-reader labels, large-text support, and clear issue status indicators.

### Moderation Dashboard

- **Report management** — filter reports, inspect details, review photographs, and examine issue histories.
- **Controlled status transitions** — perform only the lifecycle actions permitted for each report.
- **Duplicate management** — compare similar reports and merge confirmed duplicates while preserving relevant engagement data.
- **Analytics** — inspect issue hotspots, geographic heatmaps, backlog age, and time-to-resolution metrics.
- **User and staff management** — manage accounts and administrative roles.
- **Auditability** — maintain an append-only audit trail for administrative actions.

### Backend Platform

- Geospatial queries powered by PostgreSQL and PostGIS.
- Redis-backed, viewport-scoped real-time updates designed to work across multiple API instances.
- Authentication and session security, including refresh-token protections.
- Report lifecycle validation and duplicate detection.
- Rate limiting, image handling, notifications, and administrative APIs.
- Shared contracts for consistent lifecycle rules and data types across applications.

## Engineering Highlights

CivicLens emphasizes architectural decisions that address practical production engineering challenges.

| Engineering decision | Benefit |
|---|---|
| **PostGIS geospatial queries** | Supports location-aware report discovery and map-based queries. |
| **Redis-backed real-time updates** | Allows API instances to coordinate map updates across server boundaries. |
| **Idempotent offline reporting** | Helps prevent duplicate reports when queued submissions are retried. |
| **Explicit lifecycle state machine** | Centralizes valid report transitions and keeps API and dashboard behavior consistent. |
| **Privacy-aware public locations** | Public map locations are approximated to protect precise reporter locations. |
| **Manual duplicate merging** | Gives moderators control over duplicate resolution instead of automatically deleting reports. |
| **Secure dashboard sessions** | Uses HTTP-only cookies, CSRF protections, content security policies, and refresh-token reuse detection. |
| **Immediate staff authorization checks** | Ensures staff role or suspension changes are enforced on subsequent requests. |
| **Accessibility-conscious design** | Includes accessible status labels, contrast tests, and a tabular alternative for heatmap information. |

## System Architecture

```mermaid
flowchart TD
    Citizen["Citizen"] --> Mobile["Flutter Mobile App"]
    Staff["Moderator / Admin"] --> Dashboard["Next.js Admin Dashboard"]

    Mobile --> API["NestJS REST API"]
    Dashboard --> BFF["Dashboard Backend-for-Frontend"]
    BFF --> API

    API --> DB[("PostgreSQL + PostGIS")]
    API <--> Redis[("Redis")]
    API --> Storage["Image Storage"]
    API --> External["External Services"]

    Redis --> API
```

The mobile application communicates with the backend API. The administrative dashboard uses a backend-for-frontend layer to manage authenticated dashboard requests. PostgreSQL/PostGIS stores application and spatial data, while Redis supports shared real-time coordination and related backend services.

Image storage and external integrations depend on the environment configuration.

## Technology Stack

| Area | Technologies |
|---|---|
| Mobile | Flutter, Dart |
| Backend | NestJS, Node.js, TypeScript |
| API | REST, Swagger/OpenAPI |
| Database | PostgreSQL 16, PostGIS |
| Real-time and coordination | Redis, WebSockets |
| Admin dashboard | Next.js, React, TypeScript |
| Shared contracts | TypeScript |
| Infrastructure | Docker, Docker Compose |
| Testing | Jest, end-to-end tests, Flutter tests and analysis |
| CI | GitHub Actions |

## Repository Structure

```text
Civiclens/
├── backend/              # NestJS API and backend tests
├── admin/                # Next.js moderation dashboard
├── mobile/               # Flutter mobile application
├── packages/
│   └── contracts/        # Shared types, enums and lifecycle rules
├── infrastructure/       # Dockerfiles and infrastructure assets
├── docs/                 # Architecture, API, database and security docs
├── docker-compose.yml
├── package.json
└── README.md
```

## Getting Started

### Prerequisites

Install the following tools before starting development:

- Git
- Node.js and npm versions compatible with the project
- Docker and Docker Compose
- Flutter SDK
- PostgreSQL/PostGIS and Redis through the provided Docker configuration, or compatible existing services

Check your local installations:

```bash
git --version
node --version
npm --version
docker --version
flutter --version
```

### 1. Clone the repository

```bash
git clone https://github.com/dewsithmenuka/Civiclens.git
cd Civiclens
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create the root and admin environment files:

```bash
cp .env.example .env
cp admin/.env.example admin/.env.local
```

Review both files and replace example values with appropriate local settings. Configure secrets and any external service credentials required by the features you intend to run.

**Never commit real credentials, production secrets, private keys, or populated environment files.**

### 4. Start infrastructure services

```bash
npm run infra:up
```

This starts the database and Redis services defined by the project's Docker Compose configuration.

Ensure the PostgreSQL connection settings match the configuration used by your local API process. For the default local database configuration documented by this project:

```bash
export DATABASE_URL="postgres://civiclens:civiclens@localhost:5433/civiclens"
export REDIS_URL="redis://localhost:6379"
```

These commands apply to a local development shell. Adjust the host, port, credentials, and database name if your configuration differs.

### 5. Apply database migrations

```bash
npm run db:migrate
```

### 6. Start the backend API

In a terminal from the repository root:

```bash
npm run dev:api
```

The API is configured to run at:

- API base URL: `http://localhost:3000`
- Swagger documentation: `http://localhost:3000/docs`

### 7. Start the admin dashboard

In a separate terminal:

```bash
npm run dev:admin
```

The dashboard is configured to run at `http://localhost:3001`.

### 8. Run the mobile application

Ensure the backend is reachable from your mobile development environment, then run:

```bash
cd mobile
flutter pub get
flutter run \
  --dart-define=API_BASE=http://localhost:3000 \
  --dart-define=GEOCODER_CONTACT=your-email@example.com
```

Replace the geocoder contact placeholder with an appropriate contact address.

**Device networking note:** `localhost` works when the mobile app and API share the same host network context. For a physical device or some emulator configurations, use the development machine's reachable LAN address or the appropriate emulator host address instead.

### Creating the first administrator

CivicLens deliberately does not provide a default administrator account. After registering an account in your local development environment, promote that account using a trusted administrative database connection:

```sql
UPDATE users
SET role = 'ADMIN'
WHERE lower(email) = lower('your-email@example.com');
```

For the Docker database configuration shown above, the command can be run with:

```bash
docker exec -it civiclens-postgres \
  psql -U civiclens -d civiclens
```

Run the SQL statement in the resulting PostgreSQL prompt. Confirm the container and database names against your Compose configuration first. This is a **local development bootstrap procedure**, not a recommended production role-management workflow.

## Configuration

CivicLens uses separate environment configuration for its backend infrastructure and admin dashboard.

| Configuration | Purpose |
|---|---|
| Root `.env` | Docker Compose and root-level environment settings |
| `admin/.env.local` | Admin dashboard server settings |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string for the API process |
| `API_BASE` | Mobile application API endpoint, supplied through a Dart define |
| `GEOCODER_CONTACT` | Contact identifier used by the geocoding integration |

Refer to `.env.example`, `admin/.env.example`, and the deployment documentation for the complete set of supported variables.

Google sign-in, email delivery, push notifications, and object-storage uploads may require additional provider-specific configuration. Do not assume these integrations are operational until they have been configured and tested in the target environment.

## Database and Migrations

Database schema changes are managed through ordered migrations.

Apply pending migrations with:

```bash
npm run db:migrate
```

The project's CI workflow also checks migration behavior, including running migrations against a clean database and verifying that a subsequent run is idempotent.

For schema and spatial-data design details, see the [Database Documentation](docs/database.md).

## Testing and Quality Assurance

Run the relevant test suites from the repository root.

### Backend and dashboard unit tests

```bash
npm test
```

### Backend end-to-end tests

```bash
npm run test:e2e
```

### Dashboard end-to-end tests

```bash
npm run test:e2e -w @civiclens/admin
```

### Flutter analysis and tests

```bash
cd mobile
flutter analyze
flutter test
```

The test coverage described by the project includes authentication and session security, report lifecycle rules, geospatial queries, image handling, notifications, Redis coordination, Google sign-in protections, administrative APIs, analytics queries, rate limiting, and dashboard session and request protections.

Run the tests locally and review the GitHub Actions results for the current commit before treating any build or integration as verified.

## Security and Privacy

Security and privacy are core design considerations in CivicLens.

- Public report payloads are designed not to expose reporter identity.
- Public map locations are approximated rather than exposing the exact reporter coordinates.
- Dashboard authentication uses HTTP-only cookies and request protections.
- API access and report lifecycle transitions are validated server-side.
- Administrative activity is recorded in an audit log.
- Account data export and deletion workflows are part of the account privacy functionality.

Actual behavior depends on the deployed version and environment. Review the [Security Documentation](docs/security.md) and [Security Policy](SECURITY.md) before deploying or reporting a vulnerability.

**For production deployments:** use strong unique secrets, enforce HTTPS, restrict database and Redis access, configure trusted proxy and CORS settings correctly, secure image storage, and verify external identity, email, and push-notification providers. Never use the sample development credentials in production.

## Project Status

CivicLens is a full-stack portfolio project with a Flutter client, NestJS backend, geospatial data layer, real-time infrastructure, and administrative dashboard.

The repository includes automated tests and CI workflows. However, a successful test suite does not automatically verify every third-party integration or deployment configuration.

The following items should be verified against the current branch and target environment before a production release:

- End-to-end image uploads against the intended object-storage provider.
- Actual email delivery and password/account verification flows.
- Push notification delivery on a configured device.
- Android build and installation.
- Docker image builds and deployment configuration.
- Production environment secrets, database migrations, networking, and external service configuration.

These are environment-dependent verification items, not a claim that every item is necessarily incomplete. Consult the current CI workflow and deployment results for the latest verified status.

## Documentation

- [Architecture](docs/architecture.md) — system components and architectural overview.
- [API Documentation](docs/api.md) — API endpoints and request/response contracts.
- [Database Documentation](docs/database.md) — schema and spatial data.
- [Security Documentation](docs/security.md) — security controls and considerations.
- [Deployment Guide](docs/deployment.md) — environment and deployment configuration.
- [Architecture Decision Records](docs/decisions/) — key design decisions.
- [Contributing Guidelines](CONTRIBUTING.md) — development and contribution workflow.
- [Security Policy](SECURITY.md) — reporting security vulnerabilities.

## Contributing

Contributions, bug reports, and constructive feedback are welcome.

1. Review the existing documentation and repository conventions.
2. Create a focused branch for your change.
3. Make the change and add or update relevant tests.
4. Run the applicable checks locally.
5. Open a pull request describing the change, its motivation, and how it was tested.

Please avoid committing secrets, personal data, generated build artifacts, or unrelated changes.

## License

CivicLens is released under the [MIT License](LICENSE).

---

**Built to explore reliable, privacy-conscious, and geospatially aware community reporting.**
