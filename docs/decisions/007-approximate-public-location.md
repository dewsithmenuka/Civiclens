# ADR-007: Approximate public coordinates

**Status:** Accepted

## Context
Precise coordinates of reports can reveal a reporter's home or routine.

## Decision
Public payloads use `ST_SnapToGrid(…, 0.0005)` (~55 m). Exact coordinates only for the reporter and moderators/admins.

## Consequences
+ Privacy by default. − Pins on the public map are slightly offset; fine for civic awareness.
