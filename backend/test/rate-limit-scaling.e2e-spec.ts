import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { RedisThrottlerStorage } from '../src/common/redis-throttler.storage';

(process.env.REDIS_URL ? describe : describe.skip)('rate limits shared across API instances', () => {
  it('enforces one counter across independent Redis storage clients', async () => {
    const clients = [
      createClient({ url: process.env.REDIS_URL }) as RedisClientType,
      createClient({ url: process.env.REDIS_URL }) as RedisClientType,
    ];
    try {
      await Promise.all(clients.map((client) => client.connect()));
      const [firstInstance, secondInstance] = clients.map((client) => new RedisThrottlerStorage(client));
      const key = randomUUID();
      const options = [key, 60_000, 2, 0, 'login'] as const;

      expect(await firstInstance.increment(...options)).toMatchObject({ totalHits: 1, isBlocked: false });
      expect(await secondInstance.increment(...options)).toMatchObject({ totalHits: 2, isBlocked: false });
      expect(await firstInstance.increment(...options)).toMatchObject({ totalHits: 3, isBlocked: true });
      expect(await secondInstance.increment(...options)).toMatchObject({ totalHits: 3, isBlocked: true });
    } finally {
      await Promise.all(clients.filter((client) => client.isOpen).map((client) => client.quit()));
    }
  });
});
