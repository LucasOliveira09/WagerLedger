import { expect, test } from 'bun:test';
import { Money } from '../../src/domain/money.js';
import { Wallet } from '../../src/domain/wallet.js';
import { InboxMessage } from '../../src/domain/inbox-message.js';
import { OutboxMessage } from '../../src/domain/outbox-message.js';
import { WalletBalanceChanged } from '../../src/domain/events/wallet-balance-changed.js';

test('inbox marca processamento uma vez e protege hash da mensagem', () => {
  const inbox = InboxMessage.receive({ messageId: 'message', consumerName: 'consumer', payloadHash: 'hash', receivedAt: new Date() });
  expect(inbox.isProcessed()).toBe(false);
  expect(inbox.matchesPayload('different')).toBe(false);
  inbox.markProcessed(new Date());
  expect(inbox.isProcessed()).toBe(true);
  expect(() => inbox.markProcessed(new Date())).toThrow();
});
test('outbox agenda retry e publica sem permitir mudanças posteriores', () => {
  const wallet = Wallet.open({ id: crypto.randomUUID(), playerId: crypto.randomUUID(), initialBalance: Money.zero('BRL') });
  const entry = wallet.credit(Money.from({ amount: '25.00', currency: 'BRL' }), { id: crypto.randomUUID(), transactionId: crypto.randomUUID() });
  const event = WalletBalanceChanged.from(wallet, entry, { correlationId: 'correlation' });
  const message = OutboxMessage.enqueue(event);
  const now = new Date();
  message.scheduleRetry(now);
  expect(message.attempts).toBe(1);
  expect(message.isDue(now)).toBe(false);
  expect(message.isDue(new Date(now.getTime() + 1000))).toBe(true);
  expect(event.toJSON().data.walletVersion).toBe(2);
  message.markPublished(now);
  expect(message.isPending()).toBe(false);
  expect(() => message.scheduleRetry(now)).toThrow();
});
