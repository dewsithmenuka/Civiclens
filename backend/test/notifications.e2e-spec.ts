import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Database } from '../src/database/database.service';
import { MailMessage, Mailer } from '../src/mail/mailer.service';
import { PUSH_COOLDOWN_MS } from '../src/notifications/notifications.service';
import { PushPayload, PushService } from '../src/notifications/push.service';

class NoopMailer extends Mailer { async send(_m: MailMessage) {} }
class FakePush extends PushService {
  calls: { tokens: string[]; payload: PushPayload }[] = [];
  dead = new Set<string>();
  async send(tokens: string[], payload: PushPayload) {
    this.calls.push({ tokens, payload });
    return { invalidTokens: tokens.filter((t) => this.dead.has(t)), failures: [] };
  }
  pushesTo(token: string) { return this.calls.filter((c) => c.tokens.includes(token)); }
}

(process.env.DATABASE_URL ? describe : describe.skip)('notifications & push (e2e)', () => {
  let app: INestApplication; let http: any; let db: Database; const push = new FakePush();
  const tag = randomUUID().slice(0, 8); const pw = 'correct-horse-battery';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tok = (n: string) => `fcm-token-${n}-${tag}-0123456789`;

  const register = async (n: string) => (await request(http).post('/api/v1/auth/register')
    .send({ email: `${n}-${tag}@example.com`, password: pw, displayName: n }).expect(201)).body.accessToken as string;
  const inbox = async (t: string) => (await request(http).get('/api/v1/notifications').set(auth(t)).expect(200)).body;
  /** Fan-out is asynchronous (it must never delay the user's request) — poll until it lands. */
  const until = async <T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> => {
    const start = Date.now();
    for (;;) { const v = await fn(); if (ok(v)) return v; if (Date.now() - start > ms) throw new Error('timed out waiting for notification'); await new Promise((r) => setTimeout(r, 25)); }
  };

  let alice: string, bob: string, carol: string, dave: string, mod: string, issueId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Mailer).useValue(new NoopMailer()).overrideProvider(PushService).useValue(push).compile();
    app = m.createNestApplication(); configureApp(app); await app.init(); http = app.getHttpServer(); db = app.get(Database);

    [alice, bob, carol, dave] = await Promise.all(['alice', 'bob', 'carol', 'dave'].map(register));
    await register('mod');
    await db.query(`UPDATE users SET role = 'MODERATOR' WHERE lower(email) = $1`, [`mod-${tag}@example.com`]);
    mod = (await request(http).post('/api/v1/auth/login').send({ email: `mod-${tag}@example.com`, password: pw }).expect(200)).body.accessToken;

    issueId = (await request(http).post('/api/v1/issues').set(auth(alice))
      .send({ category: 'ROADS', title: 'Broken kerb', latitude: 60 + Math.random(), longitude: 20 + Math.random() }).expect(201)).body.id;
    await request(http).post(`/api/v1/issues/${issueId}/follow`).set(auth(bob)).expect(200);
  });
  afterAll(() => app.close());

  describe('devices', () => {
    it('requires auth and validates input', async () => {
      await request(http).post('/api/v1/devices').send({ token: tok('x'), platform: 'ios' }).expect(401);
      await request(http).post('/api/v1/devices').set(auth(alice)).send({ token: 'short', platform: 'ios' }).expect(400);
      await request(http).post('/api/v1/devices').set(auth(alice)).send({ token: tok('x'), platform: 'toaster' }).expect(400);
    });
    it('registers, moves a token between accounts, and unregisters only your own', async () => {
      await request(http).post('/api/v1/devices').set(auth(alice)).send({ token: tok('alice'), platform: 'ios' }).expect(200);
      await request(http).post('/api/v1/devices').set(auth(bob)).send({ token: tok('bob'), platform: 'android' }).expect(200);
      await request(http).post('/api/v1/devices').set(auth(alice)).send({ token: tok('alice'), platform: 'ios' }).expect(200); // idempotent
      await request(http).post('/api/v1/devices').set(auth(carol)).send({ token: tok('shared'), platform: 'ios' }).expect(200);
      await request(http).post('/api/v1/devices').set(auth(dave)).send({ token: tok('shared'), platform: 'ios' }).expect(200); // phone changed hands
      const owner = await db.query(`SELECT u.email FROM device_tokens d JOIN users u ON u.id = d.user_id WHERE d.token = $1`, [tok('shared')]);
      expect(owner.rows).toHaveLength(1);
      expect(owner.rows[0].email).toBe(`dave-${tag}@example.com`);
      await request(http).post('/api/v1/devices/unregister').set(auth(carol)).send({ token: tok('shared') }).expect(204); // not hers
      expect((await db.query(`SELECT 1 FROM device_tokens WHERE token = $1`, [tok('shared')])).rowCount).toBe(1);
      await request(http).post('/api/v1/devices/unregister').set(auth(dave)).send({ token: tok('shared') }).expect(204);
      expect((await db.query(`SELECT 1 FROM device_tokens WHERE token = $1`, [tok('shared')])).rowCount).toBe(0);
    });
  });

  describe('status changes', () => {
    it('notifies the reporter and followers (not the actor, not strangers) and pushes to their devices', async () => {
      await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(mod)).send({ status: 'UNDER_REVIEW' }).expect(200);
      const a = await until(() => inbox(alice), (v) => v.items.length >= 1);
      const b = await until(() => inbox(bob), (v) => v.items.length >= 1);
      expect(a.items[0]).toMatchObject({ type: 'STATUS_CHANGED', read: false, issueId });
      expect(a.items[0].body).toBe('"Broken kerb" is now under review.');
      expect(b.unreadCount).toBe(1);
      expect((await inbox(carol)).items).toHaveLength(0);
      expect((await inbox(mod)).items).toHaveLength(0);
      expect(push.pushesTo(tok('alice')).at(-1)!.payload.data).toEqual({ issueId, type: 'STATUS_CHANGED' });
      expect(push.pushesTo(tok('bob'))).toHaveLength(1);
    });

    it('every status change is its own notification (no aggregation for important events)', async () => {
      await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(mod)).send({ status: 'ACKNOWLEDGED' }).expect(200);
      const a = await until(() => inbox(alice), (v) => v.items.length >= 2);
      expect(a.items.map((i: any) => i.body)).toEqual(expect.arrayContaining([
        '"Broken kerb" is now under review.', '"Broken kerb" was acknowledged by the authorities.']));
    });
  });

  describe('confirmations are debounced', () => {
    it('collapses many confirmations into one unread notification and one push', async () => {
      const alicePushesBefore = push.pushesTo(tok('alice')).length;
      await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(carol)).expect(200);
      await until(() => inbox(alice), (v) => v.items.some((i: any) => i.type === 'CONFIRMED'));
      await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(dave)).expect(200);
      const a = await until(() => inbox(alice), (v) => v.items.find((i: any) => i.type === 'CONFIRMED')?.count === 2);

      const confirmed = a.items.filter((i: any) => i.type === 'CONFIRMED');
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].body).toBe('2 people confirmed "Broken kerb".');
      expect(push.pushesTo(tok('alice')).length).toBe(alicePushesBefore + 1); // second confirmation: no second buzz
    });

    it('pushes again after the cooldown, and starts a fresh notification once the old one is read', async () => {
      // Pretend the last push was long ago: the next confirmation may buzz again (but still aggregates).
      await db.query(`UPDATE notifications SET last_pushed_at = now() - ($2 * interval '1 millisecond')
                       WHERE issue_id = $1 AND type = 'CONFIRMED' AND read_at IS NULL`, [issueId, PUSH_COOLDOWN_MS + 60_000]);
      const eve = await register('eve');
      const before = push.pushesTo(tok('alice')).length;
      await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(eve)).expect(200);
      const a = await until(() => inbox(alice), (v) => v.items.find((i: any) => i.type === 'CONFIRMED')?.count === 3);
      expect(a.items.filter((i: any) => i.type === 'CONFIRMED')).toHaveLength(1);
      expect(push.pushesTo(tok('alice')).length).toBe(before + 1);

      // Alice reads it → the next confirmation is a brand-new notification.
      const id = a.items.find((i: any) => i.type === 'CONFIRMED').id;
      await request(http).post(`/api/v1/notifications/${id}/read`).set(auth(alice)).expect(200);
      const frank = await register('frank');
      await request(http).post(`/api/v1/issues/${issueId}/confirm`).set(auth(frank)).expect(200);
      const after = await until(() => inbox(alice), (v) => v.items.filter((i: any) => i.type === 'CONFIRMED').length === 2);
      const fresh = after.items.filter((i: any) => i.type === 'CONFIRMED' && !i.read);
      expect(fresh).toHaveLength(1);
      expect(fresh[0].body).toBe('Someone confirmed "Broken kerb".');
    });
  });

  describe('inbox', () => {
    it('tracks unread count, marks one / all read, and hides other users’ notifications', async () => {
      const b = await inbox(bob);
      expect(b.unreadCount).toBeGreaterThanOrEqual(3);
      await request(http).post(`/api/v1/notifications/${b.items[0].id}/read`).set(auth(alice)).expect(404); // not Alice's
      await request(http).post(`/api/v1/notifications/${b.items[0].id}/read`).set(auth(bob)).expect(200);
      expect((await inbox(bob)).unreadCount).toBe(b.unreadCount - 1);
      await request(http).post('/api/v1/notifications/read-all').set(auth(bob)).expect(200);
      expect((await inbox(bob)).unreadCount).toBe(0);
      await request(http).get('/api/v1/notifications').expect(401);
      await request(http).get('/api/v1/notifications?limit=1').set(auth(bob)).expect(200)
        .then((r) => expect(r.body.items).toHaveLength(1));
    });
  });

  describe('dead device tokens', () => {
    it('are deleted when the push provider reports them invalid', async () => {
      await request(http).post('/api/v1/devices').set(auth(bob)).send({ token: tok('bob-dead'), platform: 'android' }).expect(200);
      push.dead.add(tok('bob-dead'));
      await request(http).patch(`/api/v1/issues/${issueId}/status`).set(auth(mod)).send({ status: 'IN_PROGRESS' }).expect(200);
      await until(() => db.query(`SELECT 1 FROM device_tokens WHERE token = $1`, [tok('bob-dead')]), (r) => r.rowCount === 0);
      expect((await db.query(`SELECT 1 FROM device_tokens WHERE token = $1`, [tok('bob')])).rowCount).toBe(1); // healthy one stays
    });
  });
});