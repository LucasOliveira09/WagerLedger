import { expect, test } from 'bun:test';
import { StructuredTelemetry } from '../../src/infrastructure/observability/telemetry.js';
test('telemetria agrega séries e limita campos de log', () => {
  const logs: string[] = []; const telemetry = new StructuredTelemetry(line => logs.push(line));
  telemetry.count('transactions_total', { status: 'PROCESSED' }); telemetry.count('transactions_total', { status: 'PROCESSED' });
  telemetry.observe('processing_seconds', 0.03); telemetry.gauge('outbox_lag_seconds', 2);
  telemetry.log('warn', 'reconciliation_diverged', { walletId: 'w', correlationId: 'c', ...{ password: 'secret', money: '100.00' } });
  expect(telemetry.render()).toContain('transactions_total{status="PROCESSED"} 2');
  expect(telemetry.render()).toContain('processing_seconds_bucket{le="0.05"} 1');
  expect(logs[0]).not.toContain('secret'); expect(JSON.parse(logs[0]!)).toMatchObject({ level: 'warn', walletId: 'w', correlationId: 'c' });
});
