import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { bootstrap } from '../../src/main.js';

test('HTTP distingue processamento, replay, conflito e rejeição de negócio', async () => {
  const db = await createTestDatabase();
  const app = await bootstrap({ databaseUrl: db.url, port: 0, host: '127.0.0.1', quiet: true });
  const base = await app.getUrl();

  try {
    const opened = await fetch(`${base}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: crypto.randomUUID(),
        initialBalance: { amount: '100.00', currency: 'BRL' },
      }),
    });
    const wallet = (await opened.json()) as { id: string; playerId: string };
    const input = {
      providerId: 'provider',
      externalTransactionId: 'bet',
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: 'round',
      gameId: 'game',
      kind: 'BET',
      money: { amount: '25.00', currency: 'BRL' },
    };
    const post = (body: unknown, key?: string) =>
      fetch(`${base}/wagering/transactions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
        body: JSON.stringify(body),
      });
    expect((await post(input)).status).toBe(400);
    const processed = await post(input, 'key');
    expect(processed.status).toBe(200);
    expect(await processed.json()).toMatchObject({
      status: 'PROCESSED',
      balance: { amount: '75.00', currency: 'BRL' },
      idempotentReplay: false,
    });
    expect(await (await post(input, 'key')).json()).toMatchObject({ idempotentReplay: true });
    expect(
      (await post({ ...input, money: { amount: '26.00', currency: 'BRL' } }, 'key')).status,
    ).toBe(409);
    expect(
      (
        await post(
          { ...input, externalTransactionId: 'huge', money: { amount: '80.00', currency: 'BRL' } },
          'huge',
        )
      ).status,
    ).toBe(422);
    expect((await post({ ...input, kind: 'OPENING' }, 'internal')).status).toBe(400);
  } finally {
    await app.close();
    await db.close();
  }
}, 30000);
