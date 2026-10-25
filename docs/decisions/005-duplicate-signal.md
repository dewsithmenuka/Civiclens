# ADR-005: Duplicate detection is a signal, not an action

**Status:** Accepted

## Context
Same-category reports nearby are often duplicates but can also be distinct problems (two potholes).

## Decision
Flag `possible_duplicate_of` when category matches within `DUPLICATE_RADIUS_M` (50) and `DUPLICATE_WINDOW_HOURS` (24). Never auto-merge/delete; moderators decide.

## Consequences
+ No data loss from false positives. − Moderator workload; text/embedding similarity can reduce it later (optional, never a hard dependency).
