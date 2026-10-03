import { latencySummary } from './metrics.js';

export interface LoadWallet { id: string; playerId: string }
export interface GeneratorOptions {
  baseUrl: string; wallets: readonly LoadWallet[]; concurrency: number; durationMs: number;
  maxRequests: number; timeoutMs: number; prefix: string;
}
interface BetResult { status: number; transactionId?: string; failure?: string }
export async function submitBet(baseUrl: string, wallet: LoadWallet, identity: string, timeoutMs: number): Promise<BetResult> {
  try {
    const response = await fetch(new URL('/wagering/transactions', baseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': identity, 'x-correlation-id': identity },
      body: JSON.stringify({ providerId: 'load-test', externalTransactionId: identity, walletId: wallet.id,
        playerId: wallet.playerId, roundId: 'load-round', gameId: 'load-game', kind: 'BET', money: { amount: '1.00', currency: 'BRL' } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.json() as { transactionId?: string; status?: string; idempotentReplay?: boolean; balance?: { amount?: string; currency?: string } };
    if (response.status !== 200) return { status: response.status, failure: `HTTP_${response.status}` };
    if (typeof body.transactionId !== 'string' || body.status !== 'PROCESSED' || body.idempotentReplay !== false
      || body.balance?.currency !== 'BRL' || typeof body.balance.amount !== 'string' || !/^(0|[1-9]\d*)\.\d{2}$/.test(body.balance.amount)) {
      return { status: response.status, failure: 'INVALID_RESPONSE' };
    }
    return { status: response.status, transactionId: body.transactionId };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { status: 0, failure: ['TimeoutError', 'AbortError'].includes(name) ? 'TIMEOUT' : 'TRANSPORT_OR_JSON_ERROR' };
  }
}
export async function runLoad(options: GeneratorOptions) {
  if (!options.wallets.length || options.concurrency < 1 || options.maxRequests < 1 || options.durationMs <= 0) throw new RangeError('Carga vazia ou inválida.');
  const latencies: number[] = []; const ids = new Set<string>();
  const statusCounts: Record<string, number> = {}; const failures: Record<string, number> = {};
  let sent = 0; let successes = 0;
  const started = performance.now();
  // Modelo fechado: cada conexão lógica só envia a próxima operação quando termina a atual.
  // Não há retry do cliente; toda operação tem identidade única e entra nas estatísticas.
  await Promise.all(Array.from({ length: options.concurrency }, async () => {
    while (sent < options.maxRequests && performance.now() - started < options.durationMs) {
      const index = sent++;
      const wallet = options.wallets[index % options.wallets.length]!;
      const requestStarted = performance.now();
      const result = await submitBet(options.baseUrl, wallet, `${options.prefix}:${index}`, options.timeoutMs);
      latencies.push(performance.now() - requestStarted);
      const status = String(result.status); statusCounts[status] = (statusCounts[status] ?? 0) + 1;
      const failure = result.failure ?? (ids.has(result.transactionId!) ? 'DUPLICATE_TRANSACTION_ID' : undefined);
      if (failure) failures[failure] = (failures[failure] ?? 0) + 1;
      else { successes++; ids.add(result.transactionId!); }
    }
  }));
  const elapsedMs = performance.now() - started;
  return { requests: sent, successes, errors: sent - successes, errorRate: sent ? (sent - successes) / sent : 0,
    elapsedMs, throughputRps: sent / (elapsedMs / 1000), successfulRps: successes / (elapsedMs / 1000),
    statusCounts, failures, uniqueTransactionIds: ids.size, requestLimitReached: sent >= options.maxRequests,
    latency: latencySummary(latencies) };
}
