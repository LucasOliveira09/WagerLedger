import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { ormOptions } from './infrastructure/persistence/orm.js';
import { MikroFinancialUnitOfWork } from './infrastructure/persistence/mikro-financial-unit-of-work.js';
import { OpenWallet } from './application/open-wallet.js';
import { WalletController } from './interfaces/http/wallet-controller.js';
import { ProviderTransactionController, WagerController } from './interfaces/http/wager-controller.js';
import { ProcessWager } from './application/process-wager.js';
import { FinancialQueries } from './application/financial-queries.js';
import { MikroFinancialReadStore } from './infrastructure/persistence/mikro-financial-read-store.js';
import { ReconcileWallet } from './application/reconcile-wallet.js';
import { telemetry } from './infrastructure/observability/telemetry.js';
import { HealthService } from './infrastructure/observability/health-service.js';
import { HealthController } from './interfaces/http/health-controller.js';
import { createSqsClient } from './infrastructure/messaging/sqs-client.js';
import { DeclaredProviderIdentity, ProviderIdentityPort } from './application/ports/provider-identity.js';

@Module({})
// Ponto de composição da API: NestJS conecta casos de uso às implementações de banco
// e identidade. O domínio e os casos de uso não precisam importar decorators do framework.
export class AppModule {
  static register(databaseUrl?: string, sqsEndpoint?: string): DynamicModule {
    return {
      module: AppModule, imports: [MikroOrmModule.forRoot(ormOptions(databaseUrl))], controllers: [WalletController, WagerController, ProviderTransactionController, HealthController],
      providers: [
        { provide: ProviderIdentityPort, useClass: DeclaredProviderIdentity },
        { provide: HealthService, useFactory: (orm: MikroORM) => new HealthService(orm, createSqsClient(sqsEndpoint)), inject: [MikroORM] },
        { provide: ReconcileWallet, useFactory: (orm: MikroORM) => new ReconcileWallet(new MikroFinancialReadStore(orm), telemetry), inject: [MikroORM] },
        { provide: FinancialQueries, useFactory: (orm: MikroORM) => new FinancialQueries(new MikroFinancialReadStore(orm)), inject: [MikroORM] },
        { provide: MikroFinancialUnitOfWork, useFactory: (orm: MikroORM) => new MikroFinancialUnitOfWork(orm, telemetry), inject: [MikroORM] },
        { provide: OpenWallet, useFactory: (uow: MikroFinancialUnitOfWork) => new OpenWallet(uow), inject: [MikroFinancialUnitOfWork] },
        { provide: ProcessWager, useFactory: (uow: MikroFinancialUnitOfWork) => new ProcessWager(uow, telemetry), inject: [MikroFinancialUnitOfWork] },
      ],
    };
  }
}
