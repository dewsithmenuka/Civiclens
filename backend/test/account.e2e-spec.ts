import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailMessage, Mailer } from '../src/mail/mailer.service';
import { GoogleProfile, GoogleVerifier } from '../src/auth/google.verifier';
import { StorageService, StoredObject } from '../src/storage/storage.service';

class FakeMailer extends Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) { this.sent.push(m); }
  to(email: string) { return this.sent.filter((m) => m.to.toLowerCase() === email.toLowerCase()); }
  /** Mail is sent in the background (so a slow SMTP server never blocks sign-up) — wait for it to land. */
  async waitFor(email: string, count: number, timeoutMs = 3000) {
    const start = Date.now();
    while (this.to(email).length < count) {
      if (Date.now() - start > timeoutMs) throw new Error(`expected ${count} mail(s) to ${email}, got ${this.to(email).length}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  lastToken(email: string): string {
    const m = this.to(email).at(-1);
    const t = m?.text.match(/token=([\w-]+)/)?.[1];
    if (!t) throw new Error(`no token mail for ${email}`);
    return t;
  }
}

class FakeGoogleVerifier extends GoogleVerifier {
  async verify(idToken: string): Promise<GoogleProfile> {
    const [sub, email] = idToken.split('|');
    if (!sub || !email) throw new Error('Invalid test ID token');
    return { sub, email, emailVerified: true };
  }
}

class FakeStorage extends StorageService {
  deleted: string[] = [];
  failDeletes = false;
  async presignPut(key: string) { return `https://storage.test/${key}`; }
  async head(_key: string): Promise<StoredObject | null> { return null; }
  async get(_key: string): Promise<Buffer> { throw new Error('Image reads are not configured in this test'); }
  async put(_key: string, _body: Buffer, _contentType: string): Promise<void> {
    throw new Error('Image writes are not configured in this test');
  }
  async delete(key: string) {
    if (this.failDeletes) throw new Error('Storage deletion failed');
    this.deleted.push(key);
  }
  publicUrl(key: string) { return `https://storage.test/${key}`; }
}

const storage = new FakeStorage();

async function boot(mailer: Mailer) {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer).useValue(mailer)
    .overrideProvider(GoogleVerifier).useClass(FakeGoogleVerifier)
    .overrideProvider(StorageService).useValue(storage)
    .compile();
  const app = mod.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

(process.env.DATABASE_URL ? describe : describe.skip)('account security (e2e)', () => {
  let app: INestApplication; let http: any; const mailer = new FakeMailer();
  const tag = randomUUID().slice(0, 8); const pw = 'correct-horse-battery';
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const email = (n: string) => `${n}-${tag}@example.com`;
  const register = async (n: string) => {
    const body = (await request(http).post('/api/v1/auth/register').send({ email: email(n), password: pw, displayName: n }).expect(201)).body as { accessToken: string; refreshToken: string };
    await mailer.waitFor(email(n), 1); // the verification mail
    return body;
  };

  describe('privacy export and deletion', () => {
    it('exports the account, exact report location, image metadata, and associated activity', async () => {
      const t = await register('export');
      const issue = (await request(http).post('/api/v1/issues').set(auth(t.accessToken))
        .send({ category: 'ROADS', title: 'Exported report', latitude: 12.12345, longitude: 34.56789 })
        .expect(201)).body;
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const { rows: users } = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email('export')]);
        await pool.query(
          `INSERT INTO issue_images
             (issue_id, uploader_id, storage_key, mime_type, size_bytes, width, height)
           VALUES ($1, $2, $3, 'image/jpeg', 2048, 640, 480)`,
          [issue.id, users[0].id, `export-${tag}.jpg`],
        );
        await pool.query(
          `INSERT INTO notifications (user_id, issue_id, type, title, body)
           VALUES ($1, $2, 'STATUS_CHANGED', 'Report update', 'Your report was reviewed')`,
          [users[0].id, issue.id],
        );
        await pool.query(
          `INSERT INTO device_tokens (user_id, token, platform)
           VALUES ($1, $2, 'ios')`,
          [users[0].id, `push-${tag}`],
        );
      } finally {
        await pool.end();
      }

      const result = await request(http).get('/api/v1/auth/me/export').set(auth(t.accessToken)).expect(200);
      expect(result.headers['content-disposition']).toContain('civiclens-data-export.json');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body.account.email).toBe(email('export'));
      expect(result.body.account).not.toHaveProperty('passwordHash');
      expect(result.body.reportedIssues).toHaveLength(1);
      expect(result.body.reportedIssues[0].latitude).toBeCloseTo(12.12345, 5);
      expect(result.body.reportedIssues[0].longitude).toBeCloseTo(34.56789, 5);
      expect(result.body.reportedIssues[0].images[0]).toMatchObject({
        storageKey: `export-${tag}.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
        url: `https://storage.test/export-${tag}.jpg`,
      });
      expect(result.body.notifications[0].title).toBe('Report update');
      expect(result.body.deviceTokens[0]).toMatchObject({ token: `push-${tag}`, platform: 'ios' });
      await request(http).get('/api/v1/auth/me/export').expect(401);
    });

    it('requires the current password, removes reports and images, clears retained references, and revokes access', async () => {
      const owner = await register('erase');
      const other = await register('retained');
      const ownedIssue = (await request(http).post('/api/v1/issues').set(auth(owner.accessToken))
        .send({ category: 'WATER', title: 'Delete this report', latitude: 13, longitude: 35 }).expect(201)).body;
      const retainedIssue = (await request(http).post('/api/v1/issues').set(auth(other.accessToken))
        .send({ category: 'WASTE', title: 'Keep this report', latitude: 14, longitude: 36 }).expect(201)).body;
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const ownImage = `erase-own-${tag}.jpg`;
      const attachedImage = `erase-attached-${tag}.jpg`;
      let ownerId = '';
      try {
        const { rows: users } = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email('erase')]);
        ownerId = users[0].id;
        await pool.query(
          `INSERT INTO issue_images
             (issue_id, uploader_id, storage_key, mime_type, size_bytes, width, height)
           VALUES ($1, $2, $3, 'image/jpeg', 2048, 640, 480), ($4, $2, $5, 'image/png', 1024, 320, 240)`,
          [ownedIssue.id, ownerId, ownImage, retainedIssue.id, attachedImage],
        );
        await pool.query('UPDATE issues SET possible_duplicate_of = $1 WHERE id = $2', [ownedIssue.id, retainedIssue.id]);
        await pool.query(
          `INSERT INTO issue_status_history (issue_id, from_status, to_status, actor_id)
           VALUES ($1, 'REPORTED', 'UNDER_REVIEW', $2)`,
          [retainedIssue.id, ownerId],
        );
        await pool.query(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1`, [ownerId]);
      } finally {
        await pool.end();
      }

      storage.deleted = [];
      await request(http).get('/api/v1/auth/me/export').set(auth(owner.accessToken)).expect(200);
      await request(http).delete('/api/v1/auth/me').set(auth(owner.accessToken))
        .send({ password: 'wrong-password' }).expect(401);
      storage.failDeletes = true;
      await request(http).delete('/api/v1/auth/me').set(auth(owner.accessToken))
        .send({ password: pw }).expect(500);
      storage.failDeletes = false;
      await request(http).delete('/api/v1/auth/me').set(auth(owner.accessToken))
        .send({ password: pw }).expect(204);
      expect(storage.deleted.sort()).toEqual([attachedImage, ownImage].sort());

      const check = new Pool({ connectionString: process.env.DATABASE_URL });
      try {
        const { rows: users } = await check.query('SELECT 1 FROM users WHERE id = $1', [ownerId]);
        const { rows: ownIssues } = await check.query('SELECT 1 FROM issues WHERE id = $1', [ownedIssue.id]);
        const { rows: retained } = await check.query(
          `SELECT possible_duplicate_of FROM issues WHERE id = $1`,
          [retainedIssue.id],
        );
        const { rows: history } = await check.query(
          `SELECT actor_id FROM issue_status_history WHERE issue_id = $1 ORDER BY id DESC LIMIT 1`,
          [retainedIssue.id],
        );
        const { rows: images } = await check.query('SELECT 1 FROM issue_images WHERE storage_key = ANY($1::text[])', [[ownImage, attachedImage]]);
        expect(users).toHaveLength(0);
        expect(ownIssues).toHaveLength(0);
        expect(retained[0].possible_duplicate_of).toBeNull();
        expect(history[0].actor_id).toBeNull();
        expect(images).toHaveLength(0);
      } finally {
        await check.end();
      }
      await request(http).get('/api/v1/auth/me').set(auth(owner.accessToken)).expect(401);
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: owner.refreshToken }).expect(401);
    });

    it('allows Google-only accounts to delete with a fresh token for their linked identity', async () => {
      const idToken = `google-sub-${tag}|google-${tag}@example.com`;
      const signedIn = (await request(http).post('/api/v1/auth/google').send({ idToken }).expect(200)).body;
      await request(http).delete('/api/v1/auth/me').set(auth(signedIn.accessToken))
        .send({ googleIdToken: idToken }).expect(204);
      await request(http).get('/api/v1/auth/me').set(auth(signedIn.accessToken)).expect(401);
    });
  });

  beforeAll(async () => { process.env.NODE_ENV = 'test'; app = await boot(mailer); http = app.getHttpServer(); });
  afterAll(() => app.close());

  describe('email verification', () => {
    it('sends a verification mail on register and verifies via the link (single-use)', async () => {
      const t = await register('verify');
      expect(mailer.to(email('verify'))).toHaveLength(1);
      expect(mailer.to(email('verify'))[0].subject).toMatch(/verify/i);
      expect((await request(http).get('/api/v1/auth/me').set(auth(t.accessToken))).body.emailVerified).toBe(false);

      const token = mailer.lastToken(email('verify'));
      const ok = await request(http).get(`/api/v1/auth/verify-email?token=${token}`).expect(200);
      expect(ok.headers['content-type']).toMatch(/html/);
      expect(ok.text).toMatch(/Email verified/);
      expect((await request(http).get('/api/v1/auth/me').set(auth(t.accessToken))).body.emailVerified).toBe(true);

      await request(http).get(`/api/v1/auth/verify-email?token=${token}`).expect(400); // replay
      await request(http).get('/api/v1/auth/verify-email?token=not-a-real-token').expect(400);
      await request(http).get('/api/v1/auth/verify-email').expect(400);
    });

    it('resend invalidates the previous link; verified users get no further mail', async () => {
      const t = await register('resend');
      const first = mailer.lastToken(email('resend'));
      await request(http).post('/api/v1/auth/verify-email/resend').set(auth(t.accessToken)).expect(202);
      expect(mailer.to(email('resend'))).toHaveLength(2);
      await request(http).get(`/api/v1/auth/verify-email?token=${first}`).expect(400);
      await request(http).get(`/api/v1/auth/verify-email?token=${mailer.lastToken(email('resend'))}`).expect(200);
      await request(http).post('/api/v1/auth/verify-email/resend').set(auth(t.accessToken)).expect(202);
      expect(mailer.to(email('resend'))).toHaveLength(2);
      await request(http).post('/api/v1/auth/verify-email/resend').expect(401);
    });

    it('does not store raw tokens in the database', async () => {
      await register('hashed');
      const token = mailer.lastToken(email('hashed'));
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const { rows } = await pool.query(`SELECT count(*)::int n FROM auth_tokens WHERE token_hash = $1`, [token]);
      await pool.end();
      expect(rows[0].n).toBe(0);
    });
  });

  describe('password reset', () => {
    it('gives the same response for unknown and known emails, but only mails real accounts', async () => {
      await register('forgot');
      const before = mailer.sent.length;
      const a = await request(http).post('/api/v1/auth/forgot-password').send({ email: `ghost-${tag}@example.com` }).expect(202);
      expect(mailer.sent.length).toBe(before);
      const b = await request(http).post('/api/v1/auth/forgot-password').send({ email: email('forgot').toUpperCase() }).expect(202);
      expect(mailer.sent.length).toBe(before + 1);
      expect(a.body).toEqual(b.body);
      await request(http).post('/api/v1/auth/forgot-password').send({ email: 'not-an-email' }).expect(400);
    });

    it('full flow: form → weak password keeps the link alive → reset → old creds dead, all sessions revoked', async () => {
      const t = await register('reset');
      await request(http).post('/api/v1/auth/forgot-password').send({ email: email('reset') }).expect(202);
      const token = mailer.lastToken(email('reset'));

      const form = await request(http).get(`/api/v1/auth/reset-password?token=${token}`).expect(200);
      expect(form.text).toMatch(/type="password"/);

      await request(http).post('/api/v1/auth/reset-password').send({ token, password: 'short' }).expect(400);
      const newPw = 'a-brand-new-passphrase';
      await request(http).post('/api/v1/auth/reset-password').send({ token, password: newPw }).expect(200); // token survived the typo

      await request(http).post('/api/v1/auth/login').send({ email: email('reset'), password: pw }).expect(401);
      await request(http).post('/api/v1/auth/login').send({ email: email('reset'), password: newPw }).expect(200);
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401); // old session killed

      await request(http).post('/api/v1/auth/reset-password').send({ token, password: 'yet-another-passphrase' }).expect(400); // replay
      await request(http).get(`/api/v1/auth/reset-password?token=${token}`).expect(400);
    });

    it('accepts the HTML form post and answers with a page', async () => {
      await register('formuser');
      await request(http).post('/api/v1/auth/forgot-password').send({ email: email('formuser') }).expect(202);
      const token = mailer.lastToken(email('formuser'));
      const r = await request(http).post('/api/v1/auth/reset-password').type('form').send({ token, password: 'form-submitted-passphrase' }).expect(200);
      expect(r.headers['content-type']).toMatch(/html/);
      expect(r.text).toMatch(/Password updated/);
    });

    it('a newer reset request invalidates the older link', async () => {
      await register('twice');
      await request(http).post('/api/v1/auth/forgot-password').send({ email: email('twice') }).expect(202);
      const first = mailer.lastToken(email('twice'));
      await request(http).post('/api/v1/auth/forgot-password').send({ email: email('twice') }).expect(202);
      await request(http).post('/api/v1/auth/reset-password').send({ token: first, password: 'should-not-work-at-all' }).expect(400);
    });
  });

  describe('REQUIRE_VERIFIED_EMAIL enforcement', () => {
    it('blocks reporting until the email is verified', async () => {
      process.env.REQUIRE_VERIFIED_EMAIL = 'true';
      const strictMailer = new FakeMailer();
      const strict = await boot(strictMailer);
      delete process.env.REQUIRE_VERIFIED_EMAIL;
      try {
        const h = strict.getHttpServer();
        const e = `strict-${tag}@example.com`;
        const t = (await request(h).post('/api/v1/auth/register').send({ email: e, password: pw, displayName: 'strict' }).expect(201)).body;
        await strictMailer.waitFor(e, 1);
        const body = { category: 'ROADS', title: 'Pothole', latitude: 50 + Math.random(), longitude: 10 + Math.random() };
        const denied = await request(h).post('/api/v1/issues').set(auth(t.accessToken)).send(body).expect(403);
        expect(denied.body.message).toMatch(/Verify your email/);
        await request(h).get(`/api/v1/auth/verify-email?token=${strictMailer.lastToken(e)}`).expect(200);
        await request(h).post('/api/v1/issues').set(auth(t.accessToken)).send(body).expect(201);
      } finally { await strict.close(); }
    });
  });
});