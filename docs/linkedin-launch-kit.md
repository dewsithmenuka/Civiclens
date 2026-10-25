# LinkedIn launch kit

## Positioning
Don't pitch "a Flutter app". Pitch **a systems-engineering project with opinionated design decisions**. Recruiters and
senior engineers respond to *decisions and trade-offs*, not feature lists. Lead with one of these hooks:

- "I designed realtime so a pothole in Brooklyn never wakes a phone in LA." (tile-scoped subscriptions)
- "Retries from a flaky connection can't create duplicate reports." (idempotent offline queue)
- "Public map pins are intentionally ~55 m wrong — here's why." (privacy by design)

## Post draft (edit freely)
> I built CivicLens — a real-time geospatial platform for reporting and tracking local infrastructure issues
> (potholes, broken streetlights, and blocked accessibility ramps).
>
> Three decisions I'm proud of:
> 📍 **Viewport-scoped realtime** — clients subscribe to map tiles, not a global firehose.
> 🔁 **Idempotent offline reporting** — retries never create duplicates.
> 🔒 **Privacy by default** — public coordinates snap to a ~55 m grid; reporter identity never leaves the DB.
>
> Stack: NestJS · PostgreSQL/PostGIS · Socket.IO · Redis · Flutter · Next.js · Docker · GitHub Actions
> 38 tests (including end-to-end against real PostGIS), 8 ADRs documenting the trade-offs.
>
> Repo + architecture write-up in the comments 👇
> #softwareengineering #postgis #nestjs #flutter #civictech

## Assets checklist
- [ ] 15–30 s screen recording: open map → pan → a report from a 2nd device appears live
- [ ] Architecture diagram (the Mermaid chart in README renders on GitHub — screenshot it)
- [ ] Swagger UI screenshot (`/docs`)
- [ ] Terminal screenshot of the 23 e2e tests passing
- [ ] Pin the repo; add topics: `postgis`, `nestjs`, `flutter`, `geospatial`, `civic-tech`
- [ ] Tag `v0.1.0` and publish release notes before posting
