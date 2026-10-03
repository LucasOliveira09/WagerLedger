import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { HealthService } from '../../infrastructure/observability/health-service.js';
import { telemetry } from '../../infrastructure/observability/telemetry.js';

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}
  @Get('health/live')
  live() { return { status: 'alive' }; }
  @Get('health/ready')
  async ready(@Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const result = await this.health.ready(); response.status(result.status === 'ready' ? 200 : 503); return result;
  }
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  metrics() { return telemetry.render(); }
}
