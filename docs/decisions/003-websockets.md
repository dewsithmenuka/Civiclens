# ADR-003: Socket.IO for realtime delivery

**Status:** Accepted

## Context
Users need live map updates, but PostgreSQL must remain authoritative.

## Decision
Socket.IO namespace `/live`. Events are notifications of already-committed state. Redis adapter for multi-instance (v0.3).

## Consequences
+ Rooms, reconnection and ack built in. − Sticky sessions or the Redis adapter required when scaling horizontally.
