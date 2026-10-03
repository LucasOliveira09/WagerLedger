import type { LogContext, MetricLabels, Telemetry } from '../../application/ports/telemetry.js';

const bounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
function series(name: string, labels: MetricLabels = {}): string {
  const values = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  return values.length ? `${name}{${values.join(',')}}` : name;
}
export class StructuredTelemetry implements Telemetry {
  private readonly values = new Map<string, number>();
  constructor(private readonly output: (line: string) => void = line => console.log(line)) {}
  count(name: string, labels?: MetricLabels): void { this.add(series(name, labels), 1); }
  observe(name: string, value: number, labels: MetricLabels = {}): void {
    this.add(series(`${name}_count`, labels), 1); this.add(series(`${name}_sum`, labels), value);
    for (const bound of [...bounds, Infinity]) if (value <= bound) this.add(series(`${name}_bucket`, { ...labels, le: bound === Infinity ? '+Inf' : String(bound) }), 1);
  }
  gauge(name: string, value: number): void { this.values.set(series(name), value); }
  log(level: 'info' | 'warn' | 'error', event: string, context: LogContext): void {
    const { correlationId, messageId, transactionId, walletId, providerId, code, attempt } = context;
    this.output(JSON.stringify({ timestamp: new Date().toISOString(), level, event, correlationId, messageId, transactionId, walletId, providerId, code, attempt }));
  }
  render(): string { return Array.from(this.values, ([key, value]) => `${key} ${value}`).join('\n') + '\n'; }
  private add(key: string, value: number): void { this.values.set(key, (this.values.get(key) ?? 0) + value); }
}
export const telemetry = new StructuredTelemetry();
