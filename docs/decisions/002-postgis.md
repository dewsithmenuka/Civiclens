# ADR-002: PostGIS geography for locations

**Status:** Accepted

## Context
Nearby search, viewport loading and duplicate detection are core features and must stay fast as data grows.

## Decision
Store `geography(Point,4326)` with a GiST index; use `ST_DWithin`, `&&` with `ST_MakeEnvelope`, and `<->` ordering.

## Consequences
+ Metre-accurate distances, indexed queries. − Slightly heavier than lat/lng columns; requires the PostGIS extension in every environment.
