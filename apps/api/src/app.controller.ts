import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHealth() {
    return {
      status: 'ok',
      message: 'DocIntel Pro API is running',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  getHealthCheck() {
    return {
      status: 'healthy',
      service: 'docintel-pro-api',
      timestamp: new Date().toISOString(),
    };
  }
}
