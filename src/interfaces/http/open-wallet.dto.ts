import { objectInput, moneyInput, uuidInput } from '../contracts/input-validation.js';
import type { OpenWalletInput } from '../../application/open-wallet.js';

export function parseOpenWallet(input: unknown): OpenWalletInput {
  const props = objectInput(input, ['playerId', 'initialBalance']);
  return { playerId: uuidInput(props.playerId, 'playerId'), initialBalance: moneyInput(props.initialBalance) };
}
