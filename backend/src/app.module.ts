import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesController } from './categories/categories.controller';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { LoggingInterceptor } from './common/logging.interceptor';
import { RATE_LIMIT_STORAGE, RateLimitStorageModule } from './common/rate-limit.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { IssuesModule } from './issues/issues.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStorageModule],
      inject: [RATE_LIMIT_STORAGE],
      useFactory: (storage?: ThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        skipIf: (ctx) =>
          process.env.NODE_ENV === 'test' &&
          !ctx.switchToHttp().getRequest().headers?.['x-enforce-rate-limit'],
        ...(storage ? { storage } : {}),
      }),
    }),
    DatabaseModule,
    AuditModule,
    StorageModule,
    AuthModule,
    IssuesModule,
    UploadsModule,
    AdminModule,
  ],
  controllers: [
    CategoriesController,
    HealthController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}