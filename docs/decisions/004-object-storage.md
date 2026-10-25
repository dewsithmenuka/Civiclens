# ADR-004: Object storage for images (planned v0.2)

**Status:** Accepted

## Context
Image binaries must not live in PostgreSQL.

## Decision
S3-compatible storage (Cloudflare R2 / S3) with presigned uploads; metadata in `issue_images`. Mobile never sees storage credentials.

## Consequences
+ Cheap, CDN-friendly. − Needs server-side validation of type/size and orphan cleanup.
