import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { createOrm } from '../../src/infrastructure/persistence/orm.js';

test('schema de transações protege keys, identidade externa e inbox', async () => {
  const db = await createTestDatabase();
  const em = db.orm.em.fork();
  const wallet = crypto.randomUUID(); const player = crypto.randomUUID();
  try {
    await em.execute('insert into wallets(id,player_id,currency,balance) values(?,?,?,?)', [wallet, player, 'BRL', '0.00']);
    const insert = (id: string, key: string, external: string) => em.execute('insert into wager_transactions(id,provider_id,external_transaction_id,idempotency_key,payload_hash,wallet_id,player_id,round_id,game_id,kind,amount,currency,status) values(?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, 'provider', external, key, 'hash', wallet, player, 'round', 'game', 'LOSS', '0.00', 'BRL', 'PROCESSED']);
    await insert(crypto.randomUUID(), 'key', 'external');
    await expect(insert(crypto.randomUUID(), 'key', 'other')).rejects.toThrow();
    await expect(insert(crypto.randomUUID(), 'other', 'external')).rejects.toThrow();
    await em.execute('insert into inbox_messages(message_id,consumer_name,payload_hash) values(?,?,?)', ['message', 'consumer', 'hash']);
    await expect(em.execute('insert into inbox_messages(message_id,consumer_name,payload_hash) values(?,?,?)', ['message', 'consumer', 'other'])).rejects.toThrow();
    await expect(em.execute("update wager_transactions set status = 'PENDING' where idempotency_key = ?", ['key'])).rejects.toThrow();
    const appUrl = new URL(db.url); appUrl.username = 'wagerledger_app'; appUrl.password = 'local-development-only';
    const appOrm = await createOrm(appUrl.toString());
    try { await expect(appOrm.em.fork().execute('TRUNCATE wallet_ledger')).rejects.toThrow(); }
    finally { await appOrm.close(); }
    await db.orm.migrator.down({ to: 0 });
    await db.orm.migrator.up();
  } finally { await db.close(); }
}, 30000);
