import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './interfaces/http/error-filter.js';

export async function bootstrap(options: { databaseUrl?: string; port?: number; host?: string; quiet?: boolean } = {}) {
  const app = await NestFactory.create(AppModule.register(options.databaseUrl), options.quiet ? { logger: false } : {});
  app.useGlobalFilters(new HttpErrorFilter());
  app.enableShutdownHooks();
  await app.listen(options.port ?? Number(process.env.PORT ?? '3000'), options.host ?? '0.0.0.0');
  return app;
}

if (import.meta.main) {
  await bootstrap();
}
