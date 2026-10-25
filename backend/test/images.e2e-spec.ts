import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { StorageService, StoredObject } from '../src/storage/storage.service';

class FakeStorage extends StorageService {
  objects = new Map<string, StoredObject>();
  bodies = new Map<string, Buffer>();
  async presignPut(key: string) { return `https://storage.test/upload/${key}?sig=fake`; }
  async head(key: string) { return this.objects.get(key) ?? null; }
  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error('Object not found');
    let body = this.bodies.get(key);
    if (!body) {
      const image = sharp({
        create: {
          width: 2,
          height: 3,
          channels: 3,
          background: { r: 120, g: 80, b: 40 },
        },
      });
      body = object.contentType === 'image/jpeg'
        ? await image.jpeg().withMetadata({ orientation: 6 }).toBuffer()
        : object.contentType === 'image/png'
          ? await image.png().toBuffer()
          : await image.webp().toBuffer();
      this.bodies.set(key, body);
    }
    return Buffer.from(body);
  }
  async put(key: string, body: Buffer, contentType: string) {
    this.bodies.set(key, Buffer.from(body));
    this.objects.set(key, { contentType, sizeBytes: body.length });
  }
  async delete(key: string) {
    this.objects.delete(key);
    this.bodies.delete(key);
  }
  publicUrl(key: string) { return `https://cdn.test/${key}`; }
}

(process.env.DATABASE_URL ? describe : describe.skip)('image uploads (e2e)', () => {
  let app: INestApplication; let http: any; const store = new FakeStorage();
  const tag = randomUUID().slice(0, 8);
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const reg = async (n: string) => (await request(http).post('/api/v1/auth/register')
    .send({ email: `${n}-${tag}@example.com`, password: 'correct-horse-battery', displayName: n }).expect(201)).body.accessToken as string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(StorageService).useValue(store).compile();
    app = mod.createNestApplication(); configureApp(app); await app.init(); http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('presign → (device uploads) → register → visible on the issue', async () => {
    const alice = await reg('img-alice');
    const issue = await request(http).post('/api/v1/issues').set(auth(alice))
      .send({ category: 'ACCESSIBILITY', title: 'Ramp blocked by bins', latitude: 20 + Math.random(), longitude: 30 + Math.random() }).expect(201);

    const p = await request(http).post('/api/v1/uploads/presign').set(auth(alice)).send({ contentType: 'image/jpeg', sizeBytes: 200_000 }).expect(201);
    expect(p.body.key).toMatch(/^issues\/.+\.jpg$/);
    expect(p.body.uploadUrl).toContain('storage.test');

    await request(http).post(`/api/v1/issues/${issue.body.id}/images`).set(auth(alice)).send({ key: p.body.key, width: 1200, height: 900 }).expect(400); // not uploaded yet
    store.objects.set(p.body.key, { contentType: 'image/jpeg', sizeBytes: 200_000 });
    await request(http).post(`/api/v1/issues/${issue.body.id}/images`).set(auth(alice)).send({ key: p.body.key, width: 1200, height: 900 }).expect(201);

    const got = await request(http).get(`/api/v1/issues/${issue.body.id}`).expect(200);
    expect(got.body.images).toHaveLength(1);
    expect(got.body.images[0].url).toBe(`https://cdn.test/${p.body.key}`);
    expect(got.body.images[0]).toMatchObject({ width: 3, height: 2 });
    const sanitizedMetadata = await sharp(store.bodies.get(p.body.key)!).metadata();
    expect(sanitizedMetadata.exif).toBeUndefined();
    expect(sanitizedMetadata.orientation).toBeUndefined();
  });

  it('rejects bad types/sizes at presign and enforces ownership + limits at register', async () => {
    const alice = await reg('own-alice'); const bob = await reg('own-bob');
    await request(http).post('/api/v1/uploads/presign').set(auth(alice)).send({ contentType: 'application/pdf', sizeBytes: 100 }).expect(400);
    await request(http).post('/api/v1/uploads/presign').set(auth(alice)).send({ contentType: 'image/png', sizeBytes: 50_000_000 }).expect(400);
    await request(http).post('/api/v1/uploads/presign').send({ contentType: 'image/png', sizeBytes: 100 }).expect(401);

    const issue = (await request(http).post('/api/v1/issues').set(auth(alice))
      .send({ category: 'WASTE', title: 'Overflowing bin', latitude: 25 + Math.random(), longitude: 35 + Math.random() }).expect(201)).body;
    const bobSlot = (await request(http).post('/api/v1/uploads/presign').set(auth(bob)).send({ contentType: 'image/png', sizeBytes: 1000 }).expect(201)).body;
    store.objects.set(bobSlot.key, { contentType: 'image/png', sizeBytes: 1000 });
    // bob can't attach to alice's issue; alice can't claim bob's slot
    await request(http).post(`/api/v1/issues/${issue.id}/images`).set(auth(bob)).send({ key: bobSlot.key, width: 10, height: 10 }).expect(403);
    await request(http).post(`/api/v1/issues/${issue.id}/images`).set(auth(alice)).send({ key: bobSlot.key, width: 10, height: 10 }).expect(403);

    for (let i = 0; i < 4; i++) {
      const s = (await request(http).post('/api/v1/uploads/presign').set(auth(alice)).send({ contentType: 'image/webp', sizeBytes: 1000 }).expect(201)).body;
      store.objects.set(s.key, { contentType: 'image/webp', sizeBytes: 1000 });
      await request(http).post(`/api/v1/issues/${issue.id}/images`).set(auth(alice)).send({ key: s.key, width: 10, height: 10 }).expect(201);
    }
    const fifth = (await request(http).post('/api/v1/uploads/presign').set(auth(alice)).send({ contentType: 'image/webp', sizeBytes: 1000 }).expect(201)).body;
    store.objects.set(fifth.key, { contentType: 'image/webp', sizeBytes: 1000 });
    await request(http).post(`/api/v1/issues/${issue.id}/images`).set(auth(alice)).send({ key: fifth.key, width: 10, height: 10 }).expect(400);
  });

  it('rejects an object whose real size or type violates policy', async () => {
    const alice = await reg('pol-alice');
    const issue = (await request(http).post('/api/v1/issues').set(auth(alice))
      .send({ category: 'WATER', title: 'Leak', latitude: 27 + Math.random(), longitude: 37 + Math.random() }).expect(201)).body;
    const s = (await request(http).post('/api/v1/uploads/presign').set(auth(alice)).send({ contentType: 'image/png', sizeBytes: 1000 }).expect(201)).body;
    store.objects.set(s.key, { contentType: 'image/png', sizeBytes: 9_000_000 }); // lied about size
    await request(http).post(`/api/v1/issues/${issue.id}/images`).set(auth(alice)).send({ key: s.key, width: 10, height: 10 }).expect(400);
  });
});