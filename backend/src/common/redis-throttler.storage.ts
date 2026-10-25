import { createHash, randomUUID } from 'crypto';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { RedisClientType } from 'redis';

const INCREMENT_SCRIPT = `
local redisTime = redis.call('TIME')
local now = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])
local member = ARGV[4]

local blockedUntil = redis.call('GET', KEYS[2])
if blockedUntil then
  blockedUntil = tonumber(blockedUntil)
  if blockedUntil > now then
    local blockedFor = math.ceil((blockedUntil - now) / 1000)
    local expiresIn = redis.call('PTTL', KEYS[1])
    return {redis.call('ZCARD', KEYS[1]), math.max(0, math.ceil(expiresIn / 1000)), 1, blockedFor}
  end
  redis.call('DEL', KEYS[1], KEYS[2])
end

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - ttl)
local hits = redis.call('ZCARD', KEYS[1])
local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local expiresIn = ttl
if #first > 0 then
  expiresIn = math.max(0, math.ceil((tonumber(first[2]) + ttl - now) / 1000))
end

if blockDuration <= 0 and hits >= limit then
  return {hits + 1, expiresIn, 1, expiresIn}
end

redis.call('ZADD', KEYS[1], now, member)
redis.call('PEXPIRE', KEYS[1], ttl)
hits = hits + 1

if blockDuration > 0 and hits > limit then
  local blockedUntil = now + blockDuration
  redis.call('SET', KEYS[2], blockedUntil, 'PX', blockDuration + ttl)
  return {hits, expiresIn, 1, math.ceil(blockDuration / 1000)}
end

return {hits, expiresIn, 0, 0}
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly client: RedisClientType) {}

  ping(): Promise<string> {
    return this.client.ping();
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): ReturnType<ThrottlerStorage['increment']> {
    const digest = createHash('sha256').update(`${throttlerName}:${key}`).digest('hex');
    const redisKey = `civiclens:throttle:{${digest}}`;
    const result: unknown = await this.client.eval(INCREMENT_SCRIPT, {
      keys: [`${redisKey}:hits`, `${redisKey}:block`],
      arguments: [
        String(ttl),
        String(limit),
        String(blockDuration),
        randomUUID(),
      ],
    });

    if (!Array.isArray(result) || result.length !== 4) {
      throw new Error('Redis throttler returned an invalid storage record');
    }
    const [totalHits, timeToExpire, isBlocked, timeToBlockExpire] = result.map(Number);
    if (![totalHits, timeToExpire, isBlocked, timeToBlockExpire].every(Number.isFinite)) {
      throw new Error('Redis throttler returned a non-numeric storage record');
    }
    return {
      totalHits,
      timeToExpire,
      isBlocked: isBlocked === 1,
      timeToBlockExpire,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}
