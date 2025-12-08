import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import pino from 'pino';

async function bootstrap() {
  const logger = pino({
    level: process.env['LOG_LEVEL'] || 'info',
    transport:
      process.env['NODE_ENV'] === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  });

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    bufferLogs: true,
  });

  // Log startup
  logger.info('Initializing DocIntel Pro API...');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env['CORS_ORIGIN'] || '*',
    credentials: true,
  });

  const port = process.env['PORT'] || 3000;
  await app.listen(port);

  Logger.log(`🚀 API running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
