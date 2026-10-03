import { DomainError } from '../domain/domain-error.js';
import type { FinancialReadStore } from './ports/financial-read-store.js';
import type { WagerTransaction } from '../domain/wager-transaction.js';

interface Cursor {
  v: 1;
  walletId: string;
  after: number;
  through: number;
}

function decodeCursor(value: string, walletId: string): Cursor {
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
      throw new Error();
    }

    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;

    if (
      cursor.v !== 1 ||
      cursor.walletId !== walletId ||
      !Number.isSafeInteger(cursor.after) ||
      !Number.isSafeInteger(cursor.through) ||
      cursor.after < 0 ||
      cursor.through < cursor.after
    ) {
      throw new Error();
    }

    return cursor;
  } catch {
    throw new DomainError('INVALID_CURSOR', 'Cursor inválido para esta carteira.');
  }
}

function transactionView(tx: WagerTransaction) {
  return {
    id: tx.id,
    providerId: tx.providerId,
    externalTransactionId: tx.externalTransactionId,
    walletId: tx.walletId,
    playerId: tx.playerId,
    roundId: tx.roundId,
    gameId: tx.gameId,
    kind: tx.kind,
    money: tx.money.toJSON(),
    status: tx.status,
    referenceExternalTransactionId: tx.referenceExternalTransactionId ?? null,
    referenceTransactionId: tx.referenceTransactionId ?? null,
    failureCode: tx.failureCode ?? null,
    createdAt: tx.createdAt.toISOString(),
    processedAt: tx.processedAt?.toISOString() ?? null,
  };
}

export class FinancialQueries {
  constructor(private readonly store: FinancialReadStore) {}

  async wallet(id: string) {
    const wallet = await this.store.wallet(id);

    if (!wallet) {
      throw new DomainError('WALLET_NOT_FOUND', 'Carteira inexistente.');
    }

    return wallet;
  }

  async transaction(id: string) {
    const tx = await this.store.transaction(id);

    if (!tx) {
      throw new DomainError('TRANSACTION_NOT_FOUND', 'Transação inexistente.');
    }

    return transactionView(tx);
  }

  async external(providerId: string, externalId: string) {
    const tx = await this.store.external(providerId, externalId);

    if (!tx) {
      throw new DomainError('TRANSACTION_NOT_FOUND', 'Transação inexistente.');
    }

    return transactionView(tx);
  }

  async ledger(walletId: string, limit = 50, encoded?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new DomainError('INVALID_LIMIT', 'Limit deve estar entre 1 e 100.');
    }

    const wallet = await this.wallet(walletId);
    // through fixa a versão da primeira página. Novos lançamentos ficam fora desta leitura,
    // evitando que o histórico cresça durante a paginação; after marca o último visto.
    const cursor =
      encoded === undefined
        ? { v: 1 as const, walletId, after: 0, through: wallet.version }
        : decodeCursor(encoded, walletId);

    if (cursor.through > wallet.version) {
      throw new DomainError('INVALID_CURSOR', 'Cursor aponta para versão futura.');
    }

    const rows = await this.store.ledger(walletId, cursor.after, cursor.through, limit + 1);
    const entries = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? Buffer.from(JSON.stringify({ ...cursor, after: entries.at(-1)!.sequence })).toString(
            'base64url',
          )
        : null;

    return { entries, nextCursor };
  }
}
