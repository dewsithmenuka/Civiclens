/** The heat SQL against a real PostGIS database. Seeds its own data in a remote corner of the map and cleans up after itself. */
import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { Database } from '../src/database/database.service';
import { HeatRepository } from '../src/admin/heat.repository';
import { OPEN_STATUSES, cellDegreesForZoom, statusesForScope } from '../src/admin/heat.logic';

(process.env.DATABASE_URL ? describe : describe.skip)('heat repository (PostGIS)', () => {
  const db = new Database(); const repo = new HeatRepository(db);
  const tag = randomUUID().slice(0, 8);
  // A far-away, unlikely-to-be-used corner so other data in the database can't interfere.
  const A = { lat: -60.1, lng: 150.1 }, B = { lat: -60.15, lng: 150.15 }, OLD = { lat: -60.2, lng: 150.2 };
  let userId: string;

  const insert = (lat: number, lng: number, o: { category?: string; status?: string; ageHours?: number; resolvedAfterHours?: number; confirmations?: number } = {}) =>
    db.query(
      `INSERT INTO issues (reporter_id, category, title, status, location, confirmation_count, created_at, resolved_at)
       VALUES ($1,$2,$3,$4, ST_SetSRID(ST_MakePoint($6,$5),4326)::geography, $7,
               now() - ($8 * interval '1 hour'),
               CASE WHEN $9::float8 IS NULL THEN NULL ELSE now() - ($8 * interval '1 hour') + ($9 * interval '1 hour') END)`,
      [userId, o.category ?? 'ROADS', `heat-${tag}`, o.status ?? 'REPORTED', lat, lng, o.confirmations ?? 0, o.ageHours ?? 1, o.resolvedAfterHours ?? null]);

  const near = <T extends { lat: number; lng: number }>(cells: T[], p: { lat: number; lng: number }, tol: number): T[] =>
    cells.filter((c) => Math.abs(c.lat - p.lat) <= tol && Math.abs(c.lng - p.lng) <= tol);
  const all = (o: object = {}) => repo.cells({ cell: 0.005, days: 0, statuses: statusesForScope('open'), limit: 5000, ...o });

  beforeAll(async () => {
    userId = (await db.query(`INSERT INTO users (email, password_hash, display_name) VALUES ($1,'x','heat tester') RETURNING id`, [`heat-${tag}@example.com`])).rows[0].id;
    // Cluster A: 4 ROADS + 1 WATER, all open, inside one 0.005° cell — but spread along latitude so a finer grid splits them
    for (const dLat of [0, 0.0004, 0.0008, -0.0004]) await insert(A.lat + dLat, A.lng, { category: 'ROADS', ageHours: 100, confirmations: dLat === 0 ? 3 : 0 });
    await insert(A.lat - 0.0008, A.lng, { category: 'WATER', status: 'IN_PROGRESS', ageHours: 2 });
    // Cluster B: 2 LIGHTING open, 1 resolved (took 24 h), plus a rejected and a duplicate that must never be counted
    await insert(B.lat, B.lng, { category: 'LIGHTING' }); await insert(B.lat, B.lng, { category: 'LIGHTING', ageHours: 50 });
    await insert(B.lat, B.lng, { category: 'LIGHTING', status: 'RESOLVED', ageHours: 30, resolvedAfterHours: 24 });
    await insert(B.lat, B.lng, { status: 'REJECTED' }); await insert(B.lat, B.lng, { status: 'DUPLICATE' });
    // One old open report (60 days)
    await insert(OLD.lat, OLD.lng, { ageHours: 24 * 60 });
  });
  afterAll(async () => {
    await db.query(`DELETE FROM issues WHERE title = $1`, [`heat-${tag}`]);
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await db.pool.end();
  });

  it('groups open reports into grid cells and orders the busiest first', async () => {
    const cells = await all();
    const a = near(cells, A, 0.0026), b = near(cells, B, 0.0026), old = near(cells, OLD, 0.0026);
    expect(a).toHaveLength(1); expect(a[0].n).toBe(5); expect(a[0].open_n).toBe(5);
    expect(b).toHaveLength(1); expect(b[0].n).toBe(2);   // resolved/rejected/duplicate are not "open"
    expect(old).toHaveLength(1); expect(old[0].n).toBe(1);
    expect(cells.indexOf(a[0])).toBeLessThan(cells.indexOf(b[0]));
    expect(a[0].oldest_open_hours).toBeGreaterThanOrEqual(99);
    for (let i = 1; i < cells.length; i++) expect(cells[i - 1].n).toBeGreaterThanOrEqual(cells[i].n);
  });
  it('snaps to cell centres on the grid', async () => {
    for (const c of near(await all(), A, 0.0026)) { expect(Math.abs(c.lat / 0.005 - Math.round(c.lat / 0.005))).toBeLessThan(1e-6); }
  });
  it('a finer zoom splits the same reports into more, smaller cells — and loses none', async () => {
    const fine = near(await all({ cell: cellDegreesForZoom(16) }), A, 0.0026);
    expect(fine.length).toBeGreaterThan(1);
    expect(fine.reduce((s, c) => s + c.n, 0)).toBe(5);
  });
  it('scope: resolved shows only resolved; all excludes rejected and duplicates', async () => {
    const resolved = near(await all({ statuses: statusesForScope('resolved') }), B, 0.0026);
    expect(resolved).toHaveLength(1); expect(resolved[0].n).toBe(1);
    const every = near(await all({ statuses: statusesForScope('all') }), B, 0.0026);
    expect(every[0].n).toBe(3); expect(every[0].open_n).toBe(2);
  });
  it('days limits by creation date, and 0 means all time', async () => {
    expect(near(await all({ days: 30 }), OLD, 0.0026)).toHaveLength(0);
    expect(near(await all({ days: 90 }), OLD, 0.0026)).toHaveLength(1);
    expect(near(await all({ days: 0 }), OLD, 0.0026)).toHaveLength(1);
  });
  it('category filter narrows the cells', async () => {
    const lighting = await all({ category: 'LIGHTING' });
    expect(near(lighting, B, 0.0026)[0].n).toBe(2);
    expect(near(lighting, A, 0.0026)).toHaveLength(0);
    const water = near(await all({ category: 'WATER' }), A, 0.0026);
    expect(water[0].n).toBe(1);
  });
  it('the cell cap keeps only the busiest cells', async () => {
    const top = await all({ limit: 1 });
    expect(top).toHaveLength(1);
    expect(top[0].n).toBeGreaterThanOrEqual(5);
  });
  it('hotspots rank areas by open reports, with the most common category and total confirmations', async () => {
    const spots = await repo.hotspots({ cell: 0.005, limit: 5000 });
    const a = near(spots, A, 0.0026)[0], b = near(spots, B, 0.0026)[0];
    expect(a.open_n).toBe(5); expect(a.top_category).toBe('ROADS'); expect(a.confirmations).toBe(3);
    expect(b.open_n).toBe(2); expect(b.top_category).toBe('LIGHTING');
    expect(spots.indexOf(a)).toBeLessThan(spots.indexOf(b));
    expect(await repo.hotspots({ cell: 0.005, limit: 3 })).toHaveLength(3);
    expect(near(await repo.hotspots({ cell: 0.005, category: 'LIGHTING', limit: 5000 }), A, 0.0026)).toHaveLength(0);
  });
  it('resolution time by category uses the median of resolved reports', async () => {
    const rows = await repo.resolutionByCategory();
    const lighting = rows.find((r) => r.category === 'LIGHTING')!;
    expect(lighting.resolved).toBeGreaterThanOrEqual(1);
    expect(lighting.open).toBeGreaterThanOrEqual(2);
    expect(typeof lighting.median_hours).toBe('number');
    expect(rows.every((r) => r.resolved >= 0 && r.open >= 0)).toBe(true);
  });
  it('backlog age buckets open reports by how long they have waited', async () => {
    const b = Object.fromEntries((await repo.backlogAge()).map((r) => [r.bucket, r.n]));
    expect(b.gt7d).toBeGreaterThanOrEqual(1);          // the 60-day-old one
    expect(b['3to7d'] ?? 0).toBeGreaterThanOrEqual(4); // the four 100-hour-old ROADS reports
    expect(b.lt1d).toBeGreaterThanOrEqual(2);
    expect(OPEN_STATUSES).toContain('IN_PROGRESS');
  });
});