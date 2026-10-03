import { DomainError } from '../../domain/domain-error.js';
import { objectInput, stringInput, uuidInput, moneyInput } from './input-validation.js';
import type { WagerInput } from '../../application/process-wager.js';

export function parseWager(input: unknown): WagerInput {
  const props = objectInput(input, [
    'providerId',
    'externalTransactionId',
    'walletId',
    'playerId',
    'roundId',
    'gameId',
    'kind',
    'money',
    'referenceExternalTransactionId',
  ]);
  const providerId = stringInput(props.providerId, 'providerId', 100);

  if (providerId.startsWith('__')) {
    throw new DomainError('INVALID_PROVIDER', 'Identidade reservada para operações internas.');
  }

  const kind = stringInput(props.kind, 'kind', 8);

  if (!['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'].includes(kind)) {
    throw new DomainError('INVALID_KIND', 'Tipo de operação inválido.');
  }

  return {
    providerId,
    externalTransactionId: stringInput(props.externalTransactionId, 'externalTransactionId'),
    walletId: uuidInput(props.walletId, 'walletId'),
    playerId: uuidInput(props.playerId, 'playerId'),
    roundId: stringInput(props.roundId, 'roundId'),
    gameId: stringInput(props.gameId, 'gameId'),
    kind: kind as WagerInput['kind'],
    money: moneyInput(props.money),
    ...(props.referenceExternalTransactionId !== undefined
      ? {
          referenceExternalTransactionId: stringInput(
            props.referenceExternalTransactionId,
            'referenceExternalTransactionId',
          ),
        }
      : {}),
  };
}
