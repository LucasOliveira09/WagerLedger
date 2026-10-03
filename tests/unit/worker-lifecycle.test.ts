import { expect, test } from 'bun:test';
import { WorkerLifecycle } from '../../src/interfaces/workers/worker-lifecycle.js';
test('shutdown interrompe novas leituras e espera operação em andamento', async () => {
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
  let reads = 0; let cancelled = false; let finished = false;
  const lifecycle = new WorkerLifecycle([{ async tick() { reads++; entered(); await barrier; finished = true; return 1; }, requestStop() { cancelled = true; } }]);
  const running = lifecycle.run(); await ready; lifecycle.requestStop();
  expect(cancelled).toBe(true); expect(finished).toBe(false);
  release(); await running; expect(finished).toBe(true); expect(reads).toBe(1);
});
