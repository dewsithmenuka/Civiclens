/**
 * End-to-end tests against a real PostgreSQL + PostGIS database.
 * Run with DATABASE_URL pointing at a migrated, disposable database (CI provides one).
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { io as ioClient } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Database } from '../src/database/database.service';

const hasDb = !!process.env.DATABASE_URL;
(hasDb ? describe : describe.skip)('CivicLens API (e2e, PostGIS)', () => {
  let app: INestApplication;
  let db: Database;
  let http: ReturnType<INestApplication['getHttpServer']>;
  const tag = randomUUID().slice(0, 8);
  const pw = 'correct-horse-battery';

  const register = async (name: string) => {
    const res = await request(http).post('/api/v1/auth/register')
      .send({ email: `${name}-${tag}@example.com`, password: pw, displayName: name }).expect(201);
    return res.body as { accessToken: string; refreshToken: string };
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    configureApp(app);
    await app.listen(0);
    http = app.getHttpServer();
    db = app.get(Database);
  });
  afterAll(async () => { await app.close(); });

  describe('health & reference data', () => {
    it('reports ready with PostGIS', async () => {
      const r = await request(http).get('/health/ready').expect(200);
      expect(r.body.checks.database).toBe('up');
      expect(r.body.checks.postgis).toMatch(/^\d/);
      expect(r.body.checks.redis).toBe('not_configured');
      expect(r.body.checks.storage).toBe('not_configured');
    });
    it('serves seeded categories publicly', async () => {
      const r = await request(http).get('/api/v1/categories').expect(200);
      expect(r.body.map((c: any) => c.code)).toEqual(expect.arrayContaining(['ROADS', 'ACCESSIBILITY']));
    });
  });

  describe('auth', () => {
    it('rejects weak input and duplicate email', async () => {
      await request(http).post('/api/v1/auth/register').send({ email: 'x', password: 'short', displayName: 'a' }).expect(400);
      await register('dupe');
      await request(http).post('/api/v1/auth/register')
        .send({ email: `dupe-${tag}@example.com`, password: pw, displayName: 'dupe' }).expect(409);
    });
    it('logs in, rejects bad password, protects routes', async () => {
      await register('login');
      await request(http).post('/api/v1/auth/login').send({ email: `login-${tag}@example.com`, password: 'wrong-wrong-wrong' }).expect(401);
      const ok = await request(http).post('/api/v1/auth/login').send({ email: `LOGIN-${tag}@example.com`, password: pw }).expect(200);
      await request(http).get('/api/v1/auth/me').expect(401);
      const me = await request(http).get('/api/v1/auth/me').set(auth(ok.body.accessToken)).expect(200);
      expect(me.body.role).toBe('USER');
      expect(me.body.password_hash).toBeUndefined();
    });
    it('rotates refresh tokens and kills the session family on reuse', async () => {
      const t = await register('rotate');
      const r1 = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }).expect(200);
      expect(r1.body.refreshToken).not.toBe(t.refreshToken);
      // replaying the spent token is treated as theft…
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
      const { rows: reuseEvents } = await db.query(
        `SELECT id
         FROM audit_logs
         WHERE action = $1
           AND entity_id = (
             SELECT id::text
             FROM refresh_tokens
             WHERE token_hash = encode(digest($2, 'sha256'), 'hex')
           )`,
        ['auth.refresh_token_reuse', t.refreshToken],
      );
      expect(reuseEvents).toHaveLength(1);
      // …and the legitimately rotated token is revoked with it
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    });
    it('does not issue multiple refresh tokens when the same token is used concurrently', async () => {
      const t = await register('concurrent-rotate');
      const results = await Promise.all([
        request(http).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }),
        request(http).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }),
      ]);

      expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
      const issued = results.find((result) => result.status === 200)!;
      await request(http).post('/api/v1/auth/refresh')
        .send({ refreshToken: issued.body.refreshToken })
        .expect(401);
    });
  });

  describe('rate limiting', () => {
    it('throttles brute-force login attempts (429 after 10/min)', async () => {
      const codes: number[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await request(http).post('/api/v1/auth/login').set('x-enforce-rate-limit', '1')
          .send({ email: `nobody-${tag}@example.com`, password: 'wrong-wrong-wrong' });
        codes.push(r.status);
      }
      expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    });
  });

  describe('issues + PostGIS', () => {
    let alice: { accessToken: string }; let bob: { accessToken: string };
    let issueId: string;
    // Random per-run location so repeated runs against the same database never collide
    // with leftovers (the duplicate rule would — correctly — flag them).
    const LAT = 10 + Math.random() * 25, LNG = -120 + Math.random() * 60;

    beforeAll(async () => { alice = await register('alice'); bob = await register('bob'); });

    it('requires auth to create and validates input', async () => {
      await request(http).post('/api/v1/issues').send({}).expect(401);
      await request(http).post('/api/v1/issues').set(auth(alice.accessToken))
        .send({ category: 'NOPE', title: 'x', latitude: 999, longitude: 0 }).expect(400);
    });

    it('creates an issue; reporter sees exact coordinates', async () => {
      const r = await request(http).post('/api/v1/issues').set(auth(alice.accessToken))
        .send({ category: 'ROADS', title: 'Deep pothole on Broadway', latitude: LAT, longitude: LNG }).expect(201);
      issueId = r.body.id;
      expect(r.body.status).toBe('REPORTED');
      expect(r.body.locationPrecision).toBe('EXACT');
      expect(r.body.location.lat).toBeCloseTo(LAT, 6);
    });

    it('public view is approximate and never exposes the reporter', async () => {
      const r = await request(http).get(`/api/v1/issues/${issueId}`).expect(200);
      expect(r.body.locationPrecision).toBe('APPROXIMATE');
      expect(r.body.location.lat).not.toBeCloseTo(LAT, 6);
      expect(Math.abs(r.body.location.lat - LAT)).toBeLessThan(0.001);
      expect(JSON.stringify(r.body)).not.toMatch(/reporter/i);
      expect(r.body.timeline).toHaveLength(1);
    });

    it('is idempotent for offline-queue retries (same clientRequestId)', async () => {
      const body = { category: 'WATER', title: 'Burst pipe', latitude: 40.75, longitude: -73.98, clientRequestId: randomUUID() };
      const a = await request(http).post('/api/v1/issues').set(auth(alice.accessToken)).send(body).expect(201);
      const b = await request(http).post('/api/v1/issues').set(auth(alice.accessToken)).send(body).expect(201);
      expect(b.body.id).toBe(a.body.id);
    });

    it('flags (does not delete) a nearby same-category report as a possible duplicate', async () => {
      const r = await request(http).post('/api/v1/issues').set(auth(bob.accessToken))
        .send({ category: 'ROADS', title: 'Pothole near Broadway', latitude: LAT + 0.0002, longitude: LNG }).expect(201);
      expect(r.body.possibleDuplicateOf).toBe(issueId);
      expect(r.body.status).toBe('REPORTED');
    });

    it('does not flag a different category at the same spot', async () => {
      const r = await request(http).post('/api/v1/issues').set(auth(bob.accessToken))
        .send({ category: 'LIGHTING', title: 'Streetlight out', latitude: LAT, longitude: LNG }).expect(201);
      expect(r.body.possibleDuplicateOf).toBeNull();
    });

    it('nearby search returns distance-ordered results within radius', async () => {
      const r = await request(http).get('/api/v1/issues/nearby').query({ lat: LAT, lng: LNG, radius: 300, category: 'ROADS' }).expect(200);
      expect(r.body.length).toBeGreaterThanOrEqual(2);
      const d = r.body.map((i: any) => i.distanceM);
      expect([...d].sort((x, y) => x - y)).toEqual(d);
      expect(Math.max(...d)).toBeLessThanOrEqual(300);
    });

    it('viewport query returns only issues inside the box', async () => {
      const inside = await request(http).get('/api/v1/issues/map')
        .query({ minLng: LNG - 0.02, minLat: LAT - 0.02, maxLng: LNG + 0.02, maxLat: LAT + 0.02 }).expect(200);
      expect(inside.body.some((i: any) => i.id === issueId)).toBe(true);
      const outside = await request(http).get('/api/v1/issues/map')
        .query({ minLng: LNG + 1, minLat: LAT + 1, maxLng: LNG + 1.1, maxLat: LAT + 1.1 }).expect(200);
      expect(outside.body).toHaveLength(0);
    });

    it('list supports literal text search, category/status filters, and bounded pagination', async () => {
      await request(http).post('/api/v1/issues').set(auth(alice.accessToken))
        .send({ category: 'WATER', title: 'Distinctive hydrant leak', description: 'near the station', latitude: 40.82, longitude: -73.91 }).expect(201);
      const found = await request(http).get('/api/v1/issues')
        .query({ q: 'HYDRANT', category: 'WATER', status: 'REPORTED', limit: 1, offset: 0 }).expect(200);
      expect(found.body.items).toHaveLength(1);
      expect(found.body.items[0].title).toBe('Distinctive hydrant leak');
      expect(found.body.limit).toBe(1);
      expect(found.body.offset).toBe(0);
      expect(found.body.total).toBeGreaterThanOrEqual(1);
      await request(http).get('/api/v1/issues').query({ q: 'x'.repeat(101) }).expect(400);
    });

    it('rejects oversized and inverted viewports', async () => {
      await request(http).get('/api/v1/issues/map').query({ minLng: -80, minLat: 30, maxLng: -70, maxLat: 45 }).expect(400);
      await request(http).get('/api/v1/issues/map').query({ minLng: -74, minLat: 40.7, maxLng: -75, maxLat: 40.8 }).expect(400);
    });

    it('confirmations: not your own, once per user, counted', async () => {
      await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(alice.accessToken)).expect(403);
      const a = await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(bob.accessToken)).expect(200);
      const b = await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(bob.accessToken)).expect(200);
      expect(a.body.confirmationCount).toBe(1);
      expect(b.body.confirmationCount).toBe(1);
    });

    it('follow / unfollow is idempotent', async () => {
      await request(http).get(`/api/v1/issues/${issueId}/follow`).set(auth(bob.accessToken))
        .expect(200).expect(({ body }) => expect(body.following).toBe(false));
      await request(http).post(`/api/v1/issues/${issueId}/follow`).set(auth(bob.accessToken)).expect(200);
      await request(http).post(`/api/v1/issues/${issueId}/follow`).set(auth(bob.accessToken)).expect(200);
      await request(http).get(`/api/v1/issues/${issueId}/follow`).set(auth(bob.accessToken))
        .expect(200).expect(({ body }) => expect(body.following).toBe(true));
      const r = await request(http).delete(`/api/v1/issues/${issueId}/follow`).set(auth(bob.accessToken)).expect(200);
      expect(r.body.following).toBe(false);
    });

    describe('moderation & lifecycle (RBAC)', () => {
      let mod: { accessToken: string };
      beforeAll(async () => {
        await register('mod');
        await db.query(`UPDATE users SET role = 'MODERATOR' WHERE lower(email) = $1`, [`mod-${tag}@example.com`]);
        const l = await request(http).post('/api/v1/auth/login').send({ email: `mod-${tag}@example.com`, password: pw }).expect(200);
        mod = l.body; // role is embedded at login, so log in again after promotion
      });

      it('a normal user cannot change status', async () => {
        await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(alice.accessToken)).send({ status: 'UNDER_REVIEW' }).expect(403);
      });
      it('a moderator cannot skip lifecycle stages', async () => {
        const r = await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(mod.accessToken)).send({ status: 'RESOLVED' }).expect(400);
        expect(r.body.message).toMatch(/Illegal transition/);
      });
      it('a moderator walks the legal path; timeline + audit log record it', async () => {
        for (const status of ['UNDER_REVIEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED']) {
          await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(mod.accessToken)).send({ status, note: `to ${status}` }).expect(200);
        }
        const r = await request(http).get(`/api/v1/issues/${issueId}`).expect(200);
        expect(r.body.status).toBe('RESOLVED');
        expect(r.body.timeline.map((t: any) => t.to)).toEqual(['REPORTED', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED']);
        const audit = await db.query(`SELECT count(*)::int n FROM audit_logs WHERE entity_id = $1 AND action = 'issue.status_changed'`, [issueId]);
        expect(audit.rows[0].n).toBe(4);
      });
      it('cannot confirm a resolved issue; terminal states have no exits', async () => {
        await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(bob.accessToken)).expect(400);
        await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(mod.accessToken)).send({ status: 'IN_PROGRESS' }).expect(400);
      });
      it('rejected issues disappear from the public map but stay visible to moderators', async () => {
        const c = await request(http).post('/api/v1/issues').set(auth(alice.accessToken))
          .send({ category: 'WASTE', title: 'Spam report', latitude: 40.80, longitude: -73.95 }).expect(201);
        await request(http).patch(`/api/v1/issues/${c.body.id}/status`).set(auth(mod.accessToken)).send({ status: 'REJECTED' }).expect(200);
        await request(http).get(`/api/v1/issues/${c.body.id}`).expect(404);
        const asMod = await request(http).get(`/api/v1/issues/${c.body.id}`).set(auth(mod.accessToken)).expect(200);
        expect(asMod.body.locationPrecision).toBe('EXACT');
        await db.query(`UPDATE users SET role = 'USER' WHERE lower(email) = $1`, [`mod-${tag}@example.com`]);
        await request(http).get(`/api/v1/issues/${c.body.id}`).set(auth(mod.accessToken)).expect(404);
      });
    });
  });

  describe('realtime (viewport-scoped)', () => {
    it('delivers issue.created only to clients whose viewport covers the issue', async () => {
      const u = await register('rt');
      const url = (await app.getUrl()).replace('[::1]', 'localhost');
      const inView = ioClient(`${url}/live`, { transports: ['websocket'] });
      const elsewhere = ioClient(`${url}/live`, { transports: ['websocket'] });
      const received: string[] = [];
      const missed: string[] = [];
      inView.on('issue.created', (i) => received.push(i.title));
      elsewhere.on('issue.created', (i) => missed.push(i.title));
      const connected = (socket: ReturnType<typeof ioClient>) =>
        new Promise<void>((resolve, reject) => {
          socket.once('connect', resolve);
          socket.once('connect_error', reject);
        });
      await Promise.all([connected(inView), connected(elsewhere)]).catch((error) => {
        inView.close();
        elsewhere.close();
        throw error;
      });
      const ack1 = await inView.emitWithAck('viewport.subscribe', { bbox: { minLng: -73.97, minLat: 40.77, maxLng: -73.95, maxLat: 40.79 } });
      const ack2 = await elsewhere.emitWithAck('viewport.subscribe', { bbox: { minLng: -118.30, minLat: 34.04, maxLng: -118.20, maxLat: 34.08 } });
      expect(ack1.ok).toBe(true);
      expect(ack2.ok).toBe(true);
      await request(http).post('/api/v1/issues').set(auth(u.accessToken))
        .send({ category: 'TRAFFIC', title: 'Signal stuck on red', latitude: 40.78, longitude: -73.96 }).expect(201);
      await new Promise((r) => setTimeout(r, 400));
      expect(received).toEqual(['Signal stuck on red']);
      expect(missed).toEqual([]);
      inView.close(); elsewhere.close();
    });
  });
});
