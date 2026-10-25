import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { configureApp } from './app.setup';
import { getConfig } from './config';

async function bootstrap() {
  const cfg = getConfig();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(), { bufferLogs: false });
  if (cfg.redisUrl) {
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis(cfg.redisUrl); // throws if Redis is configured but unreachable: fail fast, never degrade silently
    app.useWebSocketAdapter(adapter);
  } else {
    app.useWebSocketAdapter(new IoAdapter(app));
  }
  configureApp(app);
  app.enableShutdownHooks();

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('CivicLens API').setVersion('0.1.0').addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, doc);

  await app.listen(cfg.port, '0.0.0.0');
  console.log(JSON.stringify({ level: 'info', msg: 'api_started', port: cfg.port, docs: '/docs' }));
}
bootstrap();