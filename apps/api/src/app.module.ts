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
    }),
  ],
  controllers: [AppController],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppModule {}
