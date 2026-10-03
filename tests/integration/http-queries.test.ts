import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { bootstrap } from '../../src/main.js';

test('GETs públicos expõem carteira, ledger e identidades interna/externa', async () => {
  const db = await createTestDatabase();
  const app = await bootstrap({ databaseUrl: db.url, port: 0, host: '127.0.0.1', quiet: true });

  try {
    const url = await app.getUrl();
    const response = await fetch(`${url}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: crypto.randomUUID(),
        initialBalance: { amount: '100.00', currency: 'BRL' },
      }),
    });
    const wallet = (await response.json()) as { id: string; playerId: string };
    const bet = await fetch(`${url}/wagering/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'http-query' },
      body: JSON.stringify({
        providerId: 'p',
        externalTransactionId: 'bet',
        walletId: wallet.id,
        playerId: wallet.playerId,
        roundId: 'r',
        gameId: 'g',
        kind: 'BET',
        money: { amount: '10.00', currency: 'BRL' },
      }),
    });
    const result = (await bet.json()) as { transactionId: string };

    for (const path of [
      `/wallets/${wallet.id}`,
      `/wallets/${wallet.id}/ledger?limit=1`,
      `/wagering/transactions/${result.transactionId}`,
      '/providers/p/wagering/transactions/bet',
    ]) {
      expect((await fetch(url + path)).status).toBe(200);
    }

    expect((await fetch(`${url}/wallets/${wallet.id}/ledger?limit=0`)).status).toBe(400);
    expect((await fetch(`${url}/wallets/${wallet.id}/ledger?limit=1e2`)).status).toBe(400);
    expect((await fetch(`${url}/wallets/not-uuid`)).status).toBe(400);
    expect((await fetch(`${url}/wagering/transactions/${crypto.randomUUID()}`)).status).toBe(404);
    const reconciliation = await fetch(`${url}/wallets/${wallet.id}/reconciliation`, {
      method: 'POST',
    });
    expect(reconciliation.status).toBe(200);
    expect(await reconciliation.json()).toMatchObject({
      consistent: true,
      checkedEntries: 2,
      difference: { amount: '0.00', currency: 'BRL' },
    });
  } finally {
    await app.close();
    await db.close();
  }
}, 30000);
