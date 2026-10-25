
import 'reflect-metadata';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Database } from '../src/database/database.service';
import { MailMessage, Mailer } from '../src/mail/mailer.service';

class NoopMailer extends Mailer {
  async send(_m: MailMessage) {}
}

(process.env.DATABASE_URL ? describe : describe.skip)('admin API (e2e)', () => {
  let app: INestApplication;
  let http: any;
  let db: Database;

  const tag = randomUUID().slice(0, 8);
  const pw = 'correct-horse-battery';

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const email = (n: string) => `${n}-${tag}@example.com`;

  const lat0 = 30 + Math.random() * 10;
  const lng0 = 100 + Math.random() * 10; // far from other suites' data

  const register = async (n: string) =>
    (
      await request(http)
        .post('/api/v1/auth/register')
        .send({
          email: email(n),
          password: pw,
          displayName: `User ${n}`,
        })
        .expect(201)
    ).body.accessToken as string;

  const login = async (n: string) =>
    (
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: email(n), password: pw })
        .expect(200)
    ).body.accessToken as string;

  const promote = async (n: string, role: string) => {
    await db.query(
      `UPDATE users SET role = $2 WHERE lower(email) = $1`,
      [email(n), role],
    );

    return login(n);
  };

  const report = async (t: string, over: object = {}) =>
    (
      await request(http)
        .post('/api/v1/issues')
        .set(auth(t))
        .send({
          category: 'ROADS',
          title: 'Pothole',
          latitude: lat0,
          longitude: lng0,
          ...over,
        })
        .expect(201)
    ).body;

  const userId = async (n: string) =>
    (
      await db.query(
        `SELECT id FROM users WHERE lower(email) = $1`,
        [email(n)],
      )
    ).rows[0].id as string;

  let alice: string;
  let bob: string;
  let carol: string;
  let regular: string;
  let mod: string;
  let admin: string;

  let original: any;
  let dup: any;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const m = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(Mailer)
      .useValue(new NoopMailer())
      .compile();

    app = m.createNestApplication();
    configureApp(app);
    await app.init();

    http = app.getHttpServer();
    db = app.get(Database);

    [alice, bob, carol, regular] = await Promise.all(
      ['alice', 'bob', 'carol', 'regular'].map(register),
    );

    await register('mod');
    await register('admin');

    mod = await promote('mod', 'MODERATOR');
    admin = await promote('admin', 'ADMIN');

    original = await report(alice, {
      title: `Deep pothole 100% dangerous_one ${tag}`,
    });

    dup = await report(bob, {
      title: 'Pothole same spot',
      latitude: lat0 + 0.0002,
    }); // flagged as a possible duplicate

    await request(http)
      .post(`/api/v1/issues/${dup.id}/follow`)
      .set(auth(carol))
      .expect(200);

    await request(http)
      .post(`/api/v1/issues/${dup.id}/confirm`)
      .set(auth(carol))
      .expect(200);
  });

  afterAll(() => app.close());

  describe('access control', () => {
    it('rejects anonymous callers and ordinary users', async () => {
      for (const path of [
        '/admin/issues',
        '/admin/stats',
        '/admin/users',
        '/admin/audit',
        '/admin/assignees',
      ]) {
        await request(http).get(`/api/v1${path}`).expect(401);
        await request(http)
          .get(`/api/v1${path}`)
          .set(auth(regular))
          .expect(403);
      }

      await request(http)
        .patch(`/api/v1/admin/issues/${original.id}/status`)
        .set(auth(regular))
        .send({ status: 'UNDER_REVIEW' })
        .expect(403);
      await request(http)
        .patch(`/api/v1/admin/issues/${original.id}/assignee`)
        .set(auth(regular))
        .send({ assigneeId: null })
        .expect(403);
    });

    it('moderators get the queue but not user management or the audit log', async () => {
      await request(http)
        .get('/api/v1/admin/issues')
        .set(auth(mod))
        .expect(200);

      await request(http)
        .get('/api/v1/admin/stats')
        .set(auth(mod))
        .expect(200);

      await request(http)
        .get('/api/v1/admin/users')
        .set(auth(mod))
        .expect(403);

      await request(http)
        .get('/api/v1/admin/audit')
        .set(auth(mod))
        .expect(403);

      await request(http)
        .get('/api/v1/admin/assignees')
        .set(auth(mod))
        .expect(200);
    });

    it('admins get everything', async () => {
      for (const path of [
        '/admin/issues',
        '/admin/stats',
        '/admin/users',
        '/admin/audit',
      ]) {
        await request(http)
          .get(`/api/v1${path}`)
          .set(auth(admin))
          .expect(200);
      }
    });
  });

  describe('queue listing', () => {
    it('shows exact coordinates and the reporter’s display name — never their email', async () => {
      const r = await request(http)
        .get('/api/v1/admin/issues')
        .query({ search: `Deep pothole 100% dangerous_one ${tag}` })
        .set(auth(mod))
        .expect(200);

      const item = r.body.items.find((i: any) => i.id === original.id);

      expect(item.locationPrecision).toBe('EXACT');
      expect(item.location.lat).toBeCloseTo(lat0, 6);
      expect(item.reporter.displayName).toBe('User alice');
      expect(JSON.stringify(r.body)).not.toContain('@example.com');
    });

    it('filters by status, category and the duplicate flag', async () => {
      const flagged = await request(http)
        .get('/api/v1/admin/issues')
        .query({ flagged: 'true', search: 'same spot' })
        .set(auth(mod))
        .expect(200);

      expect(flagged.body.items.map((i: any) => i.id)).toContain(dup.id);
      expect(
        flagged.body.items.every((i: any) => i.possibleDuplicateOf),
      ).toBe(true);

      const unflagged = await request(http)
        .get('/api/v1/admin/issues')
        .query({ flagged: 'true', search: `dangerous_one ${tag}` })
        .set(auth(mod))
        .expect(200);

      expect(unflagged.body.items.map((i: any) => i.id)).not.toContain(
        original.id,
      );

      const water = await request(http)
        .get('/api/v1/admin/issues')
        .query({ category: 'WATER', search: `dangerous_one ${tag}` })
        .set(auth(mod))
        .expect(200);

      expect(water.body.total).toBe(0);

      await request(http)
        .get('/api/v1/admin/issues')
        .query({ status: 'NOPE' })
        .set(auth(mod))
        .expect(400);
    });

    it('filters by exact report ID, inclusive dates, and a bounded geographic radius', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const result = await request(http)
        .get('/api/v1/admin/issues')
        .query({
          reportId: original.id,
          createdFrom: today,
          createdTo: today,
          latitude: lat0,
          longitude: lng0,
          radiusM: 100,
        })
        .set(auth(mod))
        .expect(200);

      expect(result.body.total).toBe(1);
      expect(result.body.items[0].id).toBe(original.id);

      await request(http)
        .get('/api/v1/admin/issues')
        .query({ latitude: lat0, radiusM: 100 })
        .set(auth(mod))
        .expect(400);

      await request(http)
        .get('/api/v1/admin/issues')
        .query({ createdFrom: '2026-12-31', createdTo: '2026-01-01' })
        .set(auth(mod))
        .expect(400);
    });

    it('treats % and _ in search literally (not as wildcards)', async () => {
      const lit = await request(http)
        .get('/api/v1/admin/issues')
        .query({ search: '100%' })
        .set(auth(mod))
        .expect(200);

      expect(lit.body.items.map((i: any) => i.id)).toContain(original.id);

      const wild = await request(http)
        .get('/api/v1/admin/issues')
        .query({ search: '%%%' })
        .set(auth(mod))
        .expect(200);

      expect(wild.body.items.map((i: any) => i.id)).not.toContain(dup.id);

      const under = await request(http)
        .get('/api/v1/admin/issues')
        .query({ search: `dangerous_one ${tag}` })
        .set(auth(mod))
        .expect(200);

      expect(under.body.total).toBe(1);

      const underWild = await request(http)
        .get('/api/v1/admin/issues')
        .query({ search: `dangerousXone ${tag}` })
        .set(auth(mod))
        .expect(200);

      expect(underWild.body.total).toBe(0);
    });

    it('sorts and paginates', async () => {
      const oldest = await request(http)
        .get('/api/v1/admin/issues')
        .query({ sort: 'oldest', search: 'ssible', limit: 1 })
        .set(auth(mod))
        .expect(200);

      expect(oldest.body.items.length).toBeLessThanOrEqual(1);

      const page = await request(http)
        .get('/api/v1/admin/issues')
        .query({ limit: 2, offset: 0 })
        .set(auth(mod))
        .expect(200);

      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBeGreaterThanOrEqual(2);

      await request(http)
        .get('/api/v1/admin/issues')
        .query({ limit: 500 })
        .set(auth(mod))
        .expect(400);
    });
  });

  describe('issue detail', () => {
    it('shows the duplicate candidate with distance, and the reverse links', async () => {
      const d = await request(http)
        .get(`/api/v1/admin/issues/${dup.id}`)
        .set(auth(mod))
        .expect(200);

      expect(d.body.possibleDuplicate).toMatchObject({
        id: original.id,
        title: original.title,
      });

      expect(d.body.possibleDuplicate.location.lat).toBeCloseTo(lat0, 5);
      expect(d.body.possibleDuplicate.location.lng).toBeCloseTo(lng0, 5);

      expect(d.body.possibleDuplicate.location.lat).toBeCloseTo(lat0, 5);
      expect(d.body.possibleDuplicate.distanceM).toBeGreaterThan(10);
      expect(d.body.possibleDuplicate.distanceM).toBeLessThan(40);

      expect(d.body.timeline).toHaveLength(1);
      expect(d.body.timeline[0]).toMatchObject({
        from: null,
        to: 'REPORTED',
        actor: { displayName: 'User bob' },
      });

      expect(d.body.followerCount).toBe(1);
      expect(d.body).toHaveProperty('assignee', null);
      expect(d.body).toHaveProperty('audit');

      const o = await request(http)
        .get(`/api/v1/admin/issues/${original.id}`)
        .set(auth(mod))
        .expect(200);

      expect(o.body.duplicatesOfThis.map((x: any) => x.id)).toEqual([
        dup.id,
      ]);

      expect(o.body.possibleDuplicate).toBeNull();
    });

    describe('assignment', () => {
      it('assigns to active staff, audits changes, and allows unassignment', async () => {
        const modId = await userId('mod');
        await request(http)
          .patch(`/api/v1/admin/issues/${original.id}/assignee`)
          .set(auth(mod))
          .send({ assigneeId: modId })
          .expect(200)
          .expect(({ body }) => expect(body.issue.assignee).toMatchObject({
            id: modId,
            displayName: 'User mod',
            role: 'MODERATOR',
          }));

        const audit = await request(http)
          .get('/api/v1/admin/audit')
          .query({ entityId: original.id, action: 'issue.assigned' })
          .set(auth(admin))
          .expect(200);
        expect(audit.body.items[0].metadata).toMatchObject({ to: modId, toName: 'User mod' });

        await request(http)
          .patch(`/api/v1/admin/issues/${original.id}/assignee`)
          .set(auth(mod))
          .send({ assigneeId: await userId('regular') })
          .expect(400);

        await request(http)
          .patch(`/api/v1/admin/issues/${original.id}/assignee`)
          .set(auth(mod))
          .send({ assigneeId: null })
          .expect(200)
          .expect(({ body }) => expect(body.issue.assignee).toBeNull());

        await request(http)
          .patch(`/api/v1/admin/issues/${original.id}/assignee`)
          .set(auth(regular))
          .send({ assigneeId: modId })
          .expect(403);
      });
    });

    it('404s on unknown ids and 400s on malformed ones', async () => {
      await request(http)
        .get(`/api/v1/admin/issues/${randomUUID()}`)
        .set(auth(mod))
        .expect(404);

      await request(http)
        .get('/api/v1/admin/issues/not-a-uuid')
        .set(auth(mod))
        .expect(400);
    });
  });

  describe('duplicate merge', () => {
    it('refuses nonsensical merges', async () => {
      const lone = await report(alice, {
        title: 'Lonely report',
        latitude: lat0 + 1,
        longitude: lng0 + 1,
        category: 'LIGHTING',
      });

      const p = (id: string, body: object) =>
        request(http)
          .patch(`/api/v1/admin/issues/${id}/status`)
          .set(auth(mod))
          .send(body);

      expect(
        (
          await p(lone.id, { status: 'DUPLICATE' })
            .expect(400)
        ).body.message,
      ).toMatch(/duplicateOfId/); // nothing to merge into

      expect(
        (
          await p(lone.id, {
            status: 'DUPLICATE',
            duplicateOfId: lone.id,
          }).expect(400)
        ).body.message,
      ).toMatch(/itself/);

      await p(lone.id, {
        status: 'DUPLICATE',
        duplicateOfId: randomUUID(),
      }).expect(404);

      await p(lone.id, {
        status: 'UNDER_REVIEW',
        duplicateOfId: original.id,
      }).expect(400); // only valid with DUPLICATE

      const closed = await report(alice, {
        title: 'Will be rejected',
        latitude: lat0 + 2,
        longitude: lng0 + 2,
        category: 'WASTE',
      });

      await p(closed.id, { status: 'REJECTED' }).expect(200);

      expect(
        (
          await p(lone.id, {
            status: 'DUPLICATE',
            duplicateOfId: closed.id,
          }).expect(400)
        ).body.message,
      ).toMatch(/closed/);
    });

    it('merges into the detected original: hides the duplicate, carries followers and confirmations across', async () => {
      const before = (
        await request(http)
          .get(`/api/v1/issues/${original.id}`)
          .expect(200)
      ).body;

      expect(before.confirmationCount).toBe(0);

      const r = await request(http)
        .patch(`/api/v1/admin/issues/${dup.id}/status`)
        .set(auth(mod))
        .send({ status: 'DUPLICATE', note: 'Same pothole' })
        .expect(200);

      expect(r.body).toMatchObject({
        status: 'DUPLICATE',
        previousStatus: 'REPORTED',
        mergedInto: original.id,
      });

      // hidden from the public…
      await request(http).get(`/api/v1/issues/${dup.id}`).expect(404);

      // …and the original gained two independent sightings: carol (who confirmed the duplicate) and bob (who reported it)
      const after = (
        await request(http)
          .get(`/api/v1/issues/${original.id}`)
          .expect(200)
      ).body;

      expect(after.confirmationCount).toBe(2);

      // carol and bob now follow the original; the original's own reporter isn't counted as a confirmer or follower of herself
      const followers = (
        await db.query(
          `SELECT user_id FROM issue_followers WHERE issue_id = $1`,
          [original.id],
        )
      ).rows.map((x) => x.user_id);

      expect(followers).toEqual(
        expect.arrayContaining([await userId('carol'), await userId('bob')]),
      );

      expect(followers).not.toContain(await userId('alice'));

      const confirmers = (
        await db.query(
          `SELECT user_id FROM issue_confirmations WHERE issue_id = $1`,
          [original.id],
        )
      ).rows.map((x) => x.user_id);

      expect(confirmers).not.toContain(await userId('alice'));

      // the moderator's note and the merge target are recorded
      const detail = (
        await request(http)
          .get(`/api/v1/admin/issues/${dup.id}`)
          .set(auth(mod))
          .expect(200)
      ).body;

      expect(detail.timeline.at(-1)).toMatchObject({
        to: 'DUPLICATE',
        note: 'Same pothole',
        actor: { displayName: 'User mod', role: 'MODERATOR' },
      });

      const audit = await db.query(
        `SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'issue.status_changed'`,
        [dup.id],
      );

      expect(audit.rows[0].metadata).toMatchObject({
        to: 'DUPLICATE',
        duplicateOf: original.id,
      });
    });

    it('a merged duplicate is terminal, and the original can’t be merged into it', async () => {
      await request(http)
        .patch(`/api/v1/admin/issues/${dup.id}/status`)
        .set(auth(mod))
        .send({ status: 'UNDER_REVIEW' })
        .expect(400);

      const third = await report(alice, {
        title: 'Another',
        latitude: lat0 + 3,
        longitude: lng0 + 3,
        category: 'TRAFFIC',
      });

      expect(
        (
          await request(http)
            .patch(`/api/v1/admin/issues/${third.id}/status`)
            .set(auth(mod))
            .send({ status: 'DUPLICATE', duplicateOfId: dup.id })
            .expect(400)
        ).body.message,
      ).toMatch(/duplicate/);
    });

    it('the legacy moderator endpoint shares the same merge logic', async () => {
      const a = await report(alice, {
        title: 'Orig two',
        latitude: lat0 + 4,
        longitude: lng0 + 4,
        category: 'WATER',
      });

      const b = await report(bob, {
        title: 'Dup two',
        latitude: lat0 + 4.0002,
        longitude: lng0 + 4,
        category: 'WATER',
      });

      const r = await request(http)
        .patch(`/api/v1/issues/${b.id}/status`)
        .set(auth(mod))
        .send({ status: 'DUPLICATE' })
        .expect(200);

      expect(r.body.mergedInto).toBe(a.id);
    });
  });

  describe('category correction', () => {
    it('lets staff fix a category, audits it, and validates input', async () => {
      const issue = await report(alice, {
        title: 'Wrongly filed',
        latitude: lat0 + 5,
        longitude: lng0 + 5,
        category: 'ROADS',
      });

      const r = await request(http)
        .patch(`/api/v1/admin/issues/${issue.id}`)
        .set(auth(mod))
        .send({ category: 'ACCESSIBILITY' })
        .expect(200);

      expect(r.body.category).toBe('ACCESSIBILITY');

      const a = await db.query(
        `SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'issue.category_changed'`,
        [issue.id],
      );

      expect(a.rows[0].metadata).toEqual({
        from: 'ROADS',
        to: 'ACCESSIBILITY',
      });

      await request(http)
        .patch(`/api/v1/admin/issues/${issue.id}`)
        .set(auth(mod))
        .send({ category: 'ACCESSIBILITY' })
        .expect(200); // no-op: no second audit row

      expect(
        (
          await db.query(
            `SELECT count(*)::int n FROM audit_logs WHERE entity_id = $1 AND action = 'issue.category_changed'`,
            [issue.id],
          )
        ).rows[0].n,
      ).toBe(1);

      await request(http)
        .patch(`/api/v1/admin/issues/${issue.id}`)
        .set(auth(mod))
        .send({ category: 'NOPE' })
        .expect(400);

      await request(http)
        .patch(`/api/v1/admin/issues/${issue.id}`)
        .set(auth(regular))
        .send({ category: 'WATER' })
        .expect(403);

      await request(http)
        .patch(`/api/v1/admin/issues/${randomUUID()}`)
        .set(auth(mod))
        .send({ category: 'WATER' })
        .expect(404);
    });
  });

  describe('stats', () => {
    it('reports the queue, per-status counts and a complete 14-day series', async () => {
      const s = (
        await request(http)
          .get('/api/v1/admin/stats')
          .set(auth(mod))
          .expect(200)
      ).body;

      expect(Object.keys(s.byStatus).sort()).toEqual([
        'ACKNOWLEDGED',
        'DUPLICATE',
        'IN_PROGRESS',
        'REJECTED',
        'REPORTED',
        'RESOLVED',
        'UNDER_REVIEW',
      ]);

      expect(s.byStatus.DUPLICATE).toBeGreaterThanOrEqual(1);

      expect(
        Object.values(s.byStatus as Record<string, number>).reduce(
          (a, b) => a + b,
          0,
        ),
      ).toBe(s.totalIssues);

      expect(s.queue.open).toBeGreaterThanOrEqual(1);
      expect(s.last14Days).toHaveLength(14);
      expect(s.last14Days.at(-1).created).toBeGreaterThanOrEqual(5);
      expect(s.resolution).toMatchObject({ windowDays: 90 });

      expect(
        s.byCategory.every((c: any) => typeof c.count === 'number'),
      ).toBe(true);
    });

    it('computes a median resolution time from resolved reports', async () => {
      const issue = await report(alice, {
        title: 'Quick fix',
        latitude: lat0 + 6,
        longitude: lng0 + 6,
        category: 'LIGHTING',
      });

      for (const status of [
        'UNDER_REVIEW',
        'ACKNOWLEDGED',
        'IN_PROGRESS',
        'RESOLVED',
      ]) {
        await request(http)
          .patch(`/api/v1/admin/issues/${issue.id}/status`)
          .set(auth(mod))
          .send({ status })
          .expect(200);
      }

      const s = (
        await request(http)
          .get('/api/v1/admin/stats')
          .set(auth(mod))
          .expect(200)
      ).body;

      expect(s.resolution.sampleSize).toBeGreaterThanOrEqual(1);
      expect(s.resolution.medianHours).toBeGreaterThanOrEqual(0);
      expect(s.last14Days.at(-1).resolved).toBeGreaterThanOrEqual(1);
    });
  });

  describe('user management (admins only)', () => {
    it('lists and searches users', async () => {
      const r = await request(http)
        .get('/api/v1/admin/users')
        .query({ search: `regular-${tag}` })
        .set(auth(admin))
        .expect(200);

      expect(r.body.items).toHaveLength(1);

      expect(r.body.items[0]).toMatchObject({
        email: email('regular'),
        role: 'USER',
        status: 'ACTIVE',
        emailVerified: false,
        issueCount: 0,
      });

      expect(JSON.stringify(r.body)).not.toMatch(/password/i);

      const mods = await request(http)
        .get('/api/v1/admin/users')
        .query({ role: 'MODERATOR', search: tag })
        .set(auth(admin))
        .expect(200);

      expect(mods.body.items.map((u: any) => u.email)).toEqual([
        email('mod'),
      ]);
    });

    it('cannot change your own account, nor send an empty or invalid change', async () => {
      const adminId = await userId('admin');

      await request(http)
        .patch(`/api/v1/admin/users/${adminId}`)
        .set(auth(admin))
        .send({ role: 'USER' })
        .expect(400);

      await request(http)
        .patch(`/api/v1/admin/users/${await userId('regular')}`)
        .set(auth(admin))
        .send({})
        .expect(400);

      await request(http)
        .patch(`/api/v1/admin/users/${await userId('regular')}`)
        .set(auth(admin))
        .send({ role: 'SUPERUSER' })
        .expect(400);

      await request(http)
        .patch(`/api/v1/admin/users/${randomUUID()}`)
        .set(auth(admin))
        .send({ role: 'USER' })
        .expect(404);
    });

    it('promotes a user, and the change takes effect at their next sign-in', async () => {
      const id = await userId('regular');

      await request(http)
        .patch(`/api/v1/admin/users/${id}`)
        .set(auth(admin))
        .send({ role: 'MODERATOR' })
        .expect(200);

      const promoted = await login('regular'); // get the token FIRST

      await request(http)
        .get('/api/v1/admin/issues')
        .set(auth(promoted))
        .expect(200);

      await request(http)
        .patch(`/api/v1/admin/users/${id}`)
        .set(auth(admin))
        .send({ role: 'USER' })
        .expect(200);
    });

    it('suspending a moderator locks them out IMMEDIATELY, even with a still-valid token, and blocks sign-in', async () => {
      await register('doomed');

      const doomedToken = await promote('doomed', 'MODERATOR');

      const refresh = (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email: email('doomed'), password: pw })
          .expect(200)
      ).body.refreshToken;

      await request(http)
        .get('/api/v1/admin/issues')
        .set(auth(doomedToken))
        .expect(200);

      await request(http)
        .patch(`/api/v1/admin/users/${await userId('doomed')}`)
        .set(auth(admin))
        .send({ status: 'SUSPENDED' })
        .expect(200);

      await request(http)
        .get('/api/v1/admin/issues')
        .set(auth(doomedToken))
        .expect(403); // same token, 0 seconds later

      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refresh })
        .expect(401);

      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: email('doomed'), password: pw })
        .expect(401);

      await request(http)
        .patch(`/api/v1/admin/users/${await userId('doomed')}`)
        .set(auth(admin))
        .send({ status: 'ACTIVE' })
        .expect(200);

      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: email('doomed'), password: pw })
        .expect(200);
    });

    it('the older moderator endpoint locks out suspended staff immediately too', async () => {
      await register('doomed2');

      const t = await promote('doomed2', 'MODERATOR');

      const issue = await report(alice, {
        title: 'Legacy path',
        latitude: lat0 + 7,
        longitude: lng0 + 7,
        category: 'WASTE',
      });

      await request(http)
        .patch(`/api/v1/issues/${issue.id}/status`)
        .set(auth(t))
        .send({ status: 'UNDER_REVIEW' })
        .expect(200);

      await request(http)
        .patch(`/api/v1/admin/users/${await userId('doomed2')}`)
        .set(auth(admin))
        .send({ status: 'SUSPENDED' })
        .expect(200);

      await request(http)
        .patch(`/api/v1/issues/${issue.id}/status`)
        .set(auth(t))
        .send({ status: 'ACKNOWLEDGED' })
        .expect(403);
    });

    it('demoting an admin takes effect on their very next admin request', async () => {
      await register('temp-admin');

      const t = await promote('temp-admin', 'ADMIN');

      await request(http)
        .get('/api/v1/admin/users')
        .set(auth(t))
        .expect(200);

      await request(http)
        .patch(`/api/v1/admin/users/${await userId('temp-admin')}`)
        .set(auth(admin))
        .send({ role: 'USER' })
        .expect(200);

      await request(http)
        .get('/api/v1/admin/users')
        .set(auth(t))
        .expect(403);
    });
  });

  describe('audit log (admins only)', () => {
    it('records who did what, filterable by entity type and action', async () => {
      const all = (
        await request(http)
          .get('/api/v1/admin/audit')
          .query({ limit: 50 })
          .set(auth(admin))
          .expect(200)
      ).body;

      expect(all.items[0].id).toBeGreaterThan(all.items[1].id); // newest first

      const merges = (
        await request(http)
          .get('/api/v1/admin/audit')
          .query({
            entityType: 'issue',
            action: 'issue.status_changed',
            limit: 50,
          })
          .set(auth(admin))
          .expect(200)
      ).body;

      expect(merges.items.length).toBeGreaterThanOrEqual(5);

      expect(
        merges.items.every(
          (a: any) =>
            a.entityType === 'issue' && a.action === 'issue.status_changed',
        ),
      ).toBe(true);

      expect(merges.items[0].actor).toMatchObject({
        displayName: expect.stringMatching(/User /),
        role: 'MODERATOR',
      });

      const users = (
        await request(http)
          .get('/api/v1/admin/audit')
          .query({
            entityType: 'user',
            action: 'user.updated',
            limit: 50,
          })
          .set(auth(admin))
          .expect(200)
      ).body;

      expect(
        users.items.some((a: any) => a.metadata.after?.status === 'SUSPENDED'),
      ).toBe(true);

      expect(users.items[0].actor.role).toBe('ADMIN');
    });
  });
  describe('analytics', () => {
    it('is staff-only', async () => {
      for (const path of ['/admin/heatmap', '/admin/insights']) {
        await request(http).get(`/api/v1${path}`).expect(401);
        await request(http).get(`/api/v1${path}`).set(auth(regular)).expect(403);
        await request(http).get(`/api/v1${path}`).set(auth(mod)).expect(200);
      }
    });
    it('heatmap finds the seeded cluster and validates input', async () => {
      const r = await request(http).get('/api/v1/admin/heatmap').query({ scope: 'open', zoom: 12 }).set(auth(mod)).expect(200);
      expect(r.body.cellDegrees).toBe(0.005);
      const mine = r.body.cells.filter((c: any) => Math.abs(c.lat - lat0) < 0.01 && Math.abs(c.lng - lng0) < 0.01);
      expect(mine.length).toBeGreaterThanOrEqual(1);
      expect(r.body.maxCount).toBeGreaterThanOrEqual(mine[0].count);
      await request(http).get('/api/v1/admin/heatmap').query({ zoom: 25 }).set(auth(mod)).expect(400);
      await request(http).get('/api/v1/admin/heatmap').query({ scope: 'nope' }).set(auth(mod)).expect(400);
      await request(http).get('/api/v1/admin/heatmap').query({ category: 'NOPE' }).set(auth(mod)).expect(400);
    });
    it('insights always returns the four backlog buckets', async () => {
      const r = await request(http).get('/api/v1/admin/insights').set(auth(mod)).expect(200);
      expect(r.body.backlogAge.map((b: any) => b.key)).toEqual(['lt1d', '1to3d', '3to7d', 'gt7d']);
      expect(Array.isArray(r.body.resolutionByCategory)).toBe(true);
    });
  });
});
