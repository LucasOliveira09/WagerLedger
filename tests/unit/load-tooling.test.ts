import { expect, test } from 'bun:test';
import { loadConfig } from '../load/config.js';
import { counterDelta, latencySummary, metricTotal, parseMetrics } from '../load/metrics.js';

test('carga limita recursos e rejeita configuração inválida antes de criar serviços', () => {
  expect(loadConfig({}).concurrency).toBe(8);
  expect(loadConfig({ LOAD_HISTORY_ENTRIES: '0' }).historyEntries).toBe(0);
  for (const value of ['0', '-1', 'Infinity', '2.5', '1e2', '65']) {
    expect(() => loadConfig({ LOAD_CONCURRENCY: value })).toThrow();
  }
  expect(() => loadConfig({ LOAD_MAX_REQUESTS: '100001' })).toThrow();
});

test('percentis preservam cauda lenta e não inventam latência sem amostras', () => {
  const samples = [...Array.from({ length: 19 }, (_, index) => index + 1), 1000];
  expect(latencySummary(samples)).toMatchObject({ samples: 20, p50Ms: 10, p95Ms: 19, p99Ms: 1000, maxMs: 1000 });
  expect(samples.at(-1)).toBe(1000);
  expect(latencySummary([]).p95Ms).toBeNull();
  expect(() => latencySummary([NaN])).toThrow();
});

test('métricas excluem aquecimento e agregam labels sem confundir famílias', () => {
  const before = parseMetrics('lock_conflicts_total{code="55P03"} 2\nprocessing_seconds_count{source="http"} 3\n');
  const after = parseMetrics('lock_conflicts_total{code="55P03"} 5\nlock_conflicts_total{code="40P01"} 1\nlock_conflicts_total_extra 99\n');
  expect(metricTotal(after, 'lock_conflicts_total')).toBe(6);
  expect(counterDelta(before, after, 'lock_conflicts_total')).toBe(4);
  expect(counterDelta(before, after, 'missing_counter')).toBe(0);
  expect(() => counterDelta(after, before, 'lock_conflicts_total')).toThrow();
});
