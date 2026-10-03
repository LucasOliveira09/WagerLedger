import { Wallet } from '../domain/wallet.js';
import { Money } from '../domain/money.js';
import { WagerTransaction } from '../domain/wager-transaction.js';
import { WalletLedgerEntry } from '../domain/wallet-ledger-entry.js';
import { OutboxMessage } from '../domain/outbox-message.js';
import { WalletBalanceChanged } from '../domain/events/wallet-balance-changed.js';
import { WagerTransactionProcessed } from '../domain/events/wager-transaction-processed.js';
import type { FinancialUnitOfWork } from './ports/financial-unit-of-work.js';
import type { MoneyProps } from '../domain/money.js';
import type { EventContext } from '../domain/events/integration-event.js';

export interface OpenWalletInput {
  playerId: string;
  initialBalance: MoneyProps;
}

export class OpenWallet {
  constructor(private readonly uow: FinancialUnitOfWork) {}

  async execute(input: OpenWalletInput, context: EventContext) {
    const initial = Money.from(input.initialBalance);
    const wallet = Wallet.open({
      id: crypto.randomUUID(),
      playerId: input.playerId,
      initialBalance: initial,
    });

    // Não há carteira existente para bloquear: a unicidade jogador/moeda é garantida no banco.
    return this.uow.run(undefined, async (session) => {
      await session.addWallet(wallet);

      // O saldo inicial positivo precisa de origem auditável: OPENING + crédito de sequência 1.
      // Wallet.open já definiu esse saldo e versão; credit() aqui somaria o valor uma segunda vez.
      // Com saldo zero não há movimentação, lançamento ou evento de abertura.
      if (initial.isPositive()) {
        const tx = WagerTransaction.create({
          id: crypto.randomUUID(),
          providerId: '__internal__',
          externalTransactionId: wallet.id,
          idempotencyKey: `opening:${wallet.id}`,
          payloadHash: 'internal-opening',
          walletId: wallet.id,
          playerId: wallet.playerId,
          roundId: '__opening__',
          gameId: '__opening__',
          kind: 'OPENING',
          money: initial,
        });
        tx.markProcessed(undefined, new Date());
        await session.saveTransaction(tx);
        const entry = WalletLedgerEntry.create({
          id: crypto.randomUUID(),
          walletId: wallet.id,
          transactionId: tx.id,
          direction: 'CREDIT',
          money: initial,
          balanceBefore: Money.zero(wallet.currency),
          balanceAfter: initial,
          sequence: 1,
          createdAt: wallet.createdAt,
        });
        await session.appendLedger(entry);
        await session.appendOutbox([
          OutboxMessage.enqueue(WagerTransactionProcessed.from(tx, wallet, context)),
          OutboxMessage.enqueue(WalletBalanceChanged.from(wallet, entry, context)),
        ]);
      }

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance.toJSON(),
        version: wallet.version,
      };
    });
  }
}
