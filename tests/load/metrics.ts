export function latencySummary(samples: readonly number[]) {
  if (samples.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError('Latência inválida.');
  }

  const sorted = [...samples].sort((first, second) => first - second);
  // Nearest rank: a posição ceil(p * N) preserva a cauda observada, sem interpolação.
  const percentile = (fraction: number): number | null =>
    sorted.length ? sorted[Math.ceil(fraction * sorted.length) - 1]! : null;

  return {
    samples: sorted.length,
    minMs: sorted[0] ?? null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: sorted.at(-1) ?? null,
  };
}

export function parseMetrics(text: string): Map<string, number> {
  const result = new Map<string, number>();

  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) {
      continue;
    }

    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*(?:\{.*\})?)\s+(\S+)$/.exec(line);

    if (!match || !Number.isFinite(Number(match[2]))) {
      throw new Error('Métrica inválida.');
    }

    result.set(match[1]!, Number(match[2]));
  }

  return result;
}

export function metricTotal(metrics: ReadonlyMap<string, number>, name: string): number {
  let total = 0;

  for (const [series, value] of metrics) {
    if (series === name || series.startsWith(`${name}{`)) {
      total += value;
    }
  }

  return total;
}

export function counterDelta(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  name: string,
): number {
  const difference = metricTotal(after, name) - metricTotal(before, name);

  if (difference < 0) {
    throw new Error(`Contador reiniciou durante a carga: ${name}.`);
  }

  return difference;
}
