import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { Handler, Context, APIGatewayProxyEvent } from 'aws-lambda';
import { INestApplication } from '@nestjs/common';

let cachedApp: INestApplication | null = null;

async function bootstrapApp() {
  if (!cachedApp) {
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn'],
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();
    cachedApp = app;
  }
  return cachedApp;
}

export const handler: Handler = async (event: APIGatewayProxyEvent, context: Context) => {
  const app = await bootstrapApp();

  // Convert API Gateway event to HTTP request
  const httpAdapter = app.getHttpAdapter();

  try {
    const response = await httpAdapter.reply({ event, context }, null, event.httpMethod);
    return response;
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
