import { DomainError } from '../domain/domain-error.js';
import type { FinancialSession } from './ports/financial-unit-of-work.js';
import type { SubmissionResult } from './transaction-result.js';

export async function resolveIdempotency(
  session: FinancialSession,
  key: string,
  hash: string,
  providerId: string,
  externalTransactionId: string,
): Promise<SubmissionResult | undefined> {
  const stored = await session.transactionByKey(key);

  if (stored) {
    if (!stored.transaction.matchesPayload(hash)) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Key já usada com payload diferente.');
    }
    if (!stored.snapshot) {
      throw new DomainError('IDEMPOTENCY_CONFLICT', 'Operação interna não admite replay externo.');
    }

    // Reproduzimos o saldo, status e código HTTP da primeira resposta, não o saldo atual.
    // A cópia evita alterar o snapshot persistido ao sinalizar idempotentReplay.
    const replay = structuredClone(stored.snapshot);
    replay.body.idempotentReplay = true;

    return replay;
  }
  // Uma nova key não pode registrar de novo a mesma identidade externa do provedor.
  if (await session.transactionByExternal(providerId, externalTransactionId)) {
    throw new DomainError(
      'EXTERNAL_TRANSACTION_CONFLICT',
      'Identidade externa já associada a outra key.',
    );
  }

  return undefined;
}
