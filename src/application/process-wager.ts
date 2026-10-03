import { DomainError } from '../domain/domain-error.js';
import { Money } from '../domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { WagerTransactionProcessed } from '../domain/events/wager-transaction-processed.js';
import { WagerTransactionRejected } from '../domain/events/wager-transaction-rejected.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.js';
import { payloadHash } from './canonical-payload.js';
import { resolveIdempotency } from './idempotency.js';
import type { MoneyProps } from '../domain/money.js';
import type { WagerKind } from '../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import type { EventContext } from '../domain/events/integration-event.js';
import type { FinancialUnitOfWork } from './ports/financial-unit-of-work.js';
import type { SubmissionResult } from './transaction-result.js';

export interface WagerInput {
  providerId: string; externalTransactionId: string; walletId: string; playerId: string;
  roundId: string; gameId: string; kind: Exclude<WagerKind, 'OPENING'>; money: MoneyProps;
  referenceExternalTransactionId?: string;
}
export class ProcessWager {
  constructor(private readonly uow: FinancialUnitOfWork) {}
  async execute(input: WagerInput, key: string, context: EventContext): Promise<SubmissionResult> {
    if (input.kind !== 'BET') throw new DomainError('UNSUPPORTED_OPERATION', 'Operação ainda indisponível.');
    const money = Money.from(input.money); const hash = payloadHash(input);
    return this.uow.run(input.walletId, async session => {
      const replay = await resolveIdempotency(session, key, hash, input.providerId, input.externalTransactionId);
      if (replay) return replay;
      const wallet = session.wallet!;
      const tx = WagerTransaction.create({ ...input, id: crypto.randomUUID(), money, idempotencyKey: key, payloadHash: hash });
      let entry: WalletLedgerEntry | undefined;
      if (input.playerId !== wallet.playerId) tx.reject('WALLET_IDENTITY_MISMATCH');
      else if (money.currency !== wallet.currency) tx.reject('CURRENCY_MISMATCH');
      else {
        try {
          entry = wallet.debit(money, { id: crypto.randomUUID(), transactionId: tx.id });
          tx.markProcessed(undefined, new Date());
        } catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'INSUFFICIENT_FUNDS') throw error;
          tx.reject('INSUFFICIENT_FUNDS');
        }
      }
      const result: SubmissionResult = { statusCode: tx.status === 'REJECTED' ? 422 : 200,
        body: { transactionId: tx.id, status: tx.status, balance: wallet.balance.toJSON(), idempotentReplay: false, ...(tx.failureCode ? { failureCode: tx.failureCode } : {}) } };
      await session.saveTransaction(tx, result);
      if (entry) { await session.saveWallet(wallet); await session.appendLedger(entry); }
      const event = tx.status === 'REJECTED' ? WagerTransactionRejected.from(tx, wallet, context) : WagerTransactionProcessed.from(tx, wallet, context);
      const messages = [OutboxMessage.enqueue(event)];
      if (entry) messages.push(OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, context)));
      await session.appendOutbox(messages);
      return result;
    });
  }
}
