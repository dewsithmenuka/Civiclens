import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';

import {
  createAdapter,
  type RedisAdapter,
} from '@socket.io/redis-adapter';

import {
  createClient,
  type RedisClientType,
} from 'redis';

import type { ServerOptions } from 'socket.io';

/**
 * Socket.IO over Redis pub/sub:
 *
 * An event emitted on API instance A reaches clients
 * connected to API instance B.
 *
 * PostgreSQL remains the source of truth.
 * Redis is only used to fan events out between servers.
 */
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor!: ReturnType<
    typeof createAdapter
  >;

  private pubClient?: RedisClientType;

  private subClient?: RedisClientType;

  constructor(app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(
    url: string,
  ): Promise<void> {
    const pub = createClient({
      url,
    }) as RedisClientType;

    const sub = pub.duplicate() as RedisClientType;

    for (const client of [pub, sub]) {
      client.on('error', (error) => {
        console.error(
          JSON.stringify({
            level: 'error',
            msg: 'redis_error',
            error: String(error),
          }),
        );
      });
    }

    await Promise.all([
      pub.connect(),
      sub.connect(),
    ]);

    this.pubClient = pub;
    this.subClient = sub;

    this.adapterConstructor =
      createAdapter(pub, sub);
  }

  createIOServer(
    port: number,
    options?: ServerOptions,
  ) {
    const server =
      super.createIOServer(
        port,
        options,
      );

    if (this.adapterConstructor) {
      server.adapter(
        this.adapterConstructor,
      );
    }

    return server;
  }

  async close(): Promise<void> {
    const clients = [
      this.pubClient,
      this.subClient,
    ].filter(
      (
        client,
      ): client is RedisClientType =>
        client !== undefined,
    );

    await Promise.allSettled(
      clients.map((client) =>
        client.quit(),
      ),
    );

    this.pubClient = undefined;
    this.subClient = undefined;
  }
}
