export type MetricLabels = Readonly<Record<string, string>>;
export interface LogContext { correlationId?: string; messageId?: string; transactionId?: string; walletId?: string; providerId?: string; code?: string; attempt?: number }
export interface Telemetry {
  count(name: string, labels?: MetricLabels): void;
  observe(name: string, value: number, labels?: MetricLabels): void;
  gauge(name: string, value: number): void;
  log(level: 'info' | 'warn' | 'error', event: string, context: LogContext): void;
}
export const nullTelemetry: Telemetry = Object.freeze({ count() {}, observe() {}, gauge() {}, log() {} });
