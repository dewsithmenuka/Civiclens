# ADR-006: Tile-scoped realtime subscriptions

**Status:** Accepted

## Context
Broadcasting every event to every client does not scale and wastes mobile battery/data.

## Decision
Clients send their viewport; the server joins them to z14 tile rooms (≤ 64). Events are emitted to the tile containing the issue.

## Consequences
+ Traffic scales with local activity. − Edge case: events near tile borders are covered because subscriptions use whole tiles; very large viewports must zoom in.
