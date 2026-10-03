import { expect, test } from 'bun:test';
import { OpenWallet } from '../../src/application/open-wallet.js';
import { MikroFinancialUnitOfWork } from '../../src/infrastructure/persistence/mikro-financial-unit-of-work.js';
import { createTestDatabase } from '../support/test-database.js';
import { auditOutbox } from '../load/environment.js';

test('auditoria de carga detecta eventos ausentes mesmo com outbox sem pendências', async () => {
  const db = await createTestDatabase();
  try {
    await new OpenWallet(new MikroFinancialUnitOfWork(db.orm)).execute({ playerId: crypto.randomUUID(),
      initialBalance: { amount: '100.00', currency: 'BRL' } }, { correlationId: 'load-audit' });
    expect(await auditOutbox(db.orm)).toMatchObject({ expectedEvents: 2, totalEvents: 2, consistent: true });
    const em = db.orm.em.fork();
    await em.execute('create temporary table saved_events as select * from outbox_messages');
    // Exclusão administrativa apenas no banco temporário para simular uma regressão de emissão.
    await em.execute('delete from outbox_messages');
    expect(await auditOutbox(db.orm)).toMatchObject({ expectedEvents: 2, totalEvents: 0, invalidTransactions: 1, consistent: false });
    await em.execute(`insert into outbox_messages(id,aggregate_id,event_type,payload,occurred_at,attempts)
      select id,aggregate_id,'WagerTransactionProcessed',
        jsonb_set(payload,'{eventType}','"WagerTransactionProcessed"'::jsonb),occurred_at,attempts from saved_events`);
    expect(await auditOutbox(db.orm)).toMatchObject({ expectedEvents: 2, totalEvents: 2, invalidTransactions: 1, consistent: false });
  } finally { await db.close(); }
}, 30000);
