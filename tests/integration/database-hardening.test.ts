import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { createOrm } from '../../src/infrastructure/persistence/orm.js';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { ProcessWager } from '../../src/application/process-wager.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';

test('role da aplicação não contorna tipo, direção, identidade ou conteúdo imutável', async () => {
  const db = await createTestDatabase(); const appOrm = await createOrm(db.appUrl); const uow = new MikroFinancialUnitOfWork(appOrm); const context = { correlationId: 'hardening' };
  try {
    const wallet = await new OpenWallet(uow).execute({ playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } }, context);
    const process = new ProcessWager(uow);
    const base = { providerId: 'p', walletId: wallet.id, playerId: wallet.playerId, roundId: 'r', gameId: 'g', money: { amount: '10.00', currency: 'BRL' } };
    const loss = await process.execute({ ...base, kind: 'LOSS', externalTransactionId: 'loss' }, 'loss', context);
    const em = appOrm.em.fork();
    const append = (tx: typeof em, transactionId: string, direction: string, after: string) => tx.execute('insert into wallet_ledger(id,wallet_id,transaction_id,currency,direction,amount,balance_before,balance_after,sequence) values(?,?,?,?,?,?,?,?,2)', [crypto.randomUUID(), wallet.id, transactionId, 'BRL', direction, '10.00', '100.00', after]);
    await expect(em.transactional(async tx => {
      await tx.execute('update wallets set balance=110.00,version=2 where id=?', [wallet.id]);
      await append(tx, loss.body.transactionId, 'CREDIT', '110.00');
    })).rejects.toThrow();
    for (const kind of ['BET', 'WIN']) await expect(em.fork().transactional(async tx => {
      const id = crypto.randomUUID(); const direction = kind === 'BET' ? 'CREDIT' : 'DEBIT'; const after = direction === 'CREDIT' ? '110.00' : '90.00';
      await tx.execute("insert into wager_transactions(id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,status,processed_at) values(?,?,?,?,?,?,?,?,?,?,10.00,'BRL','PROCESSED',now())", [id, 'p', id, id, 'hash', wallet.id, wallet.playerId, 'r', 'g', kind]);
      await tx.execute('update wallets set balance=?,version=2 where id=?', [after, wallet.id]); await append(tx, id, direction, after);
    })).rejects.toThrow();
    const pending = await process.execute({ ...base, kind: 'REFUND', externalTransactionId: 'pending', referenceExternalTransactionId: 'absent' }, 'pending', context);
    await expect(em.fork().execute('update wager_transactions set amount=20.00 where id=?', [pending.body.transactionId])).rejects.toThrow();
    await expect(em.fork().execute("update outbox_messages set payload=jsonb_set(payload,'{data,status}','\"REJECTED\"')")).rejects.toThrow();
    const win = await process.execute({ ...base, kind: 'WIN', externalTransactionId: 'win' }, 'win', context);
    await expect(em.fork().transactional(async tx => {
      const id = crypto.randomUUID();
      await tx.execute("insert into wager_transactions(id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,status,reference_external_transaction_id,reference_transaction_id,processed_at) values(?,?,?,?,?,?,?,?,?,'REFUND',10.00,'BRL','PROCESSED','win',?,now())", [id, 'p', id, id, 'hash', wallet.id, wallet.playerId, 'r', 'g', win.body.transactionId]);
      await tx.execute('update wallets set balance=120.00,version=3 where id=?', [wallet.id]);
      await tx.execute("insert into wallet_ledger(id,wallet_id,transaction_id,currency,direction,amount,balance_before,balance_after,sequence) values(?,?,?,'BRL','CREDIT',10.00,110.00,120.00,3)", [crypto.randomUUID(), wallet.id, id]);
    })).rejects.toThrow();
  } finally { await appOrm.close(); await db.close(); }
}, 30000);
