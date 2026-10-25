# ADR-001: PostgreSQL as the system of record

**Status:** Accepted

## Context
We need relational integrity (users, lifecycle, confirmations), transactions for status changes, and first-class geospatial support.

## Decision
Use PostgreSQL 16. Plain SQL via `pg` and numbered SQL migrations instead of an ORM.

## Consequences
+ Full control of PostGIS SQL, easy to review. − No generated types; repositories must be tested against a real DB (they are, in CI).
