import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { REDIS_HEALTH_CHECK } from '../common/rate-limit.module';
import { Database } from '../database/database.service';
import { StorageService } from '../storage/storage.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private db: Database,
    private storage: StorageService,
    @Optional() @Inject(REDIS_HEALTH_CHECK)
    private redisHealthCheck?: () => Promise<string>,
  ) {}
  @Public() @Get() root() { return { status: 'ok' }; }
  @Public() @Get('live') live() { return { status: 'ok' }; }
  @Public() @Get('ready')
  async ready() {
    const checks: Record<string, string> = {
      database: 'down',
      postgis: 'unknown',
      redis: this.redisHealthCheck ? 'down' : 'not_configured',
      storage: 'unknown',
    };

    try {
      await this.db.query('SELECT 1');
      checks.database = 'up';
    } catch {
      return this.unavailable(checks);
    }

    try {
      const { rows } = await this.db.query(`SELECT extversion FROM pg_extension WHERE extname = 'postgis'`);
      checks.postgis = rows[0]?.extversion ?? 'missing';
    } catch {
      checks.postgis = 'down';
    }

    if (this.redisHealthCheck) {
      try {
        checks.redis = (await this.redisHealthCheck()) === 'PONG' ? 'up' : 'down';
      } catch {
        checks.redis = 'down';
      }
    }

    try {
      checks.storage = await this.storage.healthCheck();
    } catch {
      checks.storage = 'down';
    }

    if (Object.values(checks).some((check) => ['down', 'missing', 'unknown'].includes(check))) {
      return this.unavailable(checks);
    }
    return { status: 'ok', checks };
  }

  private unavailable(checks: Record<string, string>): never {
    throw new ServiceUnavailableException({ status: 'unavailable', checks });
  }
}
