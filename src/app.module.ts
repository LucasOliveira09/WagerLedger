import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { MikroORM } from '@mikro-orm/postgresql';
import { ormOptions } from './infrastructure/persistence/orm.js';
import { MikroFinancialUnitOfWork } from './infrastructure/persistence/mikro-financial-unit-of-work.js';
import { OpenWallet } from './application/open-wallet.js';
import { WalletController } from './interfaces/http/wallet-controller.js';
import { WagerController } from './interfaces/http/wager-controller.js';
import { ProcessWager } from './application/process-wager.js';

@Module({})
export class AppModule {
  static register(databaseUrl?: string): DynamicModule {
    return {
      module: AppModule, imports: [MikroOrmModule.forRoot(ormOptions(databaseUrl))], controllers: [WalletController, WagerController],
      providers: [
        { provide: MikroFinancialUnitOfWork, useFactory: (orm: MikroORM) => new MikroFinancialUnitOfWork(orm), inject: [MikroORM] },
        { provide: OpenWallet, useFactory: (uow: MikroFinancialUnitOfWork) => new OpenWallet(uow), inject: [MikroFinancialUnitOfWork] },
        { provide: ProcessWager, useFactory: (uow: MikroFinancialUnitOfWork) => new ProcessWager(uow), inject: [MikroFinancialUnitOfWork] },
      ],
    };
  }
}
