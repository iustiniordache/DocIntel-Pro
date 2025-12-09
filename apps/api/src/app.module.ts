import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import appConfig from './config/app.config';
import { AppConfigService } from './config/app-config.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [appConfig],
      isGlobal: true,
      envFilePath: ['.env.development', '.env'],
      ignoreEnvFile: process.env['NODE_ENV'] === 'production', // Skip .env files in Lambda
    }),
  ],
  controllers: [AppController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppModule {}
