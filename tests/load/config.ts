export interface LoadConfig {
  durationSeconds: number;
  concurrency: number;
  wallets: number;
  historyEntries: number;
  warmupRequests: number;
  maxRequests: number;
  timeoutSeconds: number;
  drainSeconds: number;
}

export function loadConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LoadConfig {
  // Este experimento provisiona recursos: limita o alvo ao ambiente local do desafio.
  for (const name of ['MIGRATION_DATABASE_URL', 'SQS_ENDPOINT']) {
    if (
      environment[name] &&
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(environment[name]).hostname)
    ) {
      throw new RangeError(`${name} deve apontar para o ambiente local.`);
    }
  }

  const integer = (name: string, fallback: number, minimum: number, maximum: number): number => {
    const value = environment[name] ?? String(fallback);

    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < minimum ||
      Number(value) > maximum
    ) {
      throw new RangeError(`${name} deve ser inteiro entre ${minimum} e ${maximum}.`);
    }

    return Number(value);
  };

  return {
    durationSeconds: integer('LOAD_DURATION_SECONDS', 10, 1, 300),
    concurrency: integer('LOAD_CONCURRENCY', 8, 1, 64),
    wallets: integer('LOAD_WALLETS', 16, 2, 100),
    historyEntries: integer('LOAD_HISTORY_ENTRIES', 0, 0, 10000),
    warmupRequests: integer('LOAD_WARMUP_REQUESTS', 20, 0, 10000),
    maxRequests: integer('LOAD_MAX_REQUESTS', 10000, 1, 100000),
    timeoutSeconds: integer('LOAD_TIMEOUT_SECONDS', 15, 1, 60),
    drainSeconds: integer('LOAD_DRAIN_SECONDS', 60, 1, 300),
  };
}
