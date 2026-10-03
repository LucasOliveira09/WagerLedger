import { DomainError } from '../../domain/domain-error.js';
import { payloadHash } from '../../application/canonical-payload.js';
import { objectInput, stringInput } from '../contracts/input-validation.js';
import { parseWager } from '../contracts/wager.dto.js';

export function parseWagerMessage(body: string) {
  let decoded: unknown;
  try { decoded = JSON.parse(body); } catch { throw new DomainError('INVALID_MESSAGE', 'Mensagem deve ser JSON válido.'); }
  const envelope = objectInput(decoded, ['messageId', 'type', 'occurredAt', 'data', 'correlationId']);
  const messageId = stringInput(envelope.messageId, 'messageId', 200);
  if (envelope.type !== 'WagerTransactionRequested') throw new DomainError('INVALID_MESSAGE', 'Tipo de mensagem inválido.');
  const occurredAt = stringInput(envelope.occurredAt, 'occurredAt', 24);
  if (!Number.isFinite(Date.parse(occurredAt)) || new Date(occurredAt).toISOString() !== occurredAt) throw new DomainError('INVALID_MESSAGE', 'Timestamp ISO UTC inválido.');
  const data = objectInput(envelope.data, ['idempotencyKey', 'providerId', 'externalTransactionId', 'walletId', 'playerId', 'roundId', 'gameId', 'kind', 'money', 'referenceExternalTransactionId']);
  const { idempotencyKey, ...business } = data;
  // messageId pertence ao envelope, não ao broker. A inbox compara o envelope inteiro;
  // ProcessWager calcula outro hash, só do negócio, para idempotência compartilhada com HTTP.
  return { messageId, key: stringInput(idempotencyKey, 'idempotencyKey', 256), input: parseWager(business), payloadHash: payloadHash(envelope),
    context: { correlationId: envelope.correlationId === undefined ? messageId : stringInput(envelope.correlationId, 'correlationId', 128), causationId: messageId } };
}
