import { expect, test } from 'bun:test';
import { createTestDatabase } from '../support/test-database.js';
import { bootstrap } from '../../src/main.js';

test('HTTP cria wallet e distingue payload inválido de carteira duplicada', async () => {
  const db = await createTestDatabase();
  const app = await bootstrap({ databaseUrl: db.url, port: 0, host: '127.0.0.1', quiet: true });
  const url = `${await app.getUrl()}/wallets`;
  const input = { playerId: crypto.randomUUID(), initialBalance: { amount: '100.00', currency: 'BRL' } };
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const response = await post(input);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ playerId: input.playerId, balance: input.initialBalance, version: 1 });
    expect((await post(input)).status).toBe(409);
    expect((await post({ ...input, playerId: 'invalid' })).status).toBe(400);
    expect((await post({ ...input, initialBalance: { amount: 100, currency: 'BRL' } })).status).toBe(400);
  } finally { await app.close(); await db.close(); }
}, 30000);
