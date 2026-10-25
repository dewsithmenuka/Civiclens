import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { Database } from '../src/database/database.service';
import { GoogleProfile, GoogleVerifier } from '../src/auth/google.verifier';
import { MailMessage, Mailer } from '../src/mail/mailer.service';

class NoopMailer extends Mailer { async send(_m: MailMessage) {} }
/** Token strings map to identities: "valid:<key>" resolves from a table, anything else is rejected like a bad signature. */
class FakeGoogle extends GoogleVerifier {
  identities = new Map<string, GoogleProfile>();
  async verify(idToken: string): Promise<GoogleProfile> {
    const p = this.identities.get(idToken);
    if (!p) throw new Error('bad signature');
    return p;
  }
}

(process.env.DATABASE_URL ? describe : describe.skip)('Google sign-in (e2e)', () => {
  let app: INestApplication; let http: any; let db: Database; const google = new FakeGoogle();
  const tag = randomUUID().slice(0, 8); const pw = 'correct-horse-battery';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const email = (n: string) => `${n}-${tag}@example.com`;
  /** Registers a fake Google identity and returns the token string to send (padded: the DTO requires >= 20 chars). */
  const idp = (token: string, n: string, over: Partial<GoogleProfile> = {}) => {
    const padded = token.padEnd(24, '-');
    google.identities.set(padded, { sub: `sub-${n}-${tag}`, email: email(n), emailVerified: true, name: `Name ${n}`, ...over });
    return padded;
  };
  const signIn = (t: string) => request(http).post('/api/v1/auth/google').send({ idToken: t });
  const me = async (accessToken: string) => (await request(http).get('/api/v1/auth/me').set(auth(accessToken)).expect(200)).body;
  const register = async (n: string) => (await request(http).post('/api/v1/auth/register')
    .send({ email: email(n), password: pw, displayName: n }).expect(201)).body as { accessToken: string; refreshToken: string };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const m = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Mailer).useValue(new NoopMailer()).overrideProvider(GoogleVerifier).useValue(google).compile();
    app = m.createNestApplication(); configureApp(app); await app.init(); http = app.getHttpServer(); db = app.get(Database);
  });
  afterAll(() => app.close());

  it('creates a new, already-verified user on first sign-in and issues working tokens', async () => {
    const r = await signIn(idp('tok-new', 'newbie')).expect(200);
    expect(r.body).toEqual(expect.objectContaining({ accessToken: expect.any(String), refreshToken: expect.any(String) }));
    const u = await me(r.body.accessToken);
    expect(u).toMatchObject({ email: email('newbie'), displayName: 'Name newbie', role: 'USER', emailVerified: true });
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: r.body.refreshToken }).expect(200);
  });

  it('signing in again returns the SAME user (no duplicates), even if Google now reports a different email', async () => {
    const first = await signIn(idp('tok-again', 'again')).expect(200);
    const second = await signIn(idp('tok-again', 'again', { email: email('again-renamed') })).expect(200);
    expect((await me(second.body.accessToken)).id).toBe((await me(first.body.accessToken)).id);
    const n = await db.query(`SELECT count(*)::int n FROM oauth_identities WHERE provider_user_id = $1`, [`sub-again-${tag}`]);
    expect(n.rows[0].n).toBe(1);
  });

  it('a Google-only account cannot be entered with a password', async () => {
    await signIn(idp('tok-nopw', 'nopw')).expect(200);
    await request(http).post('/api/v1/auth/login').send({ email: email('nopw'), password: pw }).expect(401);
    await request(http).post('/api/v1/auth/login').send({ email: email('nopw'), password: '!no-password-oauth-only' }).expect(401);
  });

  it('links to an existing VERIFIED local account; both sign-in methods then reach the same user', async () => {
    const local = await register('linkme');
    await db.query(`UPDATE users SET email_verified_at = now() WHERE lower(email) = $1`, [email('linkme')]);
    const g = await signIn(idp('tok-link', 'linkme', { email: email('linkme').toUpperCase() })).expect(200); // case-insensitive match
    expect((await me(g.body.accessToken)).id).toBe((await me(local.accessToken)).id);
    await request(http).post('/api/v1/auth/login').send({ email: email('linkme'), password: pw }).expect(200); // password still works
  });

  describe('pre-hijacking defence', () => {
    it('claiming an UNVERIFIED local account via Google wipes the password, sessions and outstanding links', async () => {
      const attacker = await register('victim'); // attacker registered the victim's email with a password; never verified
      await request(http).post('/api/v1/auth/forgot-password').send({ email: email('victim') }).expect(202); // leaves a live reset token
      const real = await signIn(idp('tok-victim', 'victim')).expect(200); // the real owner arrives via Google

      expect((await me(real.body.accessToken)).emailVerified).toBe(true);
      await request(http).post('/api/v1/auth/login').send({ email: email('victim'), password: pw }).expect(401); // attacker's password: dead
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: attacker.refreshToken }).expect(401); // attacker's session: dead
      const live = await db.query(`SELECT count(*)::int n FROM auth_tokens t JOIN users u ON u.id = t.user_id
                                    WHERE lower(u.email) = $1 AND t.used_at IS NULL`, [email('victim')]);
      expect(live.rows[0].n).toBe(0); // outstanding verify/reset links: dead
      const audit = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'auth.unverified_account_claimed_via_google'
                                     AND actor_id = (SELECT id FROM users WHERE lower(email) = $1)`, [email('victim')]);
      expect(audit.rowCount).toBe(1);
    });

    it('does NOT wipe a verified account’s password when linking', async () => {
      await register('safe');
      await db.query(`UPDATE users SET email_verified_at = now() WHERE lower(email) = $1`, [email('safe')]);
      await signIn(idp('tok-safe', 'safe')).expect(200);
      await request(http).post('/api/v1/auth/login').send({ email: email('safe'), password: pw }).expect(200);
    });
  });

  describe('rejections', () => {
    it('rejects a token that fails verification', async () => {
      await signIn('x'.repeat(30)).expect(401);
      await request(http).post('/api/v1/auth/google').send({ idToken: 'short' }).expect(400);
      await request(http).post('/api/v1/auth/google').send({}).expect(400);
    });
    it('rejects a Google account whose email is unverified', async () => {
      await signIn(idp('tok-unv', 'unv', { emailVerified: false })).expect(401);
      expect((await db.query(`SELECT 1 FROM users WHERE lower(email) = $1`, [email('unv')])).rowCount).toBe(0);
    });
    it('rejects suspended accounts', async () => {
      await signIn(idp('tok-susp', 'susp')).expect(200);
      await db.query(`UPDATE users SET status = 'SUSPENDED' WHERE lower(email) = $1`, [email('susp')]);
      await signIn(idp('tok-susp', 'susp')).expect(401);
    });
    it('cannot be used to become a moderator or admin (role always comes from our database)', async () => {
      const r = await signIn(idp('tok-role', 'role', { name: 'admin' })).expect(200);
      expect((await me(r.body.accessToken)).role).toBe('USER');
    });
  });

  it('concurrent first sign-ins of the same Google account produce exactly one user', async () => {
    const t = idp('tok-race', 'race');
    const results = await Promise.all([signIn(t), signIn(t), signIn(t)]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const ids = new Set(await Promise.all(results.map(async (r) => (await me(r.body.accessToken)).id)));
    expect(ids.size).toBe(1);
    expect((await db.query(`SELECT count(*)::int n FROM users WHERE lower(email) = $1`, [email('race')])).rows[0].n).toBe(1);
  });

  it('can set a password later via the normal reset flow', async () => {
    await signIn(idp('tok-later', 'later')).expect(200);
    await request(http).post('/api/v1/auth/forgot-password').send({ email: email('later') }).expect(202); // mail is a no-op here; just proves no error
  });
});

(process.env.DATABASE_URL ? describe : describe.skip)('Google sign-in when not configured (e2e)', () => {
  it('answers 503 instead of pretending to work', async () => {
    delete process.env.GOOGLE_CLIENT_IDS;
    process.env.NODE_ENV = 'test';
    const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Mailer).useValue(new NoopMailer()).compile();
    const app = m.createNestApplication(); configureApp(app); await app.init();
    try {
      const r = await request(app.getHttpServer()).post('/api/v1/auth/google').send({ idToken: 'a'.repeat(40) }).expect(503);
      expect(r.body.message).toMatch(/not configured/i);
    } finally { await app.close(); }
  });
});