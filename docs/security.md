# Security

| Concern | Control | Where |
|---|---|---|
| Passwords | Argon2id | `auth.service.ts` |
| Sessions | 15-min JWT + opaque refresh token (SHA-256 at rest), **rotation + reuse detection → family revocation** | `auth.service.ts`, e2e test |
| User enumeration | Always one Argon2 verify; generic 401 | `auth.service.ts` |
| Authorisation | Global guards: throttle → JWT → current account status/role → roles; deny-by-default (`@Public()` is opt-in) | `common/guards.ts` |
| Privilege escalation | Registration can only create `USER` (DTO whitelist rejects extra fields) | `auth.dto.ts` |
| Abuse | Per-route rate limits (auth 5–30/min, create 20/min, global 120/min); Redis-backed shared storage is required in production | controllers, `common/redis-throttler.storage.ts` |
| Input | `ValidationPipe` whitelist + `forbidNonWhitelisted`; parameterised SQL only | `app.setup.ts`, repositories |
| Privacy | ~55 m approximate public coordinates; reporter id never serialised publicly | `issues.repository.ts`, `toView` |
| Auditability | `audit_logs` for registration, refresh-reuse, status changes | `audit.service.ts` |
| Transport/headers | Helmet; CORS allow-list; HTTPS expected at the edge | `app.setup.ts` |
| Secrets | Env only; production refuses weak/default `JWT_SECRET`; gitleaks in CI | `config.ts`, CI |
| Supply chain | `npm audit` gate in CI | CI |

## Deployment requirements
Set `REDIS_URL` for every production API instance. Startup fails if it is absent, and the same Redis
service must be shared by all replicas so rate limits are enforced consistently. Redis connectivity
must be available at startup; the API does not silently fall back to per-process throttling.

HTTPS termination, deployed secrets, and the deployed CORS allow-list still require verification
in the production environment; repository configuration cannot verify the edge or runtime values.

## Known gaps (tracked for v1.0)
Email verification + password reset, Google OAuth, image content moderation,
per-account (not just per-IP) login throttling.
