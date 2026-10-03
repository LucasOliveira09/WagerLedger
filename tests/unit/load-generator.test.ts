import { expect, test } from 'bun:test';
import { runLoad } from '../load/generator.js';

test('gerador respeita concorrência, limita volume e usa uma identidade por operação', async () => {
  let active = 0; let maximum = 0; const keys = new Set<string>(); const wallets = new Set<string>();
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    active++; maximum = Math.max(maximum, active);
    const body = await request.json() as { walletId: string; money: { amount: string } };
    expect(body.money.amount).toBe('1.00');
    keys.add(request.headers.get('idempotency-key')!); wallets.add(body.walletId);
    await Bun.sleep(5); active--;
    return Response.json({ transactionId: crypto.randomUUID(), status: 'PROCESSED', idempotentReplay: false, balance: { amount: '100.00', currency: 'BRL' } });
  } });
  try {
    const result = await runLoad({ baseUrl: server.url.toString(), wallets: [{ id: 'a', playerId: 'p' }, { id: 'b', playerId: 'q' }],
      concurrency: 3, durationMs: 1000, maxRequests: 12, timeoutMs: 500, prefix: 'control' });
    expect(result.requests).toBe(12); expect(result.successes).toBe(12);
    expect(result.errorRate).toBe(0); expect(result.uniqueTransactionIds).toBe(12);
    expect(maximum).toBe(3); expect(keys.size).toBe(12); expect(wallets.size).toBe(2);
    expect(result.latency.samples).toBe(12); expect(result.requestLimitReached).toBe(true);
  } finally { await server.stop(true); }
});

test('gerador contabiliza respostas de erro e timeout sem tratá-los como sucesso', async () => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const key = request.headers.get('idempotency-key')!;
    if (key.endsWith(':0')) return Response.json({ error: { code: 'INFRASTRUCTURE_UNAVAILABLE' } }, { status: 503 });
    await Bun.sleep(100);
    return Response.json({});
  } });
  try {
    const result = await runLoad({ baseUrl: server.url.toString(), wallets: [{ id: 'a', playerId: 'p' }],
      concurrency: 1, durationMs: 1000, maxRequests: 2, timeoutMs: 20, prefix: 'failure' });
    expect(result.errors).toBe(2); expect(result.successes).toBe(0);
    expect(result.failures.HTTP_503).toBe(1); expect(result.failures.TIMEOUT).toBe(1);
    expect(result.errorRate).toBe(1); expect(result.latency.samples).toBe(2);
  } finally { await server.stop(true); }
});

test('cancelamento impede novas operações de carga', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runLoad({ baseUrl: 'http://127.0.0.1:1', wallets: [{ id: 'a', playerId: 'p' }], concurrency: 2,
    durationMs: 1000, maxRequests: 10, timeoutMs: 100, prefix: 'cancelled', signal: controller.signal });
  expect(result.requests).toBe(0); expect(result.latency.p99Ms).toBeNull();
});
