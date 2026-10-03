import { Body, Controller, Headers, Inject, Post, Res } from '@nestjs/common';
import { ProcessWager } from '../../application/process-wager.js';
import { parseWager } from './wager.dto.js';
import { correlationInput, stringInput } from './input-validation.js';

@Controller('wagering/transactions')
export class WagerController {
  constructor(@Inject(ProcessWager) private readonly processWager: ProcessWager) {}
  @Post()
  async submit(@Body() input: unknown, @Headers('idempotency-key') key: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined, @Res({ passthrough: true }) response: { status(code: number): unknown }) {
    const result = await this.processWager.execute(parseWager(input), stringInput(key, 'Idempotency-Key', 256), { correlationId: correlationInput(correlationId) });
    response.status(result.statusCode);
    return result.body;
  }
}
