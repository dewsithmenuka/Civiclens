import { getConfig } from './config';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://localhost/civiclens',
  JWT_SECRET: 'x'.repeat(40),
};

describe('getConfig', () => {
  it('requires Redis in production for shared rate limiting', () => {
    expect(() => getConfig(productionEnv)).toThrow(
      'REDIS_URL is required in production for shared rate limiting',
    );
  });

  it('accepts a production Redis URL', () => {
    expect(getConfig({ ...productionEnv, REDIS_URL: 'redis://localhost:6379' }).redisUrl)
      .toBe('redis://localhost:6379');
  });
});
