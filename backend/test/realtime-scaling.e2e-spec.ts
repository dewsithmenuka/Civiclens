/**
 * Proves horizontal scaling: two independent API instances share one Redis. A report created through
 * instance B is delivered live to a phone connected to instance A.
 * Requires REDIS_URL (CI provides a Redis service).
 */
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { io as ioClient } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailMessage, Mailer } from '../src/mail/mailer.service';
import { RedisIoAdapter } from '../src/realtime/redis-io.adapter';

class NoopMailer extends Mailer { async send(_m: MailMessage) {} }

async function bootInstance() {
  const m = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(Mailer).useValue(new NoopMailer()).compile();
  const app = m.createNestApplication();
  const adapter = new RedisIoAdapter(app);
  await adapter.connectToRedis(process.env.REDIS_URL!);
  app.useWebSocketAdapter(adapter);
  configureApp(app);
  await app.listen(0);
  return { app, adapter, url: (await app.getUrl()).replace('[::1]', 'localhost') };
}

(process.env.DATABASE_URL && process.env.REDIS_URL ? describe : describe.skip)('realtime across two API instances (Redis)', () => {
  let a: Awaited<ReturnType<typeof bootInstance>>; let b: Awaited<ReturnType<typeof bootInstance>>;
  beforeAll(async () => { process.env.NODE_ENV = 'test'; a = await bootInstance(); b = await bootInstance(); });
  afterAll(async () => { await a.app.close(); await b.app.close(); await a.adapter.close(); await b.adapter.close(); });

  it('delivers an event created on instance B to a client connected to instance A — only if its viewport matches', async () => {
    const tag = randomUUID().slice(0, 8);
    const token = (await request(b.app.getHttpServer()).post('/api/v1/auth/register')
      .send({ email: `scale-${tag}@example.com`, password: 'correct-horse-battery', displayName: 'scale' }).expect(201)).body.accessToken;

    const lat = 62 + Math.random() * 0.5, lng = 25 + Math.random() * 0.5;
    const near = ioClient(`${a.url}/live`, { transports: ['websocket'] });
    const far = ioClient(`${a.url}/live`, { transports: ['websocket'] });
    const got: string[] = []; const missed: string[] = [];
    near.on('issue.created', (i) => got.push(i.title)); far.on('issue.created', (i) => missed.push(i.title));
    await Promise.all([near, far].map((c) => new Promise((r) => c.on('connect', () => r(null)))));
    expect((await near.emitWithAck('viewport.subscribe', { bbox: { minLng: lng - 0.01, minLat: lat - 0.01, maxLng: lng + 0.01, maxLat: lat + 0.01 } })).ok).toBe(true);
    expect((await far.emitWithAck('viewport.subscribe', { bbox: { minLng: 100, minLat: -10, maxLng: 100.02, maxLat: -9.98 } })).ok).toBe(true);

    await request(b.app.getHttpServer()).post('/api/v1/issues').set({ Authorization: `Bearer ${token}` })
      .send({ category: 'LIGHTING', title: 'Lamp out (via instance B)', latitude: lat, longitude: lng }).expect(201);
    await new Promise((r) => setTimeout(r, 600));

    expect(got).toEqual(['Lamp out (via instance B)']);
    expect(missed).toEqual([]);
    near.close(); far.close();
  });
});