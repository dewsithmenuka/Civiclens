# Contributing

- Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Every schema change = a new numbered file in `backend/migrations/` (never edit an applied one).
- Every behaviour change ships with a test; every architectural change ships with an ADR in `docs/decisions/`.
- Before pushing: `npm run typecheck && npm test && npm run test:e2e`, plus
  `cd mobile && flutter analyze && flutter test`.
- The pull-request workflow also verifies migration idempotence, production
  builds, dashboard HTTP e2e, mobile web compilation, dependency advisories,
  secrets, and the backend Docker image.
