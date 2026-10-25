# Deployment

**Local:** `docker compose up --build` (PostGIS, Redis, API). Migrations run on container start.

**Environments:** `development`, `staging`, `production` — separate databases and secrets; no shared credentials.
Use the root [`.env.example`](../.env.example) as the canonical variable list. It contains development-only placeholders,
not production secrets. Production requires `DATABASE_URL`, `JWT_SECRET` (≥ 32 random chars), `REDIS_URL`, and explicit
`CORS_ORIGINS`; the API rejects a missing/weak JWT secret or missing Redis. Set `TRUST_PROXY` only to the exact trusted
proxy hop count, and ensure the edge proxy overwrites forwarded-IP headers.

Object storage variables (`STORAGE_BUCKET`, access key, secret, and optional endpoint/region/public base URL) enable image
uploads. Configure Firebase and Google sign-in only when their credentials are provisioned. Email verification requires
`SMTP_URL` when `REQUIRE_VERIFIED_EMAIL=true`.

The admin process reads `API_URL`, `APP_ORIGIN`, and `COOKIE_SECURE`. Set its public origin and secure cookies behind HTTPS
in production. Flutter release builds require `API_BASE` and `PRIVACY_POLICY_URL` build defines, both HTTPS.

**Suggested hosting (low cost):** API on Fly.io / Railway / Render, managed Postgres with PostGIS (Neon, Supabase, RDS),
Upstash Redis, Cloudflare R2 for images.

## Render demo deployment

The root [`render.yaml`](../render.yaml) describes the API and admin Docker services. It intentionally does not create
or manage a database, Redis instance, or object-storage bucket. Provision Supabase with PostGIS enabled, Upstash Redis,
and an R2 bucket separately; add their credentials through Render's dashboard, never to the blueprint or repository.
The blueprint uses free web-service instances for a low-cost demo; they can sleep when idle and should be upgraded for
production availability.

Use a Supabase direct or session-pooler PostgreSQL URL with SSL enabled (`sslmode=require`); do not use transaction
pooling because migrations hold a PostgreSQL session advisory lock. Enter the Upstash Redis TLS URL as `REDIS_URL`.
Render's generated `JWT_SECRET` is managed as a secret. Set `TRUST_PROXY` to the verified number of trusted proxy hops.

After Render assigns both service URLs, set the API's `APP_BASE_URL` to its public HTTPS URL and `CORS_ORIGINS` to the
exact admin and any hosted mobile-web origins. Set the admin's `APP_ORIGIN` to its public HTTPS URL and `API_URL` to the
API's private Render service URL (same region, for example `http://civiclens-api:10000`). Configure R2 using the
`STORAGE_BUCKET`, `STORAGE_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, and
`STORAGE_PUBLIC_BASE_URL` variables; use a public CDN URL only for objects intended to be public.

The API container applies ordered migrations before starting. Check `/health/live` and `/health/ready` after deployment;
readiness must show PostgreSQL/PostGIS and Redis as up. Create the first administrator through the documented secure
operator process only after email verification and account access have been confirmed. Never promote a default or shared
account.

For a mobile release, use the deployed API and public privacy-policy HTTPS URLs, not the CI placeholder or a local URL:

```sh
cd mobile
flutter build appbundle \
  --dart-define=API_BASE=https://YOUR_API_HOST \
  --dart-define=PRIVACY_POLICY_URL=https://YOUR_PUBLIC_PRIVACY_POLICY_URL
```

The app and `mobile/tool/verify_release_config.dart` reject non-HTTPS, local, private-network, and reserved example
hosts. The tag-triggered GitHub release workflow requires the repository variables `MOBILE_API_BASE` (the API origin,
without `/api/v1`) and `PRIVACY_POLICY_URL` (a published, reviewed policy URL), plus these Actions secrets:
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`. It validates
the URLs, builds a signed Android App Bundle, and attaches it to the GitHub release. Generate and back up the upload
keystore securely, encode it for the secret, and never commit the keystore or its passwords. iOS distribution still
requires separate Apple signing and provisioning.

The repository does not contain a published privacy-policy page or product screenshots yet. Before a public app
release, publish a policy at the configured URL and capture genuine screenshots from the hosted app with demo data;
do not use the reserved CI URLs or real user information.

**Release:** tag `vX.Y.Z` → `release.yml` creates a GitHub release with generated notes. Configure Android keystore
credentials and iOS signing/provisioning outside source control before distributing signed packages.

Health probes: liveness `/health/live`, readiness `/health/ready`. Readiness reports PostgreSQL/PostGIS, Redis, and
configured object-storage reachability; alert on failed readiness, repeated 5xx responses, and structured `http_request`
logs with elevated error levels. Logs include request IDs and authenticated user IDs, never credentials or request bodies.
Use `/health/live` only for process liveness and `/health/ready` for traffic readiness.

## Backups and recovery

Use encrypted managed PostgreSQL backups with point-in-time recovery (PITR), and enable object versioning or equivalent
recovery for the image bucket. Store backups in a separate account or region from the primary service. Never store backup
credentials or plaintext database dumps in the repository or CI artifacts.

Recommended initial objectives are **RPO ≤ 15 minutes** and **RTO ≤ 4 hours**, with at least **35 days** of database PITR
retention. Confirm these targets with the chosen provider and product requirements before launch. Keep object-version
retention at least as long as the database recovery window; otherwise, a restored database can refer to missing images.

At least quarterly, restore a recent recovery point into an isolated environment. Restore the corresponding object-storage
version too; validate PostGIS, migration history, user/report counts, image references and downloads, then run backend e2e
tests against the restored database. Record restore time and data-loss window, investigate failures, and update the runbook.
During an incident, stop writes or isolate the affected service, choose a recovery point before the incident, restore the
database and storage to separate targets, validate them, and only then switch traffic. Preserve the original systems for
investigation.
