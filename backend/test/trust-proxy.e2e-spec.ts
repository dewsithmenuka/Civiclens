import 'reflect-metadata';
import { Body, Controller, HttpCode, INestApplication, Module, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

@Controller()
class LoginController { @Post('login') @HttpCode(401) login(@Body() _b: unknown) { return { error: 'nope' }; } }

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 3 }])],
  controllers: [LoginController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
class AppModule {}

async function boot(trustProxy?: number) {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication();
  if (trustProxy !== undefined) (app.getHttpAdapter().getInstance() as any).set('trust proxy', trustProxy); // what app.setup.ts does
  await app.init();
  return app;
}
const hit = (app: INestApplication, xff?: string) => {
  const r = request(app.getHttpServer()).post('/login').send({});
  return (xff ? r.set('X-Forwarded-For', xff) : r).then((x) => x.status);
};
const burst = async (app: INestApplication, xff: () => string | undefined, n: number) => { const out: number[] = []; for (let i = 0; i < n; i++) out.push(await hit(app, xff())); return out; };

describe('rate limiting behind the dashboard (trust proxy)', () => {
  it('WITHOUT trust proxy every visitor shares the dashboard\'s IP — one person can lock everyone out', async () => {
    const app = await boot();
    expect(await burst(app, () => '1.1.1.1', 4)).toEqual([401, 401, 401, 429]);
    expect(await hit(app, '2.2.2.2')).toBe(429); // an innocent second user is blocked too
    await app.close();
  });
  it('WITH trust proxy each client IP gets its own allowance', async () => {
    const app = await boot(1);
    expect(await burst(app, () => '1.1.1.1', 4)).toEqual([401, 401, 401, 429]);
    expect(await hit(app, '2.2.2.2')).toBe(401); // unaffected
    await app.close();
  });
  it('and cannot be dodged by forging extra left-hand X-Forwarded-For entries', async () => {
    const app = await boot(1);
    let i = 0;
    expect(await burst(app, () => `evil-${i++}, 3.3.3.3`, 4)).toEqual([401, 401, 401, 429]); // still one bucket: 3.3.3.3
    await app.close();
  });
  it('requests with no X-Forwarded-For still work (local development)', async () => {
    const app = await boot(1);
    expect(await hit(app)).toBe(401);
    await app.close();
  });
});