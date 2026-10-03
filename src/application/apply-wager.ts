import { DomainError } from '../domain/domain-error.js';
import { referenceFailure } from '../domain/reference-rules.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { WagerTransactionProcessed } from '../domain/events/wager-transaction-processed.js';
import { WagerTransactionRejected } from '../domain/events/wager-transaction-rejected.js';
import { WagerTransactionPendingReference } from '../domain/events/wager-transaction-pending-reference.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.js';
import type { WagerTransaction } from '../domain/wager-transaction.js';
import type { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import type { FinancialSession } from './ports/financial-unit-of-work.js';
import type { EventContext } from '../domain/events/integration-event.js';
import type { SubmissionResult } from './transaction-result.js';

export async function applyWager(session: FinancialSession, tx: WagerTransaction, context: EventContext): Promise<SubmissionResult> {
  const wallet = session.wallet!;
  let reference: WagerTransaction | undefined;
  if (tx.playerId !== wallet.playerId) tx.reject('WALLET_IDENTITY_MISMATCH');
  else if (tx.money.currency !== wallet.currency) tx.reject('CURRENCY_MISMATCH');
  else if (tx.referenceExternalTransactionId) {
    reference = (await session.transactionByExternal(tx.providerId, tx.referenceExternalTransactionId))?.transaction;
    if (!reference || !reference.isTerminal()) tx.markPendingReference();
    else {
      const failure = referenceFailure(tx, reference);
      if (failure) tx.reject(failure);
    }
  }
  let entry: WalletLedgerEntry | undefined;
  if (!tx.isTerminal() && tx.status !== 'PENDING_REFERENCE') {
    try {
      if (tx.affectsBalance()) {
        const metadata = { id: crypto.randomUUID(), transactionId: tx.id };
        entry = tx.ledgerDirectionFor(reference) === 'DEBIT' ? wallet.debit(tx.money, metadata) : wallet.credit(tx.money, metadata);
      }
      tx.markProcessed(reference?.id, new Date());
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      if (error.code === 'INSUFFICIENT_FUNDS') tx.reject(tx.requiresReference() ? 'REVERSAL_INSUFFICIENT_FUNDS' : 'INSUFFICIENT_FUNDS');
      else if (error.code === 'AMOUNT_OUT_OF_RANGE') tx.reject('AMOUNT_OUT_OF_RANGE');
      else throw error;
    }
  }
  const result: SubmissionResult = {
    statusCode: tx.status === 'PENDING_REFERENCE' ? 202 : tx.status === 'REJECTED' ? 422 : 200,
    body: { transactionId: tx.id, status: tx.status, balance: wallet.balance.toJSON(), idempotentReplay: false, ...(tx.failureCode ? { failureCode: tx.failureCode } : {}) },
  };
  await session.saveTransaction(tx, result);
  if (entry) { await session.saveWallet(wallet); await session.appendLedger(entry); }
  const event = tx.status === 'PENDING_REFERENCE' ? WagerTransactionPendingReference.from(tx, wallet, context)
    : tx.status === 'REJECTED' ? WagerTransactionRejected.from(tx, wallet, context) : WagerTransactionProcessed.from(tx, wallet, context);
  const messages = [OutboxMessage.enqueue(event)];
  if (entry) messages.push(OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, context)));
  await session.appendOutbox(messages);
  return result;
}
