import { Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { OpenWallet } from '../../application/open-wallet.js';
import { parseOpenWallet } from './open-wallet.dto.js';
import { correlationInput, stringInput, uuidInput } from './input-validation.js';
import { DomainError } from '../../domain/domain-error.js';
import { FinancialQueries } from '../../application/financial-queries.js';
import { ReconcileWallet } from '../../application/reconcile-wallet.js';

@Controller('wallets')
export class WalletController {
  constructor(@Inject(OpenWallet) private readonly openWallet: OpenWallet, @Inject(FinancialQueries) private readonly queries: FinancialQueries, @Inject(ReconcileWallet) private readonly reconcileWallet: ReconcileWallet) {}
  @Post(':walletId/reconciliation')
  @HttpCode(200)
  reconcile(@Param('walletId') walletId: string, @Headers('x-correlation-id') correlationId?: string) {
    return this.reconcileWallet.execute(uuidInput(walletId, 'walletId'), { correlationId: correlationInput(correlationId) });
  }
  @Get(':walletId')
  get(@Param('walletId') walletId: string) { return this.queries.wallet(uuidInput(walletId, 'walletId')); }
  @Get(':walletId/ledger')
  ledger(@Param('walletId') walletId: string, @Query('limit') limit?: string, @Query('cursor') cursor?: string) {
    if (limit !== undefined && (typeof limit !== 'string' || !/^[1-9]\d{0,2}$/.test(limit))) throw new DomainError('INVALID_LIMIT', 'Limit deve ser inteiro positivo.');
    return this.queries.ledger(uuidInput(walletId, 'walletId'), limit === undefined ? 50 : Number(limit), cursor === undefined ? undefined : stringInput(cursor, 'cursor', 512));
  }
  @Post()
  create(@Body() input: unknown, @Headers('x-correlation-id') correlationId?: string) {
    return this.openWallet.execute(parseOpenWallet(input), { correlationId: correlationInput(correlationId) });
  }
}
