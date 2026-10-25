# ADR-008: Idempotent reporting via clientRequestId

**Status:** Accepted

## Context
Offline queues retry on flaky networks; naive retries create duplicates.

## Decision
Devices generate a UUID per report. `UNIQUE (reporter_id, client_request_id)` plus an up-front lookup returns the original on retry.

## Consequences
+ Safe retries with no server-side session state. − Clients must persist the id with the queued report.
