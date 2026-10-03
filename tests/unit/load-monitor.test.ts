import { expect, test } from 'bun:test';
import { startMonitor } from '../load/monitor.js';

test('monitor espera o gauge residual do aquecimento zerar antes da medição', async () => {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => {
      calls++;

      return new Response(
        `outbox_lag_seconds ${calls <= 2 ? 10 : 0}\ntransactions_total{status="PROCESSED"} 20\n`,
      );
    },
  });

  try {
    const monitor = await startMonitor(
      server.url.toString().replace(/\/$/, ''),
      server.url.toString().replace(/\/$/, ''),
    );
    const report = await monitor.stop();
    expect(report.maxOutboxLagSeconds).toBe(0);
    expect(report.api.processed).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(6);
  } finally {
    await server.stop(true);
  }
});
