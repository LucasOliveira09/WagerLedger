import { Body, Controller, Get, Headers, Inject, Param, Post, Res } from '@nestjs/common';
import { ProcessWager } from '../../application/process-wager.js';
import { parseWager } from '../contracts/wager.dto.js';
import { correlationInput, stringInput, uuidInput } from '../contracts/input-validation.js';
import { FinancialQueries } from '../../application/financial-queries.js';

@Controller('wagering/transactions')
export class WagerController {
  constructor(@Inject(ProcessWager) private readonly processWager: ProcessWager, @Inject(FinancialQueries) private readonly queries: FinancialQueries) {}
  @Get(':transactionId')
  get(@Param('transactionId') id: string) { return this.queries.transaction(uuidInput(id, 'transactionId')); }
  @Post()
  async submit(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined, @Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const result = await this.processWager.execute(parseWager(input), stringInput(key, 'Idempotency-Key', 256), { correlationId: correlationInput(correlationId) });
    response.status(result.statusCode);
    return result.body;
  }
}

@Controller('providers/:providerId/wagering/transactions')
export class ProviderTransactionController {
  constructor(@Inject(FinancialQueries) private readonly queries: FinancialQueries) {}
  @Get(':externalTransactionId')
  get(@Param('providerId') providerId: string, @Param('externalTransactionId') externalId: string) {
    return this.queries.external(stringInput(providerId, 'providerId', 100), stringInput(externalId, 'externalTransactionId', 200));
  }
}
