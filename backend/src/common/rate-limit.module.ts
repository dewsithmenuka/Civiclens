import { Module } from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { getConfig } from '../config';

export const RATE_LIMIT_STORAGE = Symbol('RATE_LIMIT_STORAGE');
export const REDIS_HEALTH_CHECK = Symbol('REDIS_HEALTH_CHECK');

@Module({
  providers: [
    {
      provide: RATE_LIMIT_STORAGE,
      useFactory: async () => {
        if (process.env.NODE_ENV === 'test') return undefined;
        const redisUrl = getConfig().redisUrl;
        if (!redisUrl) return undefined;

        const client = createClient({ url: redisUrl }) as RedisClientType;
        client.on('error', (error) => {
          console.error(JSON.stringify({
            level: 'error',
            msg: 'throttler_redis_error',
            error: String(error),
          }));
        });
        await client.connect();
        return new RedisThrottlerStorage(client);
      },
    },
    {
      provide: REDIS_HEALTH_CHECK,
      inject: [RATE_LIMIT_STORAGE],
      useFactory: (storage?: RedisThrottlerStorage) =>
        storage ? () => storage.ping() : undefined,
    },
  ],
  exports: [RATE_LIMIT_STORAGE, REDIS_HEALTH_CHECK],
})
export class RateLimitStorageModule {}
