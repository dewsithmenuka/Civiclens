import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { getConfig } from './config';

export function configureApp(app: INestApplication) {
    // Behind a reverse proxy / the dashboard: take the client IP from the last X-Forwarded-For entry. Hops, not "true":
  // trusting every hop would let anyone forge the header to dodge rate limits.
  const hops = getConfig().trustProxyHops;
  if (hops > 0) (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set('trust proxy', hops);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/live', 'health/ready'] });
  app.use(helmet());
  const origins = getConfig().corsOrigins;
  app.enableCors({ origin: origins.length ? origins : false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
}
