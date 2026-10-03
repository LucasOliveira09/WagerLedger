import { expect, test } from 'bun:test';
import { bootstrap } from '../../src/main.js';
import { createTestDatabase } from '../support/test-database.js';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';

test('Swagger serve contratos completos e assets locais sem alterar o processamento HTTP', async () => {
  const db = await createTestDatabase();
  const app = await bootstrap({ databaseUrl: db.appUrl, port: 0, host: '127.0.0.1', quiet: true });
  const base = await app.getUrl();

  try {
    const ui = await fetch(`${base}/docs/`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('swagger-ui');
    const schemaResponse = await fetch(`${base}/docs/openapi.json`);
    expect(schemaResponse.status).toBe(200);
    const document = (await schemaResponse.json()) as OpenAPIObject;
    expect(document.openapi).toBe('3.0.3');
    expect(Object.keys(document.paths).sort()).toEqual(
      [
        '/health/live',
        '/health/ready',
        '/metrics',
        '/providers/{providerId}/wagering/transactions/{externalTransactionId}',
        '/wagering/transactions',
        '/wagering/transactions/{transactionId}',
        '/wallets',
        '/wallets/{walletId}',
        '/wallets/{walletId}/ledger',
        '/wallets/{walletId}/reconciliation',
      ].sort(),
    );
    const yaml = await fetch(`${base}/docs/openapi.yaml`);
    expect(yaml.status).toBe(200);
    expect(await yaml.text()).toContain('openapi: 3.0.3');
    expect((await fetch(`${base}/docs/swagger-ui-bundle.js`)).status).toBe(200);
    const live = await fetch(`${base}/health/live`);
    expect(await live.json()).toEqual({ status: 'alive' });
    const opened = await fetch(`${base}/wallets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        playerId: crypto.randomUUID(),
        initialBalance: { amount: '100.00', currency: 'BRL' },
      }),
    });
    const wallet = (await opened.json()) as { id: string };
    const ledger = (await (await fetch(`${base}/wallets/${wallet.id}/ledger`)).json()) as {
      entries: { transactionId: string }[];
    };
    const opening = (await (
      await fetch(`${base}/wagering/transactions/${ledger.entries[0]!.transactionId}`)
    ).json()) as { providerId: string; failureCode: null };
    expect(opening.providerId).toBe('__internal__');
    expect(opening.failureCode).toBeNull();
    const schema = document.components!.schemas!.Transaction as SchemaObject;
    const provider = schema.properties!.providerId as SchemaObject;
    const failure = schema.properties!.failureCode as SchemaObject;
    expect(new RegExp(provider.pattern!).test(opening.providerId)).toBe(true);
    expect(failure.enum).toContain(opening.failureCode);
  } finally {
    await app.close();
    await db.close();
  }
}, 30000);
