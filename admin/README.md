# CivicLens Admin (Next.js)

Status: **planned — v0.4.0**.

```bash
cd admin && npx create-next-app@latest . --ts --app --tailwind --eslint
```
Add `"@civiclens/contracts": "*"` and add `admin` to root `workspaces` to share enums/types with the API.

Scope: moderation queue, duplicate review (uses `possibleDuplicateOf`), map + issue table with filters, audit-log viewer,
operational analytics. Destructive actions require explicit confirmation. Auth uses the same `/auth/*` endpoints; moderator/admin roles only.
