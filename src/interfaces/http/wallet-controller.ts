import { Body, Controller, Headers, Inject, Post } from '@nestjs/common';
import { OpenWallet } from '../../application/open-wallet.js';
import { parseOpenWallet } from './open-wallet.dto.js';
import { correlationInput } from './input-validation.js';

@Controller('wallets')
export class WalletController {
  constructor(@Inject(OpenWallet) private readonly openWallet: OpenWallet) {}
  @Post()
  create(@Body() input: unknown, @Headers('x-correlation-id') correlationId?: string) {
    return this.openWallet.execute(parseOpenWallet(input), { correlationId: correlationInput(correlationId) });
  }
}
